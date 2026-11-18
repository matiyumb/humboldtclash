import { randomBytes, createHash, timingSafeEqual, randomInt } from 'node:crypto';
import { extname } from 'node:path';
import {
  MAX_PLAYERS, MIN_PLAYERS_MULTI, INTRO_MS, OPTIONS_PER_QUESTION, REVEAL_PAUSE_MS, ROUND_MS, LIGHTNING_MS,
  scoreFor, sanitizeSettings, rankFor, DEFAULT_SETTINGS, DEFAULT_RATING, DEFAULT_ROOM_SIZE, RANKED_SETTINGS, RANKED_CATALOG, type GameSettings, type RatingChange,
  type Ack, type Identity, type MissedSong, type PlayerView, type RevealView, type RoomState, type RoundResult, type StandingRow,
} from '../../shared/types.js';
import { AUDIO_TYPES, type Track } from './catalog.js';
import type { Library, Resolved } from './library.js';
import { DEFAULT_RD, DEFAULT_VOL, updateRating } from './glicko.js';
import type { PublicRoom } from '../../shared/types.js';

export const LOAD_TIMEOUT_MS = 15_000;
export const LOBBY_GRACE_MS = 45_000;
export const EMPTY_ROOM_TTL_MS = 10 * 60_000;
export const MAX_REPLACEMENTS_PER_ROUND = 3;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type Send = (socketId: string, event: string, payload: unknown) => void;

interface Player {
  id: string;
  secretHash: Buffer;
  nickname: string;
  socketId: string | null;
  connected: boolean;
  left: boolean;
  score: number;
  correct: number;
  lobbyTimer?: NodeJS.Timeout;
}

interface Answer { optionId: string; correct: boolean; points: number; lightning: boolean; ms: number }

interface Round {
  index: number;
  questionId: string;
  track: Track;
  options: { id: string; title: string; cover: string | null }[];
  correctOptionId: string;
  token: string;
  phase: 'loading' | 'answering' | 'reveal';
  ready: Set<string>;
  replacements: number;
  clipStart: number; // 0..1, igual para todos
  deadline: number | null;
  answers: Map<string, Answer>;
  reveal: RevealView | null;
}

interface HistoryEntry { index: number; track: Track; voided: boolean; results: Map<string, RoundResult> }

interface Room {
  code: string;
  mode: 'solo' | 'multi' | 'ranked';
  maxPlayers: number;
  ratingChanges: Map<string, RatingChange>;
  phase: 'lobby' | 'playing' | 'results';
  hostId: string;
  players: Player[];
  catalogId: string | null;
  deck: Track[];
  pool: Track[]; // todas las pistas válidas del catálogo (para distractores)
  used: Set<string>;
  round: Round | null;
  history: HistoryEntry[];
  timer?: NodeJS.Timeout;
  emptyTimer?: NodeJS.Timeout;
  isPublic: boolean;
  catalogName: string | null;
  starting: boolean; // evita doble inicio mientras se cargan canciones de Deezer
  introUntil: number | null;
  settings: GameSettings;
  recorded: boolean; // resultados ya guardados en el perfil
}

export type AudioTicket = { code: string; type: string } & (
  | { path: string; url?: undefined; deezerId?: undefined }
  | { url: string; path?: undefined; deezerId?: number }
);

const hash = (s: string) => createHash('sha256').update(s).digest();
const opaque = (bytes = 9) => randomBytes(bytes).toString('base64url');

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cleanNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s.length >= 1 ? s : null;
}

function validIdentity(id: unknown): id is Identity {
  const ok = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v);
  return !!id && typeof id === 'object' && ok((id as Identity).playerId) && ok((id as Identity).secret);
}

/** Posiciones con empates compartidos (1, 1, 3…). */
export function rankStandings(rows: Omit<StandingRow, 'position'>[]): StandingRow[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'es'));
  let lastScore: number | null = null;
  let lastPos = 0;
  return sorted.map((r, i) => {
    const position = r.score === lastScore ? lastPos : i + 1;
    lastScore = r.score;
    lastPos = position;
    return { ...r, position };
  });
}

export class GameManager {
  private rooms = new Map<string, Room>();
  private sockets = new Map<string, { code: string; playerId: string }>();
  private tickets = new Map<string, AudioTicket>();

  /** Rango (por victorias guardadas) de cada jugador, para mostrarlo en salas. */
  private ranks = new Map<string, string>();

  constructor(private library: Library, private send: Send) {}

