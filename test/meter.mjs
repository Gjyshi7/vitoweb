// Measures what one hour of play costs on Cloudflare, by playing real tables on `wrangler dev --var METER:1`.
//   BASE=http://localhost:8787 LOG=/path/to/wrangler.log node test/meter.mjs [seconds per scenario=150]
// Every billable thing is printed by the server as "METER <kind> <what> <n>" (worker/meter.js); this reads
// the server log between the start and the end of each scenario and turns it into "per player-hour".
// Players here move like people (2.5–5 s per move). The pages' "I'm here" reports are measured separately
// (test/meter-page.py), because only a real page sends them.
import { driveClock } from "./clock.mjs";
import fs from "node:fs";
import { M } from "../worker/gen/murlan-engine.js";
import { S } from "../worker/gen/spathi-engine.js";
import { E as D } from "../worker/gen/derri-engine.js";
import { E as DOM } from "../worker/gen/domino-engine.js";

const BASE = process.env.BASE || "http://localhost:8787", WS = BASE.replace(/^http/, "ws");
const LOG = process.env.LOG;
const SECS = Number(process.argv[2] || 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[(Math.random() * a.length) | 0];

function legal(game, t) {
  const sn = t.snap || {}, me = t.me;
  if (game === "murlan") {
    if (t.step === "gift") { const o = sn.hand.filter((id) => M.rankOf(id) >= 3 && M.rankOf(id) <= 10); return { t: "act", step: "gift", card: o.length ? o[0] : sn.hand[0] }; }
    const moves = M.allMoves(sn.hand, sn.top, sn.must3);
    if (sn.top && (Math.random() < 0.3 || !moves.length)) return { t: "act", step: "turn", ids: null };
    return moves.length ? { t: "act", step: "turn", ids: M.cardsFor(sn.hand, pick(moves), sn.must3) } : null;
  }
  if (game === "spathi") { const card = pick(sn.hand), caps = S.captures(card, sn.table); return { t: "act", step: "turn", card, take: caps.length ? pick(caps) : [] }; }
  if (game === "derri") { const H = { hands: sn.counts.map((n) => new Array(n).fill(0)), order: sn.order || [] }; const src = D.source(H, me); return { t: "act", step: "pick", idx: (Math.random() * Math.max(1, sn.counts[src])) | 0 }; }
  if (game === "domino") {
    const H = { hands: [], start: sn.start, ends: sn.ends, L: sn.L || [], R: sn.R || [], mustOpen: sn.mustOpen }; H.hands[me] = sn.hand;
    const ms = DOM.movesFor(H, me);
    if (ms.length) { const m = pick(ms); return { t: "act", step: "turn", kind: "play", id: m.id, side: m.side }; }
    return { t: "act", step: "turn", kind: sn.boneN > 0 && t.cfg.stock ? "draw" : "pass" };
  }
}

function phone(name, game, cfg) {
  const key = "meter-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const P = { name, ws: null, asked: "", solo: false };
  P.start = async () => {
    const r = await fetch(BASE + "/api/quick", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ game, cfg, k: key }) });
    const j = await r.json();
    const ws = new WebSocket(`${WS}/ws/${j.code}?v=2&name=${name}&k=${key}`, { headers: { origin: BASE } });
    P.ws = ws;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data); if (m.t !== "state" || !m.tbl) return;
      const t = m.tbl;
      driveClock(P, m);
      if (t.phase === "solo") { P.solo = true; return; }       // the table moved onto the phone: no more server traffic
      if (t.vote && !t.vote.mine) ws.send(JSON.stringify({ t: "vote", kind: t.vote.kind, v: t.vote.kind === "again" ? "yes" : "raise" }));
      if (t.phase === "play" && t.actor === t.me && t.step !== "end" && t.step !== "choice") {
        const k = t.seq + ":" + t.step; if (P.asked === k) return; P.asked = k;
        const msg = legal(game, t);
        if (msg) setTimeout(() => { try { ws.send(JSON.stringify(msg)); } catch {} }, 2500 + Math.random() * 2500);
      }
    };
    await new Promise((r) => (ws.onopen = r));
  };
  P.stop = () => { try { P.ws.close(); } catch {} };
  return P;
}

function readMeter(from, to) {
  const fd = fs.openSync(LOG, "r"); const buf = Buffer.alloc(to - from); fs.readSync(fd, buf, 0, to - from, from); fs.closeSync(fd);
  const tot = { worker: 0, do: 0, wsmsg: 0, rows: 0 }, detail = {};
  for (const line of buf.toString().split("\n")) {
    const m = line.match(/METER (\w+) (.+) (\d+)\s*$/); if (!m) continue;
    const n = Number(m[3]); tot[m[1]] = (tot[m[1]] || 0) + n; detail[m[1] + " " + m[2]] = (detail[m[1] + " " + m[2]] || 0) + n;
  }
  return { tot, detail };
}

const SCENARIOS = [
  ["Murlan 2v2, 1 person + 3 players", "murlan", { teams: true }, 1],
  ["Murlan 2v2, 2 people + 2 players", "murlan", { teams: true }, 2],
  ["Murlan 2v2, 4 people", "murlan", { teams: true }, 4],
  ["Derri, 1 person + 3 players", "derri", {}, 1],
  ["Spathi, 1 person + 1 player", "spathi", { target: 21 }, 1],
  ["Domino 2v2, 1 person + 3 players", "domino", { teams: true }, 1],
];
const which = process.env.ONLY ? SCENARIOS.filter((s) => s[0].toLowerCase().includes(process.env.ONLY)) : SCENARIOS;
const results = [];
for (const [label, game, cfg, people] of which) {
  await sleep(3000);
  const from = fs.statSync(LOG).size;
  const ps = Array.from({ length: people }, (_, i) => phone("Meter" + i, game, cfg));
  for (const p of ps) { await p.start(); await sleep(300); }
  await sleep(SECS * 1000);
  ps.forEach((p) => p.stop());
  await sleep(1500);
  const { tot, detail } = readMeter(from, fs.statSync(LOG).size);
  const ph = people * SECS / 3600;                                  // player-hours played
  const per = { worker: tot.worker / ph, do: (tot.do + tot.wsmsg / 20) / ph, rows: tot.rows / ph };
  results.push({ label, per, tot, detail, people });
  console.log(`\n${label}  (${SECS} s${ps.some((p) => p.solo) ? ", moved onto the phone" : ""})`);
  console.log(`  per player-hour: Worker ${per.worker.toFixed(0)} · game-server requests ${per.do.toFixed(0)} · storage rows written ${per.rows.toFixed(0)}`);
  console.log("  measured:", Object.entries(detail).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", "));
}
fs.writeFileSync(process.env.OUT || "/tmp/meter-results.json", JSON.stringify(results, null, 1));
