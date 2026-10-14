// Server-rules simulation: plays whole matches of every table game with a fake clock, no network.
// Two "phones" sit at each table; their turns run out and play on autopilot, like everyone else.
// Checks: matches finish, the log only ever shows a phone its own cards, snapshots agree with the log.
//   node test/sim.mjs
const games = ["murlan", "spathi", "derri", "domino"];
const CFGS = { murlan: [{ teams: true }, { teams: false }], spathi: [{ target: 21 }], derri: [{}], domino: [{ teams: true }, { teams: false, stock: true, target: 50 }, { teams: false, stock: false, target: 50 }] };
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("  ✗ " + m); } };

for (const name of games) {
  const mod = (await import(`../worker/games/${name}.js`)).default;
  for (const cfg of CFGS[name]) {
    const t0 = Date.now();
    let now = 1_000_000;
    const realNow = Date.now; Date.now = () => now;
    const s = { players: [{ pid: "a", name: "Ana" }, { pid: "b", name: "Beni" }], g: mod.init({ cfg }) };
    mod.onJoin(s, "a", now); mod.onJoin(s, "b", now);
    mod.onMessage(s, { pid: "a", isHost: true, now }, { t: "start" });
    const online = new Set(["a", "b"]);
    let steps = 0, hands = 0, leaks = 0, lastPhase = "";
    const seatOf = (pid) => s.g.seats.findIndex((x) => x && x.pid === pid);
    while (steps < 20000) {
      if (s.g.phase === "over") break;
      if (name === "derri" && hands >= 6) break;            // Derri has no end: 6 rounds is enough
      const w = mod.wakeAt(s, online);
      if (!w) { ok(false, `${name} ${JSON.stringify(cfg)}: table stopped (phase ${s.g.phase}, step ${s.g.step})`); break; }
      now = Math.max(now, w);
      const before = s.g.log.length && s.g.log[0].seq;
      mod.onTick(s, now, online);
      if (s.g.log.length && s.g.log[0].seq !== before && s.g.log[0].k === "deal") hands++;
      steps++;
      // what each phone receives
      for (const pid of ["a", "b"]) {
        const v = mod.view(s, pid).tbl, me = seatOf(pid);
        for (const e of v.log || []) {
          if (e.k === "deal" && e.hand && e.counts && e.hand.length !== e.counts[me]) leaks++;
          if ((e.k === "give" || e.k === "ret") && e.card != null && me !== e.from && me !== e.to) leaks++;
          if (e.k === "draw" && e.card != null && me !== e.p && me !== e.from) leaks++;
          if (e.k === "draw" && e.id != null && me !== e.p) leaks++;
          if (e.order) for (const o of e.order) if (o.to !== "table" && o.to !== me && o.id != null) leaks++;
          if (e.priv) leaks++;
        }
        if (v.snap && v.snap.hand && v.snap.counts && me >= 0) ok(v.snap.hand.length === v.snap.counts[me], `${name}: snapshot hand size`);
      }
    }
    Date.now = realNow;
    const done = s.g.phase === "over" || name === "derri";
    ok(done, `${name} ${JSON.stringify(cfg)}: match did not finish (${steps} steps)`);
    ok(!leaks, `${name} ${JSON.stringify(cfg)}: ${leaks} hidden cards sent to the wrong phone`);
    console.log(`  ${done && !leaks ? "✓" : "✗"} ${name} ${JSON.stringify(cfg)}: ${hands} hands, ${steps} moves, ${Date.now() - t0} ms`);
  }
}
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
