// Murlan, online. Up to 4 phones at one table; seats nobody takes are filled with players
// before the deal. The server runs the same engine as the page (public/engine.js) and is the
// only one that knows every hand: each phone receives its own cards, the counts of the others,
// and the public events (plays, passes, the exchange cards only to the two players involved).
//
// Timing: someone whose turn it is gets TURN_MS; a phone that is offline gets OFFLINE_MS before
// the seat plays on its own. Seats left by a player keep playing under the same name.
import { G, M } from "../gen/murlan-engine.js";
import { PLAYERS } from "../gen/players.js";
import { publicId } from "../util.js";

const SEATS = 4;
const TURN_MS = 30_000;
const GIFT_MS = 25_000;
const OFFLINE_MS = 6_000;
const END_MS = 9_000;
const LOG_KEEP = 240;
const COLORS = ["#b02a63", "#2c6e8f", "#7a4fa8", "#2f8a62"];
const rnd = (a, b) => a + Math.random() * (b - a);

// ---- seats ----
function syncLobby(s) {
  const g = s.g;
  const humans = s.players.slice(0, SEATS);
  // keep filled seats (bots during "filling"), put humans in the order they joined
  const next = g.seats.map((x) => (x && x.bot ? x : null));
  for (const p of humans) {
    const at = next.findIndex((x) => x && x.pid === p.pid);
    if (at >= 0) continue;
    const free = next.findIndex((x) => !x);
    if (free < 0) break;
    next[free] = { pid: p.pid, name: p.name, fem: false, color: COLORS[free], bot: false };
  }
  g.seats = next;
}
const seatOf = (g, pid) => g.seats.findIndex((x) => x && x.pid === pid);
const nameOf = (s, seat) => {
  const x = s.g.seats[seat];
  if (!x) return "";
  if (!x.bot) { const p = s.players.find((q) => q.pid === x.pid); if (p) return p.name; }
  return x.name;
};
function newBot(s) {
  const taken = new Set(s.g.seats.filter(Boolean).map((x) => x.name.toLowerCase()));
  for (const p of s.players) taken.add(p.name.toLowerCase());
  let b;
  do { b = PLAYERS.one(); } while (taken.has(b.name.toLowerCase()) || b.name.length > 15);
  return { pid: publicId(), name: b.name, fem: b.fem, speed: 0.72 + Math.random() * 0.7, bot: true };
}

// ---- events ----
function log(g, ev) {
  g.seq += 1;
  g.log.push({ seq: g.seq, ...ev });
  if (g.log.length > LOG_KEEP) g.log.splice(0, g.log.length - LOG_KEEP);
}
const withRand = (g, fn) => { g.mt.rand = Math.random; try { return fn(); } finally { delete g.mt.rand; } };

// ---- the flow of a hand ----
function setTurn(s, now) {
  const g = s.g, H = g.mt.hand;
  const seat = g.step === "gift" ? H.exchange.first : H.cur;
  g.actor = seat;
  g.stepAt = now;
  const x = g.seats[seat];
  if (x.bot) {
    if (g.step === "gift") g.due = now + PLAYERS.think(x, { options: 6 });
    else {
      const opts = M.allMoves(H.hands[seat], H.top, H.must3).length;
      g.due = now + PLAYERS.think(x, { forced: !opts, options: opts, first: !H.top && H.hands[seat].length >= 13, hard: H.hands[seat].length <= 3 });
    }
  } else g.due = now + (g.step === "gift" ? GIFT_MS : TURN_MS);
}

function deal(s, now) {
  const g = s.g;
  const H = withRand(g, () => G.deal(g.mt));
  g.phase = "play";
  g.log = [];                                   // the log holds one hand; a phone that falls behind redraws from the snapshot
  const ex0 = H.exchange;
  log(g, { k: "deal", handNo: g.mt.handNo, dealer: g.mt.dealer, hands: H.hands.map((h) => h.slice()), target: g.mt.target, scores: g.mt.scores.slice(),
    cur: H.cur, ex: ex0 ? { first: ex0.first, last: ex0.last, jokers: !!ex0.jokers } : null });
  const ex = H.exchange;
  if (!ex) { g.step = "turn"; return setTurn(s, now + 2600); }       // the deal animation runs on the phones
  if (ex.jokers) { log(g, { k: "jokers", first: ex.first, last: ex.last }); g.step = "turn"; return setTurn(s, now + 4600); }
  const card = G.exchangeGive(g.mt);
  log(g, { k: "give", from: ex.last, to: ex.first, card });
  g.step = "gift";
  setTurn(s, now + 3600);
}