  private loadRanks(room: Room) {
    const store = this.library.store;
    if (!store) return;
    const ids = room.players.map((p) => p.id).filter((id) => !this.ranks.has(id));
    if (!ids.length) return;
    store.profiles(ids).then((m) => {
      let changed = false;
      for (const id of ids) { const r = rankFor(m.get(id)?.wins ?? 0).current.id; if (this.ranks.get(id) !== r) { this.ranks.set(id, r); changed = true; } }
      if (changed && this.rooms.has(room.code)) this.broadcast(room);
    }).catch(() => {});
  }

  /** Tamaño de la sala (2 a 10 jugadores); solo el anfitrión, en la sala de espera. */
  setRoomSize(socketId: string, size: unknown): Ack {
    const ctx = this.ctx(socketId);
    if (!ctx) return { ok: false, error: 'No estás en una sala.' };
    const { room, player } = ctx;
    if (room.mode !== 'multi') return { ok: false, error: 'Solo las salas multijugador tienen tamaño.' };
    if (room.hostId !== player.id) return { ok: false, error: 'Solo el anfitrión puede cambiar el tamaño.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'La partida ya empezó.' };
    const n = Math.round(Number(size));
    const inRoom = room.players.filter((p) => !p.left).length;
    if (!Number.isFinite(n) || n < MIN_PLAYERS_MULTI || n > MAX_PLAYERS) return { ok: false, error: `El tamaño va de ${MIN_PLAYERS_MULTI} a ${MAX_PLAYERS} jugadores.` };
    if (n < inRoom) return { ok: false, error: `Ya hay ${inRoom} jugadores en la sala.` };
    room.maxPlayers = n;
    this.broadcast(room);
    return { ok: true };
  }

  /** Crea una partida competitiva 1v1 ya emparejada y la empieza. */
  async createRankedRoom(a: { socketId: string; identity: Identity; nickname: string }, b: { socketId: string; identity: Identity; nickname: string }): Promise<Ack<{ code: string }>> {
    const check = await this.library.check(RANKED_CATALOG, RANKED_SETTINGS);
    if (!check.ok || !check.resolved) return { ok: false, error: check.message };
    let code: string;
    do {
      code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    for (const e of [a, b]) this.detachSocket(e.socketId);
    const pa = this.newPlayer(a.identity, a.nickname, a.socketId);
    const pb = this.newPlayer(b.identity, a.nickname === b.nickname ? `${b.nickname.slice(0, 13)} 2` : b.nickname, b.socketId);
    const room: Room = {
      code, mode: 'ranked', phase: 'lobby', hostId: pa.id, players: [pa, pb],
      catalogId: RANKED_CATALOG, deck: [], pool: [], used: new Set(), round: null, history: [],
      isPublic: false, catalogName: check.resolved.name, starting: false, introUntil: null,
      settings: { ...RANKED_SETTINGS }, recorded: false, maxPlayers: 2, ratingChanges: new Map(),
    };
    this.rooms.set(code, room);
    this.sockets.set(a.socketId, { code, playerId: pa.id });
    this.sockets.set(b.socketId, { code, playerId: pb.id });
    this.loadRanks(room);
    const r = await this.startGame(room, check.resolved);
    if (!r.ok) { this.deleteRoom(room); return r; }
    return { ok: true, code };
  }

  /** Actualiza el MMR (Glicko-2) de los dos jugadores de una partida competitiva. */
  private async rateRanked(room: Room, won: Set<string>) {
    const store = this.library.store!;
    const [a, b] = room.players;
    if (!a || !b) return;
    const profiles = await store.profiles([a.id, b.id]);
    const cur = (id: string) => { const p = profiles.get(id); return { mmr: p?.mmr ?? DEFAULT_RATING, rd: p?.rd ?? DEFAULT_RD, vol: p?.vol ?? DEFAULT_VOL }; };
    const ra = cur(a.id), rb = cur(b.id);
    const sa = won.has(a.id) ? (won.has(b.id) ? 0.5 : 1) : won.has(b.id) ? 0 : 0.5;
    const na = updateRating(ra, rb, sa), nb = updateRating(rb, ra, 1 - sa);
    await store.recordRanked([
      { playerId: a.id, ...na, won: sa === 1 },
      { playerId: b.id, ...nb, won: sa === 0 },
    ]);
    room.ratingChanges.set(a.id, { before: ra.mmr, after: na.mmr, delta: na.mmr - ra.mmr });
    room.ratingChanges.set(b.id, { before: rb.mmr, after: nb.mmr, delta: nb.mmr - rb.mmr });
  }

  setSettings(socketId: string, raw: unknown): Ack {
    const ctx = this.ctx(socketId);
    if (!ctx) return { ok: false, error: 'No estás en una sala.' };
    if (ctx.room.hostId !== ctx.player.id) return { ok: false, error: 'Solo el anfitrión puede cambiar los ajustes.' };
    if (ctx.room.phase !== 'lobby') return { ok: false, error: 'La partida ya empezó.' };
    ctx.room.settings = sanitizeSettings(raw);
    this.broadcast(ctx.room);
    return { ok: true };
  }

  /** Salas públicas en espera, con hueco y con alguien conectado. */
  publicRooms(): PublicRoom[] {
    const out: PublicRoom[] = [];
    for (const room of this.rooms.values()) {
      if (room.mode !== 'multi' || !room.isPublic || room.phase !== 'lobby') continue;
      const active = room.players.filter((p) => !p.left);
      if (active.length >= room.maxPlayers || !active.some((p) => p.connected)) continue;
      const host = room.players.find((p) => p.id === room.hostId);
      out.push({ code: room.code, host: host?.nickname ?? '—', catalogName: room.catalogName, players: active.length, maxPlayers: room.maxPlayers });
    }
    return out.slice(0, 30);
  }

  setPublic(socketId: string, isPublic: unknown): Ack {
    const ctx = this.ctx(socketId);
    if (!ctx) return { ok: false, error: 'No estás en una sala.' };
    if (ctx.room.hostId !== ctx.player.id) return { ok: false, error: 'Solo el anfitrión puede cambiar la visibilidad.' };
    if (ctx.room.mode !== 'multi') return { ok: false, error: 'Solo las salas multijugador pueden ser públicas.' };
    ctx.room.isPublic = isPublic === true;
    this.broadcast(ctx.room);
    return { ok: true };
  }

  // ---------- consultas ----------
  audio(token: string): AudioTicket | undefined {
    return this.tickets.get(token);
  }
  roomCount() {
    return this.rooms.size;
  }
  /** Solo para pruebas: opción correcta de la ronda actual. */
  _debugCorrect(code: string) {
    const r = this.rooms.get(code)?.round;
    return r ? r.correctOptionId : null;
  }
  _debugCorrectTitle(code: string) {
    const r = this.rooms.get(code)?.round;
    return r ? { title: r.track.title, questionId: r.questionId, phase: r.phase } : null;
  }

  // ---------- ciclo de vida de salas ----------
  async createRoom(socketId: string, identity: unknown, nickname: unknown, mode: 'solo' | 'multi', catalogId?: unknown, isPublic?: unknown, rawSettings?: unknown): Promise<Ack<{ code: string }>> {
    const settings = rawSettings === undefined ? { ...DEFAULT_SETTINGS } : sanitizeSettings(rawSettings);
    if (!validIdentity(identity)) return { ok: false, error: 'Identidad no válida. Recarga la página.' };
    const nick = cleanNickname(nickname);
    if (!nick) return { ok: false, error: 'Escribe un apodo (1 a 16 caracteres).' };
    let resolved: Resolved | undefined;
    let catalogName: string | null = null;
    if (mode === 'solo' || (catalogId !== undefined && catalogId !== null)) {
      if (typeof catalogId !== 'string') return { ok: false, error: 'Elige un catálogo.' };
      const check = await this.library.check(catalogId, settings);
      if (mode === 'solo' && !check.ok) return { ok: false, error: check.message };
      if (!check.resolved) return { ok: false, error: check.message };
      resolved = check.resolved;
      catalogName = check.resolved.name;
    }
    this.detachSocket(socketId);
    let code: string;
    do {
      code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const player = this.newPlayer(identity, nick, socketId);
    const room: Room = {
      code, mode, phase: 'lobby', hostId: player.id, players: [player],
      catalogId: typeof catalogId === 'string' ? catalogId : null,
      deck: [], pool: [], used: new Set(), round: null, history: [],
      isPublic: mode === "multi" && isPublic === true, catalogName, starting: false, introUntil: null, settings, recorded: false,
      maxPlayers: mode === 'solo' ? 1 : DEFAULT_ROOM_SIZE, ratingChanges: new Map(),
    };
    this.rooms.set(code, room);
    this.sockets.set(socketId, { code, playerId: player.id });
    this.loadRanks(room);
    if (mode === 'solo') {
      const r = await this.startGame(room, resolved);
      if (!r.ok) { this.deleteRoom(room); return r; }
    } else {
      this.broadcast(room);
    }
    return { ok: true, code };
  }

  joinRoom(socketId: string, rawCode: unknown, identity: unknown, nickname: unknown): Ack<{ code: string; rejoined: boolean }> {
    if (!validIdentity(identity)) return { ok: false, error: 'Identidad no válida. Recarga la página.' };
    const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
    const room = this.rooms.get(code);
    const existing = room?.players.find((p) => p.id === identity.playerId);

    // Reconexión: mismo navegador (mismo id y secreto).
    if (room && existing) {
      const given = hash(identity.secret);
      if (!timingSafeEqual(given, existing.secretHash)) return { ok: false, error: 'No se pudo recuperar tu puesto en esta sala.' };
      const current = this.sockets.get(socketId);
      if (!(current && current.code === code)) this.detachSocket(socketId);
      if (existing.socketId && existing.socketId !== socketId) {
        this.send(existing.socketId, 'session:replaced', { message: 'Abriste esta sala en otra pestaña o ventana.' });
        this.sockets.delete(existing.socketId);
      }
      existing.socketId = socketId;
      existing.connected = true;
      existing.left = false;
      if (existing.lobbyTimer) { clearTimeout(existing.lobbyTimer); existing.lobbyTimer = undefined; }
      const nick = cleanNickname(nickname);
      if (nick && room.phase === 'lobby') existing.nickname = this.uniqueNick(room, nick, existing.id);
      if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = undefined; }
      this.sockets.set(socketId, { code, playerId: existing.id });
      if (!this.isActive(room, room.hostId)) room.hostId = existing.id;
      this.broadcast(room);
      return { ok: true, code, rejoined: true };
    }

    if (!room || room.mode !== 'multi') return { ok: false, error: 'No existe una sala con ese código.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'La partida ya empezó: no se pueden unir más jugadores.' };
    if (room.players.filter((p) => !p.left).length >= room.maxPlayers) return { ok: false, error: `La sala está llena (máximo ${room.maxPlayers} jugadores).` };
    const nick = cleanNickname(nickname);
    if (!nick) return { ok: false, error: 'Escribe un apodo (1 a 16 caracteres).' };
    this.detachSocket(socketId);
    const player = this.newPlayer(identity, this.uniqueNick(room, nick), socketId);
    room.players.push(player);
    this.loadRanks(room);
    if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = undefined; }
    this.sockets.set(socketId, { code, playerId: player.id });
    if (!this.isActive(room, room.hostId)) room.hostId = player.id;
    this.broadcast(room);
    return { ok: true, code, rejoined: false };
  }

  leave(socketId: string): Ack {
    this.detachSocket(socketId, true);
    return { ok: true };
  }

  disconnect(socketId: string) {
    this.detachSocket(socketId, false);
  }

  async setCatalog(socketId: string, catalogId: unknown): Promise<Ack<{ name: string }>> {
    const ctx = this.ctx(socketId);
    if (!ctx) return { ok: false, error: 'No estás en una sala.' };
    const { room, player } = ctx;
    if (room.hostId !== player.id) return { ok: false, error: 'Solo el anfitrión puede elegir el catálogo.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'La partida ya empezó.' };
    if (typeof catalogId !== 'string') return { ok: false, error: 'Ese catálogo no existe.' };
    const check = await this.library.check(catalogId, room.settings);
    if (!check.resolved) return { ok: false, error: check.message };
    if (room.phase !== 'lobby' || !this.rooms.has(room.code)) return { ok: false, error: 'La partida ya empezó.' };
    room.catalogId = catalogId;
    room.catalogName = check.resolved.name;
    this.broadcast(room);
    return { ok: true, name: check.resolved.name };
  }

  async start(socketId: string): Promise<Ack> {
    const ctx = this.ctx(socketId);
    if (!ctx) return { ok: false, error: 'No estás en una sala.' };
    const { room, player } = ctx;
    if (room.hostId !== player.id) return { ok: false, error: 'Solo el anfitrión puede iniciar la partida.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'La partida ya empezó.' };
    const connected = room.players.filter((p) => p.connected && !p.left).length;
    if (room.mode === 'multi' && connected < MIN_PLAYERS_MULTI) return { ok: false, error: `Hacen falta al menos ${MIN_PLAYERS_MULTI} jugadores conectados.` };
    return this.startGame(room);
  }

  async playAgain(socketId: string): Promise<Ack> {
    const ctx = this.ctx(socketId);
    if (!ctx) return { ok: false, error: 'No estás en una sala.' };
    const { room, player } = ctx;
    if (room.phase !== 'results') return { ok: false, error: 'La partida no ha terminado.' };
    if (room.mode === 'ranked') return { ok: false, error: 'En competitivo, busca otra partida desde el inicio.' };
    if (room.hostId !== player.id) return { ok: false, error: 'Solo el anfitrión puede empezar otra partida.' };
    room.players = room.players.filter((p) => !p.left);
    for (const p of room.players) { p.score = 0; p.correct = 0; }
    room.history = [];
    room.round = null;
    if (room.mode === 'solo') return this.startGame(room);
    room.phase = 'lobby';
    for (const p of room.players) if (!p.connected) this.scheduleLobbyRemoval(room, p);
    this.broadcast(room);
    return { ok: true };
  }

  // ---------- rondas ----------
  ready(socketId: string, questionId: unknown) {
    const ctx = this.ctx(socketId);
    const round = ctx?.room.round;
    if (!ctx || !round || ctx.room.phase !== 'playing' || round.phase !== 'loading' || round.questionId !== questionId) return;
    round.ready.add(ctx.player.id);
    this.maybeStartAnswering(ctx.room);
  }

  audioFailed(socketId: string, questionId: unknown) {
    const ctx = this.ctx(socketId);
    const round = ctx?.room.round;
    if (!ctx || !round || round.phase !== 'loading' || round.questionId !== questionId) return;
    this.replaceTrack(ctx.room);
  }

  answer(socketId: string, questionId: unknown, optionId: unknown): Ack<{ accepted: true }> {
    const now = Date.now();
    const ctx = this.ctx(socketId);
    if (!ctx) return { ok: false, error: 'No estás en una sala.' };
    const { room, player } = ctx;
    const round = room.round;
    if (room.phase !== 'playing' || !round || round.questionId !== questionId) return { ok: false, error: 'Esa pregunta ya no está activa.' };
    if (round.phase === 'loading') return { ok: false, error: 'La ronda aún no ha empezado.' };
    if (round.answers.has(player.id)) return { ok: false, error: 'Ya respondiste en esta ronda.' };
    if (round.phase !== 'answering' || round.deadline === null || now > round.deadline) return { ok: false, error: 'Se acabó el tiempo.' };
    const option = round.options.find((o) => o.id === optionId);
    if (!option) return { ok: false, error: 'Opción no válida.' };
    const correct = option.id === round.correctOptionId;
    const elapsed = now - (round.deadline - ROUND_MS);
    round.answers.set(player.id, { optionId: option.id, correct, points: scoreFor(correct, round.deadline - now, elapsed), lightning: correct && elapsed <= LIGHTNING_MS, ms: Math.max(0, elapsed) });
    if (this.activePlayers(room).every((p) => round.answers.has(p.id))) this.reveal(room);
    else this.broadcast(room);
    return { ok: true, accepted: true };
  }

  // ---------- interno ----------
  private newPlayer(identity: Identity, nickname: string, socketId: string): Player {
    return { id: identity.playerId, secretHash: hash(identity.secret), nickname, socketId, connected: true, left: false, score: 0, correct: 0 };
  }

  private uniqueNick(room: Room, nick: string, selfId?: string) {
    const taken = new Set(room.players.filter((p) => p.id !== selfId && !p.left).map((p) => p.nickname.toLowerCase()));
    if (!taken.has(nick.toLowerCase())) return nick;
    for (let i = 2; ; i++) {
      const cand = `${nick.slice(0, 13)} ${i}`;
      if (!taken.has(cand.toLowerCase())) return cand;
    }
  }

  private ctx(socketId: string) {
    const s = this.sockets.get(socketId);
    if (!s) return null;
    const room = this.rooms.get(s.code);
    const player = room?.players.find((p) => p.id === s.playerId);
    if (!room || !player || player.socketId !== socketId) return null;
    return { room, player };
  }

  private isActive(room: Room, playerId: string) {
    const p = room.players.find((x) => x.id === playerId);
    return !!p && p.connected && !p.left;
  }

  /** Jugadores a los que se espera (conectados y no retirados). */
  private activePlayers(room: Room) {
    return room.players.filter((p) => p.connected && !p.left);
  }

  private detachSocket(socketId: string, explicitLeave = false) {
    const s = this.sockets.get(socketId);
    if (!s) return;
    this.sockets.delete(socketId);
    const room = this.rooms.get(s.code);
    const player = room?.players.find((p) => p.id === s.playerId);
    if (!room || !player || player.socketId !== socketId) return;
    player.socketId = null;
    player.connected = false;
    if (explicitLeave) {
      if (room.phase === 'lobby') room.players = room.players.filter((p) => p !== player);
      else player.left = true;
      // Competitivo: abandonar es rendirse; la partida termina y gana el rival.
      if (room.mode === 'ranked' && room.phase === 'playing') { player.connected = false; return this.finish(room); }
    } else if (room.phase === 'lobby') {
      this.scheduleLobbyRemoval(room, player);
    }
    this.afterPresenceChange(room);
  }

  private scheduleLobbyRemoval(room: Room, player: Player) {
    if (player.lobbyTimer) clearTimeout(player.lobbyTimer);
    player.lobbyTimer = setTimeout(() => {
      player.lobbyTimer = undefined;
      if (player.connected || room.phase !== 'lobby' || !this.rooms.has(room.code)) return;
      room.players = room.players.filter((p) => p !== player);
      this.afterPresenceChange(room);
    }, LOBBY_GRACE_MS);
  }

  private afterPresenceChange(room: Room) {
    if (room.players.every((p) => p.left)) return this.deleteRoom(room);
    if (!this.isActive(room, room.hostId)) {
      const next = this.activePlayers(room)[0];
      if (next) room.hostId = next.id;
      else if (!room.players.some((p) => p.id === room.hostId)) room.hostId = room.players[0].id;
    }
    if (this.activePlayers(room).length === 0) {
      if (!room.emptyTimer) room.emptyTimer = setTimeout(() => this.deleteRoom(room), EMPTY_ROOM_TTL_MS);
    }
    if (room.phase === 'playing' && room.round) {
      if (room.round.phase === 'loading') this.maybeStartAnswering(room);
      else if (room.round.phase === 'answering') {
        const active = this.activePlayers(room);
        if (active.length > 0 && active.every((p) => room.round!.answers.has(p.id))) return this.reveal(room);
      }
    }
    this.broadcast(room);
  }

  private deleteRoom(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    if (room.emptyTimer) clearTimeout(room.emptyTimer);
    for (const p of room.players) if (p.lobbyTimer) clearTimeout(p.lobbyTimer);
    for (const [t, ticket] of this.tickets) if (ticket.code === room.code) this.tickets.delete(t);
    for (const [sid, s] of this.sockets) if (s.code === room.code) this.sockets.delete(sid);
    this.rooms.delete(room.code);
  }

  private async startGame(room: Room, preresolved?: Resolved): Promise<Ack> {
    if (!room.catalogId) return { ok: false, error: 'Elige un catálogo antes de empezar.' };
    if (room.starting) return { ok: false, error: 'La partida ya se está preparando.' };
    let resolved = preresolved;
    if (!resolved) {
      room.starting = true;
      try {
        const check = await this.library.check(room.catalogId, room.settings);
        if (!check.ok || !check.resolved) return { ok: false, error: check.message };
        resolved = check.resolved;
      } finally {
        room.starting = false;
      }
      if (!this.rooms.has(room.code) || room.phase === 'playing') return { ok: false, error: 'La sala ya no está disponible.' };
    }
    if (resolved.deck.length < room.settings.rounds) return { ok: false, error: 'Faltan canciones para ese número de rondas.' };
    room.catalogName = resolved.name;
    room.pool = resolved.tracks;
    // Orden aleatorio salvo que sea una playlist y se pida respetar su orden.
    room.deck = resolved.ordered && !room.settings.shuffle ? [...resolved.deck] : shuffle(resolved.deck);
    room.recorded = false;
    room.used = new Set();
    room.history = [];
    room.phase = 'playing';
    for (const p of room.players) {
      p.score = 0; p.correct = 0;
      if (p.lobbyTimer) { clearTimeout(p.lobbyTimer); p.lobbyTimer = undefined; }
    }
    // Quien no está conectado al empezar no juega.
    room.players = room.players.filter((p) => p.connected && !p.left);
    room.round = null;
    // Cuenta atrás común «3, 2, 1» antes de la primera ronda.
    room.introUntil = Date.now() + INTRO_MS;
    this.setTimer(room, INTRO_MS, () => { room.introUntil = null; this.nextRound(room); });
    this.broadcast(room);
    return { ok: true };
  }

  private nextTrack(room: Room): Track | null {
    const t = room.deck.find((x) => !room.used.has(x.id));
    if (!t) return null;
    room.used.add(t.id);
    return t;
  }

  private nextRound(room: Room) {
    const index = (room.round?.index ?? 0) + 1;
    if (index > room.settings.rounds) return this.finish(room);
    const track = this.nextTrack(room);
    if (!track) return this.finish(room);
    this.setQuestion(room, index, track, 0);
  }

  private setQuestion(room: Room, index: number, track: Track, replacements: number) {
    if (room.round) this.tickets.delete(room.round.token);
    const distractors = shuffle(room.pool.filter((t) => t.title.toLowerCase() !== track.title.toLowerCase()))
      .slice(0, OPTIONS_PER_QUESTION - 1);
    const options = shuffle([track, ...distractors]).map((t) => ({ id: opaque(), title: t.title, cover: t.cover ?? null, isCorrect: t.id === track.id }));
    const token = opaque(18);
    if (track.file) {
      const path = this.library.local.audioPath(track);
      this.tickets.set(token, { path, type: AUDIO_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', code: room.code });
    } else {
      this.tickets.set(token, { url: track.previewUrl!, type: 'audio/mpeg', code: room.code, deezerId: track.deezerId });
    }
    room.round = {
      index, track, token, replacements, clipStart: Math.random(),
      questionId: opaque(),
      options: options.map(({ id, title, cover }) => ({ id, title, cover })),
      correctOptionId: options.find((o) => o.isCorrect)!.id,
      phase: 'loading', ready: new Set(), deadline: null, answers: new Map(), reveal: null,
    };
    this.setTimer(room, LOAD_TIMEOUT_MS, () => this.onLoadTimeout(room));
    this.broadcast(room);
  }

  private setTimer(room: Room, ms: number, fn: () => void) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = setTimeout(() => { room.timer = undefined; if (this.rooms.has(room.code)) fn(); }, ms);
  }

  private maybeStartAnswering(room: Room) {
    const round = room.round;
    if (!round || round.phase !== 'loading') return;
    const active = this.activePlayers(room);
    if (active.length > 0 && active.every((p) => round.ready.has(p.id))) this.startAnswering(room);
  }

  private onLoadTimeout(room: Room) {
    const round = room.round;
    if (!round || round.phase !== 'loading') return;
    if (this.activePlayers(room).length === 0) {
      // Nadie conectado: esperamos sin gastar canciones.
      return this.setTimer(room, LOAD_TIMEOUT_MS, () => this.onLoadTimeout(room));
    }
    if (round.ready.size > 0) this.startAnswering(room);
    else this.replaceTrack(room);
  }

  private replaceTrack(room: Room) {
    const round = room.round!;
    const next = round.replacements < MAX_REPLACEMENTS_PER_ROUND ? this.nextTrack(room) : null;
    if (next) return this.setQuestion(room, round.index, next, round.replacements + 1);
    // Sin repuesto: se anula la ronda para todos.
    this.reveal(room, true);
  }

  private startAnswering(room: Room) {
    const round = room.round!;
    round.phase = 'answering';
    round.deadline = Date.now() + ROUND_MS;
    this.setTimer(room, ROUND_MS + 30, () => this.reveal(room));
    this.broadcast(room);
  }

  private reveal(room: Room, voided = false) {
    const round = room.round;
    if (!round || round.phase === 'reveal') return;
    round.phase = 'reveal';
    const results = new Map<string, RoundResult>();
    for (const p of room.players) {
      const a = voided ? undefined : round.answers.get(p.id);
      const r: RoundResult = { playerId: p.id, optionId: a?.optionId ?? null, correct: !!a?.correct, points: a?.points ?? 0, timedOut: !a, lightning: !!a?.lightning, ms: a?.ms ?? null };
      p.score += r.points;
      if (r.correct) p.correct++;
      results.set(p.id, r);
    }
    round.reveal = {
      correctOptionId: voided ? null : round.correctOptionId,
      title: round.track.title,
      artist: round.track.artist,
      voided,
      link: round.track.storeUrl ?? null,
      linkLabel: round.track.storeUrl ? (round.track.deezerId ? 'Escuchar en Deezer' : 'Escuchar completa') : null,
      results: [...results.values()],
    };
    room.history.push({ index: round.index, track: round.track, voided, results });
    this.tickets.delete(round.token);
    this.setTimer(room, REVEAL_PAUSE_MS, () => this.nextRound(room));
    this.broadcast(room);
  }

  /** Victoria: 1.º puesto en multijugador o competitivo (empates incluidos). El modo solo es práctica. */
  private winners(room: Room): Set<string> {
    const active = room.players.filter((p) => !p.left);
    if (room.mode === 'solo') return new Set();
    // Competitivo: si el rival abandonó, gana quien sigue (aunque tenga 0 puntos).
    if (room.mode === 'ranked' && active.length === 1) return new Set([active[0].id]);
    if (active.length < MIN_PLAYERS_MULTI) return new Set();
    const top = Math.max(...active.map((p) => p.score));
    return new Set(active.filter((p) => p.score === top && top > 0).map((p) => p.id));
  }

  private finish(room: Room) {
    room.phase = 'results';
    if (room.timer) clearTimeout(room.timer);
    if (room.round) this.tickets.delete(room.round.token);
    // Solo cuentan las partidas multijugador; el modo solo es práctica y no se guarda.
    if (!room.recorded && this.library.store && room.mode !== 'solo') {
      room.recorded = true;
      const store = this.library.store;
      const won = this.winners(room);
      const outcomes = room.players.filter((p) => !p.left || room.mode === 'ranked').map((p) => ({ playerId: p.id, nickname: p.nickname, score: p.score, correct: p.correct, won: won.has(p.id) }));
      const job = room.mode === 'ranked' ? this.rateRanked(room, won).then(() => store.recordGame(outcomes)) : store.recordGame(outcomes);
      job.then(() => { for (const o of outcomes) this.ranks.delete(o.playerId); this.loadRanks(room); if (this.rooms.has(room.code)) this.broadcast(room); })
        .catch((e: unknown) => console.error('No se pudo guardar la partida', e));
    }
    this.afterPresenceChange(room);
  }

  // ---------- vistas ----------
  private broadcast(room: Room) {
    for (const p of room.players) if (p.socketId) this.send(p.socketId, 'room:state', this.view(room, p));
  }

  view(room: Room, me: Player): RoomState {
    const round = room.round;
    const players: PlayerView[] = room.players.map((p) => ({
      id: p.id, nickname: p.nickname, connected: p.connected, left: p.left, isHost: p.id === room.hostId,
      score: p.score, correct: p.correct, rank: this.ranks.get(p.id) ?? 'aprendiz',
      answered: !!round && round.phase !== 'loading' && round.answers.has(p.id),
    }));
    let roundView: RoomState['round'] = null;
    if (round && room.phase === 'playing') {
      const mine = round.answers.get(me.id);
      roundView = {
        index: round.index, total: room.settings.rounds, questionId: round.questionId, phase: round.phase,
        // Las opciones solo se muestran cuando arranca el temporizador.
        options: round.phase === 'loading' ? [] : round.options,
        audioUrl: `/api/audio/${round.token}`,
        clip: { start: round.clipStart, seconds: room.settings.clipSeconds },
        deadline: round.deadline, serverNow: Date.now(),
        yourAnswer: mine ? (round.phase === 'reveal' ? { ...mine } : { optionId: mine.optionId }) : null,
        reveal: round.reveal,
      };
    }
    let results: RoomState['results'] = null;
    if (room.phase === 'results') {
      const avg = (id: string) => {
        const ms = room.history.map((h) => h.results.get(id)).filter((r) => r?.correct && r.ms != null).map((r) => r!.ms!);
        return ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
      };
      const standings = rankStandings(room.players.map((p) => ({ playerId: p.id, nickname: p.nickname, score: p.score, correct: p.correct, left: p.left, avgMs: avg(p.id) })));
      const missed: MissedSong[] = [];
      for (const h of room.history) {
        const r = h.results.get(me.id);
        if (r && !r.correct) missed.push({ round: h.index, title: h.track.title, artist: h.track.artist, reason: h.voided ? 'voided' : r.timedOut ? 'timeout' : 'wrong' });
      }
      results = { standings, missed, totalRounds: room.settings.rounds, youWon: this.winners(room).has(me.id), rating: room.ratingChanges.get(me.id) ?? null };
    }
    return {
      code: room.code, mode: room.mode, phase: room.phase, you: me.id, hostId: room.hostId, players,
      catalog: room.catalogId ? { id: room.catalogId, name: room.catalogName ?? room.catalogId } : null,
      isPublic: room.isPublic,
      settings: room.settings,
      intro: room.phase === "playing" && !room.round && room.introUntil ? { startsAt: room.introUntil, serverNow: Date.now() } : null,
      round: roundView, results, maxPlayers: room.maxPlayers, minPlayers: MIN_PLAYERS_MULTI,
    };
  }
}
