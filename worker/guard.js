// Guard: one Durable Object for the whole site ("the kill switch").
// Counts new rooms per UTC day and refuses new ones above MAX_NEW_ROOMS_PER_DAY,
// or always when PAUSE_NEW_ROOMS = "1". Rooms already open keep working either way.
// Cloudflare has no spending cap, so this is our own brake against a bug or abuse burning the quota.
import { DurableObject } from "cloudflare:workers";
import { meter } from "./meter.js";

const DAYS_KEPT = 14;
const MENU_TTL = 75_000, PLAY_TTL = 330_000;

export class Guard extends DurableObject {
  // ---- the dashboard's counters: kept in memory, added to today's record every 2 minutes ----
  c() {
    if (!this.cnt) this.cnt = { req: 0, rows: 0, pings: 0, plays: {}, since: Date.now() };
    return this.cnt;
  }
  count(what) {
    meter(this.env, "do", what);
    this.c().req += 1;
    this.daily(() => this.flushCounts()).catch(() => {});
  }
  // Every change to today's record goes through here, one after another: two tables closing at the same moment
  // must not read the same record and overwrite each other's numbers.
  daily(fn) {
    const run = (this.chain || Promise.resolve()).then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }
  // Adds the in-memory counts to today's record, at most once a minute for the whole site (≤ 1,440 storage writes a day).
  // Checking costs only a read. This object sleeps when the site is quiet, so counts aren't left in memory for long.
  async flushCounts(force) {
    const c = this.cnt; if (!c) return;
    const key = "u:" + new Date().toISOString().slice(0, 10);
    const d = (await this.ctx.storage.get(key)) || { req: 0, msg: 0, rows: 0, conn: 0, tables: 0, pings: 0, plays: {}, server: {}, solo: {}, last: 0 };
    if (!force && Date.now() - (d.last || 0) < 60_000) return;
    this.cnt = null;
    d.req += c.req; d.rows += c.rows + 1; d.pings += c.pings; d.last = Date.now();
    for (const [g, n] of Object.entries(c.plays)) d.plays[g] = (d.plays[g] || 0) + n;
    meter(this.env, "rows", "guard usage day", 1);
    await this.ctx.storage.put(key, d);
  }
  // a table closed: what it cost (rooms count their own requests, messages and storage writes)
  async usage(game, u, phase) {
    this.count("rpc guard.usage");
    return this.daily(() => this.addUsage(game, u, phase));
  }
  async addUsage(game, u, phase) {
    const key = "u:" + new Date().toISOString().slice(0, 10);
    const d = (await this.ctx.storage.get(key)) || { req: 0, msg: 0, rows: 0, conn: 0, tables: 0, pings: 0, plays: {}, server: {}, solo: {} };
    d.req += Number(u.req) || 0; d.msg += Number(u.msg) || 0; d.rows += (Number(u.rows) || 0) + 1; d.conn += Number(u.conn) || 0; d.tables += 1;
    const g = String(game).slice(0, 12);
    if (phase === "solo") d.solo[g] = (d.solo[g] || 0) + 1; else d.server[g] = (d.server[g] || 0) + 1;
    meter(this.env, "rows", "guard usage day", 1);
    await this.ctx.storage.put(key, d);
    return true;
  }
  // everything the dashboard shows, in one call
  async dash() {
    this.count("rpc guard.dash");
    await this.daily(() => this.flushCounts(true));
    const now = Date.now();
    const days = {};
    for (const [k, v] of await this.ctx.storage.list({ prefix: "u:" })) days[k.slice(2)] = v;
    const rooms = {};
    for (const [k, v] of await this.ctx.storage.list({ prefix: "d:" })) rooms[k.slice(2)] = v;
    const people = this.present().map((u) => ({ place: u.place, state: u.state, ago: Math.round((now - u.at) / 1000) }));
    return { now, people, days, rooms };
  }

  // Returns { ok, reason?, count }.
  async allowRoom(game, max, paused) {
    this.count("rpc guard.allowRoom");
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
    meter(this.env, "rows", "guard day count", 1); this.c().rows += 1; await this.ctx.storage.put(key, d);
    if (d.total === 1 || d.blocked === 1) await this.prune();
    return { ...res, count: d.total };
  }

