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
    let ties = 0, rematch = false;
    while (steps < 20000) {
      if (s.g.vote && s.g.vote.kind === "tie" && !s.g.vote.counted) { s.g.vote.counted = true; ties++; }
      if (s.g.phase === "over" && !rematch) {                // both phones say yes: a new match starts at once
        mod.onMessage(s, { pid: "a", isHost: true, now }, { t: "vote", kind: "again", v: "yes" });
        mod.onMessage(s, { pid: "b", isHost: false, now }, { t: "vote", kind: "again", v: "yes" });
        rematch = s.g.phase === "play";
        ok(rematch, `${name}: both phones voting yes starts a new match`);
        break;
      }
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
    const done = rematch || name === "derri";
    ok(done, `${name} ${JSON.stringify(cfg)}: match did not finish (${steps} steps)`);
    ok(!leaks, `${name} ${JSON.stringify(cfg)}: ${leaks} hidden cards sent to the wrong phone`);
    console.log(`  ${done && !leaks ? "✓" : "✗"} ${name} ${JSON.stringify(cfg)}: ${hands} hands, ${steps} moves${ties ? `, ${ties} tie vote(s)` : ""}, ${Date.now() - t0} ms`);
  }
}
// gone too long: a phone that stays away loses its seat, one that is back in time keeps it
for (const [pub, gone, out] of [[true, 150_000, true], [true, 30_000, false], [false, 120_000, false], [false, 300_000, true]]) {
  const mod = (await import("../worker/games/murlan.js")).default;
  let now = 2_000_000; const realNow = Date.now; Date.now = () => now;
  const s = { players: [{ pid: "a", name: "Ana" }, { pid: "b", name: "Beni" }], g: mod.init({ cfg: { teams: true }, public: pub }) };
  mod.onJoin(s, "a", now); mod.onJoin(s, "b", now);
  if (s.g.phase === "lobby") mod.onMessage(s, { pid: "a", isHost: true, now }, { t: "start" });
  if (s.g.phase === "lobby") { now = s.g.startAt; mod.onTick(s, now, new Set(["a", "b"])); }
  const away = new Set(["a"]), end = now + gone;
  while (now < end && s.g.phase === "play") { const w = mod.wakeAt(s, away); if (!w) break; now = Math.min(Math.max(now, w), end); mod.onTick(s, now, away); }
  const v = mod.view(s, "b").tbl;
  Date.now = realNow;
  ok(!!v.out === out && (!out || v.why === "away"), `away ${gone / 1000}s at a ${pub ? "quick-match" : "friends"} table: ${out ? "should" : "should not"} lose the seat (out=${!!v.out})`);
  if (!!v.out === out) console.log(`  ✓ away ${gone / 1000}s, ${pub ? "quick match" : "friends"}: ${out ? "seat given away" : "seat kept"}`);
}
// Derri: someone taking from a person's hand waits for it to settle; PRIT holds once; their order is what is picked from
{
  const mod = (await import("../worker/games/derri.js")).default;
  let now = 3_000_000; const realNow = Date.now; Date.now = () => now;
  const s = { players: [{ pid: "a", name: "Ana" }, { pid: "b", name: "Beni" }], g: mod.init({ cfg: {} }) };
  mod.onJoin(s, "a", now); mod.onJoin(s, "b", now);
  mod.onMessage(s, { pid: "a", isHost: true, now }, { t: "start" });
  const on = new Set(["a", "b"]), seatOf = (pid) => s.g.seats.findIndex((x) => x && x.pid === pid);
  let found = false;
  for (let i = 0; i < 400 && !found; i++) {
    const g = s.g;
    if (g.phase === "play" && g.step === "pick" && g.actor >= 0) {
      const src = g.mt.hand && (await import("../worker/gen/derri-engine.js")).E.source(g.mt.hand, g.actor);
      const holder = g.seats[src], actor = g.seats[g.actor];
      if (holder && !holder.bot && !actor.bot && g.mt.hand.hands[src].length > 2 && Math.abs(now - g.stepAt) < 2000) {
        found = true; now = g.stepAt;
        const hp = holder.pid, ap = actor.pid;
        const r1 = mod.onMessage(s, { pid: ap, now }, { t: "act", step: "pick", idx: 0 });
        ok(r1 && r1.error === "wait", "derri: no picking in the first moment of the turn");
        const rev = g.mt.hand.hands[src].slice().reverse();
        mod.onMessage(s, { pid: hp, now: now + 300 }, { t: "order", ids: rev });
        ok(g.mt.hand.hands[src].join() === rev.join(), "derri: the holder's own order is kept");
        now += 1000;
        mod.onMessage(s, { pid: hp, now }, { t: "order", ids: rev.slice().reverse() });
        ok(g.mt.hand.hands[src].join() === rev.join(), "derri: no rearranging once they are choosing");
        mod.onMessage(s, { pid: hp, now }, { t: "hold" });
        const r2 = mod.onMessage(s, { pid: ap, now: now + 500 }, { t: "act", step: "pick", idx: 0 });
        ok(r2 && r2.error === "wait", "derri: PRIT makes the picker wait");
        mod.onMessage(s, { pid: hp, now: now + 600 }, { t: "order", ids: rev.slice().reverse() });
        ok(g.mt.hand.hands[src].join() === rev.slice().reverse().join(), "derri: during PRIT the holder can rearrange");
        const until = g.holdUntil;
        mod.onMessage(s, { pid: hp, now: now + 700 }, { t: "hold" });
        ok(g.holdUntil === until, "derri: PRIT only once per turn");
        now += 3100;
        const card = g.mt.hand.hands[src][0];
        const r3 = mod.onMessage(s, { pid: ap, now }, { t: "act", step: "pick", idx: 0 });
        ok(r3 && r3.changed && !g.mt.hand.hands[src].includes(card), "derri: after PRIT the pick takes the card at that place");
        if (!fails) console.log("  ✓ derri: hand settles, PRIT, own order");
        break;
      }
    }
    const w = mod.wakeAt(s, on); if (!w) break;
    now = Math.max(now, w); mod.onTick(s, now, on);
  }
  ok(found, "derri: found a turn taking from a person");
  Date.now = realNow;
}
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
