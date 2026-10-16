// A copy of the site's usage numbers in D1, so they can be read at any time (the dashboard, or a query):
//   usage_days    one row per UTC day: the same record the dashboard shows (Guard storage "u:YYYY-MM-DD")
//   usage_tables  one row per table when it closes: what that table cost, how long it ran, who sat there
//   SELECT * FROM usage_tables ORDER BY at DESC LIMIT 20;
// Never throws: usage numbers are for us, a game must never wait on them.
let ready = false;
async function db(env) {
  if (!env || !env.DB) return null;
  if (!ready) {
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS usage_days (day TEXT PRIMARY KEY, data TEXT, at INTEGER)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS usage_tables (at INTEGER, game TEXT, phase TEXT, room TEXT, req INTEGER, msg INTEGER, rows INTEGER, conn INTEGER, secs INTEGER, people INTEGER, seats INTEGER, hands INTEGER, only INTEGER)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS usage_tables_at ON usage_tables (at)"),
    ]);
    ready = true;
  }
  return env.DB;
}

export async function mirrorDay(env, day, d) {
  try {
    const D = await db(env); if (!D) return;
    await D.prepare("INSERT INTO usage_days (day, data, at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data, at = excluded.at")
      .bind(day, JSON.stringify(d), Date.now()).run();
  } catch (e) { console.error("usage mirror failed", e && e.message); }
}

export async function mirrorTable(env, rec) {
  try {
    const D = await db(env); if (!D) return;
    await D.batch([
      D.prepare("INSERT INTO usage_tables (at, game, phase, room, req, msg, rows, conn, secs, people, seats, hands, only) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(Date.now(), rec.game, rec.phase, rec.room, rec.req | 0, rec.msg | 0, rec.rows | 0, rec.conn | 0, rec.secs | 0, rec.people | 0, rec.seats | 0, rec.hands | 0, rec.only ? 1 : 0),
      D.prepare("DELETE FROM usage_tables WHERE at < ?").bind(Date.now() - 60 * 86400_000),
    ]);
  } catch (e) { console.error("usage table mirror failed", e && e.message); }
}
