// Datos que deben sobrevivir a reinicios: perfiles (puntos, victorias, rango, MMR), cuentas y playlists.
// - Con DATABASE_URL (Postgres: Neon, Supabase, Render…) se guarda en la base de datos.
// - Sin ella, en un archivo JSON (data/humboldtclash.json). En Render gratis ese archivo se borra en cada despliegue.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_RATING, type LeaderRow, type Mix, type MixSummary, type MixTrack, type Profile } from '../../shared/types.js';
import { DEFAULT_RD, DEFAULT_VOL } from './glicko.js';

export interface GameOutcome { playerId: string; nickname: string; score: number; correct: number; won: boolean }
export interface RankedOutcome { playerId: string; mmr: number; rd: number; vol: number; won: boolean; draw?: boolean }
export interface MixInput { name: string; tracks: MixTrack[] }
export interface Account { username: string; usernameKey: string; passHash: string; playerId: string; secret: string; createdAt: number }

export interface Store {
  readonly kind: 'postgres' | 'json' | 'memory';
  init(): Promise<void>;
  profile(playerId: string): Promise<Profile | null>;
  profiles(ids: string[]): Promise<Map<string, Profile>>;
  recordGame(outcomes: GameOutcome[]): Promise<void>;
  recordRanked(outcomes: RankedOutcome[]): Promise<void>;
  leaderboard(limit: number, by?: 'wins' | 'ranked'): Promise<LeaderRow[]>;
  createAccount(a: Account): Promise<boolean>; // false si el usuario ya existe
  account(usernameKey: string): Promise<Account | null>;
  accountOf(playerId: string): Promise<Account | null>;
  mix(id: string): Promise<Mix | null>;
  mixesOf(owner: string): Promise<MixSummary[]>;
  saveMix(owner: string, ownerName: string, input: MixInput, id?: string): Promise<Mix>;
  deleteMix(owner: string, id: string): Promise<boolean>;
  close(): Promise<void>;
}

export const emptyProfile = (playerId: string, nickname: string): Profile => ({
  playerId, nickname, points: 0, games: 0, wins: 0, correct: 0, best: 0,
  mmr: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL, rankedGames: 0, rankedWins: 0, rankedDraws: 0,
});

function summarize(m: Mix): MixSummary {
  const covers = [...new Set(m.tracks.map((t) => t.cover).filter((c): c is string => !!c))].slice(0, 4);
  const artists = [...new Set(m.tracks.map((t) => t.artist))].slice(0, 6);
  return { id: m.id, name: m.name, owner: m.owner, ownerName: m.ownerName, count: m.tracks.length, covers, artists };
}

function applyOutcome(p: Profile, o: GameOutcome): Profile {
  return {
    ...p,
    nickname: o.nickname || p.nickname,
    points: p.points + o.score,
    games: p.games + 1,
    wins: p.wins + (o.won ? 1 : 0),
    correct: p.correct + o.correct,
    best: Math.max(p.best, o.score),
  };
}

function rankRows(rows: Profile[], limit: number, by: 'wins' | 'ranked'): LeaderRow[] {
  // El ranking competitivo se ordena por victorias en duelos (el MMR es secreto).
  const pool = by === 'ranked' ? rows.filter((p) => p.rankedGames > 0) : rows.filter((p) => p.games > 0);
  const sorted = [...pool].sort(by === 'ranked' ? (a, b) => b.rankedWins - a.rankedWins || a.rankedGames - b.rankedGames : (a, b) => b.wins - a.wins || b.points - a.points).slice(0, limit);
  let lastKey = '';
  let lastPos = 0;
  return sorted.map((p, i) => {
    const key = by === 'ranked' ? `${p.rankedWins}:${p.rankedGames}` : `${p.wins}:${p.points}`;
    const position = key === lastKey ? lastPos : i + 1;
    lastKey = key; lastPos = position;
    return { position, playerId: p.playerId, nickname: p.nickname, points: p.points, wins: p.wins, games: p.games, rankedWins: p.rankedWins, rankedGames: p.rankedGames };
  });
}

/** En memoria, con volcado opcional a un archivo JSON. */
export class JsonStore implements Store {
  kind: 'json' | 'memory';
  private profilesMap = new Map<string, Profile>();
  private mixesMap = new Map<string, Mix>();
  private accounts = new Map<string, Account>();
  private timer?: NodeJS.Timeout;

