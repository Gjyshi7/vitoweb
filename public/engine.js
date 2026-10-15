/* ===== Murlan engine (pure, no DOM) =====
   Card ids: 0..51 -> rank = 3 + (id>>2) (3..15, 14 = A, 15 = 2), suit = id&3 (0 ♠,1 ♥,2 ♦,3 ♣)
   52 = black joker (16), 53 = red joker (17). 3♠ = id 0.
   Move types: 1 single, 2 pair, 3 triple, 4 bomb (four of a kind), 5 kolor (5+ in a row), 6 flush (5+ in a row, one suit).
   Kolor index: A = 1 or 14, 2 = 2, otherwise the rank. Jokers never in a row.
   Beating: flush beats everything; a flush only falls to a flush with a higher top card (same top: the longer one).
            bomb beats everything except a higher bomb or a flush.
            kolor only falls to the kolor one step higher with the same length (3-4-5-6-7 -> 4-5-6-7-8 only), or a bomb / flush. */
const M = (() => {
  const rankOf = id => id >= 52 ? (id === 52 ? 16 : 17) : 3 + (id >> 2);
  const suitOf = id => id >= 52 ? 4 : (id & 3);
  const idxRank = s => s === 1 ? 14 : s === 2 ? 15 : s;
  const T = { SINGLE: 1, PAIR: 2, TRIPLE: 3, BOMB: 4, KOLOR: 5, FLUSH: 6 };
  const POINTS = [3, 2, 1, 0];
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffle(arr, rand) { rand = rand || Math.random; for (let i = arr.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
  function counts(ids) { const c = new Int8Array(18); for (const id of ids) c[rankOf(id)]++; return c; }
  const size = m => m.t <= 4 ? m.t : m.n;
  const idOf = (rank, suit) => (rank - 3) * 4 + suit;

  function beats(m, top) {
    if (!top) return true;
    if (m.t === 6) return top.t !== 6 || m.r > top.r || (m.r === top.r && m.n > top.n);
    if (top.t === 6) return false;
    if (m.t === 4) return top.t !== 4 || m.r > top.r;
    if (m.t !== top.t) return false;
    if (m.t === 5) return m.n === top.n && m.r === top.r + 1;   // house rule: exactly one step higher
    return m.r > top.r;
  }
  function scaleRuns(c, onlyLen, minTop, out) {
    for (let s0 = 1; s0 <= 10; s0++) {
      let len = 0;
      for (let s = s0; s <= 14 && len < 13; s++) {
        if (c[idxRank(s)] < 1) break;
        len++;
        if (len >= 5 && (!onlyLen || len === onlyLen) && s > minTop) out.push({ t: 5, r: s, n: len, s: s0 });
      }
    }
  }
  // flushes need suits, so they come from the real card ids
  function flushRuns(hand, top, out) {
    out = out || [];
    const have = new Set(hand);
    for (let suit = 0; suit < 4; suit++) {
      for (let s0 = 1; s0 <= 10; s0++) {
        let len = 0;
        for (let s = s0; s <= 14 && len < 13; s++) {
          if (!have.has(idOf(idxRank(s), suit))) break;
          len++;
          if (len >= 5) { const m = { t: 6, r: s, n: len, s: s0, suit }; if (beats(m, top)) out.push(m); }
        }
      }
    }
    return out;
  }
  function genMoves(c, top) {
    const out = [];
    if (!top) {
      for (let r = 3; r <= 17; r++) if (c[r] >= 1) out.push({ t: 1, r });
      for (let r = 3; r <= 15; r++) { if (c[r] >= 2) out.push({ t: 2, r }); if (c[r] >= 3) out.push({ t: 3, r }); if (c[r] === 4) out.push({ t: 4, r }); }
      scaleRuns(c, 0, 0, out);
      return out;
    }
    if (top.t === 6) return out;               // only a flush answers a flush
    if (top.t === 1) { for (let r = top.r + 1; r <= 17; r++) if (c[r] >= 1) out.push({ t: 1, r }); }
    else if (top.t === 2 || top.t === 3) { for (let r = top.r + 1; r <= 15; r++) if (c[r] >= top.t) out.push({ t: top.t, r }); }
    else if (top.t === 5) { const k = []; scaleRuns(c, top.n, top.r, k); for (const m of k) if (m.r === top.r + 1) out.push(m); }
    for (let r = 3; r <= 15; r++) if (c[r] === 4 && (top.t !== 4 || r > top.r)) out.push({ t: 4, r });
    return out;
  }
  // every legal move for a real hand, flushes included
  function allMoves(hand, top, must3) {
    let ms = genMoves(counts(hand), top).concat(flushRuns(hand, top));
    if (must3) ms = ms.filter(m => m.t === 6 ? (m.suit === 0 && usesRank(m, 3)) : usesRank(m, 3));
    return ms;
  }
  function apply(c, m, sign) { if (m.t <= 4) c[m.r] += sign * m.t; else for (let s = m.s; s <= m.r; s++) c[idxRank(s)] += sign; }
  function usesRank(m, r) { if (m.t <= 4) return m.r === r; for (let s = m.s; s <= m.r; s++) if (idxRank(s) === r) return true; return false; }
  function classify(ids) {
    if (!ids.length) return null;
    const rs = ids.map(rankOf);
    if (ids.length === 1) return { t: 1, r: rs[0] };
    if (rs.every(r => r === rs[0])) {
      if (rs[0] >= 16) return null;
      if (ids.length <= 4) return { t: ids.length, r: rs[0] };
      return null;
    }
    if (ids.length < 5 || ids.length > 13 || rs.some(r => r >= 16)) return null;
    const tryIdx = aceIdx => {
      const ix = rs.map(r => r === 14 ? aceIdx : r === 15 ? 2 : r).sort((a, b) => a - b);
      for (let i = 1; i < ix.length; i++) if (ix[i] !== ix[i - 1] + 1) return null;
      return { t: 5, r: ix[ix.length - 1], n: ix.length, s: ix[0] };
    };
    const m = tryIdx(14) || tryIdx(1);
    if (!m) return null;
    const su = suitOf(ids[0]);
    if (ids.every(id => suitOf(id) === su)) { m.t = 6; m.suit = su; }
    return m;
  }
  function cardsFor(hand, m, must3) {
    if (m.t === 6) {
      const ids = [];
      for (let s = m.s; s <= m.r; s++) { const id = idOf(idxRank(s), m.suit); if (!hand.includes(id)) return null; ids.push(id); }
      return ids;
    }
    const need = [];
    if (m.t <= 4) for (let i = 0; i < m.t; i++) need.push(m.r); else for (let s = m.s; s <= m.r; s++) need.push(idxRank(s));
    // a kolor is played from mixed suits when possible, so it is never mistaken for a flush the player wanted to keep
    const pool = hand.slice().sort((a, b) => (must3 && a === 0 ? -1 : must3 && b === 0 ? 1 : 0) || a - b);
    const used = [];
    for (const r of need) { const i = pool.findIndex(id => rankOf(id) === r && !used.includes(id)); if (i < 0) return null; used.push(pool[i]); }
    if (m.t === 5 && used.every(id => suitOf(id) === suitOf(used[0]))) {
      // swap one card for another suit of the same rank, if there is one
      for (let k = 0; k < used.length; k++) {
        const alt = pool.find(id => rankOf(id) === rankOf(used[k]) && suitOf(id) !== suitOf(used[k]) && !used.includes(id) && !(must3 && used[k] === 0));
        if (alt !== undefined) { used[k] = alt; break; }
      }
    }
    return used;
  }
  const RN = r => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: 'Xhoker i zi', 17: 'Xhoker me ngjyra' })[r] || String(r);
  function name(m) {
    if (!m) return 'Pas';
    if (m.t === 1) return RN(m.r);
    if (m.t === 2) return 'Çift ' + RN(m.r);
    if (m.t === 3) return 'Treshe ' + RN(m.r);
    if (m.t === 4) return 'Bombë ' + RN(m.r);
    const from = RN(idxRank(m.s)), to = RN(idxRank(m.r));
    if (m.t === 6) return (m.r === 14 && m.s === 10 ? 'Royal flush ' : 'Flush ') + from + '–' + to + ' ' + '♠♥♦♣'[m.suit];
    return 'Kolor ' + from + '–' + to;
  }
  const GW = [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, .85, .75, .6, .4, .15, -.3, -.5];
  function evalHand(c) {
    let v = 0;
    for (let r = 3; r <= 17; r++) if (c[r] > 0) { v += c[r] === 4 ? -.8 : GW[r] * (c[r] === 1 ? 1 : c[r] === 2 ? .9 : .8); }
    let best = 0;
    for (let s0 = 1; s0 <= 10; s0++) {
      let len = 0, gain = 0;
      for (let s = s0; s <= 14 && len < 13; s++) { const r = idxRank(s); if (c[r] < 1) break; len++; if (c[r] === 1) gain += GW[r]; if (len >= 5) best = Math.max(best, gain - 1); }
    }
    return v - best;
  }
  const controlCost = m => m.t === 6 ? 2.2 : m.t === 4 ? 1.6 : m.t === 1 ? (m.r === 17 ? 1 : m.r === 16 ? .8 : m.r === 15 ? .45 : m.r === 14 ? .2 : 0) : m.t === 2 && m.r >= 14 ? .5 : 0;
  function policy(c, top, oppMin, myN, rand) {
    const all = genMoves(c, top);
    for (const m of all) if (size(m) === myN) return m;
    if (!all.length) return null;
    if (!top) {
      let sc = null;
      for (const m of all) if (m.t === 5) { let singles = 0; for (let s = m.s; s <= m.r; s++) if (c[idxRank(s)] === 1) singles++; if (singles >= m.n - 1 && (!sc || m.n > sc.n || (m.n === sc.n && m.r < sc.r))) sc = m; }
      if (sc && (sc.r <= 11 || rand() < .5)) return sc;
      for (let r = 3; r <= 17; r++) {
        if (c[r] === 0) continue;
        if (c[r] === 4 && myN > 4) continue;
        if (oppMin === 1 && c[r] === 1) {
          for (let q = 3; q <= 15; q++) if (c[q] >= 2 && c[q] < 4) return { t: Math.min(c[q], 3), r: q };
          for (let q = 17; q >= 3; q--) if (c[q] >= 1) return { t: 1, r: q };
        }
        return { t: Math.min(c[r], 3), r };
      }
      for (let r = 3; r <= 15; r++) if (c[r] === 4) return { t: 4, r };
      return all[0];
    }
    const urgent = oppMin <= 2 || myN <= 3;
    if (top.t <= 3) {
      let pick = null;
      for (let r = top.r + 1; r <= 17; r++) if (c[r] === top.t) { pick = { t: top.t, r }; break; }
      if (!pick && (urgent || rand() < .35)) for (let r = top.r + 1; r <= 15; r++) if (c[r] > top.t && c[r] < 4) { pick = { t: top.t, r }; break; }
      if (pick) { if (!urgent && pick.r >= 15 && top.r < 13 && rand() < .45) return null; return pick; }
    } else if (top.t === 5) {
      for (const m of all) if (m.t === 5) return m;
    }
    if (urgent || (top.t === 4) || myN <= 6) for (const m of all) if (m.t === 4) return m;
    return null;
  }
  function nextActive(S, p) { for (let i = 1; i <= 4; i++) { const q = (p + i) % 4; if (S.active[q]) return q; } return p; }
  function simApply(S, p, m) {
    if (!m) {
      S.passes++;
      const need = S.active[S.last] ? S.ac - 1 : S.ac;
      if (S.passes >= need) { S.top = null; S.passes = 0; S.cur = S.active[S.last] ? S.last : nextActive(S, S.last); }
      else S.cur = nextActive(S, p);
      return;
    }
    apply(S.c[p], m, -1); S.n[p] -= size(m); S.top = m; S.last = p; S.passes = 0;
    if (S.n[p] === 0) {
      S.active[p] = false; S.ac--; S.place[p] = ++S.fin;
      if (S.ac === 1) { for (let q = 0; q < 4; q++) if (S.active[q]) { S.place[q] = 4; S.active[q] = false; } S.ac = 0; return; }
    }
    S.cur = nextActive(S, p);
  }
  // what a finished simulation is worth to `me`: my place, plus my partner's in 2 kundër 2
  function rollout(S, me, rand) {
    const mate = S.mate;
    for (let g = 0; g < 500; g++) {
      if (S.place[me] && (mate < 0 || S.place[mate])) return POINTS[S.place[me] - 1] + (mate < 0 ? 0 : POINTS[S.place[mate] - 1]);
      const p = S.cur;
      let oppMin = 99; for (let q = 0; q < 4; q++) if (q !== p && (mate < 0 || (q & 1) !== (p & 1)) && S.active[q] && S.n[q] < oppMin) oppMin = S.n[q];
      simApply(S, p, policy(S.c[p], S.top, oppMin, S.n[p], rand));
      S.work++;
    }
    return 1;
  }
  function decide(view) {
    const rand = view.rand || Math.random;
    const me = view.me, myC = counts(view.hand), myN = view.hand.length;
    const cands = allMoves(view.hand, view.top, view.must3);
    if (!cands.length) return null;
    for (const m of cands) if (size(m) === myN) return m;
    const mate = view.teams ? (me + 2) % 4 : -1;
    let oppMin = 99; for (let q = 0; q < 4; q++) if (q !== me && q !== mate && view.active[q] && view.n[q] < oppMin) oppMin = view.n[q];
    const urgent = oppMin <= 2;
    const scored = cands.map(m => { apply(myC, m, -1); const v = evalHand(myC) + (urgent ? 0 : controlCost(m)) - size(m) * .05; apply(myC, m, 1); return { m, v }; }).sort((a, b) => a.v - b.v);
    const list = scored.slice(0, view.top ? (view.maxCands || 10) : (view.maxCands ? view.maxCands + 2 : 16));
    if (view.top) list.push({ m: null, v: evalHand(myC) + (urgent ? 1 : .25) });
    if (list.length === 1) return list[0].m;
    const played = view.played instanceof Set ? view.played : new Set(view.played);
    const mine = new Set(view.hand);
    const fixed = [[], [], [], []];
    const unknown = [];
    for (let id = 0; id < 54; id++) {
      if (played.has(id) || mine.has(id)) continue;
      const h = view.known && view.known.get(id);
      if (h !== undefined && h !== me && view.active[h]) fixed[h].push(id); else unknown.push(id);
    }
    const tot = list.map(() => 0); let rounds = 0;
    const t0 = Date.now(), budget = view.budgetMs || 260, maxRounds = view.maxRounds || 400;
    const base = new Array(4);
    const minRounds = view.minRounds != null ? view.minRounds : 24;
    // work = simulated plays so far. On a server the clock stands still while code runs (Cloudflare), so a time
    // budget can't stop the search there; a work cap keeps every decision cheap and predictable instead.
    const maxWork = view.maxWork || Infinity; let work = 0;
    while (rounds < maxRounds && work < maxWork && (rounds < minRounds || Date.now() - t0 < budget)) {
      shuffle(unknown, rand); let k = 0;
      for (let q = 0; q < 4; q++) {
        if (q === me) { base[q] = myC; continue; }
        const c = new Int8Array(18);
        if (view.active[q]) { const f = fixed[q].slice(0, view.n[q]); for (const id of f) c[rankOf(id)]++; for (let i = f.length; i < view.n[q]; i++) c[rankOf(unknown[k++])]++; }
        base[q] = c;
      }
      for (let i = 0; i < list.length; i++) {
        const S = { c: base.map(c => Int8Array.from(c)), n: view.n.slice(), active: view.active.slice(), ac: view.active.filter(Boolean).length,
          top: view.top, last: view.last, passes: view.passes, cur: me, place: view.place ? view.place.slice() : [0, 0, 0, 0], fin: 4 - view.active.filter(Boolean).length, mate };
        S.n[me] = myN;
        S.work = 0;
        simApply(S, me, list[i].m);
        tot[i] += rollout(S, me, rand);
        work += S.work + 1;
      }
      rounds++;
    }
    if (!rounds) return list[0].m;                // no search allowed (a server under pressure): the best-looking move
    let bi = 0, bs = -1e9;
    for (let i = 0; i < list.length; i++) { const s = tot[i] / rounds - list[i].v * .03; if (s > bs) { bs = s; bi = i; } }
    return list[bi].m;
  }
  function chooseGift(hand) {
    const c = counts(hand);
    const opts = hand.filter(id => { const r = rankOf(id); return r >= 3 && r <= 10; });
    if (!opts.length) return hand.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
    let best = opts[0], bv = 1e9;
    for (const id of opts) { const r = rankOf(id); c[r]--; const v = evalHand(c) + r * .01; c[r]++; if (v < bv) { bv = v; best = id; } }
    return best;
  }
  const highest = hand => hand.slice().sort((a, b) => rankOf(b) - rankOf(a) || a - b)[0];
  return { rankOf, suitOf, idxRank, idOf, T, POINTS, rng, shuffle, counts, genMoves, flushRuns, allMoves, apply, beats, classify, cardsFor, size, usesRank, name, evalHand, policy, decide, chooseGift, highest };
})();

