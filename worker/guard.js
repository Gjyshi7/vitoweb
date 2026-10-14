// Guard: one Durable Object for the whole site ("the kill switch").
// Counts new rooms per UTC day and refuses new ones above MAX_NEW_ROOMS_PER_DAY,
// or always when PAUSE_NEW_ROOMS = "1". Rooms already open keep working either way.
// Cloudflare has no spending cap, so this is our own brake against a bug or abuse burning the quota.
import { DurableObject } from "cloudflare:workers";

const DAYS_KEPT = 14;

export class Guard extends DurableObject {
  // Returns { ok, reason?, count }.
  async allowRoom(game, max, paused) {
    const day = new Date().toISOString().slice(0, 10);
    const key = "d:" + day;
    const d = (await this.ctx.storage.get(key)) || { total: 0, blocked: 0, games: {} };
    let res;
    if (paused) res = { ok: false, reason: "paused" };
    else if (d.total >= max) res = { ok: false, reason: "cap" };
    else res = { ok: true };
    if (res.ok) {
      d.total += 1;
      d.games[game] = (d.games[game] || 0) + 1;
    } else d.blocked += 1;
    await this.ctx.storage.put(key, d);
    if (d.total === 1 || d.blocked === 1) await this.prune();
    return { ...res, count: d.total };
  }

  async stats() {
    const all = await this.ctx.storage.list({ prefix: "d:" });
    const days = {};
    for (const [k, v] of all) days[k.slice(2)] = v;
    return days;
  }

  async prune() {
    const all = await this.ctx.storage.list({ prefix: "d:" });
    const keys = [...all.keys()].sort();
    const drop = keys.slice(0, Math.max(0, keys.length - DAYS_KEPT));
    if (drop.length) await this.ctx.storage.delete(drop);
  }
}
