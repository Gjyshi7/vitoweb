// Incident log: every fault the site healed by itself, and errors reported by the pages.
// Kept in D1 (table `incidents`) so it can be read at any time, and printed to Cloudflare's Logs too.
//   SELECT datetime(at/1000,'unixepoch') t, src, kind, game, room, msg FROM incidents ORDER BY at DESC LIMIT 50;
// Never throws, never blocks the game for long: a storm is capped, repeats within a minute are counted once.
let ready = false;
const recent = new Map();
let winStart = 0, inWin = 0;

export async function logIncident(env, rec) {
  try {
    const line = JSON.stringify(rec);
    console.error("incident", line.slice(0, 1500));
    if (!env || !env.DB) return;
    const now = Date.now();
    if (now - winStart > 60_000) { winStart = now; inWin = 0; }
    if (++inWin > 40) return;
    const key = `${rec.src}|${rec.kind}|${rec.game}|${String(rec.msg).slice(0, 80)}`;
    if (recent.has(key) && now - recent.get(key) < 60_000) return;
    recent.set(key, now);
    if (recent.size > 300) recent.clear();
    if (!ready) {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS incidents (at INTEGER, src TEXT, kind TEXT, game TEXT, room TEXT, msg TEXT, detail TEXT)").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS incidents_at ON incidents (at)").run();
      ready = true;
    }
    // one round trip: the new line, and anything older than 30 days goes (the Privacy Policy promises 30 days)
    await env.DB.batch([
      env.DB.prepare("INSERT INTO incidents (at, src, kind, game, room, msg, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(now, String(rec.src || "server").slice(0, 10), String(rec.kind || "").slice(0, 60), String(rec.game || "").slice(0, 12),
          String(rec.room || "").slice(0, 8), String(rec.msg || "").slice(0, 300), JSON.stringify(rec.detail || {}).slice(0, 2500)),
      env.DB.prepare("DELETE FROM incidents WHERE at < ?").bind(now - 30 * 86400_000),
    ]);
  } catch (e) {
    console.error("incident log failed", e && e.message);
  }
}
