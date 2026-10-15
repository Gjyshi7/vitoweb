// Fuzz: the real table server (worker/games/*.js) with random people instead of tidy test phones.
// Each table gets humans who play random legal moves, send junk, let their clock run out, drop and come back,
// leave, get replaced by newcomers, vote yes/no at the end, PRIT/order in Derri. A fake clock drives it all.
//
// After every step it checks the things that must never happen:
//   - an exception anywhere
//   - a bot (or autopilot) move the rules refuse          -> the table would freeze
//   - a table where nothing happens for too long while someone is there  -> frozen table
//   - a phone receiving someone else's cards             -> cheating / leak
//   - two seats for one person, a seated person who isn't in the room
//   - a single server step that burns too much CPU        -> Cloudflare kills it
//
//   node test/fuzz.mjs [tablesPerConfig=60] [seed]
import { performance } from "node:perf_hooks";
import { G, M } from "../worker/gen/murlan-engine.js";
import { S } from "../worker/gen/spathi-engine.js";
import { E as D } from "../worker/gen/derri-engine.js";
import { E as DOM } from "../worker/gen/domino-engine.js";

const TABLES = Number(process.argv[2] || 60);
let seed = Number(process.argv[3] || Date.now() % 1e9);
console.log(`seed ${seed}`);
// deterministic randomness for the fuzzer itself AND the server (so a failure can be replayed with the seed)
const rng = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
Math.random = rng;
const pick = (a) => a[(rng() * a.length) | 0];
const chance = (p) => rng() < p;

const problems = [];
let refused = 0;
const origErr = console.error;
console.error = (...a) => { if (String(a[0]).includes("auto move refused")) refused++; else origErr(...a); };

// ---------- random legal human moves, per game ----------
const human = {
  murlan(s, seat, step) {
    const H = s.g.mt.hand;
    if (step === "gift") return { t: "act", step, card: pick(G.giftOptions(H.hands[seat])) };
    const moves = M.allMoves(H.hands[seat], H.top, H.must3);
    if (H.top && (chance(0.35) || !moves.length)) return { t: "act", step, ids: null };
    if (!moves.length) return null;
    return { t: "act", step, ids: M.cardsFor(H.hands[seat], pick(moves), H.must3) };
  },
  spathi(s, seat, step) {
    const H = s.g.mt.hand;
    const card = pick(H.hands[seat]);
    const caps = S.captures(card, H.table);
    return { t: "act", step, card, take: caps.length ? pick(caps) : [] };
  },
  derri(s, seat, step) {
    const H = s.g.mt.hand, from = D.source(H, seat);
    return { t: "act", step, idx: (rng() * H.hands[from].length) | 0 };
  },
  domino(s, seat, step) {
    const H = s.g.mt.hand;
    const ms = DOM.movesFor(H, seat);
    if (ms.length) { const m = pick(ms); return { t: "act", step, kind: "play", id: m.id, side: m.side }; }
    if (DOM.canDraw(s.g.mt)) return { t: "act", step, kind: "draw" };
    return { t: "act", step, kind: "pass" };
  },
};
const junk = () => pick([
  { t: "act", ids: [999] }, { t: "act", ids: "x" }, { t: "act", card: -1, take: [1, 1] }, { t: "act", idx: 99 },
  { t: "act", kind: "play", id: 500, side: "L" }, { t: "act", kind: "pass" }, { t: "act", kind: "draw" },
  { t: "vote", kind: "again", v: "maybe" }, { t: "seat", seat: 7 }, { t: "start" }, { t: "hold" }, { t: "order", ids: [1, 2, 3] },
  { t: "cfg", cfg: { teams: "lol", target: 1e9 } }, { t: "nonsense" }, { t: "act", step: "gift", card: 53 },
]);

const CFGS = {
  murlan: [{ teams: true }, { teams: false }],
  spathi: [{ target: 21 }, { target: 11 }],
  derri: [{}],
  domino: [{ teams: true }, { teams: false, stock: true, target: 50 }, { teams: false, stock: false, target: 50 }],
};
const STUCK_MS = 60_000;          // nothing at all happening for this long while someone is at the table
const CPU_WARN = 25;              // ms for one server step (Workers free plan allows ~10 ms; paid 30 s)

