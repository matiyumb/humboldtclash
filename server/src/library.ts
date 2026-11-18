import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_TRACKS, type CatalogCheck, type CatalogSummary, type Difficulty, type GameSettings, type MixTrack } from '../../shared/types.js';
import { Catalog, distinctByTitle, remoteAllowed, type Track } from './catalog.js';
import { Deezer, DeezerError } from './deezer.js';
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

/**
 * Dificultad por popularidad (Deezer «rank»): se ordenan de más a menos escuchadas y se toma
 * el tercio de arriba (mainstream), el del medio (fan) o el de abajo (nicho). Cada tramo tiene
 * al menos tantas canciones como rondas, para que siempre se pueda jugar si el catálogo alcanza.
 */
export function byDifficulty(tracks: Track[], difficulty: Difficulty, rounds: number): Track[] {
  if (difficulty === 'general' || tracks.length <= rounds) return tracks;
  const sorted = [...tracks].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
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

  constructor(readonly local: Catalog, readonly deezer: Deezer | null, readonly store: Store | null = null) {}

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

  async list(): Promise<{ featured: CatalogSummary[]; local: CatalogSummary[]; deezerOnline: boolean }> {
    this.local.refresh();
    const featured = await this.featured().catch(() => []);
    return { featured, local: this.local.list(), deezerOnline: featured.some((f) => f.kind === 'artist') };
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
    const tracks = distinctByTitle(raw, (t) => (t.file ? true : !!t.previewUrl && remoteAllowed(t.previewUrl)));
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
