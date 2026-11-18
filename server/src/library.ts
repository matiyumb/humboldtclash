import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_TRACKS, type CatalogCheck, type CatalogSummary, type Difficulty, type GameSettings, type MixTrack } from '../../shared/types.js';
import { Catalog, distinctByTitle, remoteAllowed, type Track } from './catalog.js';
import { Deezer, DeezerError } from './deezer.js';
import type { LastFm } from './lastfm.js';
import type { Store } from './store.js';

export interface Resolved {
  id: string;
  name: string;
  /** Todas las canciones jugables del catálogo (para las opciones falsas). */
  tracks: Track[];
  /** Las que pueden sonar según la dificultad elegida. */
  deck: Track[];
  /** ¿Tiene un orden propio (playlist/mezcla) que se puede respetar? */
  ordered: boolean;
}

interface FeaturedConfig { artistas?: string[]; playlists?: { nombre?: string; id: number | string }[]; exitos?: boolean }

export function mixTrackToTrack(t: MixTrack, collection: string): Track {
  return {
    id: `dz-${t.deezerId}`, deezerId: t.deezerId, title: t.title, artist: t.artist, collection,
    previewUrl: t.preview, storeUrl: t.link, cover: t.cover ?? undefined, rank: t.rank,
    origin: 'Deezer – vista previa oficial de 30 s (playlist de usuario)',
    license: 'Vista previa de Deezer: uso no comercial con atribución',
  };
}

/** Por debajo de esta cobertura, los oyentes de Last.fm se ignoran y manda el «rank» de Deezer. */
export const LASTFM_MIN_COVERAGE = 0.5;

/**
 * Orden de más a menos popular. Si Last.fm conoce al menos la mitad de las canciones, manda su
 * número de oyentes; para el resto se usa el «rank» de Deezer. Las dos escalas no se comparan
 * directamente: cada pista recibe su percentil (0 = la menos escuchada, 1 = la más) dentro de su
 * fuente, y se ordena por ese percentil.
 */
export function byPopularity(tracks: Track[]): Track[] {
  const byRank = (a: Track, b: Track) => (b.rank ?? 0) - (a.rank ?? 0);
  const known = tracks.filter((t) => typeof t.listeners === 'number');
  if (!tracks.length || known.length < tracks.length * LASTFM_MIN_COVERAGE) return [...tracks].sort(byRank);
  const pct = (list: Track[], value: (t: Track) => number) => {
    const asc = [...list].sort((a, b) => value(a) - value(b));
    return new Map(asc.map((t, i) => [t.id, asc.length > 1 ? i / (asc.length - 1) : 0.5]));
  };
  const fm = pct(known, (t) => t.listeners!);
  const dz = pct(tracks, (t) => t.rank ?? 0);
  const score = (t: Track) => fm.get(t.id) ?? dz.get(t.id) ?? 0;
  return [...tracks].sort((a, b) => score(b) - score(a) || byRank(a, b));
}

/**
 * Dificultad por popularidad (oyentes de Last.fm o «rank» de Deezer): se ordenan de más a menos
 * escuchadas y se toma el tercio de arriba (mainstream), el del medio (fan) o el de abajo (nicho).
 * Cada tramo tiene al menos tantas canciones como rondas, para que siempre se pueda jugar si el
 * catálogo alcanza.
 */
export function byDifficulty(tracks: Track[], difficulty: Difficulty, rounds: number): Track[] {
  if (difficulty === 'general' || tracks.length <= rounds) return tracks;
  const sorted = byPopularity(tracks);
  const n = sorted.length;
  const size = Math.min(n, Math.max(Math.ceil(n / 3), rounds));
  const ids = new Set(
    (difficulty === 'mainstream'
      ? sorted.slice(0, size)
      : difficulty === 'nicho'
        ? sorted.slice(n - size)
        : sorted.slice(Math.max(0, Math.floor((n - size) / 2)), Math.max(0, Math.floor((n - size) / 2)) + size)
    ).map((t) => t.id),
  );
  // Se mantiene el orden original (importa en las playlists).
  return tracks.filter((t) => ids.has(t.id));
}

