// Tipos compartidos entre cliente y servidor. Nada aquí identifica una pista:
// el cliente solo ve identificadores opacos y títulos de opciones.

export const ROUNDS_PER_GAME = 10;
export const ROUND_MS = 10_000;
export const REVEAL_PAUSE_MS = 2_000;
export const MIN_TRACKS = 10;
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS_MULTI = 2;
export const OPTIONS_PER_QUESTION = 4;
export const INTRO_MS = 3_500; // cuenta atrás «3, 2, 1» antes de la primera ronda

export function scoreFor(correct: boolean, remainingMs: number): number {
  if (!correct) return 0;
  const fullSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  return Math.min(1000, 500 + 50 * fullSeconds);
}

export interface CatalogSummary {
  id: string;
  kind: 'artist' | 'collection' | 'all' | 'playlist';
  source: 'local' | 'deezer';
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
}

export interface RevealView {
  correctOptionId: string | null;
  title: string;
  artist: string;
  voided: boolean; // ronda anulada por audio irrecuperable
  link: string | null; // p. ej. enlace a Apple Music (atribución de vistas previas)
  linkLabel: string | null;
  results: RoundResult[];
}

export interface RoundView {
  index: number; // 1..10
  total: number;
  questionId: string;
  phase: 'loading' | 'answering' | 'reveal';
  options: OptionView[];
  audioUrl: string;
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
}

export interface RoomState {
  code: string;
  mode: 'solo' | 'multi';
  isPublic: boolean;
  phase: 'lobby' | 'playing' | 'results';
  you: string;
  hostId: string;
  players: PlayerView[];
  catalog: { id: string; name: string } | null;
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
