// Murlan online: the rules side. The table itself (seats, clock, quick match) is in table.js.
// The engine is the same file the page runs (public/engine.js, copied by scripts/build.mjs).
// cfg.teams: 2 kundër 2 (default) or everyone for themselves.
import { G, M } from "../gen/murlan-engine.js";
import { makeTable } from "./table.js";

// the engine takes a random source; it can't be stored, so it's attached only while dealing
const withRand = (mt, fn) => { mt.rand = Math.random; try { return fn(); } finally { delete mt.rand; } };

function snap(mt, me) {
  const H = mt.hand;
  const o = { teams: mt.teams, scores: mt.scores, team: mt.team, target: mt.target, handNo: mt.handNo, dealer: mt.dealer, winner: mt.winner, tie: mt.tie, golden: !!mt.golden };
  if (!H) return o;
  const ex = H.exchange, inEx = ex && (me === ex.first || me === ex.last);
  Object.assign(o, {
    hand: me >= 0 ? H.hands[me].slice() : [], counts: H.hands.map((h) => h.length),
    cur: H.cur, active: H.active, order: H.order, top: H.top, topCards: H.topCards, last: H.last, passes: H.passes, must3: H.must3, trick: H.trick,
    exchange: ex ? { first: ex.first, last: ex.last, jokers: !!ex.jokers, up: inEx ? ex.up ?? null : null, down: inEx ? ex.down ?? null : null, done: ex.jokers || ex.down !== undefined } : null,
  });
  if (H.result) { o.result = H.result; o.left = H.hands[H.result.order[3]].slice(); }
  return o;
}

const spec = {
  seatList: () => [0, 1, 2, 3],
  cleanCfg: (c) => ({ teams: c.teams !== false }),
  newMatch(cfg) { const mt = G.newMatch(Math.random, { teams: cfg.teams }); delete mt.rand; return mt; },

  deal(mt, emit) {
    const H = withRand(mt, () => G.deal(mt));
    const ex = H.exchange;
    const priv = {}; H.hands.forEach((h, p) => (priv[p] = { hand: h.slice() }));
    emit({ k: "deal", handNo: mt.handNo, dealer: mt.dealer, target: mt.target, cur: H.cur, counts: H.hands.map((h) => h.length),
      scores: mt.scores.slice(), team: mt.team.slice(), teams: mt.teams, ex: ex ? { first: ex.first, last: ex.last, jokers: !!ex.jokers } : null }, priv);
    if (!ex) return 2600;                                    // the phones animate the deal
    if (ex.jokers) { emit({ k: "jokers", first: ex.first, last: ex.last }); return 4600; }
    const card = G.exchangeGive(mt);
    emit({ k: "give", from: ex.last, to: ex.first }, { [ex.last]: { card }, [ex.first]: { card } });
    return 3600;
  },

  actor(mt) {
    const H = mt.hand;
    if (!H || H.result) return null;
    const ex = H.exchange;
    if (ex && !ex.jokers && ex.down === undefined) return { seat: ex.first, step: "gift" };
    return { seat: H.cur, step: "turn" };
  },

  act(mt, seat, step, msg, emit) {
    const H = mt.hand;
    if (step === "gift") {
      const card = Number(msg.card);
      if (!G.giftOptions(H.hands[seat]).includes(card)) return { error: "bad_gift" };
      const ex = H.exchange;
      G.exchangeReturn(mt, card);
      emit({ k: "ret", from: ex.first, to: ex.last }, { [ex.first]: { card }, [ex.last]: { card } });
      return { wait: 1500 };
    }
    let ids = msg.ids;
    if (ids === null || ids === undefined) {
      if (!H.top) return { error: "must_lead" };
      ids = null;
    } else {
      if (!Array.isArray(ids) || !ids.length || ids.length > 14) return { error: "bad_move" };
      ids = ids.map(Number);
      if (ids.some((x) => !Number.isInteger(x) || !H.hands[seat].includes(x)) || new Set(ids).size !== ids.length) return { error: "bad_move" };
      if (!G.checkPlay(H, seat, ids).ok) return { error: "bad_move" };
    }
    const ev = G.act(mt, seat, ids);
    if (ev.type === "pass") emit({ k: "pass", p: seat, cleared: ev.cleared, winner: ev.winner });
    else emit({ k: "play", p: seat, ids: ev.ids, m: ev.m, out: ev.out, place: ev.place || 0, one: H.hands[seat].length === 1 });
    if (ev.handOver) {
      emit({ k: "end", result: ev.result, left: H.hands[ev.result.order[3]].slice() });
      return { wait: 0 };
    }
    return { wait: ev.type === "pass" ? (ev.cleared ? 900 : 300) : ev.out ? 1100 : 500 };
  },

  auto(mt, seat, step) {
    if (step === "gift") return { card: M.chooseGift(mt.hand.hands[seat]) };
    return { ids: G.botMove(mt, seat, { maxRounds: 140, budgetMs: 80 }) };
  },

  think(mt, seat, step) {
    if (step === "gift") return { options: 6 };
    const H = mt.hand, opts = M.allMoves(H.hands[seat], H.top, H.must3).length;
    return { forced: !opts, options: opts, first: !H.top && H.hands[seat].length >= 13, hard: H.hands[seat].length <= 3 };
  },

  matchOver: (mt) => mt.winner !== null,
  // both sides past the target in the same hand: the table chooses +10 (the classic rule, also the default) or a golden hand
  pending: (mt) => (mt.tie ? "tie" : null),
  options: () => ["raise", "golden"],
  choose(mt, kind, how, emit) {
    G.choose(mt, how);
    emit({ k: "choice", how, target: mt.target, winner: mt.winner });
  },
  snap,
};

export default makeTable(spec);