/**
 * Une las fuentes de canciones:
 *  - Deezer: «deezer:artist:<id>», «deezer:playlist:<id>», «deezer:chart»
 *  - playlists de usuarios: «mix:<id>»
 *  - catálogo propio (catalog/catalog.json + audio/), si tiene canciones
 */
export class Library {
  private featuredCache: { at: number; list: CatalogSummary[] } | null = null;

  constructor(
    readonly local: Catalog,
    readonly deezer: Deezer | null,
    readonly store: Store | null = null,
    readonly lastfm: LastFm | null = null,
  ) {}

  /** Añade los oyentes de Last.fm a las pistas remotas (si está configurado). Nunca falla. */
  private async withListeners(tracks: Track[]): Promise<Track[]> {
    if (!this.lastfm) return tracks;
    const remote = tracks.filter((t) => !t.file);
    if (!remote.length) return tracks;
    const listeners = await this.lastfm.listenersFor(remote).catch(() => new Map<string, number>());
    if (!listeners.size) return tracks;
    return tracks.map((t) => (listeners.has(t.id) ? { ...t, listeners: listeners.get(t.id) } : t));
  }

  private featuredConfig(): FeaturedConfig {
    const p = join(process.env.FEATURED_FILE ?? join(process.cwd(), 'catalog/destacados.json'));
    if (!existsSync(p)) return {};
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
  }

  /** Destacados de Deezer (artistas de catalog/destacados.json). Si Deezer no responde, se omiten. */
  async featured(): Promise<CatalogSummary[]> {
    if (!this.deezer) return [];
    if (this.featuredCache && Date.now() - this.featuredCache.at < 6 * 3600_000 && this.featuredCache.list.length) return this.featuredCache.list;
    const cfg = this.featuredConfig();
    const out: CatalogSummary[] = [];
    if (cfg.exitos !== false) {
      out.push({ id: 'deezer:chart', kind: 'playlist', source: 'deezer', name: 'Éxitos del momento', subtitle: 'Deezer · lista de éxitos', trackCount: null, playable: true, artists: [], picture: null });
    }
    const artists = await Promise.all(
      (cfg.artistas ?? []).map(async (name) => {
        try {
          const found = await this.deezer!.searchArtists(name, 5);
          const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
          return found.find((a) => norm(a.name) === norm(name)) ?? found[0] ?? null;
        } catch {
          return null;
        }
      }),
    );
    out.push(...artists.filter((a): a is CatalogSummary => !!a));
    for (const pl of cfg.playlists ?? []) {
      const id = Number(pl.id);
      if (!Number.isFinite(id)) continue;
      out.push({ id: `deezer:playlist:${id}`, kind: 'playlist', source: 'deezer', name: pl.nombre ?? `Playlist ${id}`, subtitle: 'Deezer · playlist', trackCount: null, playable: true, artists: [], picture: null });
    }
    if (artists.some(Boolean) || !(cfg.artistas ?? []).length) this.featuredCache = { at: Date.now(), list: out };
    return out;
  }

  /**
   * Portada del juego:
   *  - trending: artistas más sonados ahora (lista de éxitos de Deezer, se renueva sola)
   *  - playlists: «Éxitos del momento» + playlists oficiales más escuchadas de Deezer
   *  - featured: extras opcionales de catalog/destacados.json
   */
  async list(): Promise<{ trending: CatalogSummary[]; playlists: CatalogSummary[]; featured: CatalogSummary[]; local: CatalogSummary[]; deezerOnline: boolean }> {
    this.local.refresh();
    const chartCard: CatalogSummary = { id: 'deezer:chart', kind: 'playlist', source: 'deezer', name: 'Éxitos del momento', subtitle: 'Top 100 de Deezer', trackCount: null, playable: true, artists: [], picture: null };
    const [trending, official, featured] = await Promise.all([
      this.deezer ? this.deezer.chartArtists(12).catch(() => []) : [],
      this.deezer ? this.deezer.chartPlaylists(10).catch(() => []) : [],
      this.featured().then((f) => f.filter((x) => x.id !== 'deezer:chart')).catch(() => []),
    ]);
    const playlists = this.deezer ? [chartCard, ...official] : [];
    return { trending, playlists, featured, local: this.local.list(), deezerOnline: trending.length > 0 };
  }

