// Shared server for every card/tile table (Murlan, Spathi, Derri, Domino).
// A game module only describes its rules (see the `spec` contract below); this file runs the table:
//   lobby and seats, quick match (public tables), turn clock, players who drop, seats that play by
//   themselves, the event log every phone replays, and what each phone is allowed to see.
//
// Phases:  lobby -> play -> over -> (play again | closed)
// Votes:   'choice' after a hand the table must decide on (spec.pending / spec.choose, e.g. Murlan's tie at the target),
//          'again' when a match ends (anyone can say yes early, during the match). Bots never vote.
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
const TURN_MS = 15_000;        // a game can set its own (spec.turnMs)
const OFFLINE_MS = 6_000;      // a phone that is gone this long plays its turn on autopilot
const AWAY_PUB_MS = 60_000;    // gone this long at a quick-match table: the seat goes to someone else
// At a friends' room nobody loses a seat: the table plays for you and waits for you to come back.
const ABANDON_MS = 90_000;     // no real person at the table this long: the game is over and the room closes
const WAIT_MS = 7_000;         // quick match: the longest anyone waits for the deal
const END_MS = 9_000;          // result screen between hands
// quick match: the deal comes at most 7 s after the table opens. Players sit down one by one inside
// that time; a real person who arrives meanwhile takes a free seat (or one a player took), and a match
// that has only just been dealt can still give them a player's seat.
const gap = (a = 600, b = 1800) => a + Math.random() * (b - a);
const LOG_KEEP = 400;
const GUARD_MS = 900;          // a card is about to be taken from a person's hand: their hand settles first
const HOLD_MS = 3_000;         // "PRIT": the holder asks for this long to rearrange, once per turn
const CHOICE_MS = 15_000;      // a tie at the target: the table has this long to choose
const AGAIN_MS = 25_000;       // end of a match: this long to say yes to another

