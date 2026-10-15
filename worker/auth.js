// Accounts: "Hyr me Google" (Google Identity Services), a signed session cookie, usernames, friends, invites.
//
// - The page gets a Google ID token (a signed JWT) from Google's own button and posts it here.
//   We check Google's signature (their public keys), the audience (our client id), issuer and expiry.
// - We keep: Google's account id ("sub"), email, display name, picture, and a username the player picks.
// - Session: an HttpOnly cookie "vw_s" = userId.expiry.HMAC. The HMAC secret is made once and kept in
//   the Guard's storage (or SESSION_SECRET if set as a Worker secret).
// - Friends: one row per direction. A request is a→b "req"; once accepted both rows are "ok".
// Needs: the D1 binding DB and the variable GOOGLE_CLIENT_ID. Without them sign-in is simply hidden.

const SESSION = "vw_s";
const SESSION_DAYS = 180;
const UNAME = /^[\p{L}\p{N}._]{3,16}$/u;
const ISS = ["accounts.google.com", "https://accounts.google.com"];

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const rid = (n = 12) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b64u(b).slice(0, n); };

let schemaReady = false;
async function db(env) {
  if (!env.DB) return null;
  if (!schemaReady) {
    // the live database already has these (made once by hand); this keeps `wrangler dev` working too
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, sub TEXT UNIQUE NOT NULL, email TEXT, name TEXT, uname TEXT UNIQUE COLLATE NOCASE, pic TEXT, created INTEGER, seen INTEGER)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS friends (a TEXT NOT NULL, b TEXT NOT NULL, state TEXT NOT NULL, at INTEGER, PRIMARY KEY (a, b))"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS friends_b ON friends (b)"),
    ]);
    schemaReady = true;
  }
  return env.DB;
}

// ---- session cookie ----
let keyCache = null;
async function hmacKey(env) {
  if (keyCache) return keyCache;
  let secret = env.SESSION_SECRET;
  if (!secret) secret = await env.GUARD.get(env.GUARD.idFromName("guard")).secret();
  keyCache = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return keyCache;
}
async function signSession(env, uid) {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const body = `${uid}.${exp}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(body));
  return `${body}.${b64u(sig)}`;
}
async function readSession(env, req) {
  const m = (req.headers.get("Cookie") || "").match(/(?:^|;\s*)vw_s=([A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]+)(?:;|$)/);
  if (!m) return null;
  const [uid, exp, sig] = m[1].split(".");
  if (Number(exp) < Date.now()) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), unb64u(sig), enc.encode(`${uid}.${exp}`));
    return ok ? uid : null;
  } catch { return null; }
}
export function sessionCookie(value, url, clear) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return clear ? `${SESSION}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
    : `${SESSION}=${value}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`;
}

