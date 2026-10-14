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
import mafia from "./games/mafia.js";
import imposter from "./games/imposter.js";

export const GAMES = { mafia, imposter };
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
    await this.ctx.storage.put("s", this.s);
  }

  // ---- called by the Worker (RPC) ----
  async init(code, game) {
    if (!GAMES[game]) return null;
    if (this.s && Date.now() - this.s.touched < this.ttl()) return null; // code still in use
    this.s = {
      code, game, created: Date.now(), touched: Date.now(),
      hostToken: crypto.randomUUID(), hostPid: null, hostOffAt: 0,
      players: [], round: 0, g: GAMES[game].init(),
    };
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + this.ttl());
    return { hostToken: this.s.hostToken };
  }

  async info() {
    return this.s ? { ok: true, game: this.s.game, players: this.s.players.length } : { ok: false };
  }

  // Rooms delete themselves after ROOM_TTL_MINUTES without any activity (default 6 hours).
  // Long on purpose: in Mafia every phone can stay locked for the whole game night.
  async alarm() {
    if (!this.s) { await this.ctx.storage.deleteAll(); return; }
    if (Date.now() - this.s.touched >= this.ttl()) {
      for (const w of this.ctx.getWebSockets()) { try { w.send('{"t":"closed"}'); w.close(4004, "room closed"); } catch {} }
      this.s = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
    } else {
      await this.ctx.storage.setAlarm(this.s.touched + this.ttl());
    }
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

    let p = s.players.find((x) => x.keys.includes(key) || (alt && x.keys.includes(alt)));
    if (!p) {
      if (s.players.length >= MAX_PLAYERS) return refuse(4003, "full");
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
    await this.save();
    this.broadcast();
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
    if (!s.players.some((x) => x.pid === pid)) return false;
    s.players = s.players.filter((x) => x.pid !== pid);
    GAMES[s.game].onRemove(s, pid, Date.now());
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
    const err = (e) => { try { ws.send(JSON.stringify({ t: "error", e })); } catch {} };

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
      default: {
        const r = GAMES[s.game].onMessage(s, { pid, isHost, now: Date.now() }, msg);
        if (r && r.error) return err(r.error);
        changed = !!(r && r.changed);
      }
    }
    if (!changed) return;
    await this.save();
    this.broadcast();
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
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  broadcast() {
    const s = this.s;
    if (!s) return;
    const online = this.online();
    const now = Date.now();
    const players = s.players.map((x) => ({ pid: x.pid, name: x.name, online: online.has(x.pid) }));
    const base = {
      t: "state", code: s.code, game: s.game, hostPid: s.hostPid, hostOnline: online.has(s.hostPid),
      hostOffAt: s.hostOffAt || 0, hostGraceMs: HOST_GRACE_MS, players, round: s.round, now,
    };
    const game = GAMES[s.game];
    for (const w of this.ctx.getWebSockets()) {
      if (w.readyState !== 1) continue;
      const pid = this.ctx.getTags(w)[0];
      try { w.send(JSON.stringify({ ...base, me: pid, ...game.view(s, pid, now) })); } catch {}
    }
  }
}