  // Presence and the quick-match lists live in this object's SQLite storage, not only in memory:
  // a quiet Durable Object is evicted after a few seconds and would forget everything.
  sql() {
    if (!this.metered) {
      const raw = this.ctx.storage.sql, env = this.env, self = this;
      this.metered = { exec: (...a) => { const c = raw.exec(...a); try { const n = c.rowsWritten || 0; if (n) { meter(env, "rows", "guard sql", n); self.c().rows += n; } } catch {} return c; } };
    }
    if (!this.ready) {
      const q = this.ctx.storage.sql;
      q.exec("CREATE TABLE IF NOT EXISTS who (id TEXT PRIMARY KEY, at INTEGER, place TEXT, state TEXT, hist TEXT)");
      q.exec("CREATE TABLE IF NOT EXISTS pub (k TEXT, code TEXT, until INTEGER, PRIMARY KEY (k, code))");
      q.exec("CREATE TABLE IF NOT EXISTS inv (dest TEXT, src TEXT, uname TEXT, code TEXT, game TEXT, at INTEGER, PRIMARY KEY (dest, src))");
      try { q.exec("ALTER TABLE who ADD COLUMN uid TEXT"); } catch {}       // signed-in players (friends' online dots)
      this.ready = true;
    }
    return this.metered || this.ctx.storage.sql;
  }

  // ---- presence: who is on the site right now, where, and what they usually play ----
  // Every open page says hello about every 25 s (and when it changes screen). A page quiet for
  // 45 s is gone. No names: a cookie id, a place and play counts.
  // Presence lives in this object's memory; storage is written only when someone's place/state changes (or every
  // 10 min), not on every "I'm here". A heartbeat costs no storage write. If the object was evicted, it reloads
  // what storage has and catches up within a minute as the pages report in.
  //   TTL: a page on a menu reports every 60 s and is gone after 75 s; a page at a table reports every 5 min.
  mem() {
    if (!this.who) {
      this.who = new Map();
      for (const r of this.sql().exec("SELECT id, at, place, state, hist, uid FROM who WHERE at > ?", Date.now() - PLAY_TTL).toArray())
        this.who.set(r.id, { ...r, saved: r.at });
    }
    return this.who;
  }
  async seen(id, d, uid) {
    this.count("rpc guard.seen");
    const now = Date.now(), q = this.sql(), who = this.mem();
    const hist = {};
    if (d && d.hist && typeof d.hist === "object") for (const [k, v] of Object.entries(d.hist).slice(0, 12)) {
      if (/^[a-z]{2,12}$/.test(k)) hist[k] = Math.max(0, Math.min(10_000, Number(v) || 0));
    }
    id = String(id).slice(0, 80);
    const row = { id, at: now, place: String((d && d.where) || "hub").slice(0, 12), state: String((d && d.state) || "menu").slice(0, 8), hist: JSON.stringify(hist), uid: uid || null };
    const prev = who.get(id);
    const c = this.c();
    c.pings += 1;
    if (row.state === "play" && row.place !== "hub" && (!prev || prev.state !== "play" || prev.place !== row.place)) c.plays[row.place] = (c.plays[row.place] || 0) + 1;
    if (!prev || prev.place !== row.place || prev.state !== row.state || prev.uid !== row.uid || now - prev.saved > 10 * 60_000) {
      q.exec("INSERT OR REPLACE INTO who (id, at, place, state, hist, uid) VALUES (?, ?, ?, ?, ?, ?)", row.id, row.at, row.place, row.state, row.hist, row.uid);
      row.saved = now;
    } else row.saved = prev.saved;
    who.set(id, row);
    if (!this.pruned || now - this.pruned > 60_000) {
      this.pruned = now;
      for (const [k, v] of who) if (now - v.at > PLAY_TTL) who.delete(k);
      if (!this.sqlPruned || now - this.sqlPruned > 10 * 60_000) {
        this.sqlPruned = now;
        q.exec("DELETE FROM who WHERE at < ?", now - 15 * 60_000);
        q.exec("DELETE FROM inv WHERE at < ?", now - 120_000);
      }
    }
    // invitations waiting for this player: handed over once (only signed-in players can have any)
    let invites = [];
    if (uid) {                                   // a read, not a write: cheap
      invites = q.exec("SELECT src, uname, code, game, at FROM inv WHERE dest = ? AND at > ?", uid, now - 120_000).toArray();
      if (invites.length) q.exec("DELETE FROM inv WHERE dest = ?", uid);
    }
    // one call answers everything the page needs: its invitations and how many people are on the site
    return { invites, ...this.counts() };
  }

