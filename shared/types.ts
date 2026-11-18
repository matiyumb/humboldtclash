// Tipos compartidos entre cliente y servidor. Nada aquí identifica una pista:
// el cliente solo ve identificadores opacos y títulos de opciones.

export const ROUND_MS = 10_000;
export const REVEAL_PAUSE_MS = 5_000; // pausa entre canciones
export const MAX_PLAYERS = 10; // tamaño máximo de una sala
export const DEFAULT_ROOM_SIZE = 5;
export const MIN_PLAYERS_MULTI = 2;
export const OPTIONS_PER_QUESTION = 4;
export const INTRO_MS = 3_500; // cuenta atrás «3, 2, 1» antes de la primera ronda

// Rondas por partida (configurable).
export const MIN_ROUNDS = 5;
export const MAX_ROUNDS = 20;
export const DEFAULT_ROUNDS = 10;
/** Mínimo absoluto de canciones distintas para que un catálogo sea jugable. */
export const MIN_TRACKS = MIN_ROUNDS;

/** Easter egg «oído biónico»: acertar casi al instante (≤ 0,4 s) da el máximo y una insignia. */
export const LIGHTNING_MS = 400;

export type Difficulty = 'general' | 'mainstream' | 'fan' | 'nicho';

export interface GameSettings {
  rounds: number; // 5..20
  difficulty: Difficulty;
  clipSeconds: number; // duración del fragmento: 1 a 5 s, o 10 (completo)
  instrumental: boolean; // intenta quitar la voz (efecto karaoke)
  shuffle: boolean; // false = respeta el orden de la playlist
}

export const CLIP_CHOICES = [1, 2, 3, 4, 5, 10] as const;
export const FULL_CLIP = 10;
export const DEFAULT_SETTINGS: GameSettings = { rounds: DEFAULT_ROUNDS, difficulty: 'general', clipSeconds: FULL_CLIP, instrumental: false, shuffle: true };

export const DIFFICULTIES: { id: Difficulty; name: string; hint: string }[] = [
  { id: 'general', name: 'General', hint: 'Mezcla de todo' },
  { id: 'mainstream', name: 'Mainstream', hint: 'Solo los éxitos' },
  { id: 'fan', name: 'Fan', hint: 'Conocidas, sin ser hits' },
  { id: 'nicho', name: 'Nicho', hint: 'Las menos escuchadas' },
];

export function sanitizeSettings(raw: unknown): GameSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<GameSettings>;
  const rounds = Math.round(Number(r.rounds));
  return {
    rounds: Number.isFinite(rounds) ? Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, rounds)) : DEFAULT_ROUNDS,
    difficulty: DIFFICULTIES.some((d) => d.id === r.difficulty) ? (r.difficulty as Difficulty) : 'general',
    clipSeconds: (() => {
      const legacy = (r as { clip?: string }).clip === 'one' ? 1 : undefined;
      const v = Math.round(Number(r.clipSeconds ?? legacy));
      return (CLIP_CHOICES as readonly number[]).includes(v) ? v : FULL_CLIP;
    })(),
    instrumental: r.instrumental === true,
    shuffle: r.shuffle !== false,
  };
}

/** Puntos por canción: 0 a 10. */
export const MAX_POINTS = 10;

/**
 * 0 a 10 puntos por canción. Fallo o tiempo agotado: 0.
 * Acierto: 5 + 1 punto por cada 2 segundos que queden (redondeado), máximo 10.
 * Responder en el primer segundo da 10; el «oído biónico» (≤ 0,4 s) también.
 */
export function scoreFor(correct: boolean, remainingMs: number, elapsedMs = Infinity): number {
  if (!correct) return 0;
  if (elapsedMs <= LIGHTNING_MS) return MAX_POINTS;
  return Math.min(MAX_POINTS, 5 + Math.round(Math.max(0, remainingMs) / 2000));
}

// ---------- Rangos por victorias ----------
export interface RankDef { id: string; name: string; min: number; color: string; tone: 'neutral' | 'bronze' | 'silver' | 'gold' | 'royal' }
export const RANKS: RankDef[] = [
  { id: 'aprendiz', name: 'Aprendiz', min: 0, color: '#66952e', tone: 'neutral' },
  { id: 'rookie', name: 'Rookie', min: 50, color: '#b0703a', tone: 'bronze' },
  { id: 'conocedor', name: 'Conocedor', min: 100, color: '#9ea7b3', tone: 'silver' },
  { id: 'fan', name: 'Fan', min: 500, color: '#e0b116', tone: 'gold' },
  { id: 'melofano', name: 'Melófano', min: 5000, color: '#6b2fa8', tone: 'royal' },
];
export function rankFor(wins: number): { current: RankDef; next: RankDef | null } {
  let i = 0;
  while (i + 1 < RANKS.length && wins >= RANKS[i + 1].min) i++;
  return { current: RANKS[i], next: RANKS[i + 1] ?? null };
}
// Solo las victorias multijugador (salas y competitivo) cuentan para el rango; el modo solo es práctica.

