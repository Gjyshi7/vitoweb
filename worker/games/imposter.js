// Imposter, online: everyone in the room plays on their own phone.
// The server picks the category, the word and the imposter(s). Each phone receives only its
// own card: the word, or "imposter" (plus the category when the hint is on). The word reaches
// an imposter's phone only when the host reveals the round.
// Talking and voting happen out loud at the table. A wrong vote doesn't end anything: the
// round goes on with the same imposter. The app only keeps the clock (+1 minute when the table
// wants more) and shows who it was when the host reveals.
import { WORDS, CATS, TIMES } from "../../public/imposter-words.js";
import { shuffle, pick, rand } from "../util.js";

// 3 players: one imposter. From 4 players two are possible, three from 7.
export const maxImps = (n) => (n < 4 ? 1 : n < 7 ? 2 : 3);
const isPlayer = (s, pid) => s.players.some((p) => p.pid === pid);
const EXTRA = 60;                 // "+1 minutë"
const LONGEST = 30 * 60;          // a clock never goes past this

function startTalk(g, now) {
  g.phase = "talk";
  g.timer = g.time > 0 ? { ends: now + g.time * 1000, left: g.time, paused: false, total: g.time } : { ends: 0, left: 0, paused: true, total: 0 };
}
function leftNow(g, now) {
  const t = g.timer;
  if (!t.total) return 0;
  return t.paused ? t.left : Math.max(0, Math.round((t.ends - now) / 1000));
}
function freeze(g, now) {
  if (!g.timer.paused && g.timer.ends) {
    g.timer.left = leftNow(g, now);
    g.timer.ends = 0;
    g.timer.paused = true;
  }
}
function allSeen(s) {
  const g = s.g;
  const active = g.holders.filter((h) => isPlayer(s, h));
  return active.length > 0 && active.every((h) => g.seen.includes(h));
}

export default {
  init() {
    return {
      // imps: 1-3, or 0 = "1 ose 2" (nobody knows how many)
      cats: ["Ushqime", "Vende"], imps: 1, hint: true, time: 180,
      phase: "lobby", holders: [], impSet: [], word: null, cat: null, lastWord: null,
      seen: [], order: [], timer: { ends: 0, left: 0, paused: true, total: 0 }, names: {},
    };
  },

  onRemove(s, pid, now) {
    const g = s.g;
    if (g.phase === "cards" && allSeen(s)) startTalk(g, now);
  },

  onMessage(s, me, msg) {
    const g = s.g;
    const now = me.now;

    // the one action every player takes: "I've looked at my card"
    if (msg.t === "seen") {
      if (g.phase !== "cards" || !g.holders.includes(me.pid) || g.seen.includes(me.pid)) return null;
      g.seen.push(me.pid);
      if (allSeen(s)) startTalk(g, now);
      return { changed: true };
    }

    if (!me.isHost) return null; // everything below is the host's
    switch (msg.t) {
      case "config": {
        if (g.phase !== "lobby") return null;
        const c = msg.config || {};
        if (Array.isArray(c.cats)) {
          const cats = [...new Set(c.cats.filter((x) => CATS.includes(x)))];
          if (!cats.length) return { error: "need_cat" };
          g.cats = cats;
        }
        if (c.imps !== undefined) { const v = Math.floor(Number(c.imps)); g.imps = v === 0 ? 0 : Math.max(1, Math.min(3, v || 1)); }
        if (c.hint !== undefined) g.hint = !!c.hint;
        if (c.time !== undefined && TIMES.includes(Number(c.time))) g.time = Number(c.time);
        return { changed: true };
      }
      case "deal": {
        const n = s.players.length;
        if (n < 3) return { error: "need_3" };
        const holders = s.players.map((p) => p.pid);
        const want = g.imps === 0 ? (Math.random() < 0.5 ? 1 : 2) : g.imps;
        const imps = Math.min(want, maxImps(n));
        g.holders = holders;
        g.impSet = shuffle(holders.slice()).slice(0, imps);
        g.secretCount = g.imps === 0;
        g.cat = pick(g.cats);
        const pool = WORDS[g.cat].filter((w) => w !== g.lastWord);
        g.word = pick(pool);
        g.lastWord = g.word;
        const start = rand(n);
        g.order = holders.map((_, k) => holders[(start + k) % n]);
        for (const p of s.players) g.names[p.pid] = p.name;
        g.seen = [];
        g.timer = { ends: 0, left: g.time, paused: true, total: g.time };
        g.phase = "cards";
        s.round += 1;
        return { changed: true };
      }
      case "talk":
        if (g.phase !== "cards") return null;
        startTalk(g, now);
        return { changed: true };
      case "pause": {
        if (g.phase !== "talk" || !g.timer.total) return null;
        if (!g.timer.paused) freeze(g, now);
        else if (g.timer.left > 0) { g.timer.ends = now + g.timer.left * 1000; g.timer.paused = false; }
        else return null;
        return { changed: true };
      }
      case "more": {
        // one more minute: on top of what is left, or a fresh minute once the clock has run out
        if (g.phase !== "talk") return null;
        const left = Math.min(LONGEST, leftNow(g, now) + EXTRA);
        g.timer = { ends: now + left * 1000, left, paused: false, total: Math.max(left, g.timer.total || 0) };
        return { changed: true };
      }
      case "reveal":
        if (g.phase !== "talk" && g.phase !== "cards") return null;
        freeze(g, now);
        g.phase = "result";
        return { changed: true };
      case "lobby":
        g.phase = "lobby";
        return { changed: true };
    }
    return null;
  },

  view(s, pid) {
    const g = s.g;
    const holder = g.holders.includes(pid);
    const nameOf = (id) => (s.players.find((p) => p.pid === id) || {}).name || g.names[id] || "?";
    const v = {
      cfg: { cats: g.cats, imps: g.imps, hint: g.hint, time: g.time },
      allCats: CATS, times: TIMES, maxImps: maxImps(s.players.length),
      phase: g.phase, holders: g.holders, seen: g.seen, order: g.order, timer: g.timer,
      names: Object.fromEntries(g.holders.map((id) => [id, nameOf(id)])),
      card: null, result: null,
    };
    if (g.phase !== "lobby" && holder) {
      const n = g.secretCount ? null : g.impSet.length;
      v.card = g.impSet.includes(pid)
        ? { imp: true, cat: g.hint ? g.cat : null, n }
        : { imp: false, word: g.word, cat: g.cat, n };
    }
    if (g.phase === "result") v.result = { imps: g.impSet, word: g.word, cat: g.cat };
    return v;
  },
};
