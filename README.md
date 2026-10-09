# 29 Royale

**Your table. Your team. Your 29.**

29 Royale is a browser-based, real-time, four-player online version of **29 (Twenty-Nine)**, the South Asian trick-taking card game, with a retro 16-bit pixel-art look. Players pick a nickname (no account), share a room code with three friends, and play complete matches with bidding, hidden trump, **Reverse Trump**, pairs, and match scoring.

* **Server-authoritative**: the server deals, validates every action, resolves tricks, and keeps score. Clients render only what the server sends them.
* **Private views**: each player receives only their own hand. A concealed trump stays on the server until it is revealed.
* **Reconnection**: a refresh or a network drop puts the player back in the same seat with the same hand.
* **Responsive**: works on desktop, tablet, and phone.

---

## 🎮 Play now (free hosting, ~5 minutes)

1. Sign in at <https://render.com> with your GitHub account (free).
2. Click **New → Blueprint**, pick the `29` repository and the branch that contains `render.yaml`, then click **Apply**.
3. Wait for the build to finish. Render gives you a URL such as `https://29-royale-xxxx.onrender.com`.
4. Open it, enter a nickname, click **Create Room**, and send the invite link to three friends.

**No friends online?** Click **Play vs Computer** on the home page to play with a computer partner against two computer opponents. In a lobby, the host can also **Add Bot** to any empty seat (e.g. 2 friends + 2 bots). Bots decide only from what a human in their seat could see.

The free plan sleeps after about 15 minutes without visitors, so the first visit after a break takes up to a minute to wake. Games in progress are lost when it sleeps or redeploys.

**Same Wi-Fi only?** On any computer with Node.js 20+: `npm install && npm run build && npm start`, then everyone opens `http://<that-computer's-IP>:3001`.

---

## Quick start

Requirements: **Node.js 20+** and npm 10+.

```bash
npm install          # installs all workspaces
npm run dev          # server on :3001 + Vite client on :5173
```

Open <http://localhost:5173> in four browser windows (or four devices on your LAN at `http://<your-ip>:5173`). Create a room in one, and join from the others with the code or invite link.

### Production build (single process)

```bash
npm run build        # builds client (client/dist) and server (server/dist)
npm start            # serves the API, Socket.IO and the built client on :3001
```

### Tests

```bash
npm test             # Vitest: engine unit tests + Socket.IO integration tests
npm run typecheck    # strict TypeScript for server, client and tests
npm run build && npm run e2e              # 4 real Chromium sessions play 2 rounds through the UI
ROUNDS=99 SHOTS=./shots npm run e2e       # play a full match and save screenshots
```

The E2E script uses Playwright (`playwright` dev dependency). If you don't have a Chromium for Playwright yet, run `npx playwright install chromium` first.

---

## Environment variables