function giftNow(s, now, card) {
  const g = s.g, H = g.mt.hand, ex = H.exchange;
  const back = G.exchangeReturn(g.mt, card);
  log(g, { k: "ret", from: ex.first, to: ex.last, card: back });
  g.step = "turn";
  setTurn(s, now + 1500);
}

function actNow(s, now, seat, ids) {
  const g = s.g;
  const ev = G.act(g.mt, seat, ids);
  if (ev.type === "pass") log(g, { k: "pass", p: seat, cleared: ev.cleared, winner: ev.winner });
  else log(g, { k: "play", p: seat, ids: ev.ids, m: ev.m, out: ev.out, place: ev.place || 0 });
  if (ev.handOver) {
    const H = g.mt.hand;
    const lp = ev.result.order[3];
    log(g, { k: "end", result: ev.result, left: H.hands[lp].slice() });
    g.step = "end"; g.actor = -1; g.due = now + END_MS;
    return;
  }
  setTurn(s, now + (ev.type === "pass" ? (ev.cleared ? 900 : 300) : ev.out ? 1100 : 500));
}

// the seat plays by itself: a bot's move, or the autopilot for a phone that ran out of time
function autoMove(s, now) {
  const g = s.g, H = g.mt && g.mt.hand;
  if (g.phase === "filling") {
    const free = g.seats.findIndex((x) => !x);
    if (free >= 0) {
      g.seats[free] = { ...newBot(s), color: COLORS[free] };
      g.seq += 1;   // lobby changed
    }
    if (g.seats.every(Boolean)) { startMatch(s, now + 900); return; }
    g.due = now + rnd(700, 2600);
    return;
  }
  if (g.step === "end") {
    if (g.mt.winner !== null || g.mt.tie) { g.phase = "over"; g.actor = -1; g.due = 0; log(g, { k: "over", winner: g.mt.winner, tie: g.mt.tie }); return; }
    return deal(s, now);
  }
  if (g.step === "gift") return giftNow(s, now, undefined);
  if (g.step === "turn") {
    const ids = G.botMove(g.mt, H.cur, { maxRounds: 140, budgetMs: 80 });
    return actNow(s, now, H.cur, ids);
  }
}

function startMatch(s, now) {
  const g = s.g;
  g.mt = G.newMatch(Math.random);
  delete g.mt.rand;
  g.log = [];
  deal(s, now);
}

// when does this room need to wake up next (0 = not by itself)
function wakeAt(s, online) {
  const g = s.g;
  if (!g || !g.due) return 0;
  if (g.phase !== "filling" && g.phase !== "play") return 0;
  const humanOnline = g.seats.some((x) => x && !x.bot && online.has(x.pid)) || (g.phase === "filling" && online.size > 0);
  if (!humanOnline) return 0;                           // nobody watching: the table waits
  if (g.phase === "play" && g.actor >= 0) {
    const x = g.seats[g.actor];
    if (x && !x.bot && !online.has(x.pid)) return Math.min(g.due, Math.max(g.stepAt, Date.now() - 1) + OFFLINE_MS);
  }
  return g.due;
}