  constructor(private file: string | null) {
    this.kind = file ? 'json' : 'memory';
  }

  async init() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const p of raw.profiles ?? []) this.profilesMap.set(p.playerId, { ...emptyProfile(p.playerId, p.nickname), ...p });
      for (const m of raw.mixes ?? []) this.mixesMap.set(m.id, m);
      for (const a of raw.accounts ?? []) this.accounts.set(a.usernameKey, a);
    } catch (e) {
      console.error('No se pudo leer', this.file, e);
    }
  }

  private persist() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        mkdirSync(dirname(this.file!), { recursive: true });
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify({ profiles: [...this.profilesMap.values()], mixes: [...this.mixesMap.values()], accounts: [...this.accounts.values()] }));
        renameSync(tmp, this.file!);
      } catch (e) {
        console.error('No se pudo guardar', this.file, e);
      }
    }, 300);
  }

  async profile(id: string) { return this.profilesMap.get(id) ?? null; }
  async profiles(ids: string[]) {
    const out = new Map<string, Profile>();
    for (const id of ids) { const p = this.profilesMap.get(id); if (p) out.set(id, p); }
    return out;
  }
  async recordGame(outcomes: GameOutcome[]) {
    for (const o of outcomes) this.profilesMap.set(o.playerId, applyOutcome(this.profilesMap.get(o.playerId) ?? emptyProfile(o.playerId, o.nickname), o));
    this.persist();
  }
  async recordRanked(outcomes: RankedOutcome[]) {
    for (const o of outcomes) {
      const p = this.profilesMap.get(o.playerId) ?? emptyProfile(o.playerId, '');
      this.profilesMap.set(o.playerId, {
        ...p, mmr: o.mmr, rd: o.rd, vol: o.vol,
        rankedGames: p.rankedGames + 1, rankedWins: p.rankedWins + (o.won ? 1 : 0), rankedDraws: (p.rankedDraws ?? 0) + (o.draw ? 1 : 0),
      });
    }
    this.persist();
  }
  async leaderboard(limit: number, by: 'wins' | 'ranked' = 'wins') { return rankRows([...this.profilesMap.values()], limit, by); }
  async createAccount(a: Account) {
    if (this.accounts.has(a.usernameKey)) return false;
    this.accounts.set(a.usernameKey, a);
    this.persist();
    return true;
  }
  async account(key: string) { return this.accounts.get(key) ?? null; }
  async accountOf(playerId: string) { return [...this.accounts.values()].find((a) => a.playerId === playerId) ?? null; }
  async mix(id: string) { return this.mixesMap.get(id) ?? null; }
  async mixesOf(owner: string) {
    return [...this.mixesMap.values()].filter((m) => m.owner === owner).map(summarize);
  }
  async saveMix(owner: string, ownerName: string, input: MixInput, id?: string) {
    const existing = id ? this.mixesMap.get(id) : undefined;
    if (existing && existing.owner !== owner) throw new Error('No puedes editar esta playlist.');
    const base = { id: existing?.id ?? randomBytes(6).toString('base64url'), name: input.name, owner, ownerName, tracks: input.tracks } as Mix;
    const mix: Mix = { ...summarize(base), tracks: input.tracks };
    this.mixesMap.set(mix.id, mix);
    this.persist();
    return mix;
  }
  async deleteMix(owner: string, id: string) {
    const m = this.mixesMap.get(id);
    if (!m || m.owner !== owner) return false;
    this.mixesMap.delete(id);
    this.persist();
    return true;
  }
  async close() {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
  }
}

/** Postgres (DATABASE_URL). Crea y actualiza las tablas al arrancar. */
export class PgStore implements Store {
  kind = 'postgres' as const;
  private pool: import('pg').Pool | null = null;

  constructor(private url: string) {}

