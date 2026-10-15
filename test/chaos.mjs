// Chaos: many phones on a running server (wrangler dev), doing everything real people do, all at once.
//   /tmp/.../restart.sh --var CHAOS_DROP_ALARMS:0.3     (the server also loses 30 % of its own clock ticks)
//   BASE=http://localhost:8787 node test/chaos.mjs [phones=24] [seconds=180]
// Phones press LUAJ or open friends' rooms, play legal moves at human speed (or let the clock run out),
// drop the connection and come back, open a second tab, leave for another game, vote, send junk.
// Checks, the whole time:
//   - no table where nothing happens for too long while someone is there (frozen)
//   - every phone's own hand matches what the table says it holds (no wrong data to the wrong phone)
//   - a phone never holds cards while not seated; no "server" errors
import { M } from "../worker/gen/murlan-engine.js";
import { S } from "../worker/gen/spathi-engine.js";
import { E as D } from "../worker/gen/derri-engine.js";
import { E as DOM } from "../worker/gen/domino-engine.js";

const BASE = process.env.BASE || "http://localhost:8787", WS = BASE.replace(/^http/, "ws");
const PHONES = Number(process.argv[2] || 24), SECONDS = Number(process.argv[3] || 180);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[(Math.random() * a.length) | 0];
const chance = (p) => Math.random() < p;
const GAMES = ["murlan", "murlan", "spathi", "derri", "domino"];
const CFG = { murlan: () => ({ teams: chance(0.7) }), spathi: () => ({ target: 21 }), derri: () => ({}), domino: () => ({ teams: chance(0.6) }) };
const FROZEN_MS = 32_000;
const problems = [], counts = { moves: 0, refused: 0, drops: 0, tabs: 0, leaves: 0, tables: new Set(), errors: {} };
const fail = (m) => { problems.push(m); console.log("  ✗ " + m); };

function legal(game, t) {
  const sn = t.snap || {}, me = t.me;
  try {
    if (game === "murlan") {
      if (t.step === "gift") { const opts = sn.hand.filter((id) => M.rankOf(id) >= 3 && M.rankOf(id) <= 10); return { t: "act", step: "gift", card: opts.length ? pick(opts) : sn.hand[0] }; }
      const moves = M.allMoves(sn.hand, sn.top, sn.must3);
      if (sn.top && (chance(0.3) || !moves.length)) return { t: "act", step: "turn", ids: null };
      return moves.length ? { t: "act", step: "turn", ids: M.cardsFor(sn.hand, pick(moves), sn.must3) } : null;
    }
    if (game === "spathi") { const card = pick(sn.hand), caps = S.captures(card, sn.table); return { t: "act", step: "turn", card, take: caps.length ? pick(caps) : [] }; }
    if (game === "derri") {
      const H = { hands: sn.counts.map((n) => new Array(n).fill(0)), order: sn.order || [], over: false };
      const src = D.source(H, me);
      return { t: "act", step: "pick", idx: (Math.random() * Math.max(1, sn.counts[src])) | 0 };
    }
    if (game === "domino") {
      const H = { hands: [], start: sn.start, ends: sn.ends, L: sn.L || [], R: sn.R || [], mustOpen: sn.mustOpen };
      H.hands[me] = sn.hand;
      const ms = DOM.movesFor(H, me);
      if (ms.length) { const m = pick(ms); return { t: "act", step: "turn", kind: "play", id: m.id, side: m.side }; }
      return { t: "act", step: "turn", kind: sn.boneN > 0 && t.cfg.stock ? "draw" : "pass" };
    }
  } catch (e) { fail(`${game}: could not work out a legal move from my own view: ${e.message}`); }
  return null;
}

