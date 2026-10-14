# VitoWeb Loja

The hub with 6 games (Murlan, Spathi, Derri në dorë, Domino, Imposter, Mafia) plus the room servers that let every phone play from its own screen (Mafia and Imposter), all on Cloudflare.

| Folder / file | What it is |
|---|---|
| `public/` | The site: hub, 6 games, icons, 404 page. Served as static files (free, unlimited). |
| `worker/` | The servers. `index.js` = API, `room.js` = one live room per game code, `guard.js` = daily kill switch, `games/` = Mafia and Imposter rules. |
| `wrangler.toml` | Cloudflare settings: rooms (Durable Objects), rate limits, kill switch. |
| `test/smoke.mjs` | 52 checks with fake phones. Run it after every deploy. |

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
   BASE=https://vitoweb-loja.vitoweb.workers.dev npm test
   ```

   It should end with `52 passed, 0 failed`. It creates 2 test rooms, which delete themselves.

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
- `npm test` in a second terminal runs the 52 checks against it.

This runs the real Cloudflare runtime locally, rooms included.

## 3. What to test with friends

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
- While testing, the site is hidden from Google (`X-Robots-Tag: noindex` in `public/_headers`, and `public/robots.txt`).

## 6. Before the public launch (from the plan, not done yet)

- Remove the noindex line in `public/_headers` and allow crawling in `public/robots.txt`.
- Switch to the Workers Paid plan ($5/month) on launch day and set budget alerts.
- Turnstile (bot check) on room creation, Google login with accounts in D1, AdSense with privacy and terms pages, a bot stress test.
- Your own domain (for example `loja.vitoweb.al`; Cloudflare advises against running a business on `workers.dev`): Workers & Pages → vitoweb-loja → Domains → Add domain.
- Online multiplayer for the card games (today they're played against bots).

## If something goes wrong

- **Deploy fails on `ratelimits`:** delete the three `[[ratelimits]]` blocks in `wrangler.toml` and deploy again. The servers skip limits that don't exist, so everything else keeps working.
- **Deploy asks for a `workers.dev` subdomain:** pick any free name; it becomes part of the address.
- **A room stays on "po lidhet…":** open Workers & Pages → vitoweb-loja → Logs and look at the latest errors.
- **Fonts look plain:** the fonts come from Google Fonts; on a blocked network the pages fall back to system fonts.
