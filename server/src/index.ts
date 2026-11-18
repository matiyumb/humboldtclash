import express from 'express';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Server } from 'socket.io';
import { RANKS, rankFor, sanitizeSettings, type Identity, type MixTrack } from '../../shared/types.js';
import { Catalog, remoteAllowed } from './catalog.js';
import { AudioProxy } from './audioProxy.js';
import { Deezer, DeezerError } from './deezer.js';
import { LastFm } from './lastfm.js';
import { Library } from './library.js';
import { GameManager, cleanNickname } from './game.js';
import { createStore, emptyProfile } from './store.js';
import { login, register } from './accounts.js';
import { parseSongLines } from './importer.js';
import { Matchmaker, type QueueEntry } from './matchmaking.js';

const ROOT = resolve(process.env.HUMBOLDTCLASH_ROOT ?? process.cwd());
const CATALOG_DIR = resolve(process.env.CATALOG_DIR ?? ROOT);
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DEEZER_ON = process.env.DEEZER !== 'off';
const LASTFM_KEY = process.env.LASTFM_API_KEY?.trim();

const store = await createStore(ROOT);
const library = new Library(new Catalog(CATALOG_DIR), DEEZER_ON ? new Deezer() : null, store, LASTFM_KEY ? new LastFm(LASTFM_KEY) : null);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render pone un proxy delante: IP real del usuario
app.use(express.json({ limit: '300kb' }));
const server = createServer(app);
const io = new Server(server, { serveClient: false, pingInterval: 10_000, pingTimeout: 8_000 });
const games = new GameManager(library, (socketId, event, payload) => io.to(socketId).emit(event, payload));

const deezerError = (res: express.Response, e: unknown) =>
  res.status(502).json({ error: e instanceof DeezerError ? e.message : 'Error consultando Deezer.' });

app.get('/api/config', (_req, res) => res.json({ ads: process.env.ADS === '1', adsClient: process.env.ADS_CLIENT ?? null, store: store.kind }));

app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: games.roomCount(), deezer: DEEZER_ON, lastfm: !!LASTFM_KEY, store: store.kind }));

// ---------- Catálogos ----------
app.get('/api/catalogs', async (_req, res) => {
  res.json(await library.list());
});

app.get('/api/deezer/artistas', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try { res.json(await library.search(q)); } catch (e) { deezerError(res, e); }
});

app.get('/api/deezer/canciones', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  if (!library.deezer) return res.json([]);
  try { res.json(await library.deezer.searchTracks(q)); } catch (e) { deezerError(res, e); }
});

app.get('/api/deezer/artista/:id/canciones', async (req, res) => {
  const id = Number(req.params.id);
  if (!library.deezer || !Number.isInteger(id) || id <= 0) return res.json([]);
  try { res.json(await library.deezer.artistMixTracks(id)); } catch (e) { deezerError(res, e); }
});

app.get('/api/deezer/playlist/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!library.deezer || !Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Enlace de playlist no válido.' });
  try { res.json(await library.deezer.playlistSummary(id)); } catch (e) { deezerError(res, e); }
});

app.post('/api/deezer/emparejar', async (req, res) => {
  if (!library.deezer) return res.json({ found: [], missing: [] });
  const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 40_000) : '';
  const items = parseSongLines(text).slice(0, 150);
  const found: MixTrack[] = [];
  const missing: string[] = [];
  for (let i = 0; i < items.length; i += 3) {
    const batch = items.slice(i, i + 3);
    const got = await Promise.all(batch.map((x) => library.deezer!.matchLine(x.artist, x.title)));
    got.forEach((t, k) => (t ? found.push(t) : missing.push(`${batch[k].artist ? batch[k].artist + ' - ' : ''}${batch[k].title}`)));
  }
  res.json({ found, missing });
});

app.get('/api/catalogs/:id/check', async (req, res) => {
  const settings = sanitizeSettings({ rounds: req.query.rondas, difficulty: req.query.dificultad, shuffle: true });
  const { resolved: _omit, ...check } = await library.check(req.params.id, settings);
  res.json(check);
});

app.get('/api/salas-publicas', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(games.publicRooms());
});

// ---------- Perfiles y ranking ----------
const validId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s);

