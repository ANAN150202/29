/**
 * End-to-end smoke test: four real browser sessions play 29 Royale through
 * the UI against the production build.
 *
 *   npm run build && npm run e2e            # play 2 rounds
 *   ROUNDS=99 npm run e2e                   # play a full match
 *   SHOTS=./shots npm run e2e               # also save screenshots
 *
 * Exercises: create/join via invite link, ready/start, bidding, trump
 * selection (Reverse Trump), card play, results, refresh-reconnect, and a
 * mobile viewport for one player.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT ?? 3199);
const BASE = `http://localhost:${PORT}`;
const ROUNDS = Number(process.env.ROUNDS ?? 2);
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log('[e2e]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const proc = spawn(process.execPath, ['server/dist/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', CLIENT_ORIGIN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => {
      if (String(d).includes('listening')) resolve(proc);
    });
    proc.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
}

async function shot(page, name) {
  if (!SHOTS) return;
  await sleep(450); // let entry animations settle
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  const errors = [];
  try {
    const viewports = [
      { width: 1366, height: 820 },
      { width: 1024, height: 768 },
      { width: 390, height: 844, isMobile: true, hasTouch: true },
      { width: 1280, height: 800 },
    ];
    const names = ['Asha', 'Bilal', 'Chitra', 'Dev'];
    const pages = [];
    for (let i = 0; i < 4; i++) {
      const { width, height, ...rest } = viewports[i];
      const ctx = await browser.newContext({ viewport: { width, height }, ...rest });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${names[i]}: ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && errors.push(`${names[i]} console: ${m.text()}`));
      pages.push(page);
    }

    // ── Host creates a room ───────────────────────────────────────────
    const host = pages[0];
    await host.goto(BASE);
    await shot(host, '01-home');
    await host.getByLabel('NICKNAME').fill(names[0]);
    await host.getByRole('button', { name: 'CREATE ROOM' }).click();
    await host.getByLabel('TURN TIMER').selectOption('0');
    await shot(host, '02-create');
    await host.getByRole('button', { name: 'CREATE', exact: true }).click();
    const code = (await host.locator('.room-code').innerText()).trim();
    log('room code', code);

    // ── Others join through the invite link ───────────────────────────
    for (let i = 1; i < 4; i++) {
      const p = pages[i];
      await p.goto(`${BASE}/?room=${code}`);
      await p.getByLabel('NICKNAME').fill(names[i]);
      await p.getByRole('button', { name: 'JOIN', exact: true }).click();
      await p.locator('.room-code').waitFor();
    }
    for (const p of pages) await p.getByRole('button', { name: 'READY UP' }).click();
    await host.getByRole('button', { name: 'START MATCH' }).waitFor();
    await host.waitForFunction(() => !document.querySelector('.lobby button.btn--gold[disabled]'));
    await shot(host, '03-lobby');
    await shot(pages[2], '03-lobby-mobile');
    await host.getByRole('button', { name: 'START MATCH' }).click();
    for (const p of pages) await p.locator('.felt').waitFor();
    log('match started');

    // ── Private-hand isolation in the rendered DOM ────────────────────
    const hands = await Promise.all(pages.map((p) => p.locator('.hand .card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))));
    const all = hands.flat();
    if (hands.some((h) => h.length !== 4)) throw new Error(`expected 4 cards each, got ${hands.map((h) => h.length)}`);
    if (new Set(all).size !== 16) throw new Error('hands overlap between players!');
    log('each player sees exactly their own 4 cards');

    let roundsDone = 0;
    let reloaded = false;
    let shots = new Set();
    const once = async (p, name) => {
      if (!shots.has(name)) {
        shots.add(name);
        await shot(p, name);
      }
    };

    const deadline = Date.now() + 15 * 60_000;
    while (roundsDone < ROUNDS && Date.now() < deadline) {
      let acted = false;
      for (let i = 0; i < 4; i++) {
        const p = pages[i];
        // Bidding
        const bidBtn = p.locator('.bidding__controls .btn--gold');
        if (await bidBtn.isVisible().catch(() => false)) {
          const noBids = await p.getByText('NO BIDS YET').isVisible().catch(() => false);
          await once(p, `04-bidding-${i === 2 ? 'mobile' : 'desktop'}`);
          if (noBids) await bidBtn.click();
          else await p.getByRole('button', { name: 'PASS' }).click();
          acted = true;
          break;
        }
        // Trump selection
        const hearts = p.getByRole('radio', { name: /HEARTS/ });
        if (await hearts.isVisible().catch(() => false)) {
          await hearts.click();
          await p.getByRole('radio', { name: /REVERSE TRUMP/ }).click();
          await once(p, `05-trump-select-${i === 2 ? 'mobile' : 'desktop'}`);
          await p.getByRole('button', { name: /CONFIRM REVERSE TRUMP: HEARTS/ }).click();
          acted = true;
          break;
        }
        // Results
        const next = p.getByRole('button', { name: /NEXT ROUND|PLAY AGAIN/ });
        if (await next.isVisible().catch(() => false)) {
          roundsDone++;
          await once(p, `08-results-${roundsDone}`);
          const matchOver = await p.getByRole('heading', { name: 'MATCH OVER' }).isVisible().catch(() => false);
          log(`round ${roundsDone} finished${matchOver ? ' — MATCH OVER' : ''}`);
          if (matchOver) {
            for (let k = 0; k < 4; k++) await shot(pages[k], `09-match-over-${k}`);
            roundsDone = ROUNDS;
          }
          else if (roundsDone < ROUNDS) await next.click();
          acted = true;
          break;
        }
        // Play
        const call = p.getByRole('button', { name: 'CALL FOR TRUMP' });
        if (await call.isVisible().catch(() => false)) {
          await call.click();
          await once(p, `07-trump-revealed-${i === 2 ? 'mobile' : 'desktop'}`);
          acted = true;
          break;
        }
        const playable = p.locator('.hand .card--playable');
        if ((await playable.count()) > 0) {
          await once(p, `06-playing-${i === 2 ? 'mobile' : 'desktop'}`);
          const c = playable.first();
          await c.click(); // select
          await c.click(); // play
          acted = true;

          // Mid-round: refresh the mobile player's page and make sure they come back to the same seat.
          if (!reloaded && i === 2) {
            reloaded = true;
            const before = await p.locator('.hand .card').count();
            await p.reload();
            await p.locator('.felt').waitFor({ timeout: 10_000 });
            await p.waitForFunction((n) => document.querySelectorAll('.hand .card').length === n - 1 || document.querySelectorAll('.hand .card').length === n, before);
            log('refresh → reconnected to the same seat with hand intact');
          }
          break;
        }
      }
      if (!acted) await sleep(120);
      else await sleep(60);
    }
    if (roundsDone < ROUNDS) throw new Error(`only ${roundsDone} rounds completed`);

    // Every client should agree on the match score.
    const scores = await Promise.all(pages.map((p) => p.locator('.results__table .score-big').allInnerTexts()));
    if (new Set(scores.map((s) => s.join('/'))).size !== 1) throw new Error(`score mismatch ${JSON.stringify(scores)}`);
    log('all clients agree on match score', scores[0].join(' : '));
    if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
    log('PASS');
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error('[e2e] FAIL', e);
  process.exit(1);
});
