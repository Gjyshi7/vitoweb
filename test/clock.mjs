// What a real page does (public/net.js): at the moment the table says the next move is due, say "go".
// Test phones use this so their tables run on the phones' clock, exactly like the site.
export function driveClock(P, m) {
  const t = m.tbl;
  clearTimeout(P.goT);
  if (!t || (t.phase !== "play" && t.phase !== "over") || !t.due) return;
  const skew = m.now - Date.now(), seq = t.seq;
  P.clockSeq = seq;
  const fire = (n) => {
    if (P.clockSeq !== seq || !P.ws || P.ws.readyState !== 1) return;
    try { P.ws.send('{"t":"nudge"}'); } catch {}
    if (n < 6) P.goT = setTimeout(() => fire(n + 1), 900);
  };
  P.goT = setTimeout(() => fire(0), Math.max(30, t.due - (Date.now() + skew) + 120));
}
