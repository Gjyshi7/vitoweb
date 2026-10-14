// Shared server for every card/tile table (Murlan, Spathi, Derri, Domino).
// A game module only describes its rules (see the `spec` contract below); this file runs the table:
//   lobby and seats, quick match (public tables), turn clock, players who drop, seats that play by
//   themselves, the event log every phone replays, and what each phone is allowed to see.
//
// Phases:  lobby -> play -> over      (or lobby -> solo: only one person at the table, the phone plays it locally)
//
// spec = {
//   seatList(cfg)            seats in play, e.g. [0,1,2,3] or [0,2]
//   cleanCfg(cfg)            validated config with defaults
//   newMatch(cfg)            match state (engine)
//   deal(mt, emit)           deal a hand, emit events. returns ms the phones need to animate it
//   actor(mt)                { seat, step } whose move it is now, or null when the hand is over
//   act(mt, seat, step, msg, emit)   apply a human move: { error } or { wait: ms }
//   auto(mt, seat, step)     the move a seat makes by itself (same shape as a human msg)
//   think(mt, seat, step)    context for PLAYERS.think
//   matchOver(mt)            true when the match is finished
//   snap(mt, seat)           this seat's private snapshot of the table (for phones that rejoin)
//   publicCfg?(cfg)          what the lobby shows
// }
// emit(ev, priv): ev is public; priv = { [seat]: extra fields only that seat sees }.
import { PLAYERS } from "../gen/players.js";
import { publicId } from "../util.js";

const COLORS = ["#2c6e8f", "#7a4fa8", "#2f8a62", "#a8662c", "#8f2c4f", "#3d5aa8", "#5f7a2c", "#2c8f86", "#8a4f2f", "#6b4fa8"];
const ME_COLOR = "#b02a63";
const TURN_MS = 30_000;
const OFFLINE_MS = 6_000;      // a phone that is gone this long plays its turn on autopilot
const END_MS = 9_000;          // result screen between hands
const PUBLIC_WAIT_MS = 7_000;  // a quick-match table waits this long for people, then starts
const LOG_KEEP = 400;

