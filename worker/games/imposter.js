// Imposter, online: everyone in the room plays on their own phone.
// The server picks the category, the word and the imposter(s). Each phone receives only its
// own card: the word, or "imposter" (plus the category when the hint is on). The word reaches
// an imposter's phone only after the reveal. Talking and voting happen out loud at the table;
// the host enters who got the most votes.
import { WORDS, CATS, TIMES } from "../../public/imposter-words.js";
import { shuffle, pick, rand } from "../util.js";

export const maxImps = (n) => Math.max(1, Math.min(3, Math.floor((n - 1) / 2)));
const isPlayer = (s, pid) => s.players.some((p) => p.pid === pid);

function startTalk(g, now) {
  g.phase = "talk";
  g.timer = g.time > 0 ? { ends: now + g.time * 1000, left: g.time, paused: false } : { ends: 0, left: 0, paused: true };
}
function freeze(g, now) {
  if (!g.timer.paused && g.timer.ends) {
    g.timer.left = Math.max(0, Math.round((g.timer.ends - now) / 1000));
    g.timer.ends = 0;
    g.timer.paused = true;
  }
}
function allSeen(s) {
  const g = s.g;
  const active = g.holders.filter((h) => isPlayer(s, h));
  return active.length > 0 && active.every((h) => g.seen.includes(h));
}
function award(g, kind) {
  g.gain = {};
  for (const h of g.holders) {
    const imp = g.impSet.includes(h);
    const add = kind === "imp2" ? (imp ? 2 : 0) : kind === "imp1" ? (imp ? 1 : 0) : (imp ? 0 : 1);
    g.gain[h] = add;
    g.scores[h] = (g.scores[h] || 0) + add;
  }
  g.awarded = true;
}

export default {
  init() {
    return {
      cats: ["Ushqime", "Vende"], imps: 1, hint: true, time: 180,
      phase: "lobby", holders: [], impSet: [], word: null, cat: null, lastWord: null,
      seen: [], order: [], timer: { ends: 0, left: 0, paused: true },
      vote: null, caught: null, guessed: null, awarded: false, gain: {}, scores: {}, names: {},
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
        if (c.imps !== undefined) g.imps = Math.max(1, Math.min(3, Math.floor(Number(c.imps)) || 1));
        if (c.hint !== undefined) g.hint = !!c.hint;
        if (c.time !== undefined && TIMES.includes(Number(c.time))) g.time = Number(c.time);
        return { changed: true };
      }
      case "deal": {
        const n = s.players.length;
        if (n < 3) return { error: "need_3" };
        const holders = s.players.map((p) => p.pid);
        const imps = Math.min(g.imps, maxImps(n));
        g.holders = holders;
        g.impSet = shuffle(holders.slice()).slice(0, imps);
        g.cat = pick(g.cats);
        const pool = WORDS[g.cat].filter((w) => w !== g.lastWord);
        g.word = pick(pool);
        g.lastWord = g.word;
        const start = rand(n);
        g.order = holders.map((_, k) => holders[(start + k) % n]);
        for (const p of s.players) g.names[p.pid] = p.name;
        g.seen = [];
        g.vote = null; g.caught = null; g.guessed = null; g.awarded = false; g.gain = {};
        g.timer = { ends: 0, left: g.time, paused: true };
        g.phase = "cards";
        s.round += 1;
        return { changed: true };
      }
      case "talk":
        if (g.phase !== "cards") return null;
        startTalk(g, now);
        return { changed: true };
      case "pause": {
        if (g.phase !== "talk" || !g.time) return null;
        if (!g.timer.paused) freeze(g, now);
        else if (g.timer.left > 0) { g.timer.ends = now + g.timer.left * 1000; g.timer.paused = false; }
        else return null;
        return { changed: true };
      }
      case "vote":
        if (g.phase !== "talk" && g.phase !== "cards") return null;
        freeze(g, now);
        g.phase = "vote";
        return { changed: true };
      case "pick":
        if (g.phase !== "vote" || !g.holders.includes(msg.pid)) return null;
        g.vote = msg.pid;
        return { changed: true };
      case "reveal":
        if (g.phase !== "vote" || !g.vote) return null;
        g.phase = "result";
        g.caught = g.impSet.includes(g.vote);
        if (!g.caught) award(g, "imp2");
        return { changed: true };
      case "guess":
        if (g.phase !== "result" || !g.caught || g.awarded) return null;
        g.guessed = !!msg.yes;
        award(g, g.guessed ? "imp1" : "crew");
        return { changed: true };
      case "lobby":
        g.phase = "lobby";
        return { changed: true };
      case "resetScores":
        if (g.phase !== "lobby") return null;
        g.scores = {};
        return { changed: true };
    }
    return null;
  },

  view(s, pid) {
    const g = s.g;
    const holder = g.holders.includes(pid);
    const nameOf = (id) => (s.players.find((p) => p.pid === id) || {}).name || g.names[id] || "?";
    const ids = new Set([...s.players.map((p) => p.pid), ...Object.keys(g.scores)]);
    const scores = [...ids]
      .map((id) => ({ pid: id, name: nameOf(id), score: g.scores[id] || 0, here: isPlayer(s, id) }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const v = {
      cfg: { cats: g.cats, imps: g.imps, hint: g.hint, time: g.time },
      allCats: CATS, times: TIMES, maxImps: maxImps(s.players.length),
      phase: g.phase, holders: g.holders, seen: g.seen, order: g.order, timer: g.timer, vote: g.vote,
      names: Object.fromEntries(g.holders.map((id) => [id, nameOf(id)])),
      scores, card: null, result: null,
    };
    if (g.phase !== "lobby" && holder) {
      v.card = g.impSet.includes(pid)
        ? { imp: true, cat: g.hint ? g.cat : null, n: g.impSet.length }
        : { imp: false, word: g.word, cat: g.cat, n: g.impSet.length };
    }
    if (g.phase === "result") {
      v.result = { caught: g.caught, vote: g.vote, imps: g.impSet, word: g.word, cat: g.cat, guessed: g.guessed, awarded: g.awarded, gain: g.gain };
    }
    return v;
  },
};
