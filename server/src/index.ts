import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT ?? 3001);
const here = path.dirname(fileURLToPath(import.meta.url));

const allowedOrigins = (env.CLIENT_ORIGIN ?? (isProd ? '' : 'http://localhost:5173,http://127.0.0.1:5173'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const { httpServer, close } = createApp({
  allowedOrigins,
  clientDist: env.CLIENT_DIST ?? path.resolve(here, '../../client/dist'),
  reconnectGraceMs: Number(env.RECONNECT_GRACE_MS ?? 120_000),
  roomIdleTtlMs: Number(env.ROOM_IDLE_TTL_MS ?? 600_000),
  trustProxy: env.TRUST_PROXY === 'true',
});

httpServer.listen(port, () => {
  console.log(`29 Royale server listening on :${port} (${isProd ? 'production' : 'development'})`);
  if (allowedOrigins.length) console.log(`Allowed cross-origin clients: ${allowedOrigins.join(', ')}`);
});

const shutdown = () => {
  console.log('Shutting down…');
  close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
