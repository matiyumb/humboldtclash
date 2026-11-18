import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIN_TRACKS, type CatalogCheck, type CatalogSummary } from '../../shared/types.js';
import { Catalog, distinctByTitle, remoteAllowed, type Track } from './catalog.js';
import { Deezer, DeezerError } from './deezer.js';

export interface Resolved { id: string; name: string; tracks: Track[] }

interface FeaturedConfig { artistas?: string[]; playlists?: { nombre?: string; id: number | string }[]; exitos?: boolean }

/**
 * Une las fuentes de canciones:
 *  - catálogo local (catalog/catalog.json + audio/)
 *  - Deezer: «deezer:artist:<id>», «deezer:playlist:<id>», «deezer:chart»
 */
export class Library {
  private featuredCache: { at: number; list: CatalogSummary[] } | null = null;

  constructor(readonly local: Catalog, readonly deezer: Deezer | null) {}

  private featuredConfig(): FeaturedConfig {
    const p = join(this.local.root, 'catalog/destacados.json');
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
    // Solo se guarda en caché si Deezer respondió con algún artista.
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

  /** Devuelve las canciones jugables (distintas, con audio) de un catálogo. */
  async resolve(id: string): Promise<Resolved | null> {
    if (typeof id !== 'string' || id.length > 80) return null;
    const m = id.match(/^deezer:(artist|playlist):(\d{1,15})$/);
    if (m || id === 'deezer:chart') {
      if (!this.deezer) return null;
      const src = id === 'deezer:chart' ? await this.deezer.chart() : m![1] === 'artist' ? await this.deezer.artist(Number(m![2])) : await this.deezer.playlist(Number(m![2]));
      return { id, name: src.name, tracks: distinctByTitle(src.tracks, (t) => !!t.previewUrl && remoteAllowed(t.previewUrl)) };
    }
    const tracks = this.local.playableTracks(id);
    return tracks ? { id, name: this.local.name(id), tracks } : null;
  }

  async check(id: string): Promise<CatalogCheck & { resolved?: Resolved }> {
    let r: Resolved | null;
    try {
      if (!id.startsWith('deezer:')) this.local.refresh();
      r = await this.resolve(id);
    } catch (e) {
      const msg = e instanceof DeezerError ? `${e.message} Inténtalo de nuevo en unos segundos.` : 'No se pudo cargar el catálogo.';
      return { ok: false, catalogId: id, playableCount: 0, required: MIN_TRACKS, message: msg };
    }
    if (!r) return { ok: false, catalogId: id, playableCount: 0, required: MIN_TRACKS, message: 'Ese catálogo no existe.' };
    const n = r.tracks.length;
    const ok = n >= MIN_TRACKS;
    return {
      ok, catalogId: id, name: r.name, playableCount: n, required: MIN_TRACKS, resolved: r,
      message: ok
        ? `${n} canciones distintas listas para sonar.`
        : `Solo hay ${n} canciones distintas con audio reproducible; hacen falta ${MIN_TRACKS}.`,
    };
  }
}
