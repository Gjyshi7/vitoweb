// A phone that goes dark (screen locked, a text opened, the phone asleep) while a game is on.
//   node test/away.mjs
// Devit's rules: the game carries on and the player keeps the seat however long they're gone (the table plays
// their turns); at the end of a hand the table waits up to 30 s for them, once each time they go; when every
// real person is gone the table stands still and carries on when someone is back (closes after 10 minutes).
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log("  ✗ " + m); } };
const realNow = Date.now;

async function table(name, cfg, pub, pids) {
  const mod = (await import(`../worker/games/${name}.js`)).default;
  const T = { now: 5_000_000 };
  Date.now = () => T.now;
  const s = { players: pids.map((pid) => ({ pid, name: pid.toUpperCase() })), g: mod.init({ cfg, public: pub }) };
  for (const p of pids) mod.onJoin(s, p, T.now);
  const all = new Set(pids);
  if (s.g.phase === "lobby" && !pub) mod.onMessage(s, { pid: pids[0], isHost: true, now: T.now }, { t: "start" });
  for (let i = 0; i < 40 && s.g.phase === "lobby"; i++) { T.now = Math.max(T.now, mod.wakeAt(s, all)); mod.onTick(s, T.now, all); }
  // run the table with `online` until `until` (or stop()), the way the phones and the backup alarm do
  T.run = (online, until, stop) => {
    let steps = 0;
    while (T.now < until && steps < 20000 && s.g.phase !== "closed") {
      const w = mod.wakeAt(s, online);
      if (!w) { T.now = until; break; }
      const before = { actor: s.g.actor, step: s.g.step, seq: s.g.seq, at: T.now };
      T.now = Math.min(Math.max(T.now, w), until);
      if (T.now < w) break;
      mod.onTick(s, T.now, online);
      steps++;
      if (stop && stop(before)) break;
    }
    return steps;
  };
  return { mod, s, T, all };
}
const hands = (s) => s.g.mt && s.g.mt.losses ? s.g.mt.losses.reduce((a, b) => a + b, 0) : 0;

for (const [name, cfg] of [["murlan", { teams: true }], ["derri", {}], ["domino", { teams: true, target: 100 }], ["spathi", {}]]) {
  for (const pub of [true, false]) {
    const pids = name === "spathi" ? ["a", "b"] : ["a", "b", "c"];
    const { mod, s, T, all } = await table(name, cfg, pub, pids);
    const label = `${name} ${pub ? "quick match" : "friends"}`;
    if (s.g.phase !== "play") { ok(false, `${label}: didn't start (${s.g.phase})`); continue; }
    const seatB = s.g.seats.findIndex((x) => x && x.pid === "b");
    const online = new Set(pids.filter((p) => p !== "b"));
    // b's phone goes dark for 3 minutes
    const t0 = T.now, seq0 = s.g.seq;
    const turnGaps = [];
    let endWaits = [];
    T.run(online, t0 + 180_000, (before) => {
      if (before.actor === seatB && s.g.actor !== seatB || (before.actor === seatB && s.g.seq !== before.seq)) turnGaps.push(T.now - Math.max(before.at, s.g.stepAt - 1e9));
      return false;
    });
    const v = mod.view(s, "b", T.now, online).tbl;
    ok(!v.out, `${label}: b kept the seat after 3 min dark (out=${!!v.out}, why=${v.why})`);
    ok(s.g.seats[seatB] && s.g.seats[seatB].pid === "b", `${label}: seat ${seatB} is still b's`);
    ok(s.g.phase === "play" || s.g.phase === "over", `${label}: the game went on (phase ${s.g.phase})`);
    ok(s.g.seq > seq0 + 5, `${label}: the table kept moving while b was dark (seq ${seq0} -> ${s.g.seq})`);
    // b comes back (the room calls onJoin on every reconnect): the same game, b at the table, nothing left over
    mod.onJoin(s, "b", T.now);
    T.run(all, T.now + 3000);
    const v2 = mod.view(s, "b", T.now, all).tbl;
    ok(!v2.out && v2.me === seatB, `${label}: b is back at seat ${seatB} (me=${v2.me})`);
    ok(!(s.g.away && s.g.away.b) && !(s.g.waited && s.g.waited.b), `${label}: away marks cleared when b is back`);
    ok(!(s.faults || []).length, `${label}: no faults ${JSON.stringify((s.faults || []).slice(0, 1))}`);
    void turnGaps; void endWaits;
    console.log(`  ${label}: 3 min dark, seat kept, table moved ${s.g.seq - seq0} times`);
  }
}

// the turns of a dark phone: the first waits 6 s, the next ones 2 s (the others don't sit waiting)
{
  const { s, T } = await table("murlan", { teams: false }, false, ["a", "b", "c", "d"]);
  const seatB = s.g.seats.findIndex((x) => x && x.pid === "b");
  const online = new Set(["a", "c", "d"]);
  const waits = [];
  let guard = 0;
  // everyone else is online but doesn't move: their turns run out after 15-20 s. Measure only b's turns.
  while (waits.length < 4 && guard++ < 4000 && s.g.phase === "play") {
    const startStep = s.g.stepAt, actor = s.g.actor, step = s.g.step;
    T.run(online, T.now + 60_000, () => s.g.actor !== actor || s.g.stepAt !== startStep || s.g.step !== step);
    if (actor === seatB && step === "turn") waits.push(T.now - startStep);
  }
  ok(waits.length >= 3, `dark phone's turns measured (${waits.length})`);
  ok(waits[0] >= 5900 && waits[0] <= 6500, `first turn of a dark phone plays after ~6 s (${waits[0]} ms)`);
  ok(waits.slice(1).every((w) => w >= 1900 && w <= 2600), `next turns of a dark phone play after ~2 s (${waits.slice(1).join(", ")} ms)`);
  console.log(`  dark phone's turns: ${waits.join(", ")} ms`);
}

