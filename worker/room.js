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
import { mirrorTable } from "./usage.js";
import { meter } from "./meter.js";
import mafia from "./games/mafia.js";
import imposter from "./games/imposter.js";
import murlan from "./games/murlan.js";
import spathi from "./games/spathi.js";
import derri from "./games/derri.js";
import domino from "./games/domino.js";

export const GAMES = { mafia, imposter, murlan, spathi, derri, domino };
const MAX_PLAYERS = 30;
const MSG_WINDOW_MS = 10_000;   // per-socket message budget
const MSG_MAX = 80;            // a busy phone (the table clock, rearranging cards, PRIT) stays well under this
const HOST_GRACE_MS = 60_000;   // someone else may take over as host after the host has been gone this long
const BACKUP_MS = 15_000;       // the server's own backup alarm while the phones drive the clock
// hold-to-talk (public/voice.js): one frame is 160 ms of sound, about 2 KB
const VOICE_MAX_BYTES = 6_000;
const VOICE_WINDOW_MS = 10_000;
const VOICE_MAX = 120;          // frames per socket per window: 10 s of talking is ~63

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.s = null;
    this.rate = new Map();
    this.vrate = new Map();
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

  // every billable thing this table does: printed by the meter in tests, and counted for the dashboard
  use(kind, what, n = 1) {
    meter(this.env, kind, what, n);
    if (!this.s) return;
    const u = this.s.u || (this.s.u = { req: 0, msg: 0, rows: 0, conn: 0 });
    if (kind === "do") { u.req += n; if (what === "ws connect") u.conn += n; } else if (kind === "wsmsg") u.msg += n; else if (kind === "rows") u.rows += n;
  }
  async put() { this.use("rows", "room state", 1); this.s.unsaved = 0; await this.ctx.storage.put("s", this.s); }
  // Save after a change, unless the table is in a quick run of moves that the server makes itself (a bot due
  // within a few seconds): then every 4th change. The room can't sleep in between (the next move comes before
  // the 10 s it takes), so only a crash could lose those few moves; the phones notice the rewind and redraw.
  async persist() {
    const g = this.s.g, game = GAMES[this.s.game];
    const quick = game.canJoin && g && g.phase === "play" && g.actor >= 0 && g.seats[g.actor] && g.seats[g.actor].bot && g.due && g.due - Date.now() < 4000;
    if (quick && (this.s.unsaved || 0) < 3) { this.s.unsaved = (this.s.unsaved || 0) + 1; return; }
    await this.put();
  }
  async alarmAt(t) { this.use("rows", "setAlarm", 1); await this.ctx.storage.setAlarm(t); }

  async save() {
    this.s.touched = Date.now();
    await this.flush();
    await this.put();
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
    this.use("do", "rpc room.init");
    await this.save();
    await this.alarmAt(Date.now() + this.ttl());
    return { hostToken: this.s.hostToken };
  }

  async info() {
    this.use("do", "rpc room.info");
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
  // The table's clock. While a phone that can drive it is at a card table, the phones are the clock: each one
  // sends "go" when the next move is due (an incoming message bills 1/20 of a request and writes nothing), and the
  // server keeps only a slow backup alarm in case no phone does. Otherwise (lobby, empty table, old pages) the
  // server's own alarm wakes it at the exact time. Every alarm is a billed request plus a storage write.
  phonesClock() {
    const s = this.s, g = s && s.g, game = s && GAMES[s.game];
    if (!g || !game.canJoin || (g.phase !== "play" && g.phase !== "over")) return false;
    if (this.phonesQuiet) return false;        // the phones stopped saying "go" (asleep, in the background): the server keeps time
    const on = this.online();
    return s.players.some((p) => p.clock && on.has(p.pid) && g.seats.some((x) => x && !x.bot && x.pid === p.pid));
  }
  async schedule() {
    if (!this.s) return;
    const game = GAMES[this.s.game];
    let wake = 0;
    try { wake = game.wakeAt ? game.wakeAt(this.s, this.online()) : 0; } catch (e) { this.fault("wakeAt threw", e); wake = Date.now() + 2000; }
    if (this.s.dirty) { delete this.s.dirty; await this.put(); }          // something the clock depends on changed (e.g. the table emptied)
    const ttl = this.s.touched + this.ttl();
    let target = wake ? Math.max(Date.now() + 50, Math.min(wake, ttl)) : ttl;
    if (wake && this.phonesClock()) {
      target = Math.min(ttl, Math.max(wake, Date.now()) + BACKUP_MS);
      // a backup alarm is already waiting and fires no later than the backup is needed: leave it (it runs whatever
      // is due, then sets the next). A later one (the 6-hour clean-up, or the empty-table close) is replaced, or a
      // table whose phones went quiet would wait that long.
      if (this.alarmSetTo && this.alarmSetTo > Date.now() && this.alarmSetTo <= target) { await this.flush(); return; }
    }
    // exactly this future time is already set (and hasn't fired): setting it again would only cost a storage write
    if (this.alarmSetTo === target && target > Date.now() + 20) { await this.flush(); return; }
    // tests only: CHAOS_DROP_ALARMS (set with `wrangler dev --var`, never on the live site) loses some of the
    // table's clock ticks on purpose, like Cloudflare giving up on an alarm, to prove the phones' nudges save the table
    const chaos = Number(this.env.CHAOS_DROP_ALARMS || 0);
    if (chaos && wake && Math.random() < chaos) { this.alarmSetTo = ttl; await this.alarmAt(ttl); return; }
    this.alarmSetTo = target;
    await this.alarmAt(target);
    await this.flush();
  }

  // alarmInfo.isRetry: Cloudflare stopped the last attempt (an error, or too much CPU) and is trying again.
  // Then the bots move without thinking, so the same step can't fail the same way twice.
  async alarm(alarmInfo) {
    this.use("do", "alarm");
    this.alarmSetTo = 0;                       // it fired: nothing is set any more
    if (!this.s) { await this.ctx.storage.deleteAll(); return; }
    const game = GAMES[this.s.game];
    if (game.onTick && Date.now() - this.s.touched < this.ttl()) {
      // the backup alarm found a move overdue: no phone said "go" in time, so the server keeps the exact time
      // again until a phone does (see "nudge")
      if (!this.phonesQuiet && this.phonesClock()) {
        let w0 = 0; try { w0 = game.wakeAt ? game.wakeAt(this.s, this.online()) : 0; } catch {}
        if (w0 && w0 < Date.now() - 1500) this.phonesQuiet = true;
      }
      const retry = !!(alarmInfo && alarmInfo.isRetry);
      if (retry) this.fault("alarm retried", `retry ${alarmInfo.retryCount}`, { phase: this.s.g && this.s.g.phase });
      const changed = this.tick(retry);
      await this.flush();
      if (changed) { if (!this.ending()) await this.persist(); this.broadcast(); } // not save(): the table moving alone is not activity
      if (this.ending()) return this.close(this.s.g.phase === "solo");   // a card table that ended, or moved onto the phone
      await this.schedule();
      return;
    }
    if (Date.now() - this.s.touched >= this.ttl()) {
      await this.close();
    } else {
      await this.alarmAt(this.s.touched + this.ttl());
    }
  }

  // the owner's player list (dashboard): this person sat down here under this name. Never holds up the table.
  noteName(p) {
    try {
      if (!this.s || !this.env.GUARD || !p || !p.name) return;
      const dev = p.keys.find((k) => k.startsWith("c:")) || p.keys[0];
      if (!dev) return;
      this.use("do", "rpc guard.sawName");
      const r = this.env.GUARD.get(this.env.GUARD.idFromName("guard")).sawName(dev, p.name, this.s.game, this.s.code);
      if (r && r.catch) r.catch(() => {});
    } catch {}
  }

  // a card table that is over: it closed, or its only person now plays it on the phone ("solo")
  ending() { const g = this.s && this.s.g; return !!(g && GAMES[this.s.game].canJoin && (g.phase === "closed" || g.phase === "solo")); }
  async close(quiet) {
    this.use("rows", "deleteAll", 2);
    if (this.s) {
      this.use("do", "rpc guard.usage");
      try { await this.env.GUARD.get(this.env.GUARD.idFromName("guard")).usage(this.s.game, this.s.u || {}, this.s.g && this.s.g.phase, this.s.code); } catch {}
      const g = this.s.g || {}, u = this.s.u || {};
      await mirrorTable(this.env, { game: this.s.game, phase: g.phase || "", room: this.s.code, ...u, secs: Math.round((Date.now() - this.s.created) / 1000),
        people: Array.isArray(g.seats) ? g.seats.filter((x) => x && !x.bot && !x.stand).length || this.s.players.length : this.s.players.length,
        seats: Array.isArray(g.seats) ? g.seats.filter(Boolean).length : 0, hands: (g.mt && (g.mt.handNo || g.mt.round)) || 0, only: !!g.only });
    }
    // quiet: the phone already has the table (it plays it itself), so no "the room closed" message
    for (const w of this.ctx.getWebSockets()) { try { if (!quiet) w.send('{"t":"closed"}'); w.close(quiet ? 1000 : 4004, quiet ? "on the phone" : "room closed"); } catch {} }
    this.s = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ---- websocket join (the Worker forwards /ws/CODE here) ----
  async fetch(req) {
    this.use("do", "ws connect");
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
      p = { pid, keys: [], name, joinedRound: s.round, fresh: true };
      s.players.push(p);
    }
    for (const k of [key, alt]) if (k && !p.keys.includes(k)) p.keys.push(k);
    p.keys = p.keys.slice(-4);
    const named = p.fresh || p.name !== name;
    delete p.fresh;
    p.name = name;
    if (named) this.noteName(p);
    p.clock = url.searchParams.get("v") === "2";        // this page drives the table's clock (sends "go" when a move is due)
    if (hostToken && hostToken === s.hostToken) s.hostPid = p.pid;
    if (!s.hostPid || !s.players.some((x) => x.pid === s.hostPid)) s.hostPid = p.pid;
    if (p.pid === s.hostPid) s.hostOffAt = 0;

    // One live connection per player: a second tab or a reconnect replaces the old one.
    for (const w of this.ctx.getWebSockets(p.pid)) { try { w.send('{"t":"replaced"}'); w.close(4002, "replaced"); } catch {} }
    this.ctx.acceptWebSocket(server, [p.pid]);
    if (url.searchParams.get("vc") === "1") { try { server.serializeAttachment({ voice: true }); } catch {} }   // this page plays voices
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

  // who is at the table right now: connected, and their screen is on. A phone whose screen went off says so
  // ("away") before it goes quiet, often while its connection still looks open: it counts as gone, so the table
  // plays its turns after 6 s instead of waiting the whole turn for a phone in a pocket.
  online() {
    const set = new Set();
    for (const w of this.ctx.getWebSockets()) {
      if (w.readyState !== 1) continue;
      let a = null; try { a = w.deserializeAttachment(); } catch {}
      if (a && a.dark) continue;
      set.add(this.ctx.getTags(w)[0]);
    }
    return set;
  }

  remove(pid, code, reason) {
    const s = this.s;
    const gone = s.players.find((x) => x.pid === pid);
    if (!gone) return false;
    s.players = s.players.filter((x) => x.pid !== pid);
    if (s.hostPid === pid) {                          // the host left: the next person (one who is here, if any) hosts
      const on = this.online();
      const next = s.players.find((x) => on.has(x.pid)) || s.players[0];
      s.hostPid = next ? next.pid : null; s.hostOffAt = next && on.has(next.pid) ? 0 : Date.now();
    }
    try { GAMES[s.game].onRemove(s, pid, Date.now(), gone.name); }     // the name: a friend's seat keeps it when the table plays on for them
    catch (e) { this.fault("remove crashed", e); const g = GAMES[s.game]; if (g.recover) try { g.recover(s, Date.now(), "remove crashed"); } catch {} }
    for (const w of this.ctx.getWebSockets(pid)) {
      try { w.send(code === 4001 ? '{"t":"kicked"}' : '{"t":"left"}'); w.close(code, reason); } catch {}
    }
    return true;
  }

  async webSocketMessage(ws, raw) {
    this.use("wsmsg", "in", 1);
    const s = this.s;
    if (!s) { try { ws.send('{"t":"closed"}'); ws.close(4004, "room closed"); } catch {} return; }
    if (typeof raw !== "string") return this.voice(ws, raw);
    if (raw.length > 4096) return;
    if (!this.allow(ws)) {                            // over the budget: say so once (the phone asks again), never drop a move silently
      const r = this.rate.get(ws);
      if (r && !r.told) { r.told = true; try { ws.send('{"t":"error","e":"slow_down"}'); } catch {} }
      return;
    }
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
      case "away": {                                  // the screen went off (v: true) or came back on (v: false)
        const dark = !!msg.v;
        let a = null; try { a = ws.deserializeAttachment(); } catch {}
        if (!!(a && a.dark) === dark) return;
        try { ws.serializeAttachment({ ...(a || {}), dark }); } catch {}
        this.broadcast();                             // the others' phones: who is away, when the next move is due
        await this.schedule();
        return;
      }
      case "rename": {
        const n = cleanName(msg.name);
        if (n && n !== me.name) { me.name = n; changed = true; this.noteName(me); }
        break;
      }
      case "leave": {
        const game = GAMES[s.game];
        // a card game in progress: the seat waits for you a little (a friends' room: until the game ends)
        if (game.softLeave && game.softLeave(s, pid, Date.now())) {
          for (const w of this.ctx.getWebSockets(pid)) { try { w.send('{"t":"left"}'); w.close(4000, "left"); } catch {} }
          changed = true;
          break;
        }
        if (isHost && !game.canJoin) return err("host_cant_leave");
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
      // "go": a phone says the next move is due now. Normally this IS the table's clock (see phonesClock);
      // it also rescues a table whose own alarm died. Run whatever is due; early or repeated ones do nothing.
      case "nudge": {
        const game = GAMES[s.game];
        if (!game.wakeAt) return;
        this.phonesQuiet = false;                // a phone keeps time again
        let w = 0;
        try { w = game.wakeAt(s, this.online()); } catch {}
        if (w && w <= Date.now() + 30) {
          if (w < Date.now() - 8000) this.fault("table clock missed, nudged", `${Date.now() - w} ms late`, { phase: s.g && s.g.phase, step: s.g && s.g.step });
          if (this.tick(false)) { await this.flush(); await this.persist(); this.broadcast(); if (this.ending()) return this.close(s.g.phase === "solo"); }
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
    if (this.ending()) { await this.flush(); this.broadcast(); return this.close(this.s.g.phase === "solo"); }
    await this.save();
    this.broadcast();
    await this.schedule();
  }

  // Hold-to-talk: a frame of sound from the player whose turn it is, at a friends' table that is playing.
  // Passed straight on to the other phones there that can play it. Never stored, never part of the table's
  // state, never a broadcast or a save: it can't change or slow the game. Anything else is dropped quietly.
  voice(ws, raw) {
    const s = this.s, g = s && s.g, game = s && GAMES[s.game];
    if (!g || !game || !game.canJoin || g.pub || g.phase !== "play" || !Array.isArray(g.seats)) return;
    if (!(raw instanceof ArrayBuffer) || raw.byteLength < 5 || raw.byteLength > VOICE_MAX_BYTES) return;
    const buf = new Uint8Array(raw);
    if (buf[0] !== 0x56 || buf[1] !== 1) return;
    const pid = this.ctx.getTags(ws)[0];
    const seat = g.seats.findIndex((x) => x && !x.bot && x.pid === pid);
    if (seat < 0 || seat !== g.actor) return;                // only on your own turn
    const now = Date.now();
    let r = this.vrate.get(ws);
    if (!r || now - r.t > VOICE_WINDOW_MS) { r = { t: now, n: 0 }; this.vrate.set(ws, r); }
    if (++r.n > VOICE_MAX) return;
    const out = buf.slice();
    out[2] = seat;                                           // who is talking (the phone can't claim another seat)
    for (const w of this.ctx.getWebSockets()) {
      if (w === ws || w.readyState !== 1) continue;
      let a = null; try { a = w.deserializeAttachment(); } catch {}
      if (!a || !a.voice) continue;
      try { w.send(out); } catch {}
    }
  }

  async webSocketClose(ws) {
    try { ws.close(1000, "bye"); } catch {}
    this.rate.delete(ws);
    this.vrate.delete(ws);
    const s = this.s;
    if (!s) return;
    const pid = this.ctx.getTags(ws)[0];
    if (pid === s.hostPid && !this.online().has(pid)) {
      s.hostOffAt = Date.now();
      await this.put(); // not save(): a dropped phone is not activity
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