app.get('/api/perfil/:playerId', async (req, res) => {
  if (!validId(req.params.playerId)) return res.status(400).json({ error: 'Id no válido' });
  res.setHeader('Cache-Control', 'no-store');
  const p = (await store.profile(req.params.playerId)) ?? emptyProfile(req.params.playerId, '');
  const { current, next } = rankFor(p.wins);
  const acc = await store.accountOf(req.params.playerId);
  // El MMR (y los datos de Glicko) son secretos: solo sirven para emparejar.
  const { mmr: _m, rd: _r, vol: _v, ...pub } = p;
  res.json({ ...pub, rank: current, nextRank: next, persistent: store.kind === 'postgres', username: acc?.username ?? null });
});

app.get('/api/ranking', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const rows = await store.leaderboard(20, req.query.por === 'competitivo' ? 'ranked' : 'wins');
  res.json(rows.map((r) => ({ ...r, rank: rankFor(r.wins).current.id })));
});

// ---------- Cuentas ----------
app.post('/api/cuenta/registro', async (req, res) => {
  const id = req.body?.identity as Identity | undefined;
  if (!id || !validId(id.playerId) || !validId(id.secret)) return res.status(400).json({ ok: false, error: 'Identidad no válida. Recarga la página.' });
  const r = await register(store, req.body?.username, req.body?.password, id);
  res.status(r.ok ? 200 : 400).json(r);
});

app.post('/api/cuenta/entrar', async (req, res) => {
  const r = await login(store, req.body?.username, req.body?.password, req.ip ?? '?');
  res.status(r.ok ? 200 : 401).json(r);
});

// ---------- Playlists de usuarios ----------
/** Clave de dueño: solo quien tiene el secreto del navegador puede editar sus playlists. */
function ownerKey(identity: unknown): string | null {
  const id = identity as Identity | undefined;
  if (!id || !validId(id.playerId) || !validId(id.secret)) return null;
  return createHash('sha256').update(`${id.playerId}:${id.secret}`).digest('base64url').slice(0, 32);
}

const isHttps = (u: unknown) => typeof u === 'string' && u.length < 600 && remoteAllowed(u);
function cleanTrack(t: unknown): MixTrack | null {
  const x = t as Partial<MixTrack>;
  if (!x || typeof x !== 'object') return null;
  const id = Number(x.deezerId);
  const title = typeof x.title === 'string' ? x.title.trim().slice(0, 120) : '';
  const artist = typeof x.artist === 'string' ? x.artist.trim().slice(0, 120) : '';
  if (!Number.isInteger(id) || id <= 0 || !title || !artist || !isHttps(x.preview)) return null;
  return {
    deezerId: id, title, artist,
    cover: isHttps(x.cover) ? (x.cover as string) : null,
    rank: Number.isFinite(Number(x.rank)) ? Math.max(0, Math.round(Number(x.rank))) : 0,
    preview: x.preview as string,
    link: typeof x.link === 'string' && /^https:\/\/(www\.)?deezer\.com\//.test(x.link) ? x.link : `https://www.deezer.com/track/${id}`,
  };
}

app.post('/api/mixes/mias', async (req, res) => {
  const owner = ownerKey(req.body?.identity);
  if (!owner) return res.status(400).json({ error: 'Identidad no válida' });
  res.json(await store.mixesOf(owner));
});

app.get('/api/mixes/:id', async (req, res) => {
  const mix = await store.mix(String(req.params.id).slice(0, 24));
  if (!mix) return res.status(404).json({ error: 'Esa playlist no existe.' });
  const { owner: _o, ...pub } = mix;
  res.json(pub);
});

