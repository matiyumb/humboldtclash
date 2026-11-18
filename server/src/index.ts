import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Server } from 'socket.io';
import { Catalog } from './catalog.js';
import { AudioProxy } from './audioProxy.js';
import { Deezer, DeezerError } from './deezer.js';
import { Library } from './library.js';
import { GameManager } from './game.js';

const ROOT = resolve(process.env.HUMBOLDTCLASH_ROOT ?? process.cwd());
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DEEZER_ON = process.env.DEEZER !== 'off';

const library = new Library(new Catalog(ROOT), DEEZER_ON ? new Deezer() : null);
const app = express();
app.disable('x-powered-by');
const server = createServer(app);
const io = new Server(server, { serveClient: false, pingInterval: 10_000, pingTimeout: 8_000 });
const games = new GameManager(library, (socketId, event, payload) => io.to(socketId).emit(event, payload));

app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: games.roomCount(), deezer: DEEZER_ON }));

// Catálogos: destacados de Deezer + catálogo local.
app.get('/api/catalogs', async (_req, res) => {
  res.json(await library.list());
});

// Búsqueda de artistas en Deezer (nuestra API sobre la de Deezer).
app.get('/api/deezer/artistas', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    res.json(await library.search(q));
  } catch (e) {
    res.status(502).json({ error: e instanceof DeezerError ? e.message : 'Error buscando en Deezer.' });
  }
});

app.get('/api/catalogs/:id/check', async (req, res) => {
  const { resolved: _omit, ...check } = await library.check(req.params.id);
  res.json(check);
});

app.get('/api/salas-publicas', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(games.publicRooms());
});

// ---------- Audio ----------
// El navegador solo ve /api/audio/<token aleatorio>. Las vistas previas remotas (Deezer)
// pasan por aquí: así no se revela la canción y todos los jugadores de la sala comparten caché.
const proxy = new AudioProxy(async (id) => (library.deezer ? library.deezer.freshPreview(id) : null));

app.get('/api/audio/:token', async (req, res) => {
  const ticket = games.audio(req.params.token);
  if (!ticket) return res.status(404).json({ error: 'Audio no disponible' });
  res.setHeader('Cache-Control', 'no-store');
  if (ticket.url !== undefined) {
    const got = await proxy.get(ticket.url, ticket.deezerId);
    if (!got) return res.status(502).json({ error: 'Audio no disponible' });
    res.setHeader('Content-Type', got.type);
    return res.end(got.body);
  }
  res.sendFile(ticket.path, { headers: { 'Content-Type': ticket.type }, etag: false, lastModified: false, dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) res.status(500).end();
  });
});

// Solo en pruebas automáticas: nunca se activa sin la variable de entorno.
if (process.env.HUMBOLDTCLASH_TEST === '1') {
  console.warn('⚠ Modo de prueba: /api/test/* expone respuestas. No lo uses en producción.');
  app.get('/api/test/answer/:code', (req, res) => res.json(games._debugCorrectTitle(req.params.code.toUpperCase())));
}

const clientDir = join(ROOT, 'dist/client');
if (existsSync(clientDir)) {
  app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(join(clientDir, 'index.html')));
}

type AckFn = (r: unknown) => void;
const safeAck = (ack: unknown): AckFn => (typeof ack === 'function' ? (ack as AckFn) : () => {});

io.on('connection', (socket) => {
  const on = (event: string, fn: (data: any) => unknown) => {
    socket.on(event, async (data: unknown, ack: unknown) => {
      try {
        safeAck(ack)((await fn(data ?? {})) ?? { ok: true });
      } catch (e) {
        console.error(`[${event}]`, e);
        safeAck(ack)({ ok: false, error: 'Error inesperado del servidor.' });
      }
    });
  };
  on('solo:start', (d) => games.createRoom(socket.id, d.identity, d.nickname, 'solo', d.catalogId));
  on('room:create', (d) => games.createRoom(socket.id, d.identity, d.nickname, 'multi', d.catalogId, d.isPublic));
  on('room:join', (d) => games.joinRoom(socket.id, d.code, d.identity, d.nickname));
  on('room:leave', () => games.leave(socket.id));
  on('room:setCatalog', (d) => games.setCatalog(socket.id, d.catalogId));
  on('room:setPublic', (d) => games.setPublic(socket.id, d.isPublic));
  on('room:start', () => games.start(socket.id));
  on('room:playAgain', () => games.playAgain(socket.id));
  on('round:ready', (d) => games.ready(socket.id, d.questionId));
  on('round:audioFailed', (d) => games.audioFailed(socket.id, d.questionId));
  on('round:answer', (d) => games.answer(socket.id, d.questionId, d.optionId));
  on('time:sync', () => ({ ok: true, now: Date.now() }));
  socket.on('disconnect', () => games.disconnect(socket.id));
});

server.listen(PORT, HOST, () => {
  const n = library.local.list().find((c) => c.id === 'todo')?.trackCount ?? 0;
  console.log(`Humboldtclash escuchando en http://localhost:${PORT} (${n} canciones locales · Deezer ${DEEZER_ON ? 'activado' : 'desactivado'})`);
});