  async init() {
    const { default: pg } = await import('pg');
    const local = /localhost|127\.0\.0\.1/.test(this.url) || this.url.includes('sslmode=disable');
    this.pool = new pg.Pool({ connectionString: this.url, max: 5, ssl: local ? undefined : { rejectUnauthorized: false } });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS hc_profiles (
        player_id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        points BIGINT NOT NULL DEFAULT 0,
        games INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        correct INTEGER NOT NULL DEFAULT 0,
        best INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE hc_profiles ADD COLUMN IF NOT EXISTS mmr INTEGER NOT NULL DEFAULT ${DEFAULT_RATING};
      ALTER TABLE hc_profiles ADD COLUMN IF NOT EXISTS rd DOUBLE PRECISION NOT NULL DEFAULT ${DEFAULT_RD};
      ALTER TABLE hc_profiles ADD COLUMN IF NOT EXISTS vol DOUBLE PRECISION NOT NULL DEFAULT ${DEFAULT_VOL};
      ALTER TABLE hc_profiles ADD COLUMN IF NOT EXISTS ranked_games INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE hc_profiles ADD COLUMN IF NOT EXISTS ranked_wins INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE hc_profiles ADD COLUMN IF NOT EXISTS ranked_draws INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS hc_profiles_rank ON hc_profiles (wins DESC, points DESC);
      CREATE INDEX IF NOT EXISTS hc_profiles_mmr ON hc_profiles (mmr DESC) WHERE ranked_games > 0;
      CREATE TABLE IF NOT EXISTS hc_mixes (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        name TEXT NOT NULL,
        tracks JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS hc_mixes_owner ON hc_mixes (owner);
      CREATE TABLE IF NOT EXISTS hc_accounts (
        username_key TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        pass_hash TEXT NOT NULL,
        player_id TEXT NOT NULL UNIQUE,
        secret TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  private get db() {
    if (!this.pool) throw new Error('Base de datos no iniciada');
    return this.pool;
  }

  private static row(r: Record<string, unknown>): Profile {
    return {
      playerId: String(r.player_id), nickname: String(r.nickname), points: Number(r.points), games: Number(r.games), wins: Number(r.wins),
      correct: Number(r.correct), best: Number(r.best), mmr: Number(r.mmr), rd: Number(r.rd), vol: Number(r.vol),
      rankedGames: Number(r.ranked_games), rankedWins: Number(r.ranked_wins), rankedDraws: Number(r.ranked_draws ?? 0),
    };
  }
  private static mixRow(r: Record<string, unknown>): Mix {
    const tracks = r.tracks as MixTrack[];
    const base = { id: String(r.id), name: String(r.name), owner: String(r.owner), ownerName: String(r.owner_name), tracks } as Mix;
    return { ...summarize(base), tracks };
  }
  private static accRow(r: Record<string, unknown>): Account {
    return { username: String(r.username), usernameKey: String(r.username_key), passHash: String(r.pass_hash), playerId: String(r.player_id), secret: String(r.secret), createdAt: new Date(String(r.created_at)).getTime() };
  }

  async profile(id: string) {
    const r = await this.db.query('SELECT * FROM hc_profiles WHERE player_id = $1', [id]);
    return r.rows[0] ? PgStore.row(r.rows[0]) : null;
  }
  async profiles(ids: string[]) {
    const out = new Map<string, Profile>();
    if (!ids.length) return out;
    const r = await this.db.query('SELECT * FROM hc_profiles WHERE player_id = ANY($1)', [ids]);
    for (const row of r.rows) { const p = PgStore.row(row); out.set(p.playerId, p); }
    return out;
  }
  async recordGame(outcomes: GameOutcome[]) {
    for (const o of outcomes) {
      await this.db.query(
        `INSERT INTO hc_profiles (player_id, nickname, points, games, wins, correct, best)
         VALUES ($1, $2, $3::bigint, 1, $4, $5, $6::int)
         ON CONFLICT (player_id) DO UPDATE SET
           nickname = EXCLUDED.nickname,
           points = hc_profiles.points + EXCLUDED.points,
           games = hc_profiles.games + 1,
           wins = hc_profiles.wins + EXCLUDED.wins,
           correct = hc_profiles.correct + EXCLUDED.correct,
           best = GREATEST(hc_profiles.best, EXCLUDED.best),
           updated_at = now()`,
        [o.playerId, o.nickname, o.score, o.won ? 1 : 0, o.correct, o.score],
      );
    }
  }
  async recordRanked(outcomes: RankedOutcome[]) {
    for (const o of outcomes) {
      await this.db.query(
        `INSERT INTO hc_profiles (player_id, nickname, mmr, rd, vol, ranked_games, ranked_wins, ranked_draws)
         VALUES ($1, '', $2, $3, $4, 1, $5, $6)
         ON CONFLICT (player_id) DO UPDATE SET
           mmr = EXCLUDED.mmr, rd = EXCLUDED.rd, vol = EXCLUDED.vol,
           ranked_games = hc_profiles.ranked_games + 1,
           ranked_wins = hc_profiles.ranked_wins + EXCLUDED.ranked_wins,
           ranked_draws = hc_profiles.ranked_draws + EXCLUDED.ranked_draws,
           updated_at = now()`,
        [o.playerId, o.mmr, o.rd, o.vol, o.won ? 1 : 0, o.draw ? 1 : 0],
      );
    }
  }
  async leaderboard(limit: number, by: 'wins' | 'ranked' = 'wins') {
    const r = by === 'ranked'
      ? await this.db.query('SELECT * FROM hc_profiles WHERE ranked_games > 0 ORDER BY ranked_wins DESC, ranked_games ASC LIMIT $1', [limit])
      : await this.db.query('SELECT * FROM hc_profiles WHERE games > 0 ORDER BY wins DESC, points DESC LIMIT $1', [limit]);
    return rankRows(r.rows.map(PgStore.row), limit, by);
  }
  async createAccount(a: Account) {
    const r = await this.db.query(
      'INSERT INTO hc_accounts (username_key, username, pass_hash, player_id, secret) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [a.usernameKey, a.username, a.passHash, a.playerId, a.secret],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async account(key: string) {
    const r = await this.db.query('SELECT * FROM hc_accounts WHERE username_key = $1', [key]);
    return r.rows[0] ? PgStore.accRow(r.rows[0]) : null;
  }
  async accountOf(playerId: string) {
    const r = await this.db.query('SELECT * FROM hc_accounts WHERE player_id = $1', [playerId]);
    return r.rows[0] ? PgStore.accRow(r.rows[0]) : null;
  }
  async mix(id: string) {
    const r = await this.db.query('SELECT * FROM hc_mixes WHERE id = $1', [id]);
    return r.rows[0] ? PgStore.mixRow(r.rows[0]) : null;
  }
  async mixesOf(owner: string) {
    const r = await this.db.query('SELECT * FROM hc_mixes WHERE owner = $1 ORDER BY updated_at DESC', [owner]);
    return r.rows.map((row) => summarize(PgStore.mixRow(row)));
  }
  async saveMix(owner: string, ownerName: string, input: MixInput, id?: string) {
    if (id) {
      const cur = await this.mix(id);
      if (cur && cur.owner !== owner) throw new Error('No puedes editar esta playlist.');
      if (cur) {
        const r = await this.db.query('UPDATE hc_mixes SET name = $2, tracks = $3, owner_name = $4, updated_at = now() WHERE id = $1 RETURNING *', [id, input.name, JSON.stringify(input.tracks), ownerName]);
        return PgStore.mixRow(r.rows[0]);
      }
    }
    const newId = randomBytes(6).toString('base64url');
    const r = await this.db.query('INSERT INTO hc_mixes (id, owner, owner_name, name, tracks) VALUES ($1, $2, $3, $4, $5) RETURNING *', [newId, owner, ownerName, input.name, JSON.stringify(input.tracks)]);
    return PgStore.mixRow(r.rows[0]);
  }
  async deleteMix(owner: string, id: string) {
    const r = await this.db.query('DELETE FROM hc_mixes WHERE id = $1 AND owner = $2', [id, owner]);
    return (r.rowCount ?? 0) > 0;
  }
  async close() { await this.pool?.end(); }
}

export async function createStore(root: string): Promise<Store> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const s = new PgStore(url);
    await s.init();
    console.log('Datos guardados en Postgres (DATABASE_URL).');
    return s;
  }
  const file = process.env.DATA_FILE ?? `${root}/data/humboldtclash.json`;
  const s = new JsonStore(file);
  await s.init();
  console.warn(`⚠ Sin DATABASE_URL: datos en ${file}. En Render gratis se pierden en cada despliegue (ver README).`);
  return s;
}
