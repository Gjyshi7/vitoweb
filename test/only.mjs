// Friends' rooms that play with only the people there ("Luajmë vetëm ne"): 2 or 3 people, no players added.
//   node test/only.mjs
// Plays whole hands with a fake clock (turns run out and play on autopilot). Checks: nobody extra sits down,
// the cards are split equally among the people, the empty seat never gets a turn or cards, scores and the
// log stay right, and counts in every phone's view match the real hands.
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log("  ✗ " + m); } };

const CASES = [
  ["murlan", { teams: true }, 2, [0, 2]],
  ["murlan", { teams: true }, 3, [0, 1, 2]],
  ["murlan", { teams: false }, 4, [0, 1, 2, 3]],
  ["derri", {}, 2, [0, 2]],
  ["derri", {}, 3, [0, 1, 2]],
  ["domino", { teams: true, target: 100 }, 2, [0, 2]],
];
for (const [name, cfg, n, want] of CASES) {
  const mod = (await import(`../worker/games/${name}.js`)).default;
  let now = 2_000_000;
  const realNow = Date.now; Date.now = () => now;
  const pids = ["a", "b", "c", "d"].slice(0, n);
  const s = { players: pids.map((pid, i) => ({ pid, name: "P" + i })), g: mod.init({ cfg }) };
  for (const p of pids) mod.onJoin(s, p, now);
  const host = { pid: "a", isHost: true, now };
  mod.onMessage(s, host, { t: "only", v: true });
  const r = mod.onMessage(s, host, { t: "start" });
  const label = `${name} ${n} people`;
  ok(!(r && r.error), `${label}: starts (${r && r.error})`);
  ok(s.g.phase === "play", `${label}: playing (phase ${s.g.phase})`);
  const taken = s.g.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  ok(JSON.stringify(taken) === JSON.stringify(want), `${label}: seats ${JSON.stringify(taken)} (want ${JSON.stringify(want)})`);
  ok(s.g.seats.every((x) => !x || !x.bot), `${label}: no players added`);
  if (name !== "domino") {
    const counts = s.g.mt.hand.hands.map((h) => h.length);
    const dealtTo = counts.filter((c, i) => want.includes(i));
    const total = name === "murlan" ? 54 : 49;
    // counts right after the deal (Derri throws pairs at once, so look at the deal event)
    const deal = s.g.log.find((e) => e.k === "deal");
    const dc = deal.counts.filter((c, i) => want.includes(i));
    ok(dc.reduce((a, b) => a + b, 0) === total && Math.max(...dc) - Math.min(...dc) <= 1, `${label}: ${total} cards split equally ${JSON.stringify(dc)}`);
    ok(deal.counts.every((c, i) => want.includes(i) || c === 0), `${label}: the empty seat gets no cards`);
    void dealtTo; void counts;
  }
  const online = new Set(pids);                   // everyone here but nobody moves: every turn runs out and plays itself
  let steps = 0, hands = 0, badActor = 0, badView = 0;
  while (steps < 6000 && hands < 6 && s.g.phase !== "over") {
    const w = mod.wakeAt(s, online);
    if (!w) { ok(false, `${label}: table stopped (${s.g.phase}/${s.g.step})`); break; }
    now = Math.max(now, w);
    const before = s.g.log.length && s.g.log[0].seq;
    mod.onTick(s, now, online);
    if (s.g.log.length && s.g.log[0].seq !== before && s.g.log[0].k === "deal") hands++;
    if (s.g.actor >= 0 && !want.includes(s.g.actor)) badActor++;
    for (const p of pids) {
      const v = mod.view(s, p).tbl;
      if (v.snap && v.snap.counts && s.g.mt.hand) { const real = s.g.mt.hand.hands.map((h) => h.length); if (JSON.stringify(real) !== JSON.stringify(v.snap.counts)) badView++; }
      if (v.snap && v.snap.n && s.g.mt.hand) { const real = s.g.mt.hand.hands.map((h) => h.length); if (JSON.stringify(real) !== JSON.stringify(v.snap.n)) badView++; }
    }
    steps++;
  }
  ok(badActor === 0, `${label}: the empty seat never had a turn (${badActor})`);
  ok(badView === 0, `${label}: every phone's counts match the real hands (${badView} differences)`);
  ok(hands >= 2 || s.g.phase === "over", `${label}: several hands played (${hands}, phase ${s.g.phase})`);
  ok(!(s.faults || []).length, `${label}: no faults ${JSON.stringify((s.faults || []).slice(0, 2))}`);
  if (name === "murlan" && s.g.mt.hand && s.g.mt.hand.result) {
    const pts = s.g.mt.hand.result.pts.filter((_, i) => want.includes(i)).sort((a, b) => b - a);
    const expect = n === 2 ? [3, 0] : n === 3 ? [3, 2, 0] : [3, 2, 1, 0];
    ok(JSON.stringify(pts) === JSON.stringify(expect), `${label}: points by place ${JSON.stringify(pts)}`);
  }
  Date.now = realNow;
  console.log(`  ${label}: ${hands} hands, ${steps} steps`);
}
// not enough people for "only us"
{
  const mod = (await import(`../worker/games/murlan.js`)).default;
  const s = { players: [{ pid: "a", name: "A" }], g: mod.init({ cfg: { teams: true } }) };
  mod.onJoin(s, "a", Date.now());
  mod.onMessage(s, { pid: "a", isHost: true, now: Date.now() }, { t: "only", v: true });
  const r = mod.onMessage(s, { pid: "a", isHost: true, now: Date.now() }, { t: "start" });
  ok(r && r.error === "only_count" && s.g.phase === "lobby", "one person alone can't start 'only us'");
}
{
  const mod = (await import(`../worker/games/domino.js`)).default;
  const s = { players: ["a", "b", "c"].map((pid) => ({ pid, name: pid })), g: mod.init({ cfg: { teams: true } }) };
  for (const p of ["a", "b", "c"]) mod.onJoin(s, p, Date.now());
  mod.onMessage(s, { pid: "a", isHost: true, now: Date.now() }, { t: "only", v: true });
  const r = mod.onMessage(s, { pid: "a", isHost: true, now: Date.now() }, { t: "start" });
  ok(r && r.error === "only_count", "Domino with 3 people and 'only us' explains it is 2 or 4");
}
console.log(fails ? `\n${fails} failed, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
