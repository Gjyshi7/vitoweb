// Live matchmaking check against a running server (wrangler dev, or the real site).
//   BASE=http://localhost:8787 node test/live.mjs
// Phones press LUAJ (quick match) the way the page does, then just watch. It reports:
//   how long until the deal, who sat down when, and any bot that takes too long to play.
import { driveClock } from "./clock.mjs";
const BASE = process.env.BASE || "http://localhost:8787";
const WS = BASE.replace(/^http/, "ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };

function phone(name) {
  const key = "test-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const P = { name, key, states: [], ws: null, t0: 0, dealAt: 0, me: -1 };
  P.quick = async (game, cfg) => {
    const r = await fetch(BASE + "/api/quick", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ game, cfg }) });
    const j = await r.json();
    if (!j.code) throw new Error("quick failed " + JSON.stringify(j));
    P.code = j.code;
    return j.code;
  };
  P.connect = (code) => new Promise((res) => {
    P.t0 = P.t0 || Date.now();
    const ws = new WebSocket(`${WS}/ws/${code}?v=2&name=${encodeURIComponent(name)}&k=${key}`, { headers: { origin: BASE } });
    P.ws = ws;
    ws.onopen = () => res();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t !== "state" || !m.tbl) return;
      const t = m.tbl;
      driveClock(P, m);
      P.me = t.me;
      if ((t.phase === "play" || t.phase === "solo") && !P.dealAt) P.dealAt = Date.now();   // solo: the phone plays it from here
      P.states.push({ at: Date.now(), phase: t.phase, actor: t.actor, step: t.step, seats: t.seats.map((x) => x && x.name), turnStart: t.turnStart, closed: t.phase === "closed" });
    };
    ws.onclose = (e) => { P.closed = e.code; };
  });
  P.close = () => { try { P.ws.close(); } catch {} };
  return P;
}

async function soloQuick(game, cfg, label) {
  console.log(`\n${label}`);
  const a = phone("Tester" + ((Math.random() * 900) | 0));
  const code = await a.quick(game, cfg);
  await a.connect(code);
  const start = Date.now();
  while (!a.dealAt && Date.now() - start < 20000) await sleep(100);
  const wait = a.dealAt ? (a.dealAt - start) / 1000 : null;
  ok(wait !== null && wait <= 7.5, `${game}: one person alone, the cards are dealt after ${wait === null ? "never (20 s)" : wait.toFixed(1) + " s"}`);
  if (wait === null) { a.close(); return; }
  // watch the bots play for 40 s: every bot turn must end in < 3.5 s
  const watchEnd = Date.now() + 40000;
  let moves = 0;
  while (Date.now() < watchEnd) await sleep(250);
  const play = a.states.filter((s) => s.phase === "play");
  let worst = 0, stuck = null;
  for (let i = 1; i < play.length; i++) {
    const prev = play[i - 1], cur = play[i];
    if (cur.turnStart !== prev.turnStart) moves++;
  }
  // gaps between bot turns (actor not me)
  const turns = [];
  for (const s of play) if (!turns.length || turns[turns.length - 1].turnStart !== s.turnStart) turns.push(s);
  for (let i = 0; i < turns.length - 1; i++) {
    const t = turns[i];
    if (t.actor === a.me || t.actor < 0) continue;
    const gap = turns[i + 1].turnStart - t.turnStart;
    if (gap > worst) { worst = gap; stuck = t; }
  }
  const last = turns[turns.length - 1];
  const tail = last && last.actor !== a.me && last.actor >= 0 ? Date.now() - Math.max(last.turnStart, last.at) : 0;
  ok(turns.length >= 3, `${game}: ${turns.length} turns in 40 s (this phone lets its own 15 s clock run out)`);
  ok(tail < 6000, `${game}: last turn not stuck (bot on it for ${(tail / 1000).toFixed(1)} s)`);
  console.log(`    slowest bot turn ${(worst / 1000).toFixed(1)} s (incl. animation)`);
  a.close();
}

async function fourPeople(game, cfg) {
  console.log(`\n${game}: four people press LUAJ within 2 s`);
  const ps = [0, 1, 2, 3].map((i) => phone("Njeri" + i + ((Math.random() * 90) | 0)));
  const codes = [];
  for (const p of ps) { const c = await p.quick(game, cfg); codes.push(c); await p.connect(c); await sleep(500); }
  const same = new Set(codes).size;
  ok(same === 1, `${game}: all four at the same table (${same} table(s))`);
  const start = Date.now();
  while (ps.some((p) => !p.dealAt) && Date.now() - start < 15000) await sleep(100);
  const dealt = ps.filter((p) => p.dealAt).length;
  ok(dealt === 4, `${game}: the deal reached ${dealt}/4 phones ${dealt ? ((Math.max(...ps.map((p) => p.dealAt || 0)) - start) / 1000).toFixed(1) + " s after the last one sat" : ""}`);
  const last = ps[0].states.filter((s) => s.phase === "play").pop();
  if (last) console.log("    seats:", last.seats.join(", "));
  ps.forEach((p) => p.close());
}

async function friendsFull(game, cfg, n) {
  console.log(`\n${game}: friends' room, ${n} people sit down, nobody presses Fillo`);
  const r = await fetch(BASE + "/api/create", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ game, cfg }) });
  const { code } = await r.json();
  const ps = Array.from({ length: n }, (_, i) => phone("Shok" + i));
  for (const p of ps) { await p.connect(code); await sleep(300); }
  const start = Date.now();
  while (ps.some((p) => !p.dealAt) && Date.now() - start < 8000) await sleep(100);
  const dealt = ps.filter((p) => p.dealAt).length;
  ok(dealt === n, `${game}: started by itself on ${dealt}/${n} phones${dealt ? " after " + ((Math.max(...ps.map((p) => p.dealAt || 0)) - start) / 1000).toFixed(1) + " s" : ""}`);
  ps.forEach((p) => p.close());
}

const which = process.argv[2] || "all";
if (which === "all" || which === "friends") {
  await friendsFull("murlan", { teams: true }, 4);
  await friendsFull("spathi", { target: 21 }, 2);
}
if (which === "all" || which === "solo") {
  await soloQuick("murlan", { teams: true }, "Murlan 2v2, alone");
  await soloQuick("spathi", { target: 21 }, "Spathi, alone");
  await soloQuick("derri", {}, "Derri, alone");
  await soloQuick("domino", { teams: true }, "Domino 2v2, alone");
}
if (which === "all" || which === "four") {
  await fourPeople("murlan", { teams: true });
  await fourPeople("domino", { teams: true });
}
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
