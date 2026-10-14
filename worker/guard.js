// Guard: one Durable Object for the whole site ("the kill switch").
// Counts new rooms per UTC day and refuses new ones above MAX_NEW_ROOMS_PER_DAY,
// or always when PAUSE_NEW_ROOMS = "1". Rooms already open keep working either way.
// Cloudflare has no spending cap, so this is our own brake against a bug or abuse burning the quota.
import { DurableObject } from "cloudflare:workers";

const DAYS_KEPT = 14;

export class Guard extends DurableObject {
  // Returns { ok, reason?, count }.
  async allowRoom(game, max, paused) {
    const day = new Date().toISOString().slice(0, 10);
    const key = "d:" + day;
    const d = (await this.ctx.storage.get(key)) || { total: 0, blocked: 0, games: {} };
    let res;
    if (paused) res = { ok: false, reason: "paused" };
    else if (d.total >= max) res = { ok: false, reason: "cap" };
    else res = { ok: true };
    if (res.ok) {
      d.total += 1;
      d.games[game] = (d.games[game] || 0) + 1;
    } else d.blocked += 1;
    await this.ctx.storage.put(key, d);
    if (d.total === 1 || d.blocked === 1) await this.prune();
    return { ...res, count: d.total };
  }

  // Presence and the quick-match lists live in this object's SQLite storage, not only in memory:
  // a quiet Durable Object is evicted after a few seconds and would forget everything.
  sql() {
    if (!this.ready) {
      const q = this.ctx.storage.sql;
      q.exec("CREATE TABLE IF NOT EXISTS who (id TEXT PRIMARY KEY, at INTEGER, place TEXT, state TEXT, hist TEXT)");
      q.exec("CREATE TABLE IF NOT EXISTS pub (k TEXT, code TEXT, until INTEGER, PRIMARY KEY (k, code))");
      this.ready = true;
    }
    return this.ctx.storage.sql;
  }

  // ---- presence: who is on the site right now, where, and what they usually play ----
  // Every open page says hello about every 25 s (and when it changes screen). A page quiet for
  // 45 s is gone. No names: a cookie id, a place and play counts.
  async seen(id, d) {
    const now = Date.now(), q = this.sql();
    const hist = {};
    if (d && d.hist && typeof d.hist === "object") for (const [k, v] of Object.entries(d.hist).slice(0, 12)) {
      if (/^[a-z]{2,12}$/.test(k)) hist[k] = Math.max(0, Math.min(10_000, Number(v) || 0));
    }
    q.exec("INSERT OR REPLACE INTO who (id, at, place, state, hist) VALUES (?, ?, ?, ?, ?)",
      String(id).slice(0, 80), now, String((d && d.where) || "hub").slice(0, 12), String((d && d.state) || "menu").slice(0, 8), JSON.stringify(hist));
    if (!this.pruned || now - this.pruned > 30_000) { this.pruned = now; q.exec("DELETE FROM who WHERE at < ?", now - 60_000); }
    return { ok: true };
  }
  present() {
    return this.sql().exec("SELECT id, place, state, hist FROM who WHERE at > ?", Date.now() - 45_000).toArray();
  }

  // How many real people are likely to sit at a new quick-match table of `game` in the next seconds.
  // Someone on that game's start screen is likely; someone on the main page who often plays it a bit;
  // someone elsewhere who often plays it, a little. People already at a table or in a room don't count.
  // Returns how many seats to keep open for them, and for how long (4-10 s, never more).
  async plan(game, me) {
    let e = 0;
    for (const u of this.present()) {
      if (u.id === me || u.state === "play" || u.state === "room" || u.state === "search") continue;
      let h = {}; try { h = JSON.parse(u.hist) || {}; } catch {}
      const total = Object.values(h).reduce((a, b) => a + b, 0);
      const pref = ((h[game] || 0) + 0.5) / (total + 3);          // their share of this game, smoothed
      let p = u.place === game ? 0.5 : u.place === "hub" ? 0.3 * pref : 0.08 * pref;
      if (u.state === "idle") p *= 0.3;
      e += p;
    }
    const reserve = e >= 0.35 ? Math.min(3, Math.round(e + 0.15)) : 0;
    const hold = reserve ? Math.round(4_000 + Math.min(1, e) * 6_000) : 0;
    return { reserve, hold, e: Math.round(e * 100) / 100 };
  }

  // people on the site, and per page
  async online() {
    const by = {};
    const list = this.present();
    for (const u of list) by[u.place] = (by[u.place] || 0) + 1;
    return { all: list.length, by };
  }

  // ---- quick match: public tables people can sit at, newest first, one list per game + settings ----
  // A table stays listed while it may have a seat for someone (lobby, or a bot's seat in a match);
  // the Worker asks the table itself before sending anyone there.
  async findPublic(key) {
    const q = this.sql();
    q.exec("DELETE FROM pub WHERE until < ?", Date.now());
    return q.exec("SELECT code FROM pub WHERE k = ? ORDER BY until DESC LIMIT 6", key).toArray().map((r) => r.code);
  }
  async addPublic(key, code) {
    const q = this.sql();
    q.exec("INSERT OR REPLACE INTO pub (k, code, until) VALUES (?, ?, ?)", key, code, Date.now() + 40 * 60_000);
    q.exec("DELETE FROM pub WHERE k = ? AND code NOT IN (SELECT code FROM pub WHERE k = ? ORDER BY until DESC LIMIT 12)", key, key);
  }
  async closePublic(key, code) {
    this.sql().exec("DELETE FROM pub WHERE k = ? AND code = ?", key, code);
  }

  async stats() {
    const all = await this.ctx.storage.list({ prefix: "d:" });
    const days = {};
    for (const [k, v] of all) days[k.slice(2)] = v;
    return days;
  }

  async prune() {
    const all = await this.ctx.storage.list({ prefix: "d:" });
    const keys = [...all.keys()].sort();
    const drop = keys.slice(0, Math.max(0, keys.length - DAYS_KEPT));
    if (drop.length) await this.ctx.storage.delete(drop);
  }
}
