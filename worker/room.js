// Room: one Durable Object per room code. Holds the lobby (players, host) and hands every
// game-specific message to the game module (games/mafia.js, games/imposter.js).
//
// Identity: every phone has a SECRET key (HttpOnly cookie, or a localStorage key when cookies
// are blocked) and gets a PUBLIC seat id here. Only public ids are ever sent to other phones,
// so knowing someone's seat id never lets you connect as them.
//
// Server-authoritative: each phone only ever receives what it is allowed to see (its own role
// or word); the game modules build a separate view for every socket.
import { DurableObject } from "cloudflare:workers";
import { publicId, cleanName } from "./util.js";
import { logIncident } from "./incidents.js";
import mafia from "./games/mafia.js";
import imposter from "./games/imposter.js";
import murlan from "./games/murlan.js";
import spathi from "./games/spathi.js";
import derri from "./games/derri.js";
import domino from "./games/domino.js";

export const GAMES = { mafia, imposter, murlan, spathi, derri, domino };
const MAX_PLAYERS = 30;
const MSG_WINDOW_MS = 10_000;   // per-socket message budget
const MSG_MAX = 40;
const HOST_GRACE_MS = 60_000;   // someone else may take over as host after the host has been gone this long

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.s = null;
    this.rate = new Map();
    // Keep-alive pings are answered by Cloudflare without waking the room (no cost, no CPU).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get("s")) || null;
    });
  }

  ttl() {
    const m = Number(this.env.ROOM_TTL_MINUTES);
    return (m > 0 ? m : 360) * 60_000;
  }

  async save() {
    this.s.touched = Date.now();
    await this.flush();
    await this.ctx.storage.put("s", this.s);
  }

  // ---- faults: the game modules write them on s.faults; they go to the incident log, never into storage ----
  fault(kind, e, extra) {
    if (!this.s) return;
    (this.s.faults = this.s.faults || []).push({ kind, msg: String((e && e.message) || e || "").slice(0, 300), stack: e && e.stack ? String(e.stack).slice(0, 900) : "", ...(extra || {}) });
  }
  async flush() {
    const s = this.s;
    if (!s || !s.faults || !s.faults.length) { if (s) delete s.faults; return; }
    const list = s.faults; delete s.faults;
    for (const f of list.slice(0, 6)) {
      const { kind, msg, ...detail } = f;
      await logIncident(this.env, { src: "server", kind, game: s.game, room: s.code, msg, detail });
    }
  }
  // one step of the table's own clock (also used by "nudge"); never throws
  tick(cheap) {
    const s = this.s, game = GAMES[s.game];
    if (!game.onTick) return false;
    try { return game.onTick(s, Date.now(), this.online(), { cheap }); }
    catch (e) { this.fault("tick threw", e); return true; }
  }

  // ---- called by the Worker (RPC) ----
  async init(code, game, opts = {}) {
    if (!GAMES[game]) return null;
    if (this.s && Date.now() - this.s.touched < this.ttl()) return null; // code still in use
    this.s = {
      code, game, created: Date.now(), touched: Date.now(),
      hostToken: crypto.randomUUID(), hostPid: null, hostOffAt: 0,
      players: [], round: 0, g: GAMES[game].init(opts),
    };
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + this.ttl());
    return { hostToken: this.s.hostToken };
  }

  async info() {
    if (!this.s) return { ok: false };
    const g = this.s.g || {};
    const on = this.online();
    const seated = Array.isArray(g.seats) ? g.seats.filter((x) => x && !x.bot && on.has(x.pid)).length : this.s.players.length;   // people actually there
    return { ok: true, game: this.s.game, players: this.s.players.length, humans: seated, phase: g.phase || null,
      open: GAMES[this.s.game].canJoin ? GAMES[this.s.game].canJoin(this.s) : true, cfg: g.cfg || null };
  }

  // Rooms delete themselves after ROOM_TTL_MINUTES without any activity (default 6 hours).
  // Long on purpose: in Mafia every phone can stay locked for the whole game night.
  // One alarm does two jobs: the next move a table has to make by itself (a seat on autopilot,
  // a turn that ran out of time), and deleting the room after ROOM_TTL_MINUTES of no activity.
  async schedule() {
    if (!this.s) return;
    const game = GAMES[this.s.game];
    let wake = 0;
    try { wake = game.wakeAt ? game.wakeAt(this.s, this.online()) : 0; } catch (e) { this.fault("wakeAt threw", e); wake = Date.now() + 2000; }
    const ttl = this.s.touched + this.ttl();
    // tests only: CHAOS_DROP_ALARMS (set with `wrangler dev --var`, never on the live site) loses some of the
    // table's clock ticks on purpose, like Cloudflare giving up on an alarm, to prove the phones' nudges save the table
    const chaos = Number(this.env.CHAOS_DROP_ALARMS || 0);
    if (chaos && wake && Math.random() < chaos) { await this.ctx.storage.setAlarm(ttl); return; }
    await this.ctx.storage.setAlarm(wake ? Math.max(Date.now() + 50, Math.min(wake, ttl)) : ttl);
    await this.flush();
  }

  // alarmInfo.isRetry: Cloudflare stopped the last attempt (an error, or too much CPU) and is trying again.
  // Then the bots move without thinking, so the same step can't fail the same way twice.
  async alarm(alarmInfo) {
    if (!this.s) { await this.ctx.storage.deleteAll(); return; }
    const game = GAMES[this.s.game];
    if (game.onTick && Date.now() - this.s.touched < this.ttl()) {
      const retry = !!(alarmInfo && alarmInfo.isRetry);
      if (retry) this.fault("alarm retried", `retry ${alarmInfo.retryCount}`, { phase: this.s.g && this.s.g.phase });
      const changed = this.tick(retry);
      await this.flush();
      if (changed) { await this.ctx.storage.put("s", this.s); this.broadcast(); } // not save(): the table moving alone is not activity
      if (game.canJoin && this.s.g && this.s.g.phase === "closed") return this.close();   // a card table that ended (or had to close)
      await this.schedule();
      return;
    }
    if (Date.now() - this.s.touched >= this.ttl()) {
      await this.close();
    } else {
      await this.ctx.storage.setAlarm(this.s.touched + this.ttl());
    }
  }

  async close() {
    for (const w of this.ctx.getWebSockets()) { try { w.send('{"t":"closed"}'); w.close(4004, "room closed"); } catch {} }
    this.s = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ---- websocket join (the Worker forwards /ws/CODE here) ----
  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    const refuse = (code, reason) => {
      server.accept();
      server.send(JSON.stringify({ t: "refused", code }));
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client });
    };
    const s = this.s;
    if (!s) return refuse(4004, "no room");

    const url = new URL(req.url);
    const key = req.headers.get("x-vw-key") || "";
    const alt = req.headers.get("x-vw-alt") || "";
    const name = cleanName(url.searchParams.get("name"));
    const hostToken = url.searchParams.get("host") || "";
    if (!key) return refuse(4400, "no key");
    if (!name) return refuse(4401, "no name");

    const game = GAMES[s.game];
    let p = s.players.find((x) => x.keys.includes(key) || (alt && x.keys.includes(alt)));
    if (!p) {
      // table games decide by their seats (a seat a bot holds can go to a person); others by head count
      if (s.players.length >= (game.canJoin ? 16 : game.maxPlayers || MAX_PLAYERS)) return refuse(4003, "full");
      if (game.canJoin && !game.canJoin(s)) return refuse(4005, "started");
      let pid;
      do { pid = publicId(); } while (s.players.some((x) => x.pid === pid));
      p = { pid, keys: [], name, joinedRound: s.round };
      s.players.push(p);
    }
    for (const k of [key, alt]) if (k && !p.keys.includes(k)) p.keys.push(k);
    p.keys = p.keys.slice(-4);
    p.name = name;
    if (hostToken && hostToken === s.hostToken) s.hostPid = p.pid;
    if (!s.hostPid || !s.players.some((x) => x.pid === s.hostPid)) s.hostPid = p.pid;
    if (p.pid === s.hostPid) s.hostOffAt = 0;

    // One live connection per player: a second tab or a reconnect replaces the old one.
    for (const w of this.ctx.getWebSockets(p.pid)) { try { w.send('{"t":"replaced"}'); w.close(4002, "replaced"); } catch {} }
    this.ctx.acceptWebSocket(server, [p.pid]);
    if (game.onJoin) {
      try { game.onJoin(s, p.pid, Date.now()); }
      catch (e) { this.fault("join crashed", e); if (game.recover) try { game.recover(s, Date.now(), "join crashed"); } catch {} }
    }
    await this.save();
    this.broadcast();
    await this.schedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  allow(ws) {
    const now = Date.now();
    let r = this.rate.get(ws);
    if (!r || now - r.t > MSG_WINDOW_MS) { r = { t: now, n: 0 }; this.rate.set(ws, r); }
    r.n += 1;
    return r.n <= MSG_MAX;
  }

  online() {
    const set = new Set();
    for (const w of this.ctx.getWebSockets()) {
      if (w.readyState === 1) set.add(this.ctx.getTags(w)[0]);
    }
    return set;
  }

  remove(pid, code, reason) {
    const s = this.s;
    const gone = s.players.find((x) => x.pid === pid);
    if (!gone) return false;
    s.players = s.players.filter((x) => x.pid !== pid);
    try { GAMES[s.game].onRemove(s, pid, Date.now(), gone.name); }     // the name: a friend's seat keeps it when the table plays on for them
    catch (e) { this.fault("remove crashed", e); const g = GAMES[s.game]; if (g.recover) try { g.recover(s, Date.now(), "remove crashed"); } catch {} }
    for (const w of this.ctx.getWebSockets(pid)) {
      try { w.send(code === 4001 ? '{"t":"kicked"}' : '{"t":"left"}'); w.close(code, reason); } catch {}
    }
    return true;
  }

  async webSocketMessage(ws, raw) {
    const s = this.s;
    if (!s) { try { ws.send('{"t":"closed"}'); ws.close(4004, "room closed"); } catch {} return; }
    if (typeof raw !== "string" || raw.length > 4096) return;
    if (!this.allow(ws)) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== "string") return;

    const pid = this.ctx.getTags(ws)[0];
    const me = s.players.find((x) => x.pid === pid);
    if (!me) { try { ws.close(4001, "not in room"); } catch {} return; }
    const isHost = pid === s.hostPid;
    const err = (e, why) => { try { ws.send(JSON.stringify(why ? { t: "error", e, why } : { t: "error", e })); } catch {} };

    let changed = false;
    switch (msg.t) {
      case "ping": try { ws.send('{"t":"pong"}'); } catch {} return;
      case "rename": {
        const n = cleanName(msg.name);
        if (n && n !== me.name) { me.name = n; changed = true; }
        break;
      }
      case "leave": {
        if (isHost) return err("host_cant_leave");
        changed = this.remove(pid, 4000, "left");
        break;
      }
      case "kick": {
        if (!isHost || msg.pid === pid) return;
        changed = this.remove(String(msg.pid), 4001, "kicked");
        break;
      }
      case "makeHost": {
        if (!isHost || !s.players.some((x) => x.pid === msg.pid)) return;
        s.hostPid = msg.pid;
        s.hostOffAt = this.online().has(msg.pid) ? 0 : Date.now();
        changed = true;
        break;
      }
      case "claimHost": {
        if (isHost) return;
        if (this.online().has(s.hostPid)) return err("host_online");
        if (Date.now() - (s.hostOffAt || 0) < HOST_GRACE_MS) return err("host_wait");
        s.hostPid = pid;
        s.hostOffAt = 0;
        changed = true;
        break;
      }
      // a phone saw a move that is overdue: the table's clock may have died (Cloudflare gave up on an alarm).
      // Run the table now if something is due, and set the clock again either way.
      case "nudge": {
        const game = GAMES[s.game];
        if (!game.wakeAt) return;
        let w = 0;
        try { w = game.wakeAt(s, this.online()); } catch {}
        if (w && w < Date.now() - 1500) {
          this.fault("table clock missed, nudged", `${Date.now() - w} ms late`, { phase: s.g && s.g.phase, step: s.g && s.g.step });
          if (this.tick(false)) { await this.flush(); await this.ctx.storage.put("s", s); this.broadcast(); }
        }
        await this.schedule();
        return;
      }
      default: {
        let r;
        const game = GAMES[s.game];
        try { r = game.onMessage(s, { pid, isHost, now: Date.now() }, msg); }
        catch (e) {
          // a message crashed the rules: log it and put the table back on its feet, never leave it half-done
          this.fault("message crashed", e, { t: String(msg.t).slice(0, 12) });
          if (game.recover) try { game.recover(s, Date.now(), "message crashed"); } catch (e2) { this.fault("recover crashed", e2); }
          r = { changed: true };
        }
        if (r && r.error) return err(r.error, r.why);
        changed = !!(r && r.changed);
      }
    }
    if (!changed) return;
    await this.save();
    this.broadcast();
    await this.schedule();
  }

  async webSocketClose(ws) {
    try { ws.close(1000, "bye"); } catch {}
    this.rate.delete(ws);
    const s = this.s;
    if (!s) return;
    const pid = this.ctx.getTags(ws)[0];
    if (pid === s.hostPid && !this.online().has(pid)) {
      s.hostOffAt = Date.now();
      await this.ctx.storage.put("s", s); // not save(): a dropped phone is not activity
    }
    this.broadcast();
    await this.schedule();
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  broadcast() {
    const s = this.s;
    if (!s) return;
    const online = this.online();
    const now = Date.now();
    const game = GAMES[s.game];
    let players = null;
    try { players = game.listPlayers && game.listPlayers(s, online); } catch (e) { this.fault("listPlayers crashed", e); }
    players = players || s.players.map((x) => ({ pid: x.pid, name: x.name, online: online.has(x.pid) }));
    const base = {
      t: "state", code: s.code, game: s.game, hostPid: s.hostPid, hostOnline: online.has(s.hostPid),
      hostOffAt: s.hostOffAt || 0, hostGraceMs: HOST_GRACE_MS, players, round: s.round, now,
    };
    for (const w of this.ctx.getWebSockets()) {
      if (w.readyState !== 1) continue;
      const pid = this.ctx.getTags(w)[0];
      let body;
      try { body = JSON.stringify({ ...base, me: pid, ...game.view(s, pid, now, online) }); }
      catch (e) { this.fault("view crashed", e); body = JSON.stringify({ ...base, me: pid }); }   // the phone still hears from the table
      try { w.send(body); } catch {}
    }
  }
}