// end of a hand with someone dark: the table waits up to 30 s, once; back sooner and it deals right away
for (const backAfter of [0, 12_000]) {
  const { mod, s, T, all } = await table("derri", {}, false, ["a", "b", "c"]);
  const online = new Set(["a", "c"]);
  const ends = [];
  let guard = 0;
  while (ends.length < 2 && guard++ < 20000 && s.g.phase === "play") {
    const w = mod.wakeAt(s, online);
    if (!w) break;
    T.now = Math.max(T.now, w);
    const wasEnd = s.g.step === "end", endAt = s.g.stepAt;
    if (wasEnd) {
      const v = mod.view(s, "a", T.now - 1, online).tbl;     // what a phone sees just before the deal
      if (backAfter && ends.length === 0 && T.now - endAt > backAfter) {
        // b comes back 12 s into the result screen: the next nudge deals at once
        T.now = endAt + backAfter;
        mod.onJoin(s, "b", T.now);
        const w2 = mod.wakeAt(s, all);
        T.now = Math.max(T.now, w2); mod.onTick(s, T.now, all);
        ends.push({ wait: T.now - endAt, dealt: s.g.step !== "end", back: true });
        continue;
      }
      mod.onTick(s, T.now, online);
      ends.push({ wait: T.now - endAt, sawWait: !!(v.waitFor && v.waitFor.length) });
      continue;
    }
    mod.onTick(s, T.now, online);
  }
  if (!backAfter) {
    ok(ends.length === 2, `two hand ends seen (${ends.length})`);
    ok(ends[0] && ends[0].wait >= 29_000 && ends[0].wait <= 31_000, `first hand end with b dark waits ~30 s (${ends[0] && ends[0].wait} ms)`);
    ok(ends[0] && ends[0].sawWait, `phones are told who the table waits for`);
    ok(ends[1] && ends[1].wait <= 10_000, `second hand end, b still dark: no second wait (${ends[1] && ends[1].wait} ms)`);
    console.log(`  hand ends with b dark: ${ends.map((e) => e.wait).join(", ")} ms`);
  } else {
    ok(ends[0] && ends[0].back && ends[0].dealt && ends[0].wait <= 12_100, `b back 12 s into the wait: deals at once (${ends[0] && ends[0].wait} ms, dealt=${ends[0] && ends[0].dealt})`);
    console.log(`  b back during the wait: dealt ${ends[0] && ends[0].wait} ms after the hand ended`);
  }
}

// every real person dark: the table stands still (nothing moves, nothing costs), carries on when one is back,
// and closes only after 10 minutes
{
  const { mod, s, T, all } = await table("murlan", { teams: true }, true, ["a", "b"]);
  const none = new Set();
  const seq0 = s.g.seq;
  T.run(none, T.now + 5 * 60_000);
  ok(s.g.phase === "play", `everyone dark 5 min: still open (phase ${s.g.phase})`);
  const moved = s.g.seq - seq0;
  ok(moved <= 1, `everyone dark: the table stood still (${moved} changes)`);
  mod.onJoin(s, "a", T.now); mod.onJoin(s, "b", T.now);
  T.run(all, T.now + 90_000);                          // they're back but don't touch anything: turns run out and play
  ok(s.g.seq > seq0 + 3, `someone back: the table carries on (seq ${seq0} -> ${s.g.seq})`);
  const seq1 = s.g.seq;
  T.run(none, T.now + 11 * 60_000);
  ok(s.g.phase === "closed", `everyone dark 11 min: closed (phase ${s.g.phase})`);
  void seq1;
  console.log(`  everyone dark: stood still, carried on, closed after 10 min`);
}

// end of a match: a player whose phone is dark when the time to answer runs out stays for the next match
{
  const { mod, s, T } = await table("murlan", { teams: true }, true, ["a", "b"]);
  const online = new Set(["a"]);
  let guard = 0;
  while (s.g.phase === "play" && guard++ < 30000) { const w = mod.wakeAt(s, online); if (!w) break; T.now = Math.max(T.now, w); mod.onTick(s, T.now, online); }
  ok(s.g.phase === "over", `match played out (phase ${s.g.phase})`);
  mod.onMessage(s, { pid: "a", now: T.now }, { t: "vote", kind: "again", v: "yes" });
  for (let i = 0; i < 10 && s.g.phase === "over"; i++) { const w = mod.wakeAt(s, online); if (!w) break; T.now = Math.max(T.now, w); mod.onTick(s, T.now, online); }
  const v = mod.view(s, "b", T.now, online).tbl;
  ok(s.g.phase === "play" && !v.out, `b (dark at the vote) stays for the next match (phase ${s.g.phase}, out=${!!v.out})`);
  console.log(`  dark at the rematch vote: kept the seat`);
}

Date.now = realNow;
console.log(fails ? `\n${fails} failed, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
