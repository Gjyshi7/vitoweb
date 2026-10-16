// Derri në dorë online: the rules side (4 players). Table, clock and quick match are in table.js.
// The picker takes a card blind: it sends a position, the server keeps the holder's real order.
// Only the picker and the holder learn which card moved; a pair that gets thrown is public.
import { E } from "../gen/derri-engine.js";
import { makeTable } from "./table.js";

const withRand = (mt, fn) => { mt.rand = Math.random; try { return fn(); } finally { delete mt.rand; } };

function snap(mt, me) {
  const H = mt.hand;
  const o = { losses: mt.losses, round: mt.round, dealer: mt.dealer };
  if (!H) return o;
  Object.assign(o, { hand: me >= 0 ? H.hands[me].slice() : [], counts: H.hands.map((h) => h.length), cur: H.cur, order: H.order, over: H.over, loser: H.loser });
  return o;
}

const spec = {
  turnMs: 20_000,
  seatList: () => [0, 1, 2, 3],
  cleanCfg: () => ({}),
  newMatch(cfg, seats) { const mt = E.newMatch(Math.random, seats || undefined); delete mt.rand; return mt; },
  // friends' room, only the people there: all 49 cards split among 2, 3 or 4
  onlyUs: (cfg, n) => (n === 4 ? { cfg, seats: [0, 1, 2, 3] } : n === 3 ? { cfg, seats: [0, 1, 2] } : n === 2 ? { cfg, seats: [0, 2] } : null),

  deal(mt, emit) {
    const H = withRand(mt, () => E.deal(mt));
    const priv = {}; H.hands.forEach((h, p) => (priv[p] = { hand: h.slice() }));
    emit({ k: "deal", round: mt.round, dealer: mt.dealer, counts: H.hands.map((h) => h.length), losses: mt.losses.slice() }, priv);
    const res = withRand(mt, () => E.initialDiscard(mt));
    // n: every seat's card count after the event. Public anyway (each plate shows it); the phones keep their
    // copy of the others' hands exactly that size, so what you pick from always has the cards it really has.
    emit({ k: "pairs", pairs: res.pairs, outs: res.outs, cur: H.cur, over: H.over, loser: H.loser, n: H.hands.map((h) => h.length) });
    const thrown = res.pairs.filter((p) => p.length).length;
    if (H.over) { emit({ k: "end", loser: H.loser, losses: mt.losses.slice(), order: H.order.slice() }); return 2600 + thrown * 900; }
    return 2600 + thrown * 900 + 500;
  },

  actor: (mt) => (!mt.hand || mt.hand.over ? null : { seat: mt.hand.cur, step: "pick" }),

  act(mt, seat, step, msg, emit) {
    const H = mt.hand;
    const from = E.source(H, seat);
    const idx = Number(msg.idx);
    if (!Number.isInteger(idx) || from < 0 || idx < 0 || idx >= H.hands[from].length) return { error: "bad_move" };
    const ev = withRand(mt, () => E.draw(mt, seat, idx));
    emit({ k: "draw", p: seat, from, idx, pair: ev.pair, outs: ev.outs, cur: H.cur, over: ev.over, n: H.hands.map((h) => h.length) },
      { [seat]: { card: ev.card }, [from]: { card: ev.card } });
    if (ev.over) { emit({ k: "end", loser: ev.loser, losses: mt.losses.slice(), order: H.order.slice() }); return { wait: 0 }; }
    return { wait: ev.pair ? 2400 : 1300 };   // the phones show the card arrive, and a pair meet and go to the table
  },

  // the picker takes from this seat's hand
  holder: (mt, seat, step) => (step === "pick" && mt.hand ? E.source(mt.hand, seat) : -1),
  // a player's own arrangement: the same cards, in the order they hold them
  order(mt, seat, ids) {
    const h = mt.hand && mt.hand.hands[seat];
    if (!h || !Array.isArray(ids) || ids.length !== h.length) return;
    const want = ids.map(Number);
    if (new Set(want).size !== h.length || want.some((x) => !h.includes(x))) return;
    mt.hand.hands[seat] = want;
  },
  auto: (mt, seat) => ({ idx: (Math.random() * mt.hand.hands[E.source(mt.hand, seat)].length) | 0 }),
  fallbacks: () => [{ idx: 0 }],
  think: () => ({ forced: true }),
  matchOver: () => false,                     // Derri goes on round after round
  snap,
};

export default makeTable(spec);