  async search(q: string): Promise<CatalogSummary[]> {
    if (!this.deezer) return [];
    return this.deezer.searchArtists(q);
  }

  /** Canciones jugables (distintas, con audio) de un catálogo, filtradas por dificultad. */
  async resolve(id: string, settings: GameSettings): Promise<Resolved | null> {
    if (typeof id !== 'string' || id.length > 80) return null;
    let name: string;
    let raw: Track[];
    let ordered = false;
    const m = id.match(/^deezer:(artist|playlist):(\d{1,15})$/);
    const mix = id.match(/^mix:([A-Za-z0-9_-]{4,24})$/);
    if (m || id === 'deezer:chart') {
      if (!this.deezer) return null;
      const src = id === 'deezer:chart' ? await this.deezer.chart() : m![1] === 'artist' ? await this.deezer.artist(Number(m![2])) : await this.deezer.playlist(Number(m![2]));
      name = src.name;
      raw = src.tracks;
      ordered = m?.[1] === 'playlist';
    } else if (mix) {
      const found = this.store ? await this.store.mix(mix[1]) : null;
      if (!found) return null;
      name = found.name;
      raw = found.tracks.map((t) => mixTrackToTrack(t, found.name));
      ordered = true;
    } else {
      const local = this.local.playableTracks(id);
      if (!local) return null;
      name = this.local.name(id);
      raw = local;
    }
    let tracks = distinctByTitle(raw, (t) => (t.file ? true : !!t.previewUrl && remoteAllowed(t.previewUrl)));
    // Last.fm solo hace falta para repartir por dificultad; en «general» se ahorran las consultas.
    if (settings.difficulty !== 'general' && tracks.length > settings.rounds) tracks = await this.withListeners(tracks);
    return { id, name, tracks, deck: byDifficulty(tracks, settings.difficulty, settings.rounds), ordered };
  }

  async check(id: string, settings: GameSettings): Promise<CatalogCheck & { resolved?: Resolved }> {
    const required = Math.max(MIN_TRACKS, settings.rounds);
    let r: Resolved | null;
    try {
      if (!id.startsWith('deezer:') && !id.startsWith('mix:')) this.local.refresh();
      r = await this.resolve(id, settings);
    } catch (e) {
      const msg = e instanceof DeezerError ? `${e.message} Inténtalo de nuevo en unos segundos.` : 'No se pudo cargar el catálogo.';
      return { ok: false, catalogId: id, playableCount: 0, required, message: msg };
    }
    if (!r) return { ok: false, catalogId: id, playableCount: 0, required, message: 'Ese catálogo no existe.' };
    const n = r.deck.length;
    const ok = n >= required && r.tracks.length >= 4;
    const tier = settings.difficulty === 'general' ? '' : ` en nivel ${settings.difficulty[0].toUpperCase()}${settings.difficulty.slice(1)}`;
    return {
      ok, catalogId: id, name: r.name, playableCount: n, required, resolved: r,
      message: ok
        ? `${n} canciones${tier} listas para ${settings.rounds} rondas.`
        : r.tracks.length < required
          ? `Solo hay ${r.tracks.length} canciones distintas con audio; para ${settings.rounds} rondas hacen falta ${required}.`
          : `Solo hay ${n} canciones${tier}; baja el número de rondas o elige otra dificultad.`,
    };
  }
}