app.post('/api/mixes', async (req, res) => {
  const owner = ownerKey(req.body?.identity);
  if (!owner) return res.status(400).json({ error: 'Identidad no válida' });
  const name = typeof req.body?.name === 'string' ? req.body.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) : '';
  if (!name) return res.status(400).json({ error: 'Ponle un nombre a la playlist.' });
  const raw = Array.isArray(req.body?.tracks) ? req.body.tracks.slice(0, 200) : [];
  const seen = new Set<number>();
  const tracks = raw.map(cleanTrack).filter((t: MixTrack | null): t is MixTrack => !!t && !seen.has(t.deezerId) && !!seen.add(t.deezerId));
  if (tracks.length < 5) return res.status(400).json({ error: 'Una playlist necesita al menos 5 canciones.' });
  const ownerName = cleanNickname(req.body?.nickname) ?? 'Anónimo';
  try {
    const mix = await store.saveMix(owner, ownerName, { name, tracks }, typeof req.body?.id === 'string' ? req.body.id : undefined);
    const { owner: _o, ...pub } = mix;
    res.json(pub);
  } catch (e) {
    res.status(403).json({ error: (e as Error).message });
  }
});

app.post('/api/mixes/:id/borrar', async (req, res) => {
  const owner = ownerKey(req.body?.identity);
  if (!owner) return res.status(400).json({ error: 'Identidad no válida' });
  res.json({ ok: await store.deleteMix(owner, String(req.params.id)) });
});

// ---------- Audio ----------
// El navegador solo ve /api/audio/<token aleatorio>. Las vistas previas de Deezer pasan por aquí:
// así no se revela la canción y todos los jugadores de la sala comparten la descarga.
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

// ---------- Competitivo 1v1 ----------
const matchmaker = new Matchmaker(
  (a: QueueEntry, b: QueueEntry) => {
    games.createRankedRoom(a, b).then((r) => {
      for (const e of [a, b]) io.to(e.socketId).emit(r.ok ? 'ranked:found' : 'ranked:error', r.ok ? { code: r.code } : { error: r.error });
    }).catch((e) => console.error('[ranked]', e));
  },
  (socketId, status) => io.to(socketId).emit('ranked:status', status),
);
setInterval(() => matchmaker.tick(Date.now()), 1000).unref();

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
  on('solo:start', (d) => games.createRoom(socket.id, d.identity, d.nickname, 'solo', d.catalogId, false, d.settings));
  on('room:create', (d) => games.createRoom(socket.id, d.identity, d.nickname, 'multi', d.catalogId, d.isPublic, d.settings));
  on('room:join', (d) => games.joinRoom(socket.id, d.code, d.identity, d.nickname));
  on('room:leave', () => games.leave(socket.id));
  on('room:setCatalog', (d) => games.setCatalog(socket.id, d.catalogId));
  on('room:setSettings', (d) => games.setSettings(socket.id, d.settings));
  on('room:setSize', (d) => games.setRoomSize(socket.id, d.size));
  on('ranked:queue', async (d) => {
    const id = d.identity as Identity | undefined;
    if (!id || !validId(id.playerId) || !validId(id.secret)) return { ok: false, error: 'Identidad no válida.' };
    const acc = await store.accountOf(id.playerId);
    if (!acc || acc.secret !== id.secret) return { ok: false, error: 'El competitivo es solo para jugadores registrados. Crea tu cuenta o inicia sesión.' };
    const p = await store.profile(id.playerId);
    const tier = RANKS.indexOf(rankFor(p?.wins ?? 0).current);
    matchmaker.join({ playerId: id.playerId, socketId: socket.id, identity: id, nickname: acc.username, mmr: p?.mmr ?? 1500, tier, since: Date.now() });
    return { ok: true };
  });
  on('ranked:cancel', (d) => { if (validId(d.identity?.playerId)) matchmaker.leave(d.identity.playerId); return { ok: true }; });
  on('room:setPublic', (d) => games.setPublic(socket.id, d.isPublic));
  on('room:start', () => games.start(socket.id));
  on('room:playAgain', () => games.playAgain(socket.id));
  on('round:ready', (d) => games.ready(socket.id, d.questionId));
  on('round:audioFailed', (d) => games.audioFailed(socket.id, d.questionId));
  on('round:answer', (d) => games.answer(socket.id, d.questionId, d.optionId));
  on('time:sync', () => ({ ok: true, now: Date.now() }));
  socket.on('disconnect', () => { matchmaker.leaveSocket(socket.id); games.disconnect(socket.id); });
});

const shutdown = async () => { await store.close().catch(() => {}); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Humboldtclash escuchando en http://localhost:${PORT} · Deezer ${DEEZER_ON ? 'activado' : 'desactivado'} · datos: ${store.kind}`);
});