// ---------- Competitivo (1v1 con MMR Glicko-2) ----------
export const RANKED_SETTINGS = { rounds: 10, difficulty: 'general' as Difficulty, clipSeconds: FULL_CLIP, instrumental: false, shuffle: true };
export const RANKED_CATALOG = 'deezer:chart';
export const DEFAULT_RATING = 1500;
/** Cambio de MMR: solo en el servidor. El MMR es secreto: sirve para emparejar, nunca se muestra. */
export interface RatingChange { before: number; after: number; delta: number }
export interface QueueStatus { searching: boolean; since: number; queued: number }
export interface AccountView { username: string; playerId: string }

export interface Profile {
  playerId: string;
  nickname: string;
  points: number;
  games: number;
  wins: number;
  correct: number;
  best: number;
  // Competitivo (Glicko-2)
  mmr: number;
  rd: number;
  vol: number;
  rankedGames: number;
  rankedWins: number;
}
export interface LeaderRow { position: number; playerId: string; nickname: string; points: number; wins: number; games: number; rankedWins: number; rankedGames: number }
/** Perfil tal como lo ve el cliente: sin MMR ni datos internos de Glicko. */
export type PublicProfile = Omit<Profile, 'mmr' | 'rd' | 'vol'>;

// ---------- Playlists de usuarios (mezclas) ----------
export interface MixTrack {
  deezerId: number;
  title: string;
  artist: string;
  cover: string | null;
  rank: number;
  preview: string;
  link: string;
}
export interface MixSummary { id: string; name: string; owner: string; ownerName: string; count: number; covers: string[]; artists: string[] }
export interface Mix extends MixSummary { tracks: MixTrack[] }

export interface CatalogSummary {
  id: string;
  kind: 'artist' | 'collection' | 'all' | 'playlist' | 'mix';
  source: 'local' | 'deezer' | 'mix';
  name: string;
  subtitle: string;
  trackCount: number | null; // canciones distintas con audio; null = se sabe al verificar (Deezer)
  playable: boolean;
  artists: string[];
  picture: string | null;
}

export interface PublicRoom {
  code: string;
  host: string;
  catalogName: string | null;
  players: number;
  maxPlayers: number;
}

export interface CatalogCheck {
  ok: boolean;
  catalogId: string;
  name?: string;
  playableCount: number;
  required: number;
  message: string;
}

export interface PlayerView {
  id: string;
  nickname: string;
  connected: boolean;
  left: boolean;
  isHost: boolean;
  score: number;
  correct: number;
  answered: boolean; // ¿ya respondió en la ronda actual?
  rank: string; // id del rango (por victorias guardadas)
}

export interface OptionView {
  id: string; // opaco, distinto en cada pregunta
  title: string;
  cover: string | null; // portada del álbum (si la hay)
}

export interface RoundResult {
  playerId: string;
  optionId: string | null;
  correct: boolean;
  points: number;
  timedOut: boolean;
  lightning: boolean; // easter egg «oído biónico»
  ms: number | null; // tiempo de respuesta
}

export interface RevealView {
  correctOptionId: string | null;
  title: string;
  artist: string;
  voided: boolean; // ronda anulada por audio irrecuperable
  link: string | null;
  linkLabel: string | null;
  results: RoundResult[];
}

export interface RoundView {
  index: number;
  total: number;
  questionId: string;
  phase: 'loading' | 'answering' | 'reveal';
  options: OptionView[];
  audioUrl: string;
  /** Fragmento: punto de inicio (0..1 de la parte reproducible) y segundos que suena. Igual para todos. */
  clip: { start: number; seconds: number };
  deadline: number | null; // hora del servidor (ms)
  serverNow: number;
  yourAnswer: { optionId: string; correct?: boolean; points?: number } | null;
  reveal: RevealView | null;
}

export interface StandingRow {
  position: number;
  playerId: string;
  nickname: string;
  score: number;
  correct: number;
  left: boolean;
  avgMs: number | null; // tiempo medio de respuesta en aciertos
}

export interface MissedSong {
  round: number;
  title: string;
  artist: string;
  reason: 'wrong' | 'timeout' | 'voided';
}

export interface ResultsView {
  standings: StandingRow[];
  missed: MissedSong[]; // de quien recibe la vista
  totalRounds: number;
  youWon: boolean; // cuenta como victoria para tu rango
}

export interface RoomState {
  code: string;
  mode: 'solo' | 'multi' | 'ranked';
  isPublic: boolean;
  phase: 'lobby' | 'playing' | 'results';
  you: string;
  hostId: string;
  players: PlayerView[];
  catalog: { id: string; name: string } | null;
  settings: GameSettings;
  round: RoundView | null;
  intro: { startsAt: number; serverNow: number } | null; // cuenta atrás de inicio
  results: ResultsView | null;
  maxPlayers: number;
  minPlayers: number;
}

export type Ack<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

export interface Identity {
  playerId: string;
  secret: string;
}