class Phone {
  constructor(i) { this.i = i; this.name = "Chaos" + i; this.key = "chaos-" + i + "-" + Math.random().toString(36).slice(2, 12); this.ws = null; this.code = null; this.game = null; this.t = null; this.lastChange = 0; this.lastSeq = -1; }
  async quick(game) {
    const r = await fetch(BASE + "/api/quick", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ game, cfg: CFG[game](), k: this.key }) });
    const j = await r.json(); if (!j.code) throw new Error("quick " + JSON.stringify(j));
    this.game = game; return this.open(j.code);
  }
  async create(game) {
    const r = await fetch(BASE + "/api/create", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ game, cfg: CFG[game](), k: this.key }) });
    const j = await r.json(); if (!j.code) throw new Error("create " + JSON.stringify(j));
    this.game = game; this.host = j.hostToken; return this.open(j.code);
  }
  open(code) {
    this.code = code; counts.tables.add(code);
    return new Promise((res) => {
      const q = new URLSearchParams({ name: this.name, k: this.key }); if (this.host) q.set("host", this.host);
      const ws = new WebSocket(`${WS}/ws/${code}?${q}`, { headers: { origin: BASE } });
      this.ws = ws;
      const done = setTimeout(res, 3000);
      ws.onopen = () => { clearTimeout(done); res(); };
      ws.onmessage = (e) => this.onMsg(JSON.parse(e.data));
      ws.onclose = () => { if (this.ws === ws) this.ws = null; };
    });
  }
  send(o) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); } catch {} }
  onMsg(m) {
    if (m.t === "error") { counts.errors[m.e] = (counts.errors[m.e] || 0) + 1; if (m.e === "server") fail(`${this.game} ${this.code}: the server answered "server error"`); return; }
    if (m.t !== "state" || !m.tbl) return;
    const t = m.tbl;
    this.skew = m.now - Date.now(); this.heard = Date.now();
    if (t.seq !== this.lastSeq) { this.lastSeq = t.seq; this.lastChange = Date.now(); }
    this.t = t;
    // what this phone was given must be its own: its hand has exactly the number of cards its seat holds
    const sn = t.snap;
    if (sn && sn.hand && sn.counts && t.me >= 0 && sn.hand.length !== sn.counts[t.me]) fail(`${this.game} ${this.code}: my hand (${sn.hand.length}) is not my seat's (${sn.counts[t.me]})`);
    if (sn && sn.hand && sn.hand.length && t.me < 0) fail(`${this.game} ${this.code}: a phone without a seat was sent a hand`);
    for (const e of t.log || []) if (e.priv) fail(`${this.game}: private data in a phone's log`);
    // my turn: play like a person (sometimes slowly, sometimes not at all)
    if (t.phase === "play" && t.actor === t.me && t.me >= 0 && t.step !== "end" && t.step !== "choice") {
      const key = t.seq + ":" + t.step;
      if (this.asked === key) return;
      this.asked = key;
      if (chance(0.12)) return;                                  // lets the clock run out
      const msg = legal(this.game, t);
      if (msg) setTimeout(() => { if (this.t && this.t.seq === t.seq) { counts.moves++; this.send(msg); } }, 400 + Math.random() * 3500);
    }
    if (t.vote && !t.vote.mine && chance(0.5)) this.send({ t: "vote", kind: t.vote.kind, v: t.vote.kind === "again" ? pick(["yes", "yes", "no"]) : pick(["raise", "golden"]) });
    if (t.phase === "closed" || t.out) this.code = null;
  }
  close() { try { this.ws && this.ws.close(); } catch {} this.ws = null; }
}

const phones = Array.from({ length: PHONES }, (_, i) => new Phone(i));
const end = Date.now() + SECONDS * 1000;
console.log(`${PHONES} phones for ${SECONDS} s against ${BASE}`);

async function life(p) {
  await sleep(Math.random() * 8000);
  while (Date.now() < end) {
    try {
      if (!p.code || !p.ws) {
        if (p.code && !p.ws && chance(0.8)) { await p.open(p.code); continue; }          // comes back to the same table
        p.host = null;
        if (chance(0.15)) {                                                               // a friends' room, a few friends follow
          await p.create(pick(GAMES));
          for (const f of phones.filter((x) => x !== p && !x.code).slice(0, 1 + ((Math.random() * 2) | 0))) { f.game = p.game; f.host = null; await f.open(p.code); }
          await sleep(2500); p.send({ t: "start" });
        } else await p.quick(pick(GAMES));
      }
      await sleep(2000 + Math.random() * 6000);
      const r = Math.random();
      if (r < 0.06) { counts.drops++; const code = p.code; p.close(); p.code = code; await sleep(1000 + Math.random() * 12_000); }   // network drop, comes back
      else if (r < 0.08) { counts.tabs++; const code = p.code; if (code) await p.open(code); }      // a second tab / reconnect replaces the first
      else if (r < 0.11) { counts.leaves++; p.send({ t: "leave" }); p.close(); p.code = null; }   // leaves for another game
      else if (r < 0.13) p.send(pick([{ t: "act", ids: [999] }, { t: "seat", seat: 9 }, { t: "zzz" }, { t: "act", kind: "pass" }, { t: "nudge" }, { t: "hold" }]));
    } catch (e) { console.log("  (phone error)", e.message); await sleep(2000); }
  }
}

// the referee: a table where nothing changed for too long while a phone is in it and the game is on
const watch = setInterval(() => {
  const now = Date.now();
  for (const p of phones) {
    const t = p.t;
    if (!p.ws || !p.code || !t || (t.phase !== "play" && t.phase !== "over")) continue;
    // like net.js on a real page: a move overdue on the server's clock gets a nudge
    if (t.phase === "play" && t.due && now + (p.skew || 0) > t.due + 4000 && now - p.heard > 3000 && now - (p.nudged || 0) > 5000) { p.nudged = now; p.send({ t: "nudge" }); }
    if (p.lastChange && now - p.lastChange > FROZEN_MS) { fail(`${p.game} ${p.code}: frozen for ${((now - p.lastChange) / 1000) | 0} s (phase ${t.phase}/${t.step}, actor ${t.actor})`); p.lastChange = now; }
  }
}, 2000);

await Promise.all(phones.map(life));
clearInterval(watch);
phones.forEach((p) => p.close());
console.log(`\nmoves sent ${counts.moves}, tables ${counts.tables.size}, drops ${counts.drops}, second tabs ${counts.tabs}, leaves ${counts.leaves}`);
console.log("refusals from the server (expected for junk / late moves):", JSON.stringify(counts.errors));
console.log(problems.length ? `\n${problems.length} problems` : "\nno problems");
process.exit(problems.length ? 1 : 0);
