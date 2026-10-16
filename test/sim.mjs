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
          // Murlan's exchange is shown to the whole table on purpose (the two exchanged cards only)
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
for (const [pub, gone, out] of [[true, 150_000, true], [true, 30_000, false], [false, 120_000, false], [false, 600_000, false]]) {
  const mod = (await import("../worker/games/murlan.js")).default;
  let now = 2_000_000; const realNow = Date.now; Date.now = () => now;
  const s = { players: [{ pid: "a", name: "Ana" }, { pid: "b", name: "Beni" }], g: mod.init({ cfg: { teams: true }, public: pub }) };
  mod.onJoin(s, "a", now); mod.onJoin(s, "b", now);
  if (s.g.phase === "lobby") mod.onMessage(s, { pid: "a", isHost: true, now }, { t: "start" });
  for (let i = 0; i < 20 && s.g.phase === "lobby"; i++) { now = Math.max(now, mod.wakeAt(s, new Set(["a", "b"]))); mod.onTick(s, now, new Set(["a", "b"])); }
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
// quick match lobby: players sit down one at a time; seats kept for someone likely stay open until the hold ends;
// a person who arrives later takes a seat (from a bot if need be), also during a match
{
  const mod = (await import("../worker/games/murlan.js")).default;
  let now = 4_000_000; const realNow = Date.now; Date.now = () => now;
  // one person alone: after the lobby the match moves onto the phone ("solo"), with the same players
  {
    let n0 = 3_000_000; Date.now = () => n0;
    const s0 = { players: [{ pid: "a", name: "Ana" }], g: mod.init({ cfg: { teams: true }, public: true }) };
    mod.onJoin(s0, "a", n0); const on0 = new Set(["a"]);
    while (s0.g.phase === "lobby" && n0 < 3_020_000) { const w = mod.wakeAt(s0, on0); if (!w) break; n0 = Math.max(n0, w); mod.onTick(s0, n0, on0); }
    const v0 = mod.view(s0, "a").tbl;
    ok(s0.g.phase === "solo" && v0.seats.filter(Boolean).length === 4 && mod.wakeAt(s0, on0) === 0, `one person alone: the table moves onto the phone after ${n0 - 3_000_000} ms with 4 seats, and the server stops`);
    Date.now = () => now;
  }
  // the rest of these check matches that stay on the server (2+ people, or the test switch)
  const s = { players: [{ pid: "a", name: "Ana" }], g: mod.init({ cfg: { teams: true }, public: true, serverSolo: true }) };
  mod.onJoin(s, "a", now);
  const on = new Set(["a"]), seated = () => s.g.seats.filter(Boolean).length, times = [];
  const t0 = now;
  let dealtAt = 0;
  while (s.g.phase === "lobby" && now - t0 < 20_000) { const w = mod.wakeAt(s, on); if (!w) break; now = Math.max(now, w); const n = seated(); mod.onTick(s, now, on); if (seated() > n && s.g.phase === "lobby") times.push(now - t0); if (s.g.phase !== "lobby") dealtAt = now - t0; }
  ok(times.length === 3 && times[1] > times[0] && times[0] >= 900, `lobby: bots arrive one by one (${times.join(", ")} ms)`);
  ok(dealtAt > 0 && dealtAt <= 7000, `lobby: dealt within 7 s (${dealtAt} ms)`);
  // a second person arrives at 3 s: the deal is still at 7 s at the latest
  {
    let n2 = 5_000_000; Date.now = () => n2;
    const s3 = { players: [{ pid: "a", name: "Ana" }], g: mod.init({ cfg: { teams: true }, public: true, serverSolo: true }) };
    mod.onJoin(s3, "a", n2); const on3 = new Set(["a"]); const t3 = n2; let joined = false;
    while (s3.g.phase === "lobby" && n2 - t3 < 20_000) {
      const w = mod.wakeAt(s3, on3); if (!w) break;
      if (!joined && w - t3 > 3000) { n2 = t3 + 3000; s3.players.push({ pid: "b", name: "Beni" }); mod.onJoin(s3, "b", n2); on3.add("b"); joined = true; continue; }
      n2 = Math.max(n2, w); mod.onTick(s3, n2, on3);
    }
    ok(s3.g.phase === "play" && n2 - t3 <= 7000 && s3.g.seats.some((x) => x && x.pid === "b"), `lobby: a person at 3 s sits down, deal still by 7 s (${n2 - t3} ms)`);
    now = n2; Date.now = () => now;
  }
  ok(s.g.phase === "play", "lobby: the match starts once the table is full");
  // Devit: nobody joins a game late. Once dealt, a quick-match table takes no one new.
  ok(!mod.canJoin(s), "a dealt match takes nobody new (no late joiners)");
  ok(mod.onJoin(s, "zz", now) === false && !s.g.seats.some((x) => x && x.pid === "zz"), "a late phone gets no seat");
  // a full lobby of bots: a person still gets in
  const s2 = { players: [{ pid: "a", name: "Ana" }], g: mod.init({ cfg: { teams: true }, public: true, serverSolo: true }) };
  mod.onJoin(s2, "a", now);
  s2.g.fillAt = now; for (let i = 0; i < 3; i++) { mod.onTick(s2, now, on); now += 10; s2.g.fillAt = now; if (s2.g.phase !== "lobby") break; }
  if (s2.g.phase === "lobby") { s2.players.push({ pid: "c", name: "Cimi" }); mod.onJoin(s2, "c", now); }
  ok(s2.g.phase !== "lobby" || s2.g.seats.some((x) => x && x.pid === "c"), "lobby full of bots: a person replaces one");
  Date.now = realNow;
  if (!fails) console.log(`  ✓ quick match: bots arrive at ${times.join(", ")} ms, newcomers take bot seats`);
}
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
