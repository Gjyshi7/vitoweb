/* ===== Domino engine (pure, no DOM) =====
   Double-six set: 28 tiles. Tile id 0..27 -> [a, b] with a <= b. Id 0 is 0|0.
   Seats 0..3 clockwise, 0 is you.
     2 kundër 2: seats 0+2 vs 1+3, 7 tiles each, all 28 dealt.
     1 kundër 1: seats 0 vs 2, 7 tiles each, 14 left over. With stock on, a player who can't
                 play draws until they can; with it off the leftovers stay out of play.
   A hand ends when someone plays their last tile ("domino") or nobody can move ("bllok").
   The winning side scores the pips left in the losing side's hands.
   Special rule: 0|0 counts 10 when it's the only tile left in a hand, 0 otherwise.
   Blocked hand: the side with fewer pips left wins and scores the other side's pips; a tie scores nothing.
   First side to reach the target (50 / 100 / 150 / custom) wins the match. */
const E = (() => {
  const TILES = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) TILES.push([a, b]);
  const A = id => TILES[id][0], B = id => TILES[id][1];
  const pips = id => TILES[id][0] + TILES[id][1];
  const isDbl = id => TILES[id][0] === TILES[id][1];
  const has = (id, v) => TILES[id][0] === v || TILES[id][1] === v;
  const other = (id, v) => TILES[id][0] === v ? TILES[id][1] : TILES[id][0];
  const sumPips = hand => hand.reduce((s, id) => s + pips(id), 0);
  const ZERO_ALONE = 10;
  const handValue = hand => hand.length === 1 && hand[0] === 0 ? ZERO_ALONE : sumPips(hand);
  const label = id => `${A(id)}|${B(id)}`;

  function shuffle(arr, rand) { rand = rand || Math.random; for (let i = arr.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

  /* o.seats with three seats: three players, each for themselves (a friends' room "vetëm ne"):
     7 tiles each, the other 7 drawn or out of play like 1 kundër 1. Each player is their own side. */
  function newMatch(o) {
    o = o || {};
    const three = Array.isArray(o.seats) && o.seats.length === 3;
    const teams = !three && o.teams !== false;
    const seats = three ? o.seats.slice().sort() : teams ? [0, 1, 2, 3] : [0, 2];
    const teamOf = three ? [0, 1, 2, 3].map(q => seats.indexOf(q) < 0 ? 0 : seats.indexOf(q)) : teams ? [0, 1, 0, 1] : [0, 1, 1, 1];
    return { teams, three, stock: !teams && !!o.stock, target: o.target || 100, rand: o.rand || Math.random,
      seats, teamOf, scores: three ? [0, 0, 0] : [0, 0], handNo: 0, lastWinner: -1, winner: null, hand: null };
  }
  const nextSeat = (mt, p) => mt.seats[(mt.seats.indexOf(p) + 1) % mt.seats.length];

  function deal(mt) {
    mt.handNo++;
    const deck = shuffle(Array.from({ length: 28 }, (_, i) => i), mt.rand);
    const hands = [[], [], [], []], n = mt.seats.length * 7;
    for (let i = 0; i < n; i++) hands[mt.seats[i % mt.seats.length]].push(deck[i]);
    const H = { hands, bone: deck.slice(n), start: null, L: [], R: [], ends: null, cur: 0, passes: 0,
      lacks: [new Set(), new Set(), new Set(), new Set()], played: new Set(), mustOpen: null, result: null, dealOrder: deck.slice(0, n) };
    if (mt.lastWinner >= 0) H.cur = mt.lastWinner;
    else {
      // first hand (or after a tied block): the highest double opens and must be played
      let best = -1, who = 0;
      for (const p of mt.seats) for (const id of hands[p]) {
        const v = (isDbl(id) ? 100 : 0) + pips(id) * 2 + B(id) * .1;
        if (v > best) { best = v; who = p; H.mustOpen = id; }
      }
      H.cur = who;
    }
    mt.hand = H;
    return H;
  }

  /* moves: {id, side}. side 'S' = first tile, 'L' / 'R' = which end. */
  function movesFor(H, p) {
    const hand = H.hands[p], out = [];
    if (!H.start) {
      for (const id of hand) if (H.mustOpen === null || id === H.mustOpen) out.push({ id, side: 'S' });
      return out;
    }
    const [l, r] = H.ends;
    for (const id of hand) {
      const okL = has(id, l), okR = has(id, r);
      if (okL && okR && l === r) out.push({ id, side: H.L.length <= H.R.length ? 'L' : 'R' });
      else { if (okL) out.push({ id, side: 'L' }); if (okR) out.push({ id, side: 'R' }); }
    }
    return out;
  }
  const canMove = (H, p) => movesFor(H, p).length > 0;
  const canDraw = mt => mt.stock && mt.hand.bone.length > 0;

  function endsAfter(H, m) {
    if (m.side === 'S') return [A(m.id), B(m.id)];
    const e = H.ends.slice();
    if (m.side === 'L') e[0] = other(m.id, e[0]); else e[1] = other(m.id, e[1]);
    return e;
  }

  function play(mt, p, m) {
    const H = mt.hand;
    if (p !== H.cur) throw new Error('not your turn');
    if (!movesFor(H, p).some(x => x.id === m.id && x.side === m.side)) throw new Error('illegal move ' + label(m.id) + ' ' + m.side);
    H.hands[p] = H.hands[p].filter(x => x !== m.id);
    if (m.side === 'S') { H.start = { id: m.id, left: A(m.id), right: B(m.id) }; H.ends = [A(m.id), B(m.id)]; H.mustOpen = null; }
    else if (m.side === 'L') { const inner = H.ends[0], outer = other(m.id, inner); H.L.push({ id: m.id, inner, outer }); H.ends[0] = outer; }
    else { const inner = H.ends[1], outer = other(m.id, inner); H.R.push({ id: m.id, inner, outer }); H.ends[1] = outer; }
    H.played.add(m.id); H.passes = 0;
    const ev = { type: 'play', p, id: m.id, side: m.side, over: false };
    if (!H.hands[p].length) { finish(mt, 'domino', p); ev.over = true; ev.result = H.result; return ev; }
    H.cur = nextSeat(mt, p);
    return ev;
  }

  function draw(mt, p) {
    const H = mt.hand;
    if (p !== H.cur || !canDraw(mt) || canMove(H, p)) throw new Error('cannot draw');
    const id = H.bone.pop(); H.hands[p].push(id);
    return id;
  }

  function pass(mt, p) {
    const H = mt.hand;
    if (p !== H.cur || canMove(H, p) || canDraw(mt)) throw new Error('cannot pass');
    if (H.ends) { H.lacks[p].add(H.ends[0]); H.lacks[p].add(H.ends[1]); }
    H.passes++;
    const ev = { type: 'pass', p, over: false };
    if (H.passes >= mt.seats.length) { finish(mt, 'bllok', p); ev.over = true; ev.result = H.result; return ev; }
    H.cur = nextSeat(mt, p);
    return ev;
  }

  function finish(mt, kind, p) {
    const H = mt.hand;
    const left = [0, 0, 0, 0];
    for (const q of mt.seats) left[q] = handValue(H.hands[q]);
    const sides = mt.scores.length;
    const teamLeft = new Array(sides).fill(0);
    for (const q of mt.seats) teamLeft[mt.teamOf[q]] += left[q];
    let winTeam = null;
    if (kind === 'domino') winTeam = mt.teamOf[p];
    else {
      // blocked: the side with the fewest pips wins, if it is the only one with that few
      const low = Math.min(...teamLeft);
      if (teamLeft.filter(v => v === low).length === 1) winTeam = teamLeft.indexOf(low);
    }
    const gain = winTeam === null ? 0 : teamLeft.reduce((a, v, i) => a + (i === winTeam ? 0 : v), 0);
    if (winTeam !== null) mt.scores[winTeam] += gain;
    // next hand is opened by whoever went out; after a block, by the winning side's lightest hand
    if (kind === 'domino') mt.lastWinner = p;
    else if (winTeam !== null) mt.lastWinner = mt.seats.filter(q => mt.teamOf[q] === winTeam).sort((a, b) => left[a] - left[b])[0];
    else mt.lastWinner = -1;
    if (winTeam !== null && mt.scores[winTeam] >= mt.target) mt.winner = winTeam;
    const zeroAlone = mt.seats.filter(q => H.hands[q].length === 1 && H.hands[q][0] === 0);
    H.cur = -1;
    H.result = { kind, p, winTeam, gain, left, teamLeft, scores: mt.scores.slice(), matchWinner: mt.winner, zeroAlone };
  }

  /* ---- bot: one-ply evaluation using only what a real player can see ----
     Dumps heavy tiles and doubles, keeps ends it can follow, and leaves ends that
     opponents who already passed on can't match, while not shutting out its partner. */
  function botChoose(mt, p) {
    const H = mt.hand, ms = movesFor(H, p);
    if (!ms.length) return null;
    if (ms.length === 1) return ms[0];
    const hand = H.hands[p], rand = mt.rand;
    const unseen = []; for (let id = 0; id < 28; id++) if (!H.played.has(id) && !hand.includes(id)) unseen.push(id);
    const others = []; for (let q = nextSeat(mt, p); q !== p; q = nextSeat(mt, q)) others.push(q);
    let best = null, bs = -1e9;
    for (const m of ms) {
      const rest = hand.filter(x => x !== m.id);
      if (!rest.length) return m;
      const e = endsAfter(H, m);
      let s = pips(m.id) * .9 + (isDbl(m.id) ? 3.5 : 0);
      if (m.id === 0 && rest.length > 1) s -= 2;          // 0|0 is free to hold while you have other tiles
      if (m.id !== 0 && rest.length === 1 && rest[0] === 0) s -= 6;   // don't get stuck with 0|0 alone (worth 10)
      s += 1.6 * rest.filter(x => has(x, e[0]) || has(x, e[1])).length;
      s -= .45 * unseen.filter(x => x !== m.id && (has(x, e[0]) || has(x, e[1]))).length;
      others.forEach((q, k) => {
        const mate = mt.teamOf[q] === mt.teamOf[p];
        const blocked = H.lacks[q].has(e[0]) && H.lacks[q].has(e[1]);
        const low = H.hands[q].length <= 2;
        if (mate) { if (blocked) s -= 3 + (low ? 5 : 0); }
        else if (blocked) s += (k === 0 ? 5 : 2.5) + (low ? 6 : 0);
        else if (H.lacks[q].has(e[0]) || H.lacks[q].has(e[1])) s += k === 0 ? .8 : .3;
      });
      s += (rand() - .5) * .6;
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }

  return { TILES, A, B, pips, isDbl, has, other, sumPips, handValue, ZERO_ALONE, label, shuffle, newMatch, nextSeat, deal, movesFor, canMove, canDraw, endsAfter, play, draw, pass, botChoose };
})();
if (typeof module !== 'undefined') module.exports = { E };