let pidN = 0;
const newPid = () => "p" + (++pidN);

async function runTable(name, mod, cfg, pub, t) {
  let now = 10_000_000 + t * 1e7;
  const realNow = Date.now; Date.now = () => now;
  const s = { players: [], g: mod.init({ cfg, public: pub }) };
  const people = new Map();       // pid -> { online, next }
  const join = (pid) => { s.players.push({ pid, name: "H" + pid, keys: [] }); people.set(pid, { online: true, next: now + 300 + rng() * 4000 }); return mod.onJoin(s, pid, now); };
  const host = newPid(); join(host);
  if (!pub) for (let i = 0; i < (rng() * 4) | 0; i++) join(newPid());
  else if (chance(0.5)) join(newPid());
  let lastSeq = s.g.seq, lastChange = now, steps = 0, cpuMax = 0, hands = 0, maxTable = 0;
  const online = () => new Set([...people].filter(([, p]) => p.online).map(([pid]) => pid));
  const seatOf = (pid) => s.g.seats.findIndex((x) => x && x.pid === pid);
  const fail = (what) => { problems.push(`${name} ${JSON.stringify(cfg)} ${pub ? "quick" : "friends"} table#${t} step ${steps} phase ${s.g.phase}/${s.g.step}: ${what}`); };
  let cpuWhat = "";
  const timed = (fn, what) => { const a = performance.now(); try { return fn(); } finally { const d = performance.now() - a; if (d > cpuMax) { cpuMax = d; cpuWhat = what || `${s.g.phase}/${s.g.step}`; } } };

  try {
    for (; steps < 2500; steps++) {
      if (s.g.phase === "closed") break;
      if (name === "derri" && hands >= 4) break;
      // the next thing that happens: the server's own clock, or a person doing something
      const on = online();
      const w = mod.wakeAt(s, on) || Infinity;
      let who = null, at = Infinity;
      for (const [pid, p] of people) if (p.next < at) { at = p.next; who = pid; }
      if (w === Infinity && at === Infinity) break;
      if (w <= at) {
        now = Math.max(now, w);
        timed(() => mod.onTick(s, now, on));
      } else {
        now = Math.max(now, at);
        const p = people.get(who);
        p.next = now + 200 + rng() * (chance(0.15) ? 30_000 : 3500);
        const r = rng(), me = { pid: who, isHost: who === host, now };
        if (!p.online) { if (chance(0.7)) { p.online = true; mod.onJoin(s, who, now); } continue; }   // comes back (reconnect)
        if (r < 0.04) { p.online = false; continue; }                                                // phone drops
        if (r < 0.055 && who !== host) {                                                             // leaves for good
          const gone = s.players.find((x) => x.pid === who);
          s.players = s.players.filter((x) => x.pid !== who); people.delete(who); mod.onRemove(s, who, now, gone && gone.name); continue;
        }
        if (r < 0.07 && s.players.length < 6) { const n = newPid(); if (mod.canJoin(s)) join(n); continue; }   // someone new arrives
        if (r < 0.10) { timed(() => mod.onMessage(s, me, junk())); continue; }
        const g = s.g, seat = seatOf(who);
        if (g.phase === "lobby") {
          if (!pub && who === host && chance(0.3)) timed(() => mod.onMessage(s, me, { t: "start" }));
          else if (!pub && chance(0.2)) mod.onMessage(s, me, { t: "seat", seat: pick(g.seats.map((_, i) => i)) });
          continue;
        }
        if (g.vote) { mod.onMessage(s, me, { t: "vote", kind: g.vote.kind, v: g.vote.kind === "again" ? pick(["yes", "yes", "no"]) : pick(["raise", "golden"]) }); continue; }
        if (g.phase !== "play" || seat < 0) continue;
        if (name === "derri" && chance(0.25)) {
          const h = g.mt.hand && g.mt.hand.hands[seat];
          if (h) mod.onMessage(s, me, chance(0.5) ? { t: "hold", done: chance(0.5) } : { t: "order", ids: [...h].sort(() => rng() - 0.5) });
          continue;
        }
        if (g.actor !== seat || g.step === "end" || g.step === "choice") continue;
        if (chance(0.15)) continue;                                                                  // lets the clock run out
        const msg = human[name](s, seat, g.step);
        if (!msg) continue;
        const res = timed(() => mod.onMessage(s, me, msg));
        if (res && res.error && res.error !== "wait") fail(`a legal human move was refused: ${res.error} ${JSON.stringify(msg)}`);
      }
      // ---- invariants ----
      if (s.g.seq !== lastSeq) { lastSeq = s.g.seq; lastChange = now; }
      if (s.g.mt && s.g.mt.hand && s.g.mt.hand.table) maxTable = Math.max(maxTable, s.g.mt.hand.table.length);
      const someone = s.g.seats.some((x) => x && !x.bot && online().has(x.pid));
      if ((s.g.phase === "play" || s.g.phase === "over") && someone && now - lastChange > STUCK_MS) { fail(`frozen: nothing happened for ${((now - lastChange) / 1000) | 0} s (actor ${s.g.actor}, due in ${s.g.due - now} ms)`); break; }
      if (s.g.seats.some((x) => x && x.bot && !x.name)) fail("a player seat without a name");
      const pids = s.g.seats.filter((x) => x && !x.bot).map((x) => x.pid);
      if (new Set(pids).size !== pids.length) fail("one person in two seats");
      for (const pid of pids) if (!s.players.some((p) => p.pid === pid) && s.g.phase === "lobby") fail("a seated person is not in the room");
      if (steps % 7 === 0) for (const pid of people.keys()) {
        const v = mod.view(s, pid, now, online()).tbl, me = seatOf(pid);
        if (v.log) for (const e of v.log) if (e.priv) fail("private data left in a phone's log");
        if (v.snap && v.snap.hand && v.snap.counts && me >= 0 && v.snap.hand.length !== v.snap.counts[me]) fail("snapshot hand does not match");
        if (me < 0 && v.snap && v.snap.hand && v.snap.hand.length) fail("someone without a seat sees a hand");
      }
      if (s.g.log && s.g.log.length && s.g.log[0].k === "deal" && s.g.log[0].seq === s.g.seq) hands++;
    }
  } catch (e) {
    fail("exception: " + (e && e.stack || e));
  } finally { Date.now = realNow; }
  return { steps, cpuMax, cpuWhat, maxTable };
}

