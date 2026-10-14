// Domino online: the rules side. 2 kundër 2 (seats 0+2 vs 1+3) or 1 kundër 1 (seats 0 and 2).
// Table, clock and quick match are in table.js.
import { E } from "../gen/domino-engine.js";
import { makeTable } from "./table.js";

const withRand = (mt, fn) => { mt.rand = Math.random; try { return fn(); } finally { delete mt.rand; } };

function snap(mt, me) {
  const H = mt.hand;
  const o = { teams: mt.teams, stock: mt.stock, scores: mt.scores, target: mt.target, handNo: mt.handNo, winner: mt.winner, seats: mt.seats, teamOf: mt.teamOf };
  if (!H) return o;
  Object.assign(o, {
    hand: me >= 0 ? H.hands[me].slice() : [], counts: H.hands.map((h) => h.length), boneN: H.bone.length,
    start: H.start, L: H.L, R: H.R, ends: H.ends, cur: H.cur, passes: H.passes, mustOpen: H.mustOpen,
    lacks: H.lacks.map((x) => [...x]),
  });
  if (H.result) { o.result = H.result; o.hands = H.hands; }
  return o;
}

const spec = {
  seatList: (cfg) => (cfg.teams ? [0, 1, 2, 3] : [0, 2]),
  cleanCfg(c) {
    const teams = c.teams !== false;
    const t = Math.round(Number(c.target) / 10) * 10;
    return { teams, stock: !teams && !!c.stock, target: t >= 10 && t <= 1000 ? t : 100 };
  },
  newMatch(cfg) { const mt = E.newMatch({ teams: cfg.teams, stock: cfg.stock, target: cfg.target }); delete mt.rand; return mt; },

  deal(mt, emit) {
    const H = withRand(mt, () => E.deal(mt));
    const priv = {}; for (const p of mt.seats) priv[p] = { hand: H.hands[p].slice() };
    emit({ k: "deal", handNo: mt.handNo, counts: H.hands.map((h) => h.length), cur: H.cur, mustOpen: H.mustOpen, boneN: H.bone.length, scores: mt.scores.slice() }, priv);
    return 2600;
  },

  actor: (mt) => (!mt.hand || mt.hand.result ? null : { seat: mt.hand.cur, step: "turn" }),

  act(mt, seat, step, msg, emit) {
    const H = mt.hand;
    if (msg.kind === "draw") {
      if (!E.canDraw(mt) || E.canMove(H, seat)) return { error: "bad_move" };
      const id = E.draw(mt, seat);
      emit({ k: "draw", p: seat, boneN: H.bone.length }, { [seat]: { id } });
      return { wait: 350 };
    }
    if (msg.kind === "pass") {
      if (E.canMove(H, seat) || E.canDraw(mt)) return { error: "bad_move" };
      const ev = E.pass(mt, seat);
      emit({ k: "pass", p: seat });
      if (ev.over) { emit({ k: "end", result: ev.result, hands: H.hands.map((h) => h.slice()) }); return { wait: 0 }; }
      return { wait: 600 };
    }
    const m = { id: Number(msg.id), side: String(msg.side) };
    if (!E.movesFor(H, seat).some((x) => x.id === m.id && x.side === m.side)) return { error: "bad_move" };
    const ev = E.play(mt, seat, m);
    emit({ k: "play", p: seat, id: m.id, side: m.side, one: H.hands[seat].length === 1 });
    if (ev.over) { emit({ k: "end", result: ev.result, hands: H.hands.map((h) => h.slice()) }); return { wait: 0 }; }
    return { wait: 450 };
  },

  auto(mt, seat) {
    const H = mt.hand;
    if (E.canMove(H, seat)) { const m = withRand(mt, () => E.botChoose(mt, seat)); return { kind: "play", id: m.id, side: m.side }; }
    if (E.canDraw(mt)) return { kind: "draw" };
    return { kind: "pass" };
  },
  think(mt, seat) {
    const H = mt.hand, n = E.movesFor(H, seat).length;
    return { forced: n <= 1, options: n, hard: H.hands[seat].length <= 2 };
  },
  matchOver: (mt) => mt.winner !== null,
  snap,
};

export default makeTable(spec);
