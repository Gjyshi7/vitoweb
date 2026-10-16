// GENERATED from public/derri-engine.js by scripts/build.mjs. Do not edit: change public/derri-engine.js and run `npm run build`.
/* ===== Derri në dorë engine (pure, no DOM) =====
   Same card ids as Murlan: 0..51 -> rank = 3 + (id>>2) (3..15, 11 J, 12 Q, 13 K, 14 A, 15 = 2), suit = id&3 (0 ♠,1 ♥,2 ♦,3 ♣).
   K♠ = 40 is the pig ("derri"). K♥ 41, K♦ 42, K♣ 43 are removed: 49 cards.
   Turn rule: the player in turn draws one hidden card from the next player still holding cards (seat p+1, p+2, …).
   A drawn card that matches a rank in hand is discarded with it at once. Empty hand = out (safe).
   The last player holding cards holds only the pig and loses. */
const E = (() => {
  const PIG = 40, DROP = [41, 42, 43];
  const rankOf = id => 3 + (id >> 2);
  const natural = id => { const r = rankOf(id); return r === 14 ? 1 : r === 15 ? 2 : r; };
  const label = id => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' })[rankOf(id)] || String(rankOf(id));
  function shuffle(a, rand) { rand = rand || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  /* seats: the seats in play when fewer than 4 play (e.g. [0,2] or [0,1,2]); all 49 cards are split among them */
  function newMatch(rand, seats) {
    const r = rand || Math.random;
    const S = Array.isArray(seats) && seats.length >= 2 ? seats.slice().sort() : [0, 1, 2, 3];
    return { rand: r, seats: S, losses: [0, 0, 0, 0], round: 0, dealer: S[(r() * S.length) | 0], hand: null };
  }
  const seatsOf = mt => mt.seats || [0, 1, 2, 3];
  function deal(mt) {
    mt.round++;
    const S = seatsOf(mt);
    if (!S.includes(mt.dealer)) mt.dealer = S[0];
    if (mt.round > 1) mt.dealer = S[(S.indexOf(mt.dealer) + 1) % S.length];
    const deck = shuffle(Array.from({ length: 52 }, (_, i) => i).filter(i => !DROP.includes(i)), mt.rand);
    const hands = [[], [], [], []];
    const from = S.indexOf(mt.dealer) + 1;
    deck.forEach((id, i) => hands[S[(from + i) % S.length]].push(id));
    const H = { hands, order: [], cur: S[from % S.length], dealOrder: deck, over: false, loser: -1 };
    mt.hand = H;
    return H;
  }
  function pairsIn(hand) {
    const open = new Map(), out = [];
    for (const id of hand) { const r = rankOf(id); if (open.has(r)) { out.push([open.get(r), id]); open.delete(r); } else open.set(r, id); }
    return out;
  }
  const live = (H, p) => H.hands[p].length > 0;
  function nextLive(H, p) { for (let i = 1; i <= 3; i++) { const q = (p + i) % 4; if (live(H, q)) return q; } return -1; }
  function checkOver(mt) {
    const H = mt.hand, alive = seatsOf(mt).filter(q => live(H, q));
    if (alive.length > 1) return;
    H.over = true; H.loser = alive.length ? alive[0] : -1;
    if (H.loser >= 0) { H.order.push(H.loser); mt.losses[H.loser]++; }
  }
  function initialDiscard(mt) {
    const H = mt.hand, pairs = [];
    for (let p = 0; p < 4; p++) {
      const pr = pairsIn(H.hands[p]), gone = new Set(pr.flat());
      H.hands[p] = shuffle(H.hands[p].filter(id => !gone.has(id)), mt.rand);
      pairs.push(pr);
    }
    const outs = [], S = seatsOf(mt), from = S.indexOf(mt.dealer) + 1;
    for (let k = 0; k < S.length; k++) { const p = S[(from + k) % S.length]; if (!live(H, p)) { H.order.push(p); outs.push(p); } }
    checkOver(mt);
    if (!H.over && !live(H, H.cur)) H.cur = nextLive(H, H.cur);
    return { pairs, outs };
  }
  const source = (H, p) => nextLive(H, p);
  function draw(mt, p, idx) {
    const H = mt.hand;
    if (H.over || p !== H.cur) throw new Error('not your turn');
    const from = source(H, p);
    if (idx < 0 || idx >= H.hands[from].length) throw new Error('bad index');
    const card = H.hands[from].splice(idx, 1)[0];
    const mi = H.hands[p].findIndex(id => rankOf(id) === rankOf(card));
    let pair = null;
    if (mi >= 0) { pair = [H.hands[p][mi], card]; H.hands[p].splice(mi, 1); }
    else H.hands[p].splice((mt.rand() * (H.hands[p].length + 1)) | 0, 0, card);   // a held card lands anywhere: position tells nothing
    const outs = [];
    for (const q of [from, p]) if (!live(H, q) && !H.order.includes(q)) { H.order.push(q); outs.push(q); }
    checkOver(mt);
    if (!H.over) H.cur = nextLive(H, p);
    return { p, from, card, pair, outs, over: H.over, loser: H.loser };
  }
  /* Picking is blind, so a uniform random index is the best any player can do. */
  const botPick = (mt, p) => (mt.rand() * mt.hand.hands[source(mt.hand, p)].length) | 0;
  return { PIG, rankOf, natural, label, shuffle, newMatch, deal, initialDiscard, source, draw, botPick, nextLive };
})();
if (typeof module !== 'undefined') module.exports = { E };

export { E };