for (const name of ["murlan", "spathi", "derri", "domino"]) {
  const mod = (await import(`../worker/games/${name}.js`)).default;
  for (const cfg of CFGS[name]) {
    let cpu = 0, steps = 0, maxTable = 0, cpuWhat = "";
    const before = problems.length, refusedBefore = refused;
    const t0 = performance.now();
    for (let t = 0; t < TABLES; t++) {
      const r = await runTable(name, mod, cfg, t % 2 === 0, t);
      if (r.cpuMax > cpu) { cpu = r.cpuMax; cpuWhat = r.cpuWhat + (t === 0 ? " (first table: cold start)" : ""); }
      steps += r.steps; maxTable = Math.max(maxTable, r.maxTable);
    }
    const bad = problems.length - before, ref = refused - refusedBefore;
    console.log(`  ${bad || ref ? "✗" : "✓"} ${name} ${JSON.stringify(cfg)}: ${TABLES} tables, ${steps} steps, problems ${bad}, refused bot moves ${ref}, slowest step ${cpu.toFixed(1)} ms [${cpuWhat}]${maxTable ? `, biggest table ${maxTable} cards` : ""} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    if (cpu > CPU_WARN && !cpuWhat.includes("cold start")) problems.push(`${name} ${JSON.stringify(cfg)}: one server step took ${cpu.toFixed(1)} ms of CPU`);
    if (ref) problems.push(`${name} ${JSON.stringify(cfg)}: ${ref} bot moves refused by the rules (each one freezes a table)`);
  }
}
const uniq = [...new Set(problems.map((p) => p.replace(/table#\d+ step \d+/, "")))];
console.log(problems.length ? `\n${problems.length} problems (${uniq.length} kinds):\n` + uniq.slice(0, 40).map((p) => "  - " + p.slice(0, 400)).join("\n") : "\nno problems");
process.exit(problems.length ? 1 : 0);