// ---- Google ID token ----
let jwks = { keys: null, until: 0 };
async function googleKeys() {
  if (jwks.keys && jwks.until > Date.now()) return jwks.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!r.ok) throw new Error("google keys " + r.status);
  const age = Number(((r.headers.get("Cache-Control") || "").match(/max-age=(\d+)/) || [])[1]) || 3600;
  jwks = { keys: (await r.json()).keys || [], until: Date.now() + Math.min(age, 6 * 3600) * 1000 };
  return jwks.keys;
}
export async function verifyGoogle(token, clientId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !clientId) return null;
  let head, claims;
  try { head = JSON.parse(new TextDecoder().decode(unb64u(parts[0]))); claims = JSON.parse(new TextDecoder().decode(unb64u(parts[1]))); } catch { return null; }
  if (head.alg !== "RS256") return null;
  const jwk = (await googleKeys()).find((k) => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64u(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  if (!ok) return null;
  const now = Date.now() / 1000;
  if (!ISS.includes(claims.iss) || claims.aud !== clientId || !(claims.exp > now) || !claims.sub) return null;
  return claims;
}

// ---- users ----
const pub = (u) => u && { id: u.id, uname: u.uname, name: u.name || "", pic: u.pic || "" };
export async function currentUser(env, req) {
  const D = await db(env); if (!D) return null;
  const uid = await readSession(env, req); if (!uid) return null;
  return D.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first();
}
// a first username from the Google name: letters only, plus digits until it's free
async function freeName(D, base) {
  let b = String(base || "").normalize("NFC").replace(/[^\p{L}\p{N}._]/gu, "").slice(0, 12);
  if (b.length < 3) b = "lojtar";
  for (let i = 0; i < 20; i++) {
    const n = i ? b + Math.floor(10 + Math.random() * (i < 10 ? 90 : 9990)) : b;
    if (!(await D.prepare("SELECT 1 FROM users WHERE uname = ?").bind(n).first())) return n;
  }
  return b.slice(0, 8) + rid(6);
}
export async function signIn(env, claims) {
  const D = await db(env);
  const now = Date.now();
  let u = await D.prepare("SELECT * FROM users WHERE sub = ?").bind(claims.sub).first();
  if (!u) {
    const id = rid(12), uname = await freeName(D, claims.given_name || claims.name || (claims.email || "").split("@")[0]);
    await D.prepare("INSERT INTO users (id, sub, email, name, uname, pic, created, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, claims.sub, claims.email || null, claims.name || null, uname, claims.picture || null, now, now).run();
    u = await D.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
    u.fresh = true;
  } else {
    await D.prepare("UPDATE users SET email = ?, name = ?, pic = ?, seen = ? WHERE id = ?").bind(claims.email || u.email, claims.name || u.name, claims.picture || u.pic, now, u.id).run();
  }
  return u;
}
export async function setUname(env, u, uname) {
  const n = String(uname || "").normalize("NFC").trim();
  if (!UNAME.test(n)) return { error: "bad_name" };
  const D = await db(env);
  const taken = await D.prepare("SELECT id FROM users WHERE uname = ?").bind(n).first();
  if (taken && taken.id !== u.id) return { error: "taken" };
  await D.prepare("UPDATE users SET uname = ? WHERE id = ?").bind(n, u.id).run();
  return { ok: true, uname: n };
}

// ---- friends ----
export async function friendList(env, u) {
  const D = await db(env);
  const rows = (await D.prepare(
    `SELECT f.a, f.b, f.state, u.id, u.uname, u.pic FROM friends f JOIN users u ON u.id = (CASE WHEN f.a = ?1 THEN f.b ELSE f.a END)
     WHERE f.a = ?1 OR f.b = ?1`).bind(u.id).all()).results || [];
  const friends = [], incoming = [], outgoing = [];
  for (const r of rows) {
    const who = { id: r.id, uname: r.uname, pic: r.pic || "" };
    if (r.state === "ok" && r.a === u.id) friends.push(who);
    else if (r.state === "req" && r.a === u.id) outgoing.push(who);
    else if (r.state === "req" && r.b === u.id) incoming.push(who);
  }
  return { friends, incoming, outgoing };
}
export async function friendAction(env, u, body) {
  const D = await db(env), now = Date.now();
  const act = String(body.action || "");
  if (act === "add") {
    const t = await D.prepare("SELECT id FROM users WHERE uname = ?").bind(String(body.uname || "").trim()).first();
    if (!t) return { error: "no_user" };
    if (t.id === u.id) return { error: "self" };
    const back = await D.prepare("SELECT state FROM friends WHERE a = ? AND b = ?").bind(t.id, u.id).first();
    if (back) {                                   // they already asked you: that's a yes
      await D.batch([
        D.prepare("INSERT OR REPLACE INTO friends (a, b, state, at) VALUES (?, ?, 'ok', ?)").bind(u.id, t.id, now),
        D.prepare("UPDATE friends SET state = 'ok', at = ? WHERE a = ? AND b = ?").bind(now, t.id, u.id),
      ]);
      return { ok: true, state: "ok" };
    }
    const n = await D.prepare("SELECT COUNT(*) AS n FROM friends WHERE a = ?").bind(u.id).first();
    if (n && n.n >= 300) return { error: "too_many" };
    await D.prepare("INSERT OR IGNORE INTO friends (a, b, state, at) VALUES (?, ?, 'req', ?)").bind(u.id, t.id, now).run();
    return { ok: true, state: "req" };
  }
  const id = String(body.id || "");
  if (act === "accept") {
    const r = await D.prepare("SELECT 1 FROM friends WHERE a = ? AND b = ? AND state = 'req'").bind(id, u.id).first();
    if (!r) return { error: "no_request" };
    await D.batch([
      D.prepare("UPDATE friends SET state = 'ok', at = ? WHERE a = ? AND b = ?").bind(now, id, u.id),
      D.prepare("INSERT OR REPLACE INTO friends (a, b, state, at) VALUES (?, ?, 'ok', ?)").bind(u.id, id, now),
    ]);
    return { ok: true };
  }
  if (act === "remove") {                         // unfriend, decline, or take back a request
    await D.prepare("DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)").bind(u.id, id, id, u.id).run();
    return { ok: true };
  }
  return { error: "bad_action" };
}
// delete the account: the user row and every friendship or request it is part of
export async function deleteUser(env, u) {
  const D = await db(env);
  await D.batch([
    D.prepare("DELETE FROM friends WHERE a = ? OR b = ?").bind(u.id, u.id),
    D.prepare("DELETE FROM users WHERE id = ?").bind(u.id),
  ]);
  return { ok: true };
}
export async function areFriends(env, a, b) {
  const D = await db(env);
  return !!(await D.prepare("SELECT 1 FROM friends WHERE a = ? AND b = ? AND state = 'ok'").bind(a, b).first());
}
export { pub as publicUser };
export { readSession as sessionUid, signSession as signSessionFor };
