// VitoWeb Loja — Worker entry.
// The pages and games in ../public are served by Cloudflare's static assets before this code runs.
// This code only runs for /api/* and /ws/* (see run_worker_first in wrangler.toml):
//   POST /api/create            {game, cfg}  -> {code, hostToken, game}   new private room
//   POST /api/quick             {game, cfg}  -> {code, game}              a public table to sit at (quick match)
//   GET  /api/room/CODE                 -> {ok, game}                does the room exist, which game
//   GET  /ws/CODE?name=&k=&host=        -> websocket into the room
//   GET  /api/health                    -> {ok}
//   GET  /api/admin/stats?key=ADMIN_KEY -> rooms per day (only if the ADMIN_KEY secret is set)
import { Room, GAMES } from "./room.js";
import { Guard } from "./guard.js";
import { json, roomCode, secretId, safeEqual } from "./util.js";

export { Room, Guard };

const COOKIE = "vw_id";
const KEY_RE = /^[a-z0-9-]{16,64}$/i;

function readCookie(req) {
  const m = (req.headers.get("Cookie") || "").match(/(?:^|;\s*)vw_id=([a-f0-9]{32})(?:;|$)/);
  return m ? m[1] : null;
}
function cookieHeader(id, url) {
  // Secure only on https, so `wrangler dev` on http://<your-mac-ip>:8787 still works from phones.
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${id}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax${secure}`;
}
// Requests from other websites are refused (no cross-site room creation or socket hijacking).
function badOrigin(req, url) {
  const o = req.headers.get("Origin");
  if (!o || o === "null") return false;
  try { return new URL(o).host !== url.host; } catch { return true; }
}
async function limited(binding, key) {
  if (!binding) return false; // binding missing: don't break the site, just skip
  try { return !(await binding.limit({ key })).success; } catch { return false; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      return await route(req, env, url);
    } catch (e) {
      console.error("worker error", e && e.stack || e);
      return json({ error: "server" }, 500);
    }
  },
};

async function newRoom(env, game, opts) {
  const guard = env.GUARD.get(env.GUARD.idFromName("guard"));
  const max = Number(env.MAX_NEW_ROOMS_PER_DAY) || 2000;
  const paused = String(env.PAUSE_NEW_ROOMS || "0") === "1";
  const gate = await guard.allowRoom(game, max, paused);
  if (!gate.ok) return { error: gate.reason === "paused" ? "paused" : "busy" };
  for (let i = 0; i < 8; i++) {
    const code = roomCode();
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const r = await stub.init(code, game, opts);
    if (r) return { code, game, hostToken: r.hostToken };
  }
  return { error: "busy" };
}

async function route(req, env, url) {
  const path = url.pathname;
  const ip = req.headers.get("CF-Connecting-IP") || "local";
  let gid = readCookie(req);
  const setCookie = gid ? null : (gid = secretId());
  const withCookie = (res) => {
    if (!setCookie) return res;
    const r = new Response(res.body, res);
    r.headers.append("Set-Cookie", cookieHeader(setCookie, url));
    return r;
  };

  if (path === "/api/health") return json({ ok: true });

  if (path.startsWith("/ws/")) {
    const m = path.match(/^\/ws\/([A-Z]{4})$/);
    if (!m) return new Response("Not found", { status: 404 });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
    if (badOrigin(req, url)) return new Response("Forbidden", { status: 403 });
    // Who is this phone? The cookie if the browser sent one, else the key the page keeps in localStorage.
    const cookieId = readCookie(req);
    const k = url.searchParams.get("k") || "";
    const alt = KEY_RE.test(k) ? "k:" + k : "";
    const key = cookieId ? "c:" + cookieId : alt;
    if (!key) return new Response("Missing key", { status: 400 });
    if (await limited(env.RL_IP, "ip:" + ip)) return new Response("Too many requests", { status: 429 });
    if (await limited(env.RL_JOIN, "ws:" + key)) return new Response("Too many requests", { status: 429 });
    const h = new Headers(req.headers);
    h.set("x-vw-key", key);
    if (alt && alt !== key) h.set("x-vw-alt", alt); else h.delete("x-vw-alt");
    const stub = env.ROOM.get(env.ROOM.idFromName(m[1]));
    return stub.fetch(new Request(req.url, { headers: h }));
  }

  if (path === "/api/create") {
    if (req.method !== "POST") return json({ error: "method" }, 405);
    if (badOrigin(req, url)) return json({ error: "origin" }, 403);
    if (await limited(env.RL_IP, "ip:" + ip)) return withCookie(json({ error: "slow_down" }, 429));
    if (await limited(env.RL_CREATE, "create:" + (readCookie(req) || ip))) return withCookie(json({ error: "slow_down" }, 429));
    let body = {};
    try { body = await req.json(); } catch {}
    const game = String(body.game || "");
    if (!GAMES[game]) return withCookie(json({ error: "bad_game" }, 400));
    const cfg = body.cfg && typeof body.cfg === "object" ? body.cfg : {};
    const r = await newRoom(env, game, { cfg });
    return withCookie(json(r, r.code ? 200 : 503));
  }

  // quick match: an open public table with the same settings, or a new one that others will find
  if (path === "/api/quick") {
    if (req.method !== "POST") return json({ error: "method" }, 405);
    if (badOrigin(req, url)) return json({ error: "origin" }, 403);
    if (await limited(env.RL_IP, "ip:" + ip)) return withCookie(json({ error: "slow_down" }, 429));
    if (await limited(env.RL_CREATE, "quick:" + (readCookie(req) || ip))) return withCookie(json({ error: "slow_down" }, 429));
    let body = {};
    try { body = await req.json(); } catch {}
    const game = String(body.game || "");
    if (!GAMES[game] || !GAMES[game].canJoin) return withCookie(json({ error: "bad_game" }, 400));
    const cfg = GAMES[game].init({ cfg: body.cfg && typeof body.cfg === "object" ? body.cfg : {} }).cfg;
    const key = game + ":" + JSON.stringify(cfg);
    const guard = env.GUARD.get(env.GUARD.idFromName("guard"));
    const open = await guard.findPublic(key);
    if (open) {
      const info = await env.ROOM.get(env.ROOM.idFromName(open)).info();
      if (info.ok && info.open) return withCookie(json({ code: open, game }));
      await guard.closePublic(key, open);
    }
    const r = await newRoom(env, game, { cfg, public: true });
    if (!r.code) return withCookie(json(r, 503));
    await guard.addPublic(key, r.code);
    return withCookie(json({ code: r.code, game }));
  }

  const rm = path.match(/^\/api\/room\/([A-Z]{4})$/);
  if (rm) {
    if (await limited(env.RL_IP, "ip:" + ip)) return withCookie(json({ error: "slow_down" }, 429));
    const stub = env.ROOM.get(env.ROOM.idFromName(rm[1]));
    return withCookie(json(await stub.info()));
  }

  if (path === "/api/admin/stats") {
    const want = env.ADMIN_KEY;
    const got = url.searchParams.get("key") || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!want || !(await safeEqual(want, got))) return json({ error: "not_found" }, 404);
    const guard = env.GUARD.get(env.GUARD.idFromName("guard"));
    return json({
      days: await guard.stats(),
      maxNewRoomsPerDay: Number(env.MAX_NEW_ROOMS_PER_DAY) || 2000,
      paused: String(env.PAUSE_NEW_ROOMS || "0") === "1",
    });
  }

  return json({ error: "not_found" }, 404);
}
