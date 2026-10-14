// Mafia role dealer. The game itself is played at the table; phones only show roles.
// Each phone gets its own role; mafia also see their teammates; a narrator who has no role
// sees the whole table; everyone sees everything after the host reveals.
import { shuffle } from "../util.js";

const SPECIAL = ["mafia", "doctor", "police"];

const seats = (s) => s.players.filter((p) => s.g.hostPlays || p.pid !== s.hostPid);

export function validate(c, n) {
  const special = c.mafia + c.doctor + c.police;
  if (n < 3) return "need_3";
  if (c.mafia < 1) return "need_mafia";
  if (special > n) return "too_many_roles";
  if (c.mafia * 2 >= n) return "mafia_majority"; // mafia would already equal/outnumber the town
  return null;
}

export default {
  init() {
    return { hostPlays: false, config: { mafia: 1, doctor: 1, police: 1 }, phase: "lobby", roles: {} };
  },

  onRemove(s, pid) {
    delete s.g.roles[pid];
  },

  onMessage(s, me, msg) {
    const g = s.g;
    if (!me.isHost) return null; // every Mafia action below is the host's
    switch (msg.t) {
      case "config": {
        const c = {};
        for (const k of SPECIAL) c[k] = Math.max(0, Math.min(15, Math.floor(Number(msg.config?.[k]) || 0)));
        g.config = c;
        return { changed: true };
      }
      case "hostPlays": {
        if (g.phase !== "lobby") return null;
        g.hostPlays = !!msg.v;
        return { changed: true };
      }
      case "deal": {
        const list = seats(s);
        const e = validate(g.config, list.length);
        if (e) return { error: e };
        const deck = [];
        for (const k of SPECIAL) for (let i = 0; i < g.config[k]; i++) deck.push(k);
        while (deck.length < list.length) deck.push("villager");
        shuffle(deck);
        g.roles = {};
        list.forEach((p, i) => (g.roles[p.pid] = deck[i]));
        s.round += 1;
        g.phase = "dealt";
        return { changed: true };
      }
      case "reveal":
        if (g.phase !== "dealt") return null;
        g.phase = "revealed";
        return { changed: true };
      case "lobby":
        g.phase = "lobby";
        g.roles = {};
        return { changed: true };
    }
    return null;
  },

  view(s, pid) {
    const g = s.g;
    const isHost = pid === s.hostPid;
    const myRole = g.roles[pid] || null;
    // The full table goes only to a narrator who holds no role this round (a player who becomes
    // host mid-game keeps seeing just their own card), or to everyone after the reveal.
    const narrator = isHost && !g.hostPlays && !myRole;
    const seatCount = seats(s).length;
    const mafiaPids = Object.keys(g.roles).filter((k) => g.roles[k] === "mafia");
    return {
      hostPlays: g.hostPlays, config: g.config, seatCount, phase: g.phase,
      configError: validate(g.config, seatCount),
      role: g.phase === "lobby" ? null : myRole,
      mates: myRole === "mafia" && g.phase !== "lobby" ? mafiaPids.filter((x) => x !== pid) : [],
      allRoles: g.phase === "revealed" || (narrator && g.phase === "dealt") ? g.roles : null,
    };
  },
};