See [`server/.env.example`](server/.env.example) and [`client/.env.example`](client/.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP + Socket.IO port |
| `NODE_ENV` | `development` | `production` disables the dev CORS defaults |
| `CLIENT_ORIGIN` | dev: `http://localhost:5173` | Comma-separated cross-origin allow-list. Not needed when the server serves the client itself. |
| `RECONNECT_GRACE_MS` | `120000` | How long a disconnected player keeps their seat |
| `ROOM_IDLE_TTL_MS` | `600000` | Rooms with nobody connected are deleted after this |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate limiting (only behind a trusted proxy) |
| `CLIENT_DIST` | `../client/dist` | Location of the built client |
| `VITE_SERVER_URL` | same origin | Client: point at a game server on another origin |

---

## How to play

1. Enter a nickname, then **Create Room** (choose a ruleset, Reverse Trump on or off, spectators, turn timer) or **Join Room**.
2. In the lobby, pick a seat (partners sit opposite), press **Ready Up**. The host presses **Start Match**.
3. **Bid** 16–28 or **Pass**. The highest bidder picks the trump suit and **Normal** or **Reverse Trump**.
4. Follow suit when you can. Playable cards are outlined in gold; others are dimmed. Tap a card to select it, then tap it again (or press **Play Card**) to play.
5. If you can't follow suit and the trump is hidden, you may **Call for Trump**.
6. After eight tricks, the results screen shows the contract outcome, tricks, card points, and match score. First team to **+6** wins.

The full rule definitions, including every assumption and variant, are in **[docs/RULES.md](docs/RULES.md)**. A short version is in the in-game **Rules & How to Play** dialog.

### Reverse Trump in one sentence

Within the trump suit only, the order flips to **7 8 Q K 10 A 9 J**. Any trump still beats any non-trump, other suits are unchanged, and point values never change. The indicator reads `REVERSE TRUMP: HEARTS` instead of `TRUMP: HEARTS`.

---

## Architecture

```
shared/                 Types + typed Socket.IO event contract (no logic)
  types.ts  events.ts
server/src/
  config/rulesConfig.ts Every configurable / regional rule, 3 rulesets
  game/                 Pure engine — no Express / Socket.IO / React imports
    deck.ts             Deck, crypto shuffle, points
    rules.ts            getEffectiveCardStrength, trick winner, legal cards
    scoring.ts          Card points, contract evaluation, match winner (separate)
    state.ts            GameState, actions, explicit phase→action FSM table
    engine.ts           Phase machine: deal → bid → trump → play → score
    playerView.ts       Sanitized per-player view
  rooms/                Rooms, sessions, reconnection, timers, cleanup
    RoomManager.ts      Transport-agnostic (talks via a RoomTransport interface)
    RoomStore.ts        Storage interface + in-memory implementation
  socket/               Zod schemas, rate limiting, Socket.IO handlers
  app.ts / index.ts     Express + Socket.IO bootstrap
client/src/
  game/useGameSocket.ts Socket hook: session storage, auto-rejoin, actions
  pages/                Home, Lobby, Game (results are a modal in Game)
  components/           Card, PixelSuit, PlayerSeat, Scoreboard, BiddingPanel,
                        TrumpSelector, TrumpIndicator, TrickArea, ResultsPanel …
  styles/               base.css, components.css, table.css
tests/                  Vitest suites (engine + multiplayer integration)
e2e/                    Playwright four-browser smoke test
```

### Game phases (finite-state machine)

```
waiting → dealing → bidding ─┬─→ trumpSelection → dealing → playing ⇄ trickResolution
                             └─→ (all pass) dealing → bidding           │
                                         roundEnd ←──── after 8 tricks ─┘
                                         matchEnd (±6) → rematch → dealing …
```

`PHASE_ACTIONS` in `state.ts` lists which actions each phase accepts. Anything else is rejected with `WRONG_PHASE`.

### Socket events

Client → server (each takes an ack callback that receives `{ ok: true, data } | { ok: false, error: { code, message } }`):
`room:create`, `room:join`, `room:leave`, `room:ready`, `room:switchSeat`, `room:updateSettings`, `room:backToLobby`, `game:start`, `game:bid`, `game:pass`, `game:chooseTrump`, `game:revealTrump`, `game:declarePair`, `game:playCard`, `game:nextRound`, `game:rematch`, `game:sync`.

Game actions carry `{ roomCode, actionId, seq }`. Duplicate `actionId`s are rejected (`DUPLICATE_ACTION`). A `seq` that doesn't match the server's current sequence is rejected (`STALE_ACTION`), and the server re-sends that client its state.

Server → client: `room:created`, `room:updated`, `room:closed`, `game:started`, `game:state` (per-player view), `game:actionAccepted`, `game:actionRejected`, `game:trickResolved`, `game:roundFinished`, `game:matchFinished`, `player:disconnected`, `player:reconnected`.

### Sessions & reconnection

* Joining returns a random **session token**. The client stores it in `localStorage`; the server stores only its SHA-256 hash.
* On reconnect or refresh, the client re-sends the token and gets the **same seat**. If the same token connects from a second tab, the old tab is evicted, so a seat can never be held twice.
* A disconnected player keeps their seat for `RECONNECT_GRACE_MS`. After that the seat is **vacated**: the server auto-plays it, and a newcomer joining the room code takes it over.
* Rooms nobody is connected to are deleted after `ROOM_IDLE_TTL_MS`.

### Persistence

The MVP keeps rooms **in memory**: **restarting the server resets all active games.** `RoomStore` is the seam for Redis or PostgreSQL. `GameState` is plain JSON-serializable data, and the per-room timers would move to a scheduler keyed by room code.

### Security

* All payloads are validated with **Zod** (`server/src/socket/schemas.ts`). Unknown fields are rejected.
* Shuffling uses `crypto.randomInt` (Fisher–Yates).
* Rate limits: room creation per IP, events per socket, and repeated invalid actions per socket.
* Hands, tokens, and the undealt deck are never logged or sent to other players. Internal errors return a generic message, never a stack trace.
* Nicknames are trimmed, length-limited, and stripped of control and bidi characters. React escapes them on render.
* In production, CORS is closed unless `CLIENT_ORIGIN` is set; serving the client from the same server needs no CORS.
* Basic security headers are set (`nosniff`, `X-Frame-Options: DENY`, referrer policy).

---

## Deployment

The server serves the built client, so one Node process (one container) is enough.

```bash
docker build -t 29-royale .
docker run -p 3001:3001 -e NODE_ENV=production 29-royale
```

Put it behind an HTTPS-terminating reverse proxy (Caddy, nginx, Fly.io, Render, Railway…) and make sure the proxy forwards **WebSocket upgrades** for `/socket.io/`. Set `TRUST_PROXY=true` only behind such a proxy. Example nginx location:

```nginx
location / {
  proxy_pass http://127.0.0.1:3001;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Run a **single instance**: state is in memory. Scaling out needs a shared `RoomStore` and the Socket.IO Redis adapter with sticky sessions.

If you host the client separately (e.g. on a static host), build it with `VITE_SERVER_URL=https://your-api` and set `CLIENT_ORIGIN` on the server to the client's origin.

No real-money betting, wallets, or payments are included.
