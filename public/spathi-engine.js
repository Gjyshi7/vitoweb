/* ===== Spathi engine (pure, no DOM) =====
   Card ids 0..51 share the Murlan art mapping: rank r = 3 + (id>>2) with 14 = A, 15 = 2; suit = id&3 (0 ♠, 1 ♥, 2 ♦, 3 ♣).
   Spathi value: A = 1, 2..10 face value, J/Q/K = 11/12/13 and can only be taken by the same rank (never summed).
   2♣ = id 51, 10♦ = id 30. */
const S = (() => {
  const rankOf = id => 3 + (id >> 2);
  const suitOf = id => id & 3;
  const val = id => { const r = rankOf(id); return r === 14 ? 1 : r === 15 ? 2 : r; };
  const isFace = id => val(id) >= 11;
  const TWO_CLUBS = 51, TEN_DIAMONDS = 30;
  const isClub = id => suitOf(id) === 3;
  const LABEL = v => ({1: 'A', 11: 'J', 12: 'Q', 13: 'K'})[v] || String(v);
  const SUITCH = ['♠', '♥', '♦', '♣'];
  const cardName = id => LABEL(val(id)) + SUITCH[suitOf(id)];

  function shuffle(arr, rand) { rand = rand || Math.random; for (let i = arr.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* Can these table cards be split into groups that each add up to v?
     For J/Q/K every taken card must be the same rank. */
  function validCapture(v, ids) {
    if (!ids.length) return true;
    if (v >= 11) return ids.every(id => val(id) === v);
    if (ids.some(isFace)) return false;
    const vs = ids.map(val);
    let tot = 0; for (const x of vs) tot += x;
    if (tot % v) return false;
    const n = vs.length, full = (1 << n) - 1, memo = new Map();
    const sumOf = m => { let s = 0; for (let i = 0; i < n; i++) if (m >> i & 1) s += vs[i]; return s; };
    function part(rest) {
      if (!rest) return true;
      if (memo.has(rest)) return memo.get(rest);
      const low = rest & -rest, others = rest ^ low;
      let ok = false;
      for (let sub = others; ; sub = (sub - 1) & others) {
        const g = sub | low;
        if (sumOf(g) === v && part(rest ^ g)) { ok = true; break; }
        if (!sub) break;
      }
      memo.set(rest, ok); return ok;
    }
    return part(full);
  }

  /* Every non-empty capture the card can make on this table, as arrays of table ids. */
  function captures(card, table) {
    const v = val(card), out = [];
    if (v >= 11) { const same = table.filter(id => val(id) === v); for (let m = 1; m < 1 << same.length; m++) out.push(same.filter((_, i) => m >> i & 1)); return out; }
    const num = table.filter(id => !isFace(id) && val(id) <= v);
    const n = num.length;
    for (let m = 1; m < 1 << n; m++) {
      const ids = []; let s = 0;
      for (let i = 0; i < n; i++) if (m >> i & 1) { ids.push(num[i]); s += val(num[i]); }
      if (s % v === 0 && validCapture(v, ids)) out.push(ids);
    }
    return out;
  }
  const canCapture = (card, table) => captures(card, table).length > 0;
  /* What a card can take when it's played. Taking is not optional (as in Scopa): if the card can take, it takes
     something, but the player decides how much. takes() lists the choices worth offering:
       - the largest captures (taking 3+7 and 4+6 together usually beats one pair), and
       - for J/Q/K, each single card of that rank too: leaving one on the table keeps it for your next K, Q or J.
     Any other valid capture is still allowed (the player can leave cards by tapping them off). */
  function takes(card, table) {
    const all = captures(card, table);
    const max = all.filter((a, i) => !all.some((b, j) => j !== i && b.length > a.length && a.every(x => b.includes(x))));
    if (isFace(card) && max.length === 1 && max[0].length > 1) return max.concat(max[0].map(id => [id]));
    return max;
  }
  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

  /* ---------- match & hand ---------- */
  function newMatch(opts) {
    opts = opts || {};
    return { rand: opts.rand || Math.random, target: opts.target || 21, scores: [0, 0], handNo: 0, dealer: opts.dealer != null ? opts.dealer : ((opts.rand || Math.random)() * 2) | 0, winner: null, hand: null };
  }
  function deal(mt) {
    mt.handNo++;
    if (mt.handNo > 1) mt.dealer = 1 - mt.dealer;
    const deck = shuffle(Array.from({ length: 52 }, (_, i) => i), mt.rand);
    const H = { stock: deck, hands: [[], []], table: [], taken: [[], []], lastTaker: -1, cur: 1 - mt.dealer, first: 1 - mt.dealer, seen: new Set(), log: [], over: false };
    mt.hand = H;
    const ev = { type: 'deal', round: 0, initial: true, order: [] };
    for (let k = 0; k < 4; k++) for (const p of [H.first, 1 - H.first]) { const id = H.stock.pop(); H.hands[p].push(id); ev.order.push({ id, to: p }); }
    for (let k = 0; k < 4; k++) { const id = H.stock.pop(); H.table.push(id); H.seen.add(id); ev.order.push({ id, to: 'table' }); }
    H.dealEv = ev;
    return H;
  }
  function redeal(H) {
    const ev = { type: 'deal', order: [] };
    for (let k = 0; k < 4; k++) for (const p of [H.first, 1 - H.first]) { const id = H.stock.pop(); H.hands[p].push(id); ev.order.push({ id, to: p }); }
    return ev;
  }
  /* Play `card`, taking `take` (table ids, [] = put the card down). Returns an event. */
  function act(mt, p, card, take) {
    const H = mt.hand;
    if (H.over) throw new Error('hand over');
    if (p !== H.cur) throw new Error('not your turn');
    if (!H.hands[p].includes(card)) throw new Error('card not in hand');
    take = take || [];
    if (take.some(id => !H.table.includes(id))) throw new Error('not on table');
    const must = canCapture(card, H.table);
    if (must ? !take.length || !validCapture(val(card), take) : take.length) throw new Error('illegal capture');
    H.hands[p] = H.hands[p].filter(id => id !== card);
    H.seen.add(card);
    const ev = { type: 'play', p, card, take: take.slice(), captured: take.length > 0, sweep: false, deal: null, end: null };
    if (take.length) {
      H.table = H.table.filter(id => !take.includes(id));
      H.taken[p].push(card, ...take);
      H.lastTaker = p;
      ev.sweep = H.table.length === 0;
    } else H.table.push(card);
    H.log.push({ p, card, take: take.slice() });
    H.cur = 1 - p;
    if (!H.hands[0].length && !H.hands[1].length) {
      if (H.stock.length) ev.deal = redeal(H);
      else ev.end = finishHand(mt);
    }
    return ev;
  }
  function score(taken) {
    const n = taken.map(t => t.length), cl = taken.map(t => t.filter(isClub).length);
    const pts = [0, 0], parts = [{}, {}];
    if (n[0] === n[1]) { pts[0]++; pts[1]++; parts[0].cards = parts[1].cards = 1; }
    else { const w = n[0] > n[1] ? 0 : 1; pts[w] += 2; parts[w].cards = 2; }
    for (let p = 0; p < 2; p++) {
      if (cl[p] >= 7) { pts[p]++; parts[p].clubs = 1; }
      if (taken[p].includes(TWO_CLUBS)) { pts[p]++; parts[p].two = 1; }
      if (taken[p].includes(TEN_DIAMONDS)) { pts[p]++; parts[p].ten = 1; }
    }
    return { n, cl, pts, parts };
  }
  function finishHand(mt) {
    const H = mt.hand;
    const rest = H.table.slice();
    const restTo = H.lastTaker >= 0 ? H.lastTaker : -1;
    if (restTo >= 0 && rest.length) { H.taken[restTo].push(...rest); H.table = []; }
    H.over = true;
    const sc = score(H.taken);
    for (let p = 0; p < 2; p++) mt.scores[p] += sc.pts[p];
    const [a, b] = mt.scores;
    if ((a >= mt.target || b >= mt.target) && a !== b) mt.winner = a > b ? 0 : 1;
    H.result = { ...sc, rest, restTo, scores: mt.scores.slice(), target: mt.target, winner: mt.winner, tiedAbove: a === b && a >= mt.target };
    return H.result;
  }

  /* ---------- bot ----------
     Sees only what a player at the table sees: its own hand, the table, every card already played or taken.
     For each card × capture it scores the cards taken, then samples the opponent's hand from the unseen cards
     and subtracts what the opponent could take next. */
  const W = { card: .1, club: .14, two: 1.05, ten: 1.05 };
  function worth(ids) { let w = 0; for (const id of ids) { w += W.card; if (isClub(id)) w += W.club; if (id === TWO_CLUBS) w += W.two; if (id === TEN_DIAMONDS) w += W.ten; } return w; }
  function bestTake(card, table) {
    let best = null, bw = -1;
    for (const c of captures(card, table)) { const w = worth(c); if (w > bw || (w === bw && c.length > best.length)) { bw = w; best = c; } }
    return best ? { take: best, w: bw + worth([card]) } : { take: [], w: 0 };
  }
  function oppThreat(table, hands) {
    let tot = 0;
    for (const h of hands) { let m = 0; for (const c of h) { const b = bestTake(c, table); if (b.w > m) m = b.w; } tot += m; }
    return tot / hands.length;
  }
  function viewFor(mt, p) {
    const H = mt.hand;
    return { me: p, hand: H.hands[p].slice(), table: H.table.slice(), seen: H.seen, oppN: H.hands[1 - p].length, stockN: H.stock.length, lastTaker: H.lastTaker, takenN: H.taken.map(t => t.length), takenCl: H.taken.map(t => t.filter(isClub).length) };
  }
  function options(v) {
    const out = [];
    for (const card of v.hand) {
      const t = takes(card, v.table);
      if (t.length) for (const take of t) out.push({ card, take });
      else out.push({ card, take: [] });
    }
    return out;
  }
  function decide(v, opts) {
    opts = opts || {};
    const rand = opts.rand || Math.random, samples = opts.samples || 24;
    const opt = options(v);
    if (opt.length === 1) return opt[0];
    const mine = new Set(v.hand);
    const unseen = [];
    for (let id = 0; id < 52; id++) if (!v.seen.has(id) && !mine.has(id)) unseen.push(id);
    const hands = [];
    if (v.oppN > 0) for (let s = 0; s < samples; s++) { shuffle(unseen, rand); hands.push(unseen.slice(0, v.oppN)); }
    const lastPlay = v.oppN === 0 && v.hand.length === 1 && v.stockN === 0;
    // clubs matter more once someone is near 7, cards matter more near 26
    const clubsLive = v.takenCl[0] < 7 && v.takenCl[1] < 7;
    let best = null, bs = -1e9;
    for (const o of opt) {
      const table = o.take.length ? v.table.filter(id => !o.take.includes(id)) : v.table.concat(o.card);
      let s = o.take.length ? worth(o.take) + worth([o.card]) : 0;
      if (!clubsLive) s -= [o.card, ...o.take].filter(isClub).length * W.club * (o.take.length ? 1 : 0);
      if (lastPlay) { const to = o.take.length ? v.me : v.lastTaker; if (to === v.me) s += worth(table); else s -= worth(table); }
      else if (hands.length) s -= .85 * oppThreat(table, hands);
      // keep J/Q/K and cards matching the table for later; dump low-value cards that open little
      if (!o.take.length) { s -= o.card === TWO_CLUBS || o.card === TEN_DIAMONDS ? .6 : 0; s -= isFace(o.card) ? .01 : .02 * (10 - val(o.card)) / 10; }
      s += o.take.length * .005 + rand() * .001;
      if (s > bs) { bs = s; best = o; }
    }
    return best;
  }
  function botMove(mt, p, opts) { return decide(viewFor(mt, p), opts); }

  return { rankOf, suitOf, val, isFace, isClub, TWO_CLUBS, TEN_DIAMONDS, LABEL, cardName, shuffle, rng, validCapture, captures, canCapture, takes, sameSet, newMatch, deal, act, score, viewFor, options, decide, botMove, worth, bestTake };
})();
if (typeof module !== 'undefined') module.exports = { S };
