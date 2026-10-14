// Spathi online: the rules side (2 players). Table, clock and quick match are in table.js.
import { S } from "../gen/spathi-engine.js";
import { makeTable } from "./table.js";

const withRand = (mt, fn) => { mt.rand = Math.random; try { return fn(); } finally { delete mt.rand; } };
// a deal as each seat sees it: its own cards with ids, the other player's face down
const masked = (order, seat) => order.map((o) => (o.to === "table" || o.to === seat ? o : { to: o.to, id: null }));

function snap(mt, me) {
  const H = mt.hand;
  const o = { scores: mt.scores, target: mt.target, handNo: mt.handNo, dealer: mt.dealer, winner: mt.winner };
  if (!H) return o;
  Object.assign(o, {
    hand: me >= 0 ? H.hands[me].slice() : [], counts: H.hands.map((h) => h.length), table: H.table.slice(),
    taken: H.taken.map((t) => t.slice()), takenN: H.taken.map((t) => t.length),
    stockN: H.stock.length, cur: H.cur, first: H.first, lastTaker: H.lastTaker, seen: [...H.seen],
  });
  if (H.result) o.result = H.result;
  return o;
}

const spec = {
  seatList: () => [0, 1],
  cleanCfg: (c) => ({ target: [11, 21].includes(Number(c.target)) ? Number(c.target) : 21 }),
  newMatch(cfg) { const mt = S.newMatch({ target: cfg.target }); delete mt.rand; return mt; },

  deal(mt, emit) {
    const H = withRand(mt, () => S.deal(mt));
    const order = H.dealEv.order;
    delete H.dealEv;
    emit({ k: "deal", handNo: mt.handNo, dealer: mt.dealer, first: H.first, scores: mt.scores.slice(), target: mt.target, order: masked(order, -1) },
      { 0: { order: masked(order, 0) }, 1: { order: masked(order, 1) } });
    return 3200;
  },

  actor: (mt) => (!mt.hand || mt.hand.over ? null : { seat: mt.hand.cur, step: "turn" }),

  act(mt, seat, step, msg, emit) {
    const H = mt.hand;
    const card = Number(msg.card);
    const take = Array.isArray(msg.take) ? msg.take.map(Number) : [];
    if (!H.hands[seat].includes(card)) return { error: "bad_move" };
    if (new Set(take).size !== take.length || take.some((id) => !H.table.includes(id))) return { error: "bad_move" };
    const must = S.canCapture(card, H.table);                 // taking is not optional, how much is up to the player
    if (must ? !take.length || !S.validCapture(S.val(card), take) : take.length) return { error: "bad_move" };
    const ev = S.act(mt, seat, card, take);
    emit({ k: "play", p: seat, card, take: ev.take, sweep: ev.sweep });
    let wait = 900;
    if (ev.deal) {
      emit({ k: "redeal", order: masked(ev.deal.order, -1), stockN: H.stock.length }, { 0: { order: masked(ev.deal.order, 0) }, 1: { order: masked(ev.deal.order, 1) } });
      wait += 2000;
    }
    if (ev.end) { emit({ k: "end", result: ev.end }); wait = 0; }
    return { wait };
  },

  auto: (mt, seat) => { const m = S.botMove(mt, seat, { samples: 40 }); return { card: m.card, take: m.take }; },
  think(mt, seat) {
    const H = mt.hand;
    const opts = H.hands[seat].reduce((n, c) => n + Math.max(1, S.takes(c, H.table).length), 0);
    return { options: opts, forced: H.hands[seat].length === 1, first: H.hands[seat].length === 4 && H.stock.length === 52 - 12 };
  },
  matchOver: (mt) => mt.winner !== null,
  snap,
};

export default makeTable(spec);
