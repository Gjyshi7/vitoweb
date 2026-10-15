// Self-healing: break the bots on purpose and check every table still moves on (and says what it did).
//   node test/heal.mjs
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
for (const name of ["murlan", "spathi", "derri", "domino"]) {
  for (const mode of ["refused", "crash", "crash-everything"]) {
    const mod = (await import(`../worker/games/${name}.js?${mode}`)).default;
    let now = 50_000_000; const realNow = Date.now; Date.now = () => now;
    const s = { players: [{ pid: "a", name: "Ana" }], g: mod.init({ cfg: name === "domino" ? { teams: true } : {}, serverSolo: true }) };
    mod.onJoin(s, "a", now); mod.onMessage(s, { pid: "a", isHost: true, now }, { t: "start" });
    const on = new Set(["a"]);
    // sabotage: every 3rd bot decision is illegal or throws; in "crash-everything" the fallbacks fail too
    let n = 0;
    const real = mod.__spec;
    const realAct = Math.random;
    const before = s.g.seq;
    let moves = 0, last = s.g.seq, stuck = false, steps = 0;
    const origAuto = mod.__setSabotage && mod.__setSabotage((orig) => (mt, seat, step, o) => {
      n++;
      if (mode === "refused" && n % 3 === 0) return { ids: [999], card: 999, idx: 999, kind: "play", id: 999, side: "X" };
      if (mode !== "refused" && n % 3 === 0) throw new Error("sabotaged bot");
      return orig(mt, seat, step, o);
    }, mode === "crash-everything");
    for (; steps < 600 && s.g.phase !== "closed"; steps++) {
      const w = mod.wakeAt(s, on); if (!w) { stuck = true; break; }
      now = Math.max(now, w);
      mod.onTick(s, now, on);
      if (s.g.seq !== last) { last = s.g.seq; moves++; }
    }
    Date.now = realNow;
    const faults = (s.faults || []).map((f) => f.kind);
    const kinds = [...new Set(faults)];
    const ended = s.g.phase === "closed" ? `closed (${s.g.closedWhy})` : `still playing`;
    // a broken bot must never freeze a table: it heals and plays on, or (if even the fallbacks are broken) closes with a message
    const good = !stuck && (mode === "crash-everything" ? (s.g.phase === "closed" && s.g.closedWhy === "error") || moves > 50 : moves > 50);
    ok(good, `${name} / ${mode}: ${moves} moves, ${ended}; healed with: ${kinds.join(", ") || "nothing needed"}`);
    mod.__setSabotage && mod.__setSabotage(null);
  }
}
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
