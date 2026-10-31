import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { WebSocket, WebSocketServer } from 'ws';
import type { AppConfig } from './config.js';
import { clientMessageSchema, type InterimMode, type ServerMessage } from './protocol.js';
import type { Providers } from './providers/types.js';
import { TranslatorSession } from './session.js';

const MAX_FRAME_BYTES = 64_000; // 2 s of 16 kHz PCM16; the browser sends 100 ms frames
const START_TIMEOUT_MS = 10_000;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function originAllowed(req: IncomingMessage, config: AppConfig): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    if (new URL(origin).host === req.headers.host) return true;
  } catch {
    return false;
  }
  return config.allowedOrigins.includes(origin);
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function createAppServer(config: AppConfig, providers: Providers) {
  const interimMode = (): InterimMode => (!config.partialsEnabled ? 'none' : providers.stt?.streaming ? 'native' : 'rerun');
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      version: '1.0.0',
      authRequired: Boolean(config.accessToken),
      partials: config.partialsEnabled,
      stt: {
        configured: Boolean(providers.stt),
        provider: providers.stt?.name ?? new URL(config.stt.baseUrl).host,
        model: config.stt.model,
        streaming: providers.stt?.streaming ?? false,
        interim: interimMode(),
      },
      translate: { configured: Boolean(providers.translator), provider: providers.translator?.name ?? new URL(config.llm.baseUrl).host, model: config.llm.model },
    });
  });

  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/|ws).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES + 1024 });
  const connections = new Map<string, number>();

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/ws') return socket.destroy();
    if (!originAllowed(req, config)) return rejectUpgrade(socket, 403, 'Forbidden');
    const ip = req.socket.remoteAddress ?? 'unknown';
    if ((connections.get(ip) ?? 0) >= config.maxConnectionsPerIp) return rejectUpgrade(socket, 429, 'Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => {
      connections.set(ip, (connections.get(ip) ?? 0) + 1);
      ws.once('close', () => connections.set(ip, Math.max(0, (connections.get(ip) ?? 1) - 1)));
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    let session: TranslatorSession | null = null;
    let alive = true;
    const send = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    const fail = (code: 'AUTH_REQUIRED' | 'CONFIG_MISSING' | 'BAD_REQUEST', message: string) => {
      send({ type: 'error', code, message, severity: 'error', recoverable: false });
      ws.close(1008, code);
    };

    const startTimer = setTimeout(() => {
      if (!session) ws.close(1008, 'start timeout');
    }, START_TIMEOUT_MS);
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 25_000);
    ws.on('pong', () => {
      alive = true;
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (!session || !(data instanceof Buffer) || data.length > MAX_FRAME_BYTES) return;
        if (!session.pushAudio(data)) fail('BAD_REQUEST', 'Audio was sent faster than real time.');
        return;
      }
      let parsed;
      try {
        parsed = clientMessageSchema.safeParse(JSON.parse(data.toString()));
      } catch {
        return fail('BAD_REQUEST', 'Malformed message.');
      }
      if (!parsed.success) return fail('BAD_REQUEST', 'Invalid message.');
      const msg = parsed.data;

      if (msg.type === 'start') {
        if (session) return;
        if (config.accessToken && !safeEqual(msg.token ?? '', config.accessToken)) {
          return fail('AUTH_REQUIRED', 'A valid access token is required.');
        }
        if (!providers.stt) return fail('CONFIG_MISSING', 'Speech recognition is not configured on the server.');
        session = new TranslatorSession({
          ...providers,
          send,
          settings: msg.settings,
          offsetMs: msg.offsetMs,
          partialsEnabled: config.partialsEnabled,
          log: (m, extra) => console.warn(`[session] ${m}`, extra ?? ''),
        });
        send({
          type: 'ready',
          stt: { configured: true, model: providers.stt.model, streaming: providers.stt.streaming, interim: interimMode() },
          translate: { configured: Boolean(providers.translator), model: providers.translator?.model ?? config.llm.model },
        });
        if (!providers.translator) {
          send({ type: 'error', code: 'TRANSLATE_NOT_CONFIGURED', message: 'Translation is not configured. Showing Japanese only.', severity: 'warning', recoverable: false });
        }
      } else if (msg.type === 'settings') {
        session?.updateSettings(msg.settings);
      } else if (msg.type === 'stop') {
        void session?.stop();
      }
    });

    ws.on('close', () => {
      clearTimeout(startTimer);
      clearInterval(heartbeat);
      session?.dispose();
      session = null;
    });
    ws.on('error', () => ws.terminate());
  });

  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}