export default {
  maxPlayers: SEATS,

  init() {
    return { phase: "lobby", seats: [null, null, null, null], mt: null, step: null, actor: -1, due: 0, stepAt: 0, seq: 0, log: [] };
  },

  // nobody new sits down once the cards are out (returning players are let in by the room)
  canJoin(s) {
    const g = s.g;
    if (g.phase === "lobby") return s.players.length < SEATS;
    if (g.phase === "filling") return g.seats.some((x) => !x);
    return false;
  },

  onJoin(s) {
    const g = s.g;
    if (g.phase === "lobby" || g.phase === "filling") { syncLobby(s); return true; }
    return false;
  },

  onRemove(s, pid) {
    const g = s.g;
    if (g.phase === "lobby" || g.phase === "filling") {
      const i = seatOf(g, pid);
      if (i >= 0) g.seats[i] = null;
      syncLobby(s);
      return;
    }
    const i = seatOf(g, pid);
    if (i >= 0) {   // the seat keeps playing under the same name
      const x = g.seats[i];
      g.seats[i] = { ...x, name: nameOf(s, i), bot: true, speed: 0.9 + Math.random() * 0.4 };
    }
  },

  onMessage(s, me, msg) {
    const g = s.g, now = me.now;
    const seat = seatOf(g, me.pid);
    switch (msg.t) {
      case "start": {
        if (!me.isHost || g.phase !== "lobby") return null;
        syncLobby(s);
        if (g.seats.every(Boolean)) { startMatch(s, now); return { changed: true }; }
        g.phase = "filling"; g.due = now + rnd(900, 2200); g.seq += 1;
        return { changed: true };
      }
      case "again": {
        if (!me.isHost || g.phase !== "over") return null;
        startMatch(s, now);
        return { changed: true };
      }
      case "play": {
        if (g.phase !== "play" || g.step !== "turn" || seat < 0 || g.mt.hand.cur !== seat) return { error: "not_your_turn" };
        const H = g.mt.hand;
        let ids = msg.ids;
        if (ids === null) {
          if (!H.top) return { error: "must_lead" };
          actNow(s, now, seat, null);
          return { changed: true };
        }
        if (!Array.isArray(ids) || !ids.length || ids.length > 14) return { error: "bad_move" };
        ids = ids.map(Number);
        if (ids.some((x) => !Number.isInteger(x) || !H.hands[seat].includes(x)) || new Set(ids).size !== ids.length) return { error: "bad_move" };
        const chk = G.checkPlay(H, seat, ids);
        if (!chk.ok) return { error: "illegal", why: chk.why };
        actNow(s, now, seat, ids);
        return { changed: true };
      }
      case "gift": {
        if (g.phase !== "play" || g.step !== "gift" || seat < 0) return null;
        const H = g.mt.hand;
        if (H.exchange.first !== seat) return null;
        const card = Number(msg.card);
        if (!G.giftOptions(H.hands[seat]).includes(card)) return { error: "bad_gift" };
        giftNow(s, now, card);
        return { changed: true };
      }
    }
    return null;
  },

  wakeAt,

  onTick(s, now, online) {
    let changed = false;
    for (let i = 0; i < 6; i++) {
      const w = wakeAt(s, online);
      if (!w || w > now) break;
      autoMove(s, now);
      changed = true;
    }
    return changed;
  },

  // other phones see everyone as players; nothing on the wire tells who sits where on autopilot
  listPlayers(s, online) {
    const g = s.g;
    if (g.phase === "lobby") return null;
    return g.seats.filter(Boolean).map((x, i) => ({ pid: x.pid, name: nameOf(s, g.seats.indexOf(x)), online: x.bot ? true : online.has(x.pid) }));
  },

  view(s, pid, now) {
    const g = s.g;
    const me = seatOf(g, pid);
    const seats = g.seats.map((x, i) => x ? { pid: x.pid, name: nameOf(s, i), fem: !!x.fem, color: x.color || COLORS[i] } : null);
    const out = { mur: { phase: g.phase, seq: g.seq, me, seats } };
    if (!g.mt) return out;
    const mt = g.mt, H = mt.hand, o = out.mur;
    Object.assign(o, {
      scores: mt.scores, target: mt.target, handNo: mt.handNo, dealer: mt.dealer,
      winner: mt.winner, tie: mt.tie, step: g.step, actor: g.actor,
      // the same clock for every seat: when the turn started and how long a turn may take
      turnStart: g.actor >= 0 ? g.stepAt : 0, turnMs: g.step === "gift" ? GIFT_MS : TURN_MS,
    });
    if (H) {
      o.hand = me >= 0 ? H.hands[me].slice() : [];
      o.counts = H.hands.map((h) => h.length);
      Object.assign(o, {
        cur: H.cur, active: H.active, order: H.order, top: H.top, topCards: H.topCards, last: H.last,
        passes: H.passes, must3: H.must3, trick: H.trick,
      });
      const ex = H.exchange;
      if (ex) o.exchange = { first: ex.first, last: ex.last, jokers: !!ex.jokers, up: me === ex.first || me === ex.last ? ex.up ?? null : null, down: me === ex.first || me === ex.last ? ex.down ?? null : null };
      if (H.result) o.result = H.result;
      if (g.step === "end" && H.result) o.left = H.hands[H.result.order[3]].slice();
    }
    // events of this hand, with the private parts kept for their owner
    o.log = g.log.map((e) => {
      if (e.k === "deal") { const { hands, ...pub } = e; return { ...pub, hand: me >= 0 ? hands[me] : [], counts: hands.map((h) => h.length) }; }
      if (e.k === "give" || e.k === "ret") return me === e.from || me === e.to ? e : { ...e, card: null };
      return e;
    });
    return out;
  },
};
