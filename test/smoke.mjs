// Room server smoke test: fake phones play Mafia and Imposter against a running copy of the site.
//   Local:     npx wrangler dev        then   npm test
//   Deployed:  BASE=https://vitoweb-loja.<you>.workers.dev npm test
// Needs Node 22+ (built-in WebSocket). Creates 2 rooms; they delete themselves after 6 idle hours.
const BASE = (process.env.BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const WS = BASE.replace(/^http/, "ws");
const WORDS = (await import(new URL("../public/imposter-words.js", import.meta.url))).WORDS;

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log("  ✓ " + label); }
  else { failed++; console.log("  ✗ " + label); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = () => crypto.randomUUID();

async function create(game) {
  const r = await fetch(BASE + "/api/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game }) });
  return { status: r.status, ...(await r.json()) };
}

function phone(code, name, { k = key(), host = "" } = {}) {
  const q = new URLSearchParams({ name, k });
  if (host) q.set("host", host);
  const ws = new WebSocket(`${WS}/ws/${code}?${q}`);
  const p = { ws, k, name, S: null, msgs: [], closed: null, kicked: false };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    p.msgs.push(m);
    if (m.t === "state") p.S = m;
    if (m.t === "kicked") p.kicked = true;
  };
  ws.onclose = (e) => { p.closed = e.code; };
  p.send = (o) => ws.send(JSON.stringify(o));
  p.until = async (pred, label, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (p.S && pred(p.S)) return true; await sleep(20); }
    console.log(`    (timeout waiting: ${label} for ${name})`);
    return false;
  };
  p.open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  p.close = () => { try { ws.close(); } catch {} };
  return p;
}

async function murlan() {
  console.log("Murlan (shared table server)");
  const { M } = await import(new URL("../worker/gen/murlan-engine.js", import.meta.url));
  const c = await create("murlan");
  ok(c.status === 200 && c.game === "murlan", `create room (${c.code})`);
  const a = phone(c.code, "Ana", { host: c.hostToken });
  await a.open;
  const b = phone(c.code, "Beni");
  await b.open;
  ok(await a.until((S) => S.tbl && S.tbl.seats.filter(Boolean).length === 2, "2 seats"), "2 phones sit down");
  b.send({ t: "seat", seat: 2 });
  ok(await a.until((S) => S.tbl.seats[2] && S.tbl.seats[2].name === "Beni", "seat 2"), "a phone can move to its partner's seat");
  a.send({ t: "start" });
  ok(await a.until((S) => S.tbl.phase === "play" && S.tbl.seats.every(Boolean), "4 seats", 8000), "empty seats filled, cards dealt");
  const t = a.S.tbl;
  ok(t.snap.hand.length >= 13 && t.snap.counts.reduce((x, y) => x + y, 0) === 54, "own hand + counts add up to 54");
  ok(!JSON.stringify(a.S).includes('"bot"') && !JSON.stringify(a.S).includes('"priv"'), "nothing on the wire says bot, nothing private leaks");
  ok(a.S.players.length === 4, "player list shows all 4 seats");
  const late = phone(c.code, "Vonë");
  ok(await late.open.then(() => sleep(400)).then(() => late.closed === 4005 || late.msgs.some((m) => m.t === "refused")), "a 5th phone can't join a running table");

  let leak = false, plays = 0;
  const playTurn = (p) => {
    const t = p.S && p.S.tbl;
    if (!t || t.phase !== "play" || t.actor !== t.me || p.sent === t.seq + t.step) return;
    p.sent = t.seq + t.step;
    const s = t.snap;
    if (t.step === "gift") return p.send({ t: "act", step: "gift", card: s.hand.find((x) => x < 32) ?? s.hand[0] });
    const moves = M.allMoves(s.hand, s.top, s.must3);
    if (!moves.length) return p.send({ t: "act", step: "turn", ids: null });
    const mv = moves.sort((x, y) => M.size(x) - M.size(y) || x.r - y.r)[0];
    p.send({ t: "act", step: "turn", ids: M.cardsFor(s.hand, mv, s.must3) }); plays++;
  };
  const t0 = Date.now();
  let ended = false;
  while (Date.now() - t0 < 300000) {
    for (const p of [a, b]) {
      const t = p.S && p.S.tbl;
      if (t && (t.log || []).some((e) => e.k === "deal" && e.hands)) leak = true;
      playTurn(p);
    }
    if ((a.S.tbl.log || []).some((e) => e.k === "end")) { ended = true; break; }
    await sleep(60);
  }
  const deal = (S) => (S.tbl.log || []).find((e) => e.k === "deal");
  ok(ended, `a full hand is played to the end (${plays} plays by the phones)`);
  ok(!leak && deal(a.S) && deal(b.S) && JSON.stringify(deal(a.S).hand) !== JSON.stringify(deal(b.S).hand), "each phone only gets its own deal");
  b.send({ t: "act", step: "turn", ids: [999] });
  await sleep(300);
  ok(b.msgs.some((x) => x.t === "error"), "bad moves are refused");
  b.close();
  ok(await a.until((S) => S.players.length === 4, "still 4"), "a phone that leaves keeps its seat at the table");
  a.close(); late.close();
}

