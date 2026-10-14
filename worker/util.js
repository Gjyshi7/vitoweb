// Small helpers shared by the Worker and the Durable Objects.

export const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O, so codes read aloud without confusion
const ID_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";

export function rand(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function pick(a) { return a[rand(a.length)]; }

export function roomCode() {
  return Array.from({ length: 4 }, () => CODE_CHARS[rand(CODE_CHARS.length)]).join("");
}
// Public seat id: shown to every phone in the room. Never used to log in.
export function publicId() {
  return Array.from({ length: 10 }, () => ID_CHARS[rand(ID_CHARS.length)]).join("");
}
// Secret guest id: lives in an HttpOnly cookie, never sent to other players.
export function secretId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Player names: no control characters or angle brackets, trimmed, max 16 characters.
export function cleanName(v) {
  return String(v || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
}

export function json(o, status = 200, headers = {}) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export async function safeEqual(a, b) {
  const ea = new TextEncoder().encode(String(a || ""));
  const eb = new TextEncoder().encode(String(b || ""));
  if (ea.byteLength !== eb.byteLength || !ea.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ea, eb);
}