export function makeTable(spec) {
  const turnMs = spec.turnMs || TURN_MS;
  const seatOf = (g, pid) => g.seats.findIndex((x) => x && x.pid === pid);
  const humansAt = (g) => g.seats.filter((x) => x && !x.bot).length;
  const nameOf = (s, i) => {
    const x = s.g.seats[i];
    if (!x) return "";
    if (!x.bot) { const p = s.players.find((q) => q.pid === x.pid); if (p) return p.name; }
    return x.name || "Lojtar";
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
      let free = list.find((i) => !g.seats[i]);
      if (free === undefined && g.pub) { const b = list.filter((i) => g.seats[i] && g.seats[i].bot); free = b[(Math.random() * b.length) | 0]; }
      if (free === undefined) break;
      g.seats[free] = { pid: p.pid, bot: false };
    }
  }
  function usedNames(s) {
    const set = new Set(s.players.map((p) => p.name.toLowerCase()));
    for (const x of s.g.seats) if (x && x.bot && x.name) set.add(x.name.toLowerCase());
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
    g.fillAt = 0;
    syncLobby(s);
    fillSeats(s);
    startMatch(s, now);
  }
  function startMatch(s, now) {
    const g = s.g;
    g.mt = spec.newMatch(g.cfg);
    g.phase = "play"; g.acts = 0;
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
      g.actor = -1; g.stepAt = at;
      const need = spec.pending && spec.pending(g.mt);
      if (need) { g.step = "choice"; g.vote = { kind: need, votes: {}, until: at + CHOICE_MS }; g.due = g.vote.until; return; }
      g.step = "end"; g.due = at + END_MS;
      if (spec.matchOver(g.mt)) overNow(s, at);
      return;
    }
    g.actor = a.seat; g.step = a.step; g.stepAt = at;
    g.turnId = (g.turnId || 0) + 1; g.holdUntil = 0; g.extra = 0;
    const x = g.seats[a.seat];
    g.due = x.bot ? at + PLAYERS.think(x, spec.think(g.mt, a.seat, a.step)) : at + turnMs;
    if (x.bot && holderOf(g) >= 0) g.due = Math.max(g.due, at + GUARD_MS + 300);
  }
  // the seat whose hand the actor takes from (Derri), when it's a person: they get a moment, and PRIT
  function holderOf(g) {
    if (!spec.holder || g.actor < 0 || !g.mt) return -1;
    const h = spec.holder(g.mt, g.actor, g.step);
    return h >= 0 && g.seats[h] && !g.seats[h].bot ? h : -1;
  }
  const settling = (g, now) => holderOf(g) >= 0 && (now < g.stepAt + GUARD_MS || g.holdUntil > now);
  function apply(s, now, seat, step, msg) {
    const g = s.g;
    const r = spec.act(g.mt, seat, step, msg, emitter(g));
    if (r && r.error) return r;
    g.acts = (g.acts || 0) + 1;
    nextTurn(s, now + ((r && r.wait) || 0));
    return { ok: true };
  }
  // ---- votes ----
  const humans = (g) => g.seats.filter((x) => x && !x.bot).map((x) => x.pid);
  function overNow(s, at) {
    const g = s.g;
    g.phase = "over"; g.step = "end";
    const votes = {};
    for (const pid of humans(g)) if (g.pre && g.pre[pid]) votes[pid] = "yes";   // said yes during the match
    g.vote = { kind: "again", votes, until: at + AGAIN_MS };
    g.due = g.vote.until;
    settle(s, at);
  }
  // decide a vote once everyone at the table has voted, or when time is up
  function settle(s, now, timeUp) {
    const g = s.g, v = g.vote;
    if (!v) return;
    const hs = humans(g), voted = hs.filter((p) => v.votes[p]);
    if (voted.length < hs.length && !timeUp) return;
    const count = (x) => voted.filter((p) => v.votes[p] === x).length;
    if (v.kind === "again") {
      const yes = voted.filter((p) => v.votes[p] === "yes");
      g.vote = null; g.pre = {};
      if (!yes.length) { g.phase = "closed"; g.due = 0; g.seq += 1; return; }
      // whoever said no (or nothing) gives the seat to someone new
      g.seats = g.seats.map((x) => (x && !x.bot && !yes.includes(x.pid) ? { ...newBot(s), color: x.color } : x));
      g.left = [...(g.left || []), ...hs.filter((p) => !yes.includes(p))];
      startMatch(s, now);
      return;
    }
    // a choice: the most votes wins; a draw (or nobody voting) keeps the classic rule (the first option)
    const opts = spec.options ? spec.options(v.kind) : [];
    let pick = opts[0];
    for (const o of opts) if (count(o) > count(pick)) pick = o;
    g.vote = null;
    spec.choose(g.mt, v.kind, pick, emitter(g));
    g.step = "end"; g.stepAt = now; g.due = now + 2500;
    if (spec.matchOver(g.mt)) overNow(s, now);
  }

  // someone who has been gone too long loses the seat (the table carries on under the same name)
  function awayCheck(s, now, online) {
    const g = s.g;
    if (g.phase !== "play" || g.actor < 0) return;
    const x = g.seats[g.actor];
    if (!x || x.bot || online.has(x.pid)) return;
    g.away = g.away || {};
    const since = g.away[x.pid] || (g.away[x.pid] = now - OFFLINE_MS);
    if (!g.pub || now - since < AWAY_PUB_MS) return;
    // somebody new takes the seat (with the cards); the others are told who left and who sat down
    g.seats[g.actor] = { ...newBot(s), color: x.color };
    g.left = [...(g.left || []), x.pid];
    g.why = { ...(g.why || {}), [x.pid]: "away" };
    delete g.away[x.pid];
  }

  const fresh = (g) => (g.acts || 0) < 2;
  // a friends' room where every seat has a person: start by itself in a moment (the host can still press Fillo)
  const FULL_START_MS = 2_000;
  function friendsReady(s, now) {
    const g = s.g;
    if (g.pub || g.phase !== "lobby") return;
    const full = spec.seatList(g.cfg).every((i) => g.seats[i] && !g.seats[i].bot);
    if (!full) g.fillAt = 0;
    else if (!g.fillAt) g.fillAt = now + FULL_START_MS;
  }
  // Quick match (Devit's rule): you never wait more than WAIT_MS. The other players sit down one by one,
  // spread over that time, so you see the 2nd, the 3rd, the 4th arrive; the table opens a moment after
  // the last one sits. A real person who comes in meanwhile takes a free seat (or one a player took) and
  // never pushes the deal later. Nothing is ever filled in a lump at the end.
  function fillStep(s, now) {
    const g = s.g;
    syncLobby(s);
    const free = spec.seatList(g.cfg).filter((i) => !g.seats[i]);
    if (!free.length || now >= g.dealBy - 50) { g.fillAt = 0; return begin(s, now); }
    g.seats[free[(Math.random() * free.length) | 0]] = newBot(s);
    g.seq += 1;
    nextFill(g, now);
  }
  // when the next one sits down: the time left until ~0.9 s before the deal, shared among the free seats
  function nextFill(g, now) {
    const free = spec.seatList(g.cfg).filter((i) => !g.seats[i]).length;
    if (!free) { g.fillAt = Math.min(g.dealBy, now + gap(650, 950)); return; }      // full: open in a moment
    const slot = Math.max(300, (g.dealBy - 900 - now) / free);
    const f = free === 1 ? 0.7 + Math.random() * 0.3 : 0.75 + Math.random() * 0.4;
    g.fillAt = Math.min(g.dealBy - 600, now + slot * f);
  }

  // ---- self-healing ----
  // A table must never stop. Every fault is written to s.faults (room.js sends them to the incident log) and
  // the table is moved on anyway: the bot's move, else simpler moves that are always legal, else a fresh
  // deal (same scores), else a fresh match, and only as the very last resort a clean close with a message.
  function fault(s, kind, e, extra) {
    const g = s.g;
    (s.faults = s.faults || []).push({ kind, msg: String((e && e.message) || e || "").slice(0, 300), stack: e && e.stack ? String(e.stack).slice(0, 900) : "",
      phase: g.phase, step: g.step, actor: g.actor, seq: g.seq, ...(extra || {}) });
  }
  function rescue(s, now, why) {
    const g = s.g;
    g.rescues = (g.rescues || []).filter((t) => now - t < 10 * 60_000);
    g.rescues.push(now);
    fault(s, "rescue", why, { n: g.rescues.length });
    const n = g.rescues.length;
    if (n <= 2 && g.mt) {                                                                                 // a fresh hand, same scores
      try { g.vote = null; g.phase = "play"; dealHand(s, now); return; } catch (e) { fault(s, "rescue: new hand failed", e); }
    }
    if (n <= 3) {                                                                                         // a fresh match, same people
      try { g.vote = null; g.phase = "play"; fillSeats(s); startMatch(s, now); return; } catch (e) { fault(s, "rescue: new match failed", e); }
    }
    g.phase = "closed"; g.closedWhy = "error"; g.due = 0; g.vote = null; g.seq += 1;                          // never frozen: close, and say so
  }
  function autoMove(s, now, cheap) {
    const g = s.g;
    if (g.phase === "lobby") return g.pub ? fillStep(s, now) : begin(s, now);
    if (g.phase === "over") return settle(s, now, true);
    if (g.phase !== "play") return;
    if (g.step === "choice") return settle(s, now, true);
    if (g.step === "end") return dealHand(s, now);
    if (settling(g, now)) { g.due = Math.max(g.stepAt + GUARD_MS, g.holdUntil) + 300; return; }
    const seat = g.actor, step = g.step;
    if (g.faultTurn !== g.turnId) { g.faultTurn = g.turnId; g.faultN = 0; }
    // cheap: Cloudflare is retrying a step it had to stop (too much CPU), or this turn already failed once
    const quick = !!cheap || g.faultN > 0;
    let moves = [];
    try { moves.push(spec.auto(g.mt, seat, step, { cheap: quick })); } catch (e) { g.faultN++; fault(s, "bot crashed", e); }
    if (spec.fallbacks) { try { moves = moves.concat(spec.fallbacks(g.mt, seat, step)); } catch (e) { fault(s, "fallbacks crashed", e); } }
    for (let i = 0; i < moves.length; i++) {
      const msg = moves[i];
      if (!msg) continue;
      let r;
      try { r = apply(s, now, seat, step, msg); }
      catch (e) { g.faultN++; fault(s, "move crashed", e, { move: JSON.stringify(msg).slice(0, 200) }); continue; }
      if (!r.error) { if (i > 0) fault(s, "fallback move used", "", { tried: i }); return; }
      if (i === 0) { g.faultN++; fault(s, "bot move refused", r.error, { move: JSON.stringify(msg).slice(0, 200) }); }
    }
    rescue(s, now, `no move accepted (seat ${seat}, ${step})`);
  }

  // nobody real is at the table (everyone closed the page): the table doesn't wait for them forever
  // (a friends' lobby is left alone: the host may be off sending the code to the others)
  const nobody = (s, online) => (s.g.phase === "play" || s.g.phase === "over") && !s.g.seats.some((x) => x && !x.bot && online.has(x.pid));
  function wakeAt(s, online) {
    const g = s.g;
    if (g.phase === "closed" || g.phase === "solo") return 0;
    if (nobody(s, online)) { if (!g.emptySince) g.emptySince = Date.now(); return g.emptySince + ABANDON_MS; }
    g.emptySince = 0;
    if (g.phase === "lobby") return online.size && g.fillAt ? g.fillAt : 0;
    if ((g.phase !== "play" && g.phase !== "over") || !g.due) return 0;
    if (g.actor >= 0) {
      const x = g.seats[g.actor];
      if (x && !x.bot && !online.has(x.pid)) return Math.min(g.due, Math.max(g.stepAt, Date.now() - 1) + OFFLINE_MS);
    }
    return g.due;
  }

  // when the table should move next on its own (for the phones' nudge): a seat whose phone is gone plays after OFFLINE_MS
  function nextDue(g, now, online) {
    if (!g.due) return 0;
    const x = g.actor >= 0 && g.seats[g.actor];
    if (online && x && !x.bot && !online.has(x.pid)) return Math.min(g.due, Math.max(g.stepAt, now) + OFFLINE_MS);
    return g.due;
  }
  const realAuto = spec.auto, realFallbacks = spec.fallbacks;
  return {
    maxPlayers: 4,
    // tests only (test/heal.mjs): swap in a broken bot to prove the table heals
    __setSabotage(wrap, breakFallbacks) {
      spec.auto = wrap ? wrap(realAuto) : realAuto;
      spec.fallbacks = wrap && breakFallbacks ? () => { throw new Error("sabotaged fallbacks"); } : realFallbacks;
    },

    init(opts = {}) {
      const now = Date.now();
      return {
        phase: "lobby", cfg: spec.cleanCfg(opts.cfg || {}), pub: !!opts.public, startAt: 0,
        // quick match: the first player sits down after ~1-2 s, the deal is at the latest WAIT_MS from now
        dealBy: opts.public ? now + WAIT_MS : 0,
        fillAt: opts.public ? now + ((WAIT_MS - 900) / Math.max(1, spec.seatList(spec.cleanCfg(opts.cfg || {})).length - 1)) * (0.6 + Math.random() * 0.3) : 0,
        seats: [null, null, null, null], mt: null, step: null, actor: -1, due: 0, stepAt: 0, seq: 0, log: [],
      };
    },

    canJoin(s) {
      const g = s.g, list = spec.seatList(g.cfg);
      if (g.phase === "lobby") return list.some((i) => !g.seats[i] || (g.pub && g.seats[i].bot));
      // a match that has only just been dealt (nobody has really played yet) can still take a person
      return g.pub && g.phase === "play" && fresh(g) && list.some((i) => g.seats[i] && g.seats[i].bot);
    },

    onJoin(s, pid, now) {
      const g = s.g;
      now = now || Date.now();
      if (g.phase === "play") {
        // a match in progress: take over one of the seats a bot holds (not the one whose turn it is)
        if (!g.pub || !fresh(g) || seatOf(g, pid) >= 0 || (g.left && g.left.includes(pid))) return false;
        const bots = spec.seatList(g.cfg).filter((i) => g.seats[i] && g.seats[i].bot);
        if (!bots.length) return false;
        const calm = bots.filter((i) => i !== g.actor), pickFrom = calm.length ? calm : bots;
        const i = pickFrom[(Math.random() * pickFrom.length) | 0];
        g.seats[i] = { pid, bot: false, color: g.seats[i].color };
        if (g.actor === i && g.due < now + 4000) { g.due = now + turnMs; g.stepAt = now; }
        g.seq += 1;
        return true;
      }
      if (g.phase !== "lobby") return false;
      const had = seatOf(g, pid) >= 0;
      syncLobby(s);
      g.seq += 1;
      friendsReady(s, now);
      if (g.pub && !had) {
        if (!g.dealBy) g.dealBy = now + WAIT_MS;                    // a table made before this rule
        // full: deal in a moment; otherwise the others keep arriving inside the same 7 s
        if (spec.seatList(g.cfg).every((i) => g.seats[i])) g.fillAt = Math.min(g.dealBy, now + gap(500, 900));
        else if (!g.fillAt || g.fillAt > g.dealBy) nextFill(g, now);
      }
      return true;
    },

    onRemove(s, pid, now, name) {
      const g = s.g;
      if (g.phase === "lobby") { syncLobby(s); g.seq += 1; friendsReady(s, Date.now()); return; }
      const i = seatOf(g, pid);
      if (i >= 0) g.seats[i] = g.pub ? { ...newBot(s), color: g.seats[i].color }                    // someone new sits down
        : { ...g.seats[i], name: name || nameOf(s, i), bot: true, stand: true, speed: 0.95 + Math.random() * 0.15 };   // friends: the seat keeps the name (shown as not here)
    },

    onMessage(s, me, msg) {
      const g = s.g, now = me.now, seat = seatOf(g, me.pid);
      switch (msg.t) {
        case "cfg": {
          if (!me.isHost || g.phase !== "lobby" || g.pub) return null;
          g.cfg = spec.cleanCfg({ ...g.cfg, ...(msg.cfg || {}) });
          syncLobby(s); g.seq += 1; friendsReady(s, now);
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
        case "vote": {
          if (seat < 0) return null;
          const v = String(msg.v || "");
          if (msg.kind === "again" && g.phase === "play") {          // early: "let's play again after this"
            g.pre = g.pre || {}; g.pre[me.pid] = v === "yes"; g.seq += 1;
            return { changed: true };
          }
          if (!g.vote || msg.kind !== g.vote.kind) return null;
          const ok = g.vote.kind === "again" ? ["yes", "no"] : (spec.options ? spec.options(g.vote.kind) : []);
          if (!ok.includes(v)) return null;
          g.vote.votes[me.pid] = v; g.seq += 1;
          settle(s, now);
          return { changed: true };
        }
        case "hold": {                              // PRIT / GATI from the hand someone is taking from
          if (g.phase !== "play" || seat < 0 || holderOf(g) !== seat) return null;
          const bot = g.seats[g.actor].bot;
          if (msg.done) {
            if (!(g.holdUntil > now)) return null;
            g.holdUntil = now;
            if (bot) g.due = Math.min(g.due, now + 700);
          } else {
            if (g.holdTurn === g.turnId) return null;
            g.holdTurn = g.turnId; g.holdUntil = now + HOLD_MS;
            if (bot) g.due = Math.max(g.due, g.holdUntil + 700);
            else { g.due += HOLD_MS; g.extra = HOLD_MS; }
          }
          g.seq += 1;
          return { changed: true };
        }
        case "order": {                             // your own arrangement: positions are what the others pick from
          if (g.phase !== "play" || seat < 0 || !spec.order) return null;
          if (holderOf(g) === seat && now > g.stepAt + GUARD_MS && !(g.holdUntil + 400 > now)) return null;   // too late, they're choosing
          spec.order(g.mt, seat, msg.ids);
          return null;
        }
        case "act": {
          if (g.phase !== "play" || seat < 0 || g.actor !== seat || g.step === "end") return { error: "not_your_turn" };
          if (settling(g, now)) return { error: "wait" };
          if (msg.step && msg.step !== g.step) return { error: "not_your_turn" };
          const r = apply(s, now, seat, g.step, msg);
          return r.error ? { error: r.error, why: r.why } : { changed: true };
        }
      }
      return null;
    },

    wakeAt,

    onTick(s, now, online, opts) {
      let changed = false;
      const g = s.g;
      try {
        if (g.away) for (const pid of Object.keys(g.away)) if (online.has(pid)) delete g.away[pid];
        if (nobody(s, online) && g.emptySince && now - g.emptySince >= ABANDON_MS) {
          g.phase = "closed"; g.due = 0; g.vote = null; g.seq += 1;
          return true;
        }
        for (let i = 0; i < 8; i++) {
          const w = wakeAt(s, online);
          if (!w || w > now || nobody(s, online)) break;
          awayCheck(s, now, online);
          autoMove(s, now, opts && opts.cheap);
          changed = true;
          if (opts && opts.cheap) break;          // a retried step does one thing and lets go
        }
      } catch (e) {
        fault(s, "tick crashed", e);
        rescue(s, now, "tick crashed");
        changed = true;
      }
      return changed;
    },

    // room.js calls this when a message from a phone crashed the rules: the table is put back on its feet
    recover(s, now, why) { if (s.g.phase === "play" || s.g.phase === "over") rescue(s, now, why); },

    // every phone sees everyone at the table as a player
    listPlayers(s, online) {
      const g = s.g;
      if (g.phase === "lobby") return null;
      return g.seats.map((x, i) => x && { pid: x.pid, name: nameOf(s, i), online: x.bot ? true : online.has(x.pid) }).filter(Boolean);
    },

    view(s, pid, now, online) {
      const g = s.g;
      const me = seatOf(g, pid);
      now = now || Date.now();
      // who isn't at the table any more: since when (server clock). The phones show it after a few seconds,
      // so a short network drop doesn't flash. Bots never show as away; a friend who left does.
      if (online) {
        g.gone = g.gone || {};
        for (const x of g.seats) if (x && !x.bot) { if (online.has(x.pid)) delete g.gone[x.pid]; else if (!g.gone[x.pid]) g.gone[x.pid] = now; }
      }
      const offOf = (x, i) => i === me || !x ? 0 : x.stand ? 1 : !x.bot && g.gone && g.gone[x.pid] || 0;
      const seats = g.seats.map((x, i) => x && { name: nameOf(s, i), fem: !!x.fem, color: i === me ? ME_COLOR : x.color || null, off: offOf(x, i) });
      const t = {
        phase: g.phase, cfg: g.cfg, pub: g.pub, startAt: g.startAt, seq: g.seq, me, seats, seatList: spec.seatList(g.cfg),
      };
      if (g.closedWhy) t.closedWhy = g.closedWhy;
      if (g.phase === "lobby" && g.pub) t.dealBy = g.dealBy;
      if (g.phase === "lobby" || g.phase === "solo" || !g.mt) return { tbl: t };
      const hs = humans(g);
      if (g.vote) t.vote = { kind: g.vote.kind, until: g.vote.until, mine: g.vote.votes[pid] || null, n: hs.length,
        tally: Object.values(g.vote.votes).reduce((o, x) => ((o[x] = (o[x] || 0) + 1), o), {}) };
      t.pre = !!(g.pre && g.pre[pid]);
      if (g.left && g.left.includes(pid)) { t.out = true; if (g.why && g.why[pid]) t.why = g.why[pid]; }   // didn't stay for the new match, or was gone too long
      Object.assign(t, {
        step: g.step, actor: g.actor,
        turnStart: g.actor >= 0 ? g.stepAt : 0, turnMs: turnMs + (g.extra || 0), due: nextDue(g, now, online),
        hold: g.holdUntil > Date.now() ? { seat: holderOf(g), until: g.holdUntil } : null,
        holdUsed: g.holdTurn === g.turnId, guardUntil: holderOf(g) >= 0 ? g.stepAt + GUARD_MS : 0,
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
