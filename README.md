# VITOWEB games (vitoweb.al)

The hub with 6 games (Murlan, Spathi, Derri në dorë, Domino, Imposter, Mafia) plus the room servers that let every phone play from its own screen (Murlan, Mafia and Imposter), all on Cloudflare.

| Folder / file | What it is |
|---|---|
| `public/` | The site: hub, 6 games, icons, 404 page. Served as static files (free, unlimited). |
| `worker/` | The servers. `index.js` = API, `room.js` = one live room per game code, `guard.js` = daily kill switch, `games/` = Murlan, Mafia and Imposter. `gen/` = copies of the page engines, made by `npm run build` (don't edit). |
| `public/net.js` | Start menu (Luaj online / Krijo dhomë / Hyr), rooms and the connection, shared by the 4 table games. Sits outside the rotated table, so the keyboard is right on an upright phone. |
| `public/hand.js` | Your hand in every table game: drag sideways to reorder, drag the selected cards up onto the table to play. One finger only; a second finger cancels. |
| `public/*-engine.js` | The rules of each table game. The server runs the same files (copied to `worker/gen/`). |
| `worker/games/table.js` | The shared table server: seats, quick match, turn clock (15 s, Derri 20 s), seats that play by themselves, what each phone may see, end-of-match votes, people who are gone too long. `murlan.js`, `spathi.js`, `derri.js`, `domino.js` only describe their rules. |
| `worker/guard.js` | Daily room cap, plus presence (who is on the site, where, what they usually play) and the quick-match table lists, in its SQLite storage. |
| `public/presence.js` | Every page reports where it is every 25 s; the phone keeps its own play counts. |

**Quick match.** A new table gets a plan from the Guard: how many real people are likely to sit down soon (someone on that game's start screen, someone on the main page who often plays it). Those seats stay open for 4-10 s; the other seats fill with players one at a time. Anyone who arrives later still gets in: in the lobby they take a seat a bot took meanwhile; a match that has only just been dealt (fewer than 2 moves) can still give them a bot's seat. Once cards are being played, nobody new sits down.
| `test/sim.mjs` | Plays whole matches of the 4 table games on the server rules with a fake clock and checks no phone ever gets someone else's cards. `node test/sim.mjs` |
| `public/players.js` | Names and pace of the other players at the card tables (shared by every game and the server). |
| `public/table-ui.js` | Top bar (RENDIT, PAUZË), pause menu and the big play buttons, shared by the 4 table games. |
| `public/ads.js` | Ad slots, off until AdSense approves the site. Open any page with `?ads=preview` to see where they go. |
| `wrangler.toml` | Cloudflare settings: rooms (Durable Objects), rate limits, kill switch. |
| `test/smoke.mjs` | 68 checks with fake phones. Run it after every deploy. |

## 1. Put it online (first time, about 5 minutes)

Cloudflare's drag-and-drop upload only hosts plain files. It cannot create the room servers (Durable Objects), so the deploy goes through Wrangler, Cloudflare's own command-line tool.

1. Check Node.js: open Terminal and run `node -v`. It must say `v22` or higher. If not, install the LTS version from nodejs.org.
2. Unzip `vitoweb-loja.zip`. In VS Code: File → Open Folder → `vitoweb-loja`, then Terminal → New Terminal.
3. Run these three, one at a time:

   ```
   npm install
   npx wrangler login
   npx wrangler deploy
   ```

   - `login` opens the browser: log in to Cloudflare and press **Allow**.
   - The first deploy on an account may ask you to choose a `workers.dev` subdomain (for example `vitoweb`).
   - The last line printed is the site's address, like `https://vitoweb-loja.vitoweb.workers.dev`.
4. Check the servers (put your address in place of the example):

   ```
   BASE=https://vitoweb.al npm test
   ```

   It should end with `68 passed, 0 failed`. It creates 3 test rooms, which delete themselves.

**Updating later:** change files, run `npx wrangler deploy` again. Phones in a room drop for a second and reconnect on their own; rooms keep their state.

### Without the terminal (GitHub instead)

1. On github.com create a **private** repository, for example `vitoweb-loja`.
2. On its page press "uploading an existing file" and drag in everything from the unzipped folder **except** `node_modules` (if you created it). Commit.
3. Cloudflare dashboard → Workers & Pages → Create application → **Import a repository** → choose it → keep the deploy command `npx wrangler deploy` → Save and Deploy.

Every later upload to that repository redeploys the site by itself. Keep the Worker name `vitoweb-loja` (it must match `name` in `wrangler.toml`).

## 2. Try it on your Mac and phones before deploying (optional)

```
npx wrangler dev --ip 0.0.0.0
```

- On the Mac: http://localhost:8787
- On phones on the same Wi-Fi: `http://<your Mac's IP>:8787` (Mac: System Settings → Wi-Fi → Details → IP address).
- `npm test` in a second terminal runs the 68 checks against it.

This runs the real Cloudflare runtime locally, rooms included.

## 3. What to test with friends

- **Murlan online (2–4 phones):** Fillo → Luaj me shokët → Krijo tavolinë, send the link, the others join, host presses Fillo. Empty seats fill by themselves. Close one phone mid-hand and reopen the link: same cards. Leave a phone idle: after 30 s its turn plays itself.
- **Hub:** open every game on an iPhone and an Android, and come back with the back arrow.
- **Card games:** one full game each, phone sideways and upright; drag cards in your hand.
- **Mafia (4+ phones):** create a room, share the WhatsApp link, everyone joins, deal, hold the card to see the role. Lock one phone for 2 minutes, unlock: same role. Narrator sees the table. Kick someone. Reveal. New round.
- **Imposter online (3+ phones):** choose "Secili me telefonin e vet", create, join by link, deal. Check the timer shows the same time on every phone and the imposter never sees the word.
- **Host's phone dies:** after 1 minute the others see "Bëhu host" and can take over.
- **Networks:** play on mobile data, on Wi-Fi, and switch between them mid-game.

When something breaks, note: phone model, browser, what you pressed, and the time. The server logs are in the dashboard (Workers & Pages → vitoweb-loja → Logs).

## 4. Switches

Change in `wrangler.toml`, then `npx wrangler deploy`:

| Setting | Default | What it does |
|---|---|---|
| `PAUSE_NEW_ROOMS` | `"0"` | `"1"` stops new rooms at once. Rooms already open keep working. |
| `MAX_NEW_ROOMS_PER_DAY` | `"2000"` | New rooms allowed per day (UTC). An estimate: adjust after real testing. |
| `ROOM_TTL_MINUTES` | `"360"` | A room deletes itself after 6 hours with no activity. |

**Room numbers per day:** run `npx wrangler secret put ADMIN_KEY`, type a long password, then open `https://<your address>/api/admin/stats?key=<that password>`. Without the secret this page does not exist.

## 5. How the servers work

- Pages, scripts and icons are static files: free and never wake a server. Only `/api/*` and `/ws/*` run code.
- Every Mafia or Imposter room is its own Durable Object (a tiny server for that room). Phones connect over a WebSocket. Rooms sleep between moves, and keep-alive pings are answered without waking them.
- The server decides roles and words. Each phone receives only its own card; the narrator (Mafia) sees the table only if he has no role.
- Each phone has a secret guest id (HttpOnly cookie, with a local key as backup). Other phones only ever see a public seat id, so nobody can log in as someone else.
- Limits: 600 requests/min per IP (loose because many phones on mobile data share one IP), 10 new rooms/min and 40 joins/min per phone, 40 messages per 10 s per phone, 30 players per room.
- Other websites can't create rooms or open sockets here (origin check).
- The site is open to search engines: `public/robots.txt` allows everything and lists `public/sitemap.xml`. The dashboard (`/admin`) and the 404 page carry `noindex`.

## 6. Address, legal pages, ads, sign-in

- **Address.** The site is `vitoweb.al`. `www.vitoweb.al` and the old `loja.vitoweb.al` open the same files and the first line of every page sends the visitor on to `vitoweb.al` (same path). All three are custom domains in `wrangler.toml` under `[[routes]]`; Cloudflare makes their DNS records itself on deploy.
- **The old agency site** that used to be on vitoweb.al is gone. Its old page addresses open the home page (`public/_redirects`).
- **Privacy Policy and Terms** (English): `public/privacy.html`, `public/terms.html`, at `/privacy` and `/terms`. They describe exactly what the site stores; if you add anything that stores or sends data (a new cookie, analytics, another ad network), update the policy the same day.
- **Ads**: `public/ads.js`. Three values from AdSense switch them on (publisher id, ad-unit id, ENABLED); the publisher id also goes in `public/ads.txt` and in the `google-adsense-account` meta tag of `public/index.html`. `?ads=preview` shows the slots without Google, `?ads=test` shows Google's test ads. For EU/UK/CH visitors publish Google's consent message (AdSense → Privacy & messaging). The full-screen break between hands needs a separate yes from Google (H5 Games Ads).
- **Google sign-in**: in Google Cloud → APIs & Services → Credentials → the OAuth client (Web application) → Authorized JavaScript origins: `https://vitoweb.al`. Put its client id in `GOOGLE_CLIENT_ID` in `wrangler.toml` and deploy. Until then sign-in stays hidden.
- **Capacity**: see section 8 for what the Free plan holds and when the Paid plan ($5/month) starts to make sense.

## 7. Self-healing ("the bug hunter") and the incident log

The site is built so that a table can never stay frozen. When something breaks, it is fixed on the spot and written down.

**On the server (every table):**
- The Murlan and Spathi players think with a fixed amount of work, never a time limit (on Cloudflare the clock stands still while code runs). Worst case ~6 ms per move, well under the Free plan's ~10 ms.
- If Cloudflare had to stop a step and retries it, the players move instantly without thinking, so the same step can't fail twice.
- If a player's move is ever refused or crashes: simpler moves that are always legal; if none work, the hand is dealt again (scores kept); then a fresh match; only as the very last resort the table closes with *"Tavolina pati një problem dhe u mbyll"* and everyone goes back to the menu. It never just stops.
- A message, a join or a leave that crashes the rules is caught and the table is put back on its feet.

**On every phone (net.js):**
- If the page stops following the table (its replay got stuck), it redraws the table from the server within ~10 s.
- If a move is overdue on the server's clock (Cloudflare dropped a timer), the phone sends a *nudge* and the server moves at once.
- A connection that went silent is reopened; a quick-match lobby that is late is played on the phone instead; if LUAJ can't get a table from the server for any reason, the table is played on the phone.

**The incident log** (D1 database `vitoweb-loja`, table `incidents`): everything above that had to happen, plus page errors.
```
npx wrangler d1 execute vitoweb-loja --remote --command "SELECT datetime(at/1000,'unixepoch') t, src, kind, game, msg FROM incidents ORDER BY at DESC LIMIT 50"
```
A few `table clock missed, nudged` or `page healed` lines are normal. Many of the same kind, or any `crashed` / `rescue`, is a bug to look at.

**Tests** (run before every deploy):
| Command | What it proves |
|---|---|
| `node test/sim.mjs` | Whole matches, privacy, quick-match pacing, seats given away |
| `node test/fuzz.mjs 30` | Random people (legal moves, junk, drops, leaves, votes) on every game: no freeze, no leak, no refused bot move, CPU per step |
| `node test/heal.mjs` | Broken bots on purpose: every table heals or closes cleanly, never freezes |
| `BASE=http://localhost:8787 node test/live.mjs` | Real server: lobby within 7 s, bots move, 4 people start together, friends' rooms start when full |
| `BASE=http://localhost:8787 node test/chaos.mjs 36 240` | 36 phones, drops, second tabs, leaving, friends' rooms; start the server with `--var SOLO_ON_SERVER:1 --var CHAOS_DROP_ALARMS:0.3` (keep one-person tables on the server, lose 30 % of its timer ticks) |
| `BASE=http://localhost:8787 npm test` | The 76 smoke checks |
| `BASE=… LOG=… node test/meter.mjs` | What one player-hour costs (server started with `--var METER:1`) |

## 8. Capacity on Cloudflare (measured, not guessed)

Measured with `test/meter.mjs` (server started with `--var METER:1`, which prints every billable thing). Free plan limits per day:
100,000 game-server (Durable Object) requests, 100,000 storage rows written, 100,000 Worker requests. They reset at 02:00 Tirana.

| One player-hour | Requests | Storage writes |
|---|---|---|
| Before (one person + 3 players on the server, page reporting every 25 s) | ~1,900 | ~4,200 → **~24 player-hours a day** |
| Now: alone with players (the match moves onto the phone after the lobby; ~4 games an hour) | ~70 | ~90 → **~1,100 player-hours a day** |
| Now: 2 people + 2 players (server; the phones drive the clock) | ~360 | ~900 → ~110 player-hours a day |
| Now: 4 people (server) | ~180 | ~400 → ~250 player-hours a day |
| An open page on a menu | 60 | ~0 (only when it changes place) |

What made the difference: one-person tables play on the phone after the 7 s lobby; the phones are the table's clock (a "go" message bills 1/20 of a request and writes nothing, a server alarm bills a request and a write); pages report every 60 s on menus and every 5 min while playing; presence is kept in memory; empty tables really close (they used to wake every 90 s for 6 hours).

On Workers Paid ($5/month) nothing stops at a daily limit: 1 million requests and 50 million storage writes a month are included, then $0.15 per million requests and $1.00 per million writes.

## 9. The dashboard

`https://vitoweb.al/admin`, opened with the owner's key (only its SHA-256 is in `wrangler.toml` as `ADMIN_HASH`; to change the key, put the SHA-256 of a new one there and deploy). It shows who is on the site now and where, today's use of the Free limits, games today (on the phone / on the server), what the site fixed by itself (the incident log) and the last 14 days.
Tables report what they cost when they close; the Guard's own counts are saved at most once a minute, so on a very quiet site they read a little low (marked ≈). Cloudflare's own numbers: Workers & Pages → vitoweb-loja → Metrics.

## If something goes wrong

- **Deploy fails on `ratelimits`:** delete the three `[[ratelimits]]` blocks in `wrangler.toml` and deploy again. The servers skip limits that don't exist, so everything else keeps working.
- **Deploy asks for a `workers.dev` subdomain:** pick any free name; it becomes part of the address.
- **A room stays on "po lidhet…":** open Workers & Pages → vitoweb-loja → Logs and look at the latest errors.
- **Fonts look plain:** the fonts come from Google Fonts; on a blocked network the pages fall back to system fonts.