export function makeTable(spec) {
  const seatOf = (g, pid) => g.seats.findIndex((x) => x && x.pid === pid);
  const humansAt = (g) => g.seats.filter((x) => x && !x.bot).length;
  const nameOf = (s, i) => {
    const x = s.g.seats[i];
    if (!x) return "";
    if (!x.bot) { const p = s.players.find((q) => q.pid === x.pid); if (p) return p.name; }
    return x.name;
  };

  function emitter(g) {
    return (ev, priv) => {
      g.seq += 1;
      g.log.push(priv ? { seq: g.seq, ...ev, priv } : { seq: g.seq, ...ev });
      if (g.log.length > LOG_KEEP) g.log.splice(0, g.log.length - LOG_KEEP);
    };
  }

  // ---- lobby ----
  function syncLobby(s) {
    const g = s.g, list = spec.seatList(g.cfg);
    // people who left lose their seat; seats outside the current mode are cleared
    g.seats = g.seats.map((x, i) => {
      if (!x || !list.includes(i)) return null;
      if (!x.bot && !s.players.some((p) => p.pid === x.pid)) return null;
      return x;
    });
    for (const p of s.players) {
      if (seatOf(g, p.pid) >= 0) continue;
      const free = list.find((i) => !g.seats[i]);
      if (free === undefined) break;
      g.seats[free] = { pid: p.pid, bot: false };
    }
  }
  function usedNames(s) {
    const set = new Set(s.players.map((p) => p.name.toLowerCase()));
    for (const x of s.g.seats) if (x && x.bot) set.add(x.name.toLowerCase());
    return set;
  }
  function newBot(s) {
    const taken = usedNames(s);
    let b;
    do { b = PLAYERS.one(); } while (taken.has(b.name.toLowerCase()) || b.name.length > 15 || b.name.length < 3);
    return { pid: publicId(), bot: true, name: b.name, fem: b.fem, speed: 0.88 + Math.random() * 0.24 };
  }
  function fillSeats(s) {
    const g = s.g;
    for (const i of spec.seatList(g.cfg)) if (!g.seats[i]) g.seats[i] = newBot(s);
    // colours: each seat its own, stable for the match
    let k = Math.floor(Math.random() * COLORS.length);
    for (const i of spec.seatList(g.cfg)) { const x = g.seats[i]; if (!x.color) x.color = COLORS[k++ % COLORS.length]; }
  }

  // ---- match flow ----
  function begin(s, now) {
    const g = s.g;
    syncLobby(s);
    fillSeats(s);
    if (humansAt(g) < 2) {                       // nobody else came: this phone plays the table itself
      g.phase = "solo"; g.due = 0; g.seq += 1;
      return;
    }
    startMatch(s, now);
  }
  function startMatch(s, now) {
    const g = s.g;
    g.mt = spec.newMatch(g.cfg);
    g.phase = "play";
    dealHand(s, now);
  }
  function dealHand(s, now) {
    const g = s.g;
    g.log = [];                                  // the log holds one hand; a phone that falls behind redraws from its snapshot
    const ms = spec.deal(g.mt, emitter(g)) || 0;
    nextTurn(s, now + ms);
  }
  function nextTurn(s, at) {
    const g = s.g;
    const a = spec.actor(g.mt);
    if (!a) {                                    // hand over
      g.step = "end"; g.actor = -1; g.stepAt = at; g.due = at + END_MS;
      if (spec.matchOver(g.mt)) { g.phase = "over"; g.due = 0; }
      return;
    }
    g.actor = a.seat; g.step = a.step; g.stepAt = at;
    const x = g.seats[a.seat];
    g.due = x.bot ? at + PLAYERS.think(x, spec.think(g.mt, a.seat, a.step)) : at + TURN_MS;
  }
  function apply(s, now, seat, step, msg) {
    const g = s.g;
    const r = spec.act(g.mt, seat, step, msg, emitter(g));
    if (r && r.error) return r;
    nextTurn(s, now + ((r && r.wait) || 0));
    return { ok: true };
  }
  function autoMove(s, now) {
    const g = s.g;
    if (g.phase === "lobby") return begin(s, now);
    if (g.phase !== "play") return;
    if (g.step === "end") return dealHand(s, now);
    const msg = spec.auto(g.mt, g.actor, g.step);
    const r = apply(s, now, g.actor, g.step, msg);
    if (r.error) { console.error("auto move refused", g.step, r.error); g.due = now + 5000; }
  }

  function wakeAt(s, online) {
    const g = s.g;
    if (g.phase === "lobby") return g.pub && online.size ? g.startAt : 0;
    if (g.phase !== "play" || !g.due) return 0;
    const someone = g.seats.some((x) => x && !x.bot && online.has(x.pid));
    if (!someone) return 0;                      // nobody watching: the table waits for them
    if (g.actor >= 0) {
      const x = g.seats[g.actor];
      if (x && !x.bot && !online.has(x.pid)) return Math.min(g.due, Math.max(g.stepAt, Date.now() - 1) + OFFLINE_MS);
    }
    return g.due;
  }

  return {
    maxPlayers: 4,

    init(opts = {}) {
      return {
        phase: "lobby", cfg: spec.cleanCfg(opts.cfg || {}), pub: !!opts.public, startAt: opts.public ? Date.now() + PUBLIC_WAIT_MS : 0,
        seats: [null, null, null, null], mt: null, step: null, actor: -1, due: 0, stepAt: 0, seq: 0, log: [],
      };
    },

    canJoin(s) {
      const g = s.g;
      return g.phase === "lobby" && spec.seatList(g.cfg).some((i) => !g.seats[i]);
    },

    onJoin(s, pid, now) {
      const g = s.g;
      if (g.phase !== "lobby") return false;
      syncLobby(s);
      g.seq += 1;
      // a public table that just filled up starts at once
      if (g.pub && spec.seatList(g.cfg).every((i) => g.seats[i])) begin(s, now || Date.now());
      return true;
    },

    onRemove(s, pid) {
      const g = s.g;
      if (g.phase === "lobby") { syncLobby(s); g.seq += 1; return; }
      const i = seatOf(g, pid);
      if (i >= 0) g.seats[i] = { ...g.seats[i], name: nameOf(s, i), bot: true, speed: 0.95 + Math.random() * 0.15 };
    },

    onMessage(s, me, msg) {
      const g = s.g, now = me.now, seat = seatOf(g, me.pid);
      switch (msg.t) {
        case "cfg": {
          if (!me.isHost || g.phase !== "lobby" || g.pub) return null;
          g.cfg = spec.cleanCfg({ ...g.cfg, ...(msg.cfg || {}) });
          syncLobby(s); g.seq += 1;
          return { changed: true };
        }
        case "seat": {                            // sit somewhere else (pick your partner)
          const to = Number(msg.seat);
          if (g.phase !== "lobby" || seat < 0 || !spec.seatList(g.cfg).includes(to) || g.seats[to]) return null;
          g.seats[to] = g.seats[seat]; g.seats[seat] = null; g.seq += 1;
          return { changed: true };
        }
        case "start": {
          if (!me.isHost || g.phase !== "lobby") return null;
          begin(s, now);
          return { changed: true };
        }
        case "again": {
          if (!me.isHost || g.phase !== "over") return null;
          startMatch(s, now);
          return { changed: true };
        }
        case "act": {
          if (g.phase !== "play" || seat < 0 || g.actor !== seat || g.step === "end") return { error: "not_your_turn" };
          if (msg.step && msg.step !== g.step) return { error: "not_your_turn" };
          const r = apply(s, now, seat, g.step, msg);
          return r.error ? { error: r.error, why: r.why } : { changed: true };
        }
      }
      return null;
    },

    wakeAt,

    onTick(s, now, online) {
      let changed = false;
      for (let i = 0; i < 8; i++) {
        const w = wakeAt(s, online);
        if (!w || w > now) break;
        autoMove(s, now);
        changed = true;
      }
      return changed;
    },

    // every phone sees everyone at the table as a player
    listPlayers(s, online) {
      const g = s.g;
      if (g.phase === "lobby") return null;
      return g.seats.map((x, i) => x && { pid: x.pid, name: nameOf(s, i), online: x.bot ? true : online.has(x.pid) }).filter(Boolean);
    },

    view(s, pid) {
      const g = s.g;
      const me = seatOf(g, pid);
      const seats = g.seats.map((x, i) => x && { name: nameOf(s, i), fem: !!x.fem, color: i === me ? ME_COLOR : x.color || null });
      const t = {
        phase: g.phase, cfg: g.cfg, pub: g.pub, startAt: g.startAt, seq: g.seq, me, seats, seatList: spec.seatList(g.cfg),
      };
      if (g.phase === "lobby" || g.phase === "solo" || !g.mt) return { tbl: t };
      Object.assign(t, {
        step: g.step, actor: g.actor,
        turnStart: g.actor >= 0 ? g.stepAt : 0, turnMs: TURN_MS,
        snap: spec.snap(g.mt, me),
        log: g.log.map((e) => {
          if (!e.priv) return e;
          const { priv, ...pub } = e;
          return priv[me] ? { ...pub, ...priv[me] } : pub;
        }),
      });
      return { tbl: t };
    },
  };
}