  // ---- friends: who of them is on the site, and invitations to a table ----
  async whereAre(uids) {
    this.count("rpc guard.whereAre");
    const out = {};
    if (!Array.isArray(uids) || !uids.length) return out;
    const want = new Set(uids.slice(0, 300));
    for (const r of this.present()) {
      if (!r.uid || !want.has(r.uid)) continue;
      if (!out[r.uid] || out[r.uid].at < r.at) out[r.uid] = { place: r.place, state: r.state, at: r.at };
    }
    return out;
  }
  async invite(dest, src, uname, code, game) {
    this.count("rpc guard.invite");
    this.sql().exec("INSERT OR REPLACE INTO inv (dest, src, uname, code, game, at) VALUES (?, ?, ?, ?, ?, ?)", dest, src, uname, code, game, Date.now());
    return { ok: true };
  }

  // the key that signs session cookies: made once, kept here
  async secret() {
    this.count("rpc guard.secret");
    let k = await this.ctx.storage.get("session-secret");
    if (!k) { const b = new Uint8Array(48); crypto.getRandomValues(b); k = [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); await this.ctx.storage.put("session-secret", k); }
    return k;
  }
  present() {
    const now = Date.now(), out = [];
    for (const v of this.mem().values()) if (now - v.at < (v.state === "play" ? PLAY_TTL : MENU_TTL)) out.push(v);
    return out;
  }
  counts() {
    const by = {};
    const list = this.present();
    for (const u of list) by[u.place] = (by[u.place] || 0) + 1;
    return { all: list.length, by };
  }

  // How many real people are likely to sit at a new quick-match table of `game` in the next seconds.
  // Someone on that game's start screen is likely; someone on the main page who often plays it a bit;
  // someone elsewhere who often plays it, a little. People already at a table or in a room don't count.
  // Returns how many seats to keep open for them, and for how long (4-10 s, never more).
  async plan(game, me) {
    this.count("rpc guard.plan");
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
    this.count("rpc guard.online");
    return this.counts();
  }

  // ---- quick match: public tables people can sit at, newest first, one list per game + settings ----
  // A table stays listed while it may have a seat for someone (lobby, or a bot's seat in a match);
  // the Worker asks the table itself before sending anyone there.
  async findPublic(key) {
    this.count("rpc guard.findPublic");
    const q = this.sql();
    q.exec("DELETE FROM pub WHERE until < ?", Date.now());
    return q.exec("SELECT code FROM pub WHERE k = ? ORDER BY until DESC LIMIT 6", key).toArray().map((r) => r.code);
  }
  async addPublic(key, code) {
    this.count("rpc guard.addPublic");
    const q = this.sql();
    q.exec("INSERT OR REPLACE INTO pub (k, code, until) VALUES (?, ?, ?)", key, code, Date.now() + 40 * 60_000);
    q.exec("DELETE FROM pub WHERE k = ? AND code NOT IN (SELECT code FROM pub WHERE k = ? ORDER BY until DESC LIMIT 12)", key, key);
  }
  async closePublic(key, code) {
    this.count("rpc guard.closePublic");
    this.sql().exec("DELETE FROM pub WHERE k = ? AND code = ?", key, code);
  }

  async stats() {
    this.count("rpc guard.stats");
    const all = await this.ctx.storage.list({ prefix: "d:" });
    const days = {};
    for (const [k, v] of all) days[k.slice(2)] = v;
    return days;
  }

  async prune() {
    for (const prefix of ["d:", "u:"]) {
      const all = await this.ctx.storage.list({ prefix });
      const keys = [...all.keys()].sort();
      const drop = keys.slice(0, Math.max(0, keys.length - DAYS_KEPT));
      if (drop.length) await this.ctx.storage.delete(drop);
    }
  }
}
