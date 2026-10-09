import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/events';
import { RULESETS } from './config/rulesConfig';
import type { RoomManager } from './rooms/RoomManager';
import { registerSocketHandlers, type HandlerOptions } from './socket/handlers';

export interface AppOptions extends HandlerOptions {
  /** Allowed browser origins for Socket.IO / CORS. Empty = same-origin only. */
  allowedOrigins?: string[];
  /** Directory with the built client to serve statically (optional). */
  clientDist?: string;
}

export interface App {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  manager: RoomManager;
  close(): Promise<void>;
}

export function createApp(options: AppOptions = {}): App {
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy) app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: manager.store.size() });
  });

  app.get('/api/rulesets', (_req, res) => {
    res.json(
      Object.values(RULESETS).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        reverseTrumpSupported: r.reverseTrumpSupported,
      })),
    );
  });

  if (options.clientDist && existsSync(options.clientDist)) {
    const dist = options.clientDist;
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Generic error handler: never leak stack traces.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[http] error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const httpServer = createServer(app);
  const origins = options.allowedOrigins ?? [];
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: origins.length ? { origin: origins, credentials: false } : undefined,
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  const manager = registerSocketHandlers(io, options);
  manager.startSweeper();

  return {
    httpServer,
    io,
    manager,
    close: () =>
      new Promise<void>((resolve) => {
        manager.shutdown();
        io.close(() => resolve());
      }),
  };
}