/* ===== Murlan match state (pure) ===== */
const G = (() => {
  const { rankOf, classify, beats, POINTS, shuffle, highest, chooseGift, decide } = M;
  /* opts.teams: 2 kundër 2. Partners sit across (seats 0+2 and 1+3); a team scores both partners' places.
     mt.winner / mt.tie are seats in a free-for-all and teams (0 or 1) in 2 kundër 2. */
  function newMatch(rand, opts) {
    opts = opts || {};
    const teams = !!opts.teams;
    return { rand: rand || Math.random, teams, teamOf: teams ? [0, 1, 0, 1] : [0, 1, 2, 3], scores: [0, 0, 0, 0], team: [0, 0],
      target: 21, handNo: 0, dealer: ((rand || Math.random)() * 4) | 0, lastOrder: null, winner: null, tie: null, hand: null };
  }
  function deal(mt) {
    mt.handNo++;
    if (mt.handNo > 1) mt.dealer = (mt.dealer + 1) % 4;
    const deck = shuffle(Array.from({ length: 54 }, (_, i) => i), mt.rand);
    const hands = [[], [], [], []];
    deck.forEach((id, i) => hands[(mt.dealer + 1 + i) % 4].push(id));
    const H = { hands, active: [true, true, true, true], order: [], top: null, topCards: [], last: -1, passes: 0, cur: 0, golden: !!mt.golden,
      played: new Set(), known: [new Map(), new Map(), new Map(), new Map()], must3: false, trick: [], dealOrder: deck };
    mt.hand = H;
    if (mt.handNo === 1) { H.cur = hands.findIndex(h => h.includes(0)); H.must3 = true; H.exchange = null; }
    else {
      const first = mt.lastOrder[0], last = mt.lastOrder[3];
      const hl = hands[last];
      if (hl.includes(52) && hl.includes(53)) { H.exchange = { first, last, jokers: true }; H.cur = first; }
      else { H.exchange = { first, last, jokers: false }; H.cur = last; }
    }
    return H;
  }
  function exchangeGive(mt) {
    const H = mt.hand, { first, last } = H.exchange;
    const card = highest(H.hands[last]);
    H.hands[last] = H.hands[last].filter(id => id !== card); H.hands[first].push(card);
    H.known[last].set(card, first); H.exchange.up = card;
    return card;
  }
  function giftOptions(hand) { const o = hand.filter(id => { const r = rankOf(id); return r >= 3 && r <= 10; }); return o.length ? o : [hand.slice().sort((a, b) => rankOf(a) - rankOf(b))[0]]; }
  function exchangeReturn(mt, gift) {
    const H = mt.hand, { first, last } = H.exchange;
    if (gift === undefined) gift = chooseGift(H.hands[first]);
    H.hands[first] = H.hands[first].filter(id => id !== gift); H.hands[last].push(gift);
    H.known[first].set(gift, last); H.exchange.down = gift;
    return gift;
  }
  function nextActive(H, p) { for (let i = 1; i <= 4; i++) { const q = (p + i) % 4; if (H.active[q]) return q; } return p; }
  const activeCount = H => H.active.filter(Boolean).length;
  function checkPlay(H, p, ids) {
    const m = classify(ids);
    if (!m) return { ok: false, why: ids.length >= 2 && ids.length < 5 && new Set(ids.map(rankOf)).size > 1 ? 'Kolori duhet të ketë të paktën 5 letra' : 'Kjo nuk është kombinim i vlefshëm' };
    if (H.must3 && !ids.includes(0)) return { ok: false, why: 'Lëvizja e parë duhet të përfshijë 3♠' };
    if (!beats(m, H.top)) {
      const t = H.top;
      let why = 'Nuk e mund atë në tavolinë';
      if (t.t === 6) why = 'Flush-i mundet vetëm nga një flush më i lartë';
      else if (t.t === 4 && m.t !== 4) why = 'Bomba mundet vetëm nga bombë më e lartë ose flush';
      else if (t.t === 5 && m.t === 5 && m.n !== t.n) why = `Duhet kolor me ${t.n} letra, jo ${m.n}`;
      else if (t.t === 5 && m.t === 5) why = `Kolori mundet vetëm nga ${name({ t: 5, s: t.s + 1, r: t.r + 1, n: t.n })}, bomba ose flush`;
      else if (t.t !== m.t && m.t !== 4) why = 'Duhet i njëjti lloj kombinimi';
      return { ok: false, why };
    }
    return { ok: true, m };
  }
  function act(mt, p, ids) {
    const H = mt.hand;
    if (p !== H.cur) throw new Error('not your turn');
    if (!ids) {
      if (!H.top) throw new Error('leader cannot pass');
      H.passes++;
      const need = H.active[H.last] ? activeCount(H) - 1 : activeCount(H);
      if (H.passes >= need) {
        const winner = H.last;
        H.top = null; H.topCards = []; H.passes = 0; H.trick = [];
        H.cur = H.active[winner] ? winner : nextActive(H, winner);
        return { type: 'pass', p, cleared: true, winner, leader: H.cur };
      }
      H.cur = nextActive(H, p);
      return { type: 'pass', p, cleared: false };
    }
    const chk = checkPlay(H, p, ids);
    if (!chk.ok) throw new Error('illegal: ' + chk.why);
    H.hands[p] = H.hands[p].filter(id => !ids.includes(id));
    for (const id of ids) { H.played.add(id); for (const k of H.known) k.delete(id); }
    H.top = chk.m; H.topCards = ids.slice(); H.last = p; H.passes = 0; H.must3 = false; H.trick.push({ p, ids: ids.slice(), m: chk.m });
    const ev = { type: 'play', p, ids, m: chk.m, out: false, handOver: false };
    if (!H.hands[p].length) {
      H.active[p] = false; H.order.push(p); ev.out = true; ev.place = H.order.length;
      if (activeCount(H) === 1) {
        const lastP = H.active.findIndex(Boolean); H.active[lastP] = false; H.order.push(lastP);
        ev.handOver = true; finishHand(mt); ev.result = H.result;
        return ev;
      }
    }
    H.cur = nextActive(H, p);
    return ev;
  }
  function finishHand(mt) {
    const H = mt.hand;
    const pts = [0, 0, 0, 0]; H.order.forEach((p, i) => pts[p] = POINTS[i]);
    for (let p = 0; p < 4; p++) mt.scores[p] += pts[p];
    if (mt.teams) for (let p = 0; p < 4; p++) mt.team[mt.teamOf[p]] += pts[p];
    mt.lastOrder = H.order.slice();
    // Who wins the match. Players, or the two teams in 2 kundër 2.
    //  - golden hand (chosen after a tie): whoever goes out first wins, whatever the points
    //  - one side past the target: it wins
    //  - two at once: the table chooses (G.choose): the target goes up by 10, or a golden hand
    const side = p => mt.teams ? mt.teamOf[p] : p;
    let choice = false;
    if (mt.golden) { mt.winner = side(H.order[0]); mt.golden = false; }
    else {
      const reached = (mt.teams ? mt.team : mt.scores).map((s, i) => s >= mt.target ? i : -1).filter(i => i >= 0);
      if (reached.length === 1) mt.winner = reached[0];
      else if (reached.length >= 2) { choice = true; mt.tie = reached; }
    }
    H.result = { order: H.order.slice(), pts, scores: mt.scores.slice(), team: mt.team.slice(), teams: mt.teams, target: mt.target, winner: mt.winner, tie: mt.tie, choice, golden: !!H.golden };
  }
  /* after a tie at the target: 'raise' = target +10 (again until only one side is past it), 'golden' = the next hand decides */
  function choose(mt, how) {
    if (!mt.tie) return;
    if (how === 'golden') mt.golden = true;
    else {
      const sc = mt.teams ? mt.team : mt.scores;
      do mt.target += 10; while (sc.filter(s => s >= mt.target).length >= 2);
      const reached = sc.map((s, i) => s >= mt.target ? i : -1).filter(i => i >= 0);
      if (reached.length === 1) mt.winner = reached[0];
    }
    mt.tie = null;
  }
  function viewFor(mt, p) {
    const H = mt.hand;
    const place = [0, 0, 0, 0]; H.order.forEach((q, i) => place[q] = i + 1);
    return { me: p, hand: H.hands[p].slice(), n: H.hands.map(h => h.length), active: H.active.slice(), top: H.top, last: H.last, passes: H.passes, played: H.played, known: H.known[p], must3: H.must3, teams: !!mt.teams, place };
  }
  function botMove(mt, p, opts) {
    const v = viewFor(mt, p); Object.assign(v, opts || {});
    const m = decide(v);
    if (!m) return null;
    return M.cardsFor(mt.hand.hands[p], m, mt.hand.must3);
  }
  return { newMatch, deal, exchangeGive, exchangeReturn, giftOptions, checkPlay, act, choose, viewFor, botMove, nextActive };
})();
if (typeof module !== 'undefined') module.exports = { M, G };
