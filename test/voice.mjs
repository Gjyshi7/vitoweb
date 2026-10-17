// Hold-to-talk on the server (worker/room.js voice()): run against wrangler dev or the live site.
//   BASE=http://localhost:8787 node test/voice.mjs
// Checks: a frame from the player whose turn it is reaches the other phones of a friends' table (with the seat
// filled in), and nothing else gets through: not off-turn, not at a quick-match table, not to old pages,
// not malformed. Frames never touch the table's state, and the game goes on as before.
const BASE = (process.env.BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const WS = BASE.replace(/^http/, "ws");
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { M } = await import(new URL("../worker/gen/murlan-engine.js", import.meta.url));

function phone(code, name, { host = "", vc = true } = {}) {
  const q = new URLSearchParams({ name, k: crypto.randomUUID(), v: "2" });
  if (host) q.set("host", host);
  if (vc) q.set("vc", "1");
  const ws = new WebSocket(`${WS}/ws/${code}?${q}`);
  ws.binaryType = "arraybuffer";
  const p = { ws, name, S: null, states: 0, bins: [], errors: [] };
  ws.onmessage = (e) => {
    if (typeof e.data !== "string") { p.bins.push(new Uint8Array(e.data)); return; }
    const m = JSON.parse(e.data);
    if (m.t === "state") { p.S = m; p.states++; }
    if (m.t === "error") p.errors.push(m.e);
  };
  p.open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  p.send = (o) => ws.send(JSON.stringify(o));
  p.until = async (pred, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (p.S && pred(p.S)) return true; await sleep(25); } return false; };
  p.close = () => { try { ws.close(); } catch {} };
  return p;
}
const frame = (n = 200, flags = 0, magic = 0x56) => { const b = new Uint8Array(5 + n); b[0] = magic; b[1] = 1; b[2] = 255; b[3] = flags; b[4] = 1; for (let i = 0; i < n; i++) b[5 + i] = (i * 7) & 0xff; return b.buffer; };

async function friends(game, people) {
  console.log(`${game}: friends' room, ${people} people, only us`);
  const c = await (await fetch(BASE + "/api/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game }) })).json();
  const ps = [phone(c.code, "Ana", { host: c.hostToken }), phone(c.code, "Beni"), phone(c.code, "Cela", { vc: false })].slice(0, people);
  for (const p of ps) await p.open;
  await ps[0].until((S) => S.tbl && S.tbl.seats.filter(Boolean).length === people);
  ps[0].send({ t: "only", v: true });
  await sleep(200);
  ps[0].send({ t: "start" });
  ok(await ps[0].until((S) => S.tbl.phase === "play" && S.tbl.actor >= 0, 12000), "the game starts");
  // wait until a person is the one to move
  let spk = null;
  for (let i = 0; i < 600 && !spk; i++) { spk = ps.find((p) => p.S.tbl.actor === p.S.tbl.me && p.S.tbl.me >= 0); if (!spk) await sleep(50); }
  ok(!!spk, "someone's turn");
  if (!spk) { console.log("    ", JSON.stringify(ps.map((p) => ({ me: p.S.tbl.me, actor: p.S.tbl.actor, step: p.S.tbl.step, phase: p.S.tbl.phase, list: p.S.tbl.seatList })))); ps.forEach((p) => p.close()); return; }
  const others = ps.filter((p) => p !== spk), seat = spk.S.tbl.me, seq = spk.S.tbl.seq;
  const before = others.map((p) => p.states);
  for (let i = 0; i < 8; i++) spk.ws.send(frame());
  spk.ws.send(frame(40, 1));
  await sleep(500);
  const withVc = others.filter((p) => p.name !== "Cela"), noVc = others.filter((p) => p.name === "Cela");
  ok(withVc.every((p) => p.bins.length === 9), `the others hear it (${withVc.map((p) => p.bins.length).join(", ")} of 9 frames)`);
  ok(withVc.every((p) => p.bins.every((b) => b[2] === seat && b[0] === 0x56)), "with the speaker's seat filled in by the server");
  ok(withVc.every((p) => p.bins[8][3] === 1 && p.bins[8].length === 45), "the last frame says it's the last, the sound arrives whole");
  ok(spk.bins.length === 0, "the speaker doesn't get their own voice back");
  ok(noVc.every((p) => p.bins.length === 0), "an old page (no voice) gets nothing it can't read");
  ok(others.every((p, i) => p.states === before[i]) && spk.S.tbl.seq === seq, "frames don't touch the table: no new state, same seq");
  // off turn, malformed, too big
  const off = others[0], n0 = spk.bins.length + withVc.reduce((a, p) => a + p.bins.length, 0);
  off.ws.send(frame());
  spk.ws.send(frame(20, 0, 0x41));
  spk.ws.send(frame(7000));
  await sleep(400);
  ok(spk.bins.length + withVc.reduce((a, p) => a + p.bins.length, 0) === n0, "off-turn, malformed and oversized frames go nowhere");
  ok(ps.every((p) => p.errors.length === 0), "and nobody gets an error for it");
  // the game still moves: the speaker plays their turn (right after the deal the turn starts once the phones have shown it)
  let moved = false;
  for (let k = 0; k < 30 && !moved; k++) {           // a refused move ("wait": the hand is still settling) is tried again
    const t = spk.S.tbl;
    if (game === "derri") spk.send({ t: "act", step: "pick", idx: 0, turn: t.turnStart });
    else { const s = t.snap, mv = M.allMoves(s.hand, s.top, s.must3).sort((x, y) => M.size(x) - M.size(y) || x.r - y.r)[0]; spk.send({ t: "act", step: t.step, ids: mv ? M.cardsFor(s.hand, mv, s.must3) : null }); }
    moved = await spk.until((S) => S.tbl.seq > seq, 700);
  }
  ok(moved, "the game goes on after talking");
  if (!moved) console.log("    errors:", JSON.stringify(spk.errors), JSON.stringify({ step: spk.S.tbl.step, actor: spk.S.tbl.actor, me: spk.S.tbl.me, seq: spk.S.tbl.seq, seq0: seq }));
  ps.forEach((p) => p.close());
}

async function quick() {
  console.log("quick match: no voice");
  const body = JSON.stringify({ game: "derri", cfg: { n: 4 } });
  const q = await (await fetch(BASE + "/api/quick", { method: "POST", headers: { "content-type": "application/json" }, body })).json();
  const a = phone(q.code, "Një"), b = phone(q.code, "Dy");
  await a.open; await b.open;
  ok(await a.until((S) => S.tbl && S.tbl.phase === "play" && S.tbl.actor >= 0, 15000), "the public table plays");
  let mine = 0;
  for (let i = 0; i < 160 && !(mine > 4); i++) {   // both phones keep talking; whenever one of them has the turn it counts
    for (const p of [a, b]) { if (p.S.tbl.actor === p.S.tbl.me) mine++; p.ws.send(frame()); }
    await sleep(250);
  }
  ok(mine > 0 && a.bins.length + b.bins.length === 0, `a frame at a quick-match table reaches nobody (${mine} sent on a turn)`);
  a.close(); b.close();
}

await friends("derri", 3);
await friends("murlan", 2);
await quick();
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