async function quick() {
  console.log("Quick match");
  const q = await (await fetch(BASE + "/api/quick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game: "domino", cfg: { teams: true } }) })).json();
  ok(/^[A-Z]{4}$/.test(q.code), `quick match gives a table (${q.code})`);
  const q2 = await (await fetch(BASE + "/api/quick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game: "domino", cfg: { teams: true } }) })).json();
  ok(q2.code === q.code, "a second phone is sent to the same open table");
  const q3 = await (await fetch(BASE + "/api/quick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game: "domino", cfg: { teams: false } }) })).json();
  ok(q3.code !== q.code, "other settings get another table");
  const solo = phone(q3.code, "Vetëm");
  await solo.open;
  ok(await solo.until((S) => S.tbl && S.tbl.seats.filter(Boolean).length === 2, "one more", 9000), "players sit down one at a time");
  // one person alone: after the lobby the table moves onto the phone (same players), the server steps out
  ok(await solo.until((S) => S.tbl && S.tbl.phase === "solo", "solo", 25000), "alone at the table: it moves onto the phone after the lobby");
  ok(solo.S.tbl.seats.filter(Boolean).length === 2, "the phone gets every seat's player to play with");
  solo.close();
  // two people: the match stays on the server, and someone who comes right after the deal still gets in
  const four = await (await fetch(BASE + "/api/quick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game: "domino", cfg: { teams: true, target: 90 } }) })).json();
  const p1 = phone(four.code, "Një"), p2 = phone(four.code, "Dy");
  await p1.open; await p2.open;
  ok(await p1.until((S) => S.tbl && S.tbl.phase === "play", "play", 25000), "two people: the table fills and the match starts on the server");
  const q4 = await (await fetch(BASE + "/api/quick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game: "domino", cfg: { teams: true, target: 90 } }) })).json();
  ok(q4.code === four.code, "someone new is sent to the match in progress");
  const late = phone(q4.code, "Vonë");
  await late.open;
  ok(await late.until((S) => S.tbl && S.tbl.me >= 0 && S.tbl.snap && S.tbl.snap.hand && S.tbl.snap.hand.length > 0, "seat"), "they take over a seat, cards and all");
  ok(await p1.until((S) => S.tbl.seats.some((x) => x && x.name === "Vonë"), "name"), "the other phones see them at the table");
  p1.close(); p2.close();
  const pr = await (await fetch(BASE + "/api/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ where: "murlan", state: "menu", hist: { murlan: 3 } }) })).json();
  ok(typeof pr.all === "number" && pr.all >= 1, `presence answers with a count (${pr.all})`);
  late.close();
}

async function mafia() {
  console.log("Mafia");
  const c = await create("mafia");
  ok(c.status === 200 && /^[A-Z]{4}$/.test(c.code) && c.game === "mafia", `create room (${c.code})`);
  const host = phone(c.code, "Hosti", { host: c.hostToken });
  await host.open;
  const names = ["Ana", "Beni", "Drita", "Gëzim", "Erion"];
  const ps = names.map((n) => phone(c.code, n));
  await Promise.all(ps.map((p) => p.open));
  ok(await host.until((S) => S.players.length === 6, "6 players"), "6 phones in the room");
  ok(host.S.hostPid === host.S.me, "creator is host");
  ok(host.S.seatCount === 5 && !host.S.hostPlays, "host is narrator by default (5 roles)");

  host.send({ t: "config", config: { mafia: 3, doctor: 1, police: 1 } });
  ok(await host.until((S) => S.configError === "mafia_majority", "majority"), "refuses mafia majority");
  host.send({ t: "config", config: { mafia: 1, doctor: 1, police: 1 } });
  await host.until((S) => !S.configError && S.config.mafia === 1, "config ok");
  ps[0].send({ t: "deal" }); // a guest can't deal
  await sleep(200);
  ok(ps[0].S.phase === "lobby", "a guest can't deal");
  host.send({ t: "deal" });
  ok(await host.until((S) => S.phase === "dealt", "dealt"), "host deals");
  await Promise.all(ps.map((p) => p.until((S) => S.phase === "dealt" && S.role, "role")));
  const roles = ps.map((p) => p.S.role);
  const count = (r) => roles.filter((x) => x === r).length;
  ok(count("mafia") === 1 && count("doctor") === 1 && count("police") === 1 && count("villager") === 2, "1 mafia, 1 doctor, 1 police, 2 villagers");
  ok(ps.every((p) => p.S.allRoles === null), "no player sees other roles");
  ok(host.S.role === null && host.S.allRoles && Object.keys(host.S.allRoles).length === 5, "narrator sees the whole table");
  ok(ps.every((p) => !JSON.stringify(p.S).includes(p.k)), "secret keys never sent to phones");

  // Security: knowing someone's public seat id must not let you become them.
  const victim = ps.find((p) => p.S.role === "police");
  const fake = phone(c.code, "Hajni", { k: victim.S.me });
  ok(!(await fake.open.then(() => true, () => false)), "a public seat id can't be used as a login key");
  const thief = phone(c.code, "Hajni");
  await thief.open;
  await thief.until((S) => S.players.length === 7, "thief joined");
  ok(thief.S.me !== victim.S.me && thief.S.role === null && thief.S.allRoles === null, "a new phone gets its own seat and no one else's role");
  host.send({ t: "kick", pid: thief.S.me });
  await sleep(300);
  ok(thief.kicked && !host.S.players.some((x) => x.pid === thief.S.me), "host can kick (phone told, seat removed)");

  // Reconnect keeps the seat and the role.
  const r0 = ps[1];
  const seat = r0.S.me, role = r0.S.role;
  r0.close();
  await sleep(200);
  ok(await host.until((S) => S.players.find((x) => x.pid === seat)?.online === false, "offline"), "others see a dropped phone as offline");
  const again = phone(c.code, r0.name, { k: r0.k });
  await again.open;
  ok(await again.until((S) => S.me === seat && S.role === role, "same seat"), "reconnecting phone gets the same seat and role");

  // A second tab for the same phone replaces the first.
  const dup = phone(c.code, again.name, { k: again.k });
  await dup.open;
  await sleep(300);
  ok(again.msgs.some((m) => m.t === "replaced") && dup.S && dup.S.me === seat, "a second tab takes over the seat (old one told to stop)");

  // Host drops: another player can take over after the grace period (60 s), not before.
  ps[2].send({ t: "claimHost" });
  await sleep(200);
  ok(ps[2].msgs.some((m) => m.t === "error" && m.e === "host_online"), "can't take host while the host is connected");

  host.send({ t: "reveal" });
  ok(await ps[0].until((S) => S.phase === "revealed" && S.allRoles, "revealed"), "reveal shows everyone the table");

  // Message flood: extra messages are dropped, the socket stays open.
  for (let i = 1; i <= 45; i++) ps[3].send({ t: "rename", name: "Flood" + i });
  await sleep(500);
  const me3 = ps[3].S.players.find((x) => x.pid === ps[3].S.me);
  ok(ps[3].closed === null && me3.name === "Flood40", `flood capped at 40 messages / 10 s (last applied: ${me3.name})`);

  [host, ...ps, again, dup, thief].forEach((p) => p.close());
}

async function imposter() {
  console.log("Imposter");
  const c = await create("imposter");
  ok(c.status === 200 && c.game === "imposter", `create room (${c.code})`);
  const host = phone(c.code, "Hosti", { host: c.hostToken });
  await host.open;
  const ps = [host, ...["Ana", "Beni", "Drita"].map((n) => phone(c.code, n))];
  await Promise.all(ps.map((p) => p.open));
  await host.until((S) => S.players.length === 4, "4 players");
  host.send({ t: "config", config: { cats: ["Kafshë"], imps: 1, hint: false, time: 120 } });
  await host.until((S) => S.cfg.cats.join() === "Kafshë" && S.cfg.time === 120 && !S.cfg.hint, "config");
  ps[1].send({ t: "config", config: { cats: ["Sport"] } });
  await sleep(200);
  ok(host.S.cfg.cats.join() === "Kafshë", "a guest can't change settings");

  host.send({ t: "deal" });
  await Promise.all(ps.map((p) => p.until((S) => S.phase === "cards" && S.card, "card")));
  const imps = ps.filter((p) => p.S.card.imp), crew = ps.filter((p) => !p.S.card.imp);
  const word = crew[0].S.card.word;
  ok(imps.length === 1 && crew.length === 3, "1 imposter, 3 with the word");
  ok(crew.every((p) => p.S.card.word === word) && WORDS["Kafshë"].includes(word), `everyone else has the same word (${word})`);
  ok(imps[0].S.card.cat === null && !imps[0].S.card.word, "hint off: imposter gets no category");
  ok(!JSON.stringify(imps[0].S).includes(word), "the word appears nowhere in the imposter's data");

  const late = phone(c.code, "Vonë");
  await late.open;
  await late.until((S) => S.players.length === 5, "late");
  ok(late.S.card === null && !late.S.holders.includes(late.S.me) && !JSON.stringify(late.S).includes(word), "late joiner waits, sees no word");

  ps.forEach((p) => p.send({ t: "seen" }));
  ok(await host.until((S) => S.phase === "talk", "talk"), "talk starts when everyone has looked");
  const left = Math.round((host.S.timer.ends - host.S.now) / 1000);
  ok(!host.S.timer.paused && left >= 118 && left <= 120, `server timer running (${left} s)`);
  host.send({ t: "pause" });
  ok(await host.until((S) => S.timer.paused && S.timer.left >= 118, "paused"), "host pauses the timer");

  const before = host.S.timer.left;
  host.send({ t: "more" });
  ok(await host.until((S) => !S.timer.paused && S.timer.left === before + 60, "more"), "+1 minute adds 60 s and restarts the clock");
  ok(!imps[0].S.result && !JSON.stringify(imps[0].S).includes(word), "while they talk, nothing reveals the imposter");
  ps[1].send({ t: "reveal" });
  await sleep(200);
  ok(host.S.phase === "talk", "a guest can't reveal");
  host.send({ t: "reveal" });
  ok(await crew[0].until((S) => S.phase === "result", "result"), "host reveals");
  ok(crew[0].S.result.imps.join() === imps[0].S.me && imps[0].S.result.word === word, "after the reveal everyone sees who it was and the word");

  host.send({ t: "lobby" });
  await host.until((S) => S.phase === "lobby", "lobby");
  host.send({ t: "config", config: { imps: 0 } });
  await host.until((S) => S.cfg.imps === 0, "random count");
  host.send({ t: "deal" });
  await Promise.all([...ps, late].map((p) => p.until((S) => S.round === 2 && S.card, "round 2")));
  ok(late.S.card !== null, "late joiner gets a card next round");
  const all = [...ps, late], nImp = all.filter((p) => p.S.card.imp).length;
  ok(nImp >= 1 && nImp <= 2 && all.every((p) => p.S.card.n === null), `"1 ose 2": ${nImp} imposter(s), nobody is told how many`);

  ps[1].send({ t: "leave" });
  await sleep(300);
  ok(ps[1].msgs.some((m) => m.t === "left") && host.S.players.length === 4, "a player can leave");
  [...ps, late].forEach((p) => p.close());
}

async function misc() {
  console.log("Site");
  const j = await (await fetch(BASE + "/api/room/QQQQ")).json();
  ok(j.ok === false, "unknown room code: not found");
  const nr = phone("QQQQ", "X");
  await nr.open.catch(() => {});
  await sleep(300);
  ok(nr.msgs.some((m) => m.t === "refused" && m.code === 4004), "socket to an unknown room is refused (4004)");
  const bad = await fetch(BASE + "/api/create", { method: "POST", headers: { "content-type": "application/json", Origin: "https://evil.example" }, body: '{"game":"mafia"}' });
  ok(bad.status === 403, "create from another website refused");
  const bg = await create("poker");
  ok(bg.status === 400, "unknown game refused");
  const h = await fetch(BASE + "/");
  ok(h.status === 200 && h.headers.get("x-content-type-options") === "nosniff", "hub served with security headers");
  for (const page of ["murlan", "spathi", "derri", "domino", "imposter", "mafia", "imposter-words.js", "cards.js", "engine.js", "favicon.ico"]) {
    const r = await fetch(BASE + "/" + page);
    ok(r.status === 200, `/${page} served`);
  }
}

await murlan();
await quick();
await mafia();
await imposter();
await misc();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
