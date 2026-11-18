// API propia de Humboldtclash sobre la API pública de Deezer (sin clave).
// Busca artistas, trae sus canciones top / playlists / éxitos con vista previa de 30 s,
// y guarda en caché las respuestas para no superar el límite de Deezer (≈50 peticiones / 5 s).
import type { CatalogSummary, MixTrack } from '../../shared/types.js';
import type { Track } from './catalog.js';

export interface DeezerTrackRaw {
  id: number;
  title: string;
  title_short?: string;
  preview?: string;
  link?: string;
  readable?: boolean;
  rank?: number;
  artist?: { id: number; name: string };
  album?: { title?: string; cover?: string; cover_medium?: string };
}

export class DeezerError extends Error {}

const ORIGIN = 'Deezer – vista previa oficial de 30 s (api.deezer.com)';
const LICENSE = 'Vista previa de Deezer: uso no comercial con atribución (términos de la API de Deezer)';

export function deezerToTrack(d: DeezerTrackRaw, collection: string): Track | null {
  if (!d?.id || !d.preview || d.readable === false) return null;
  const title = (d.title_short || d.title || '').trim();
  if (!title) return null;
  return {
    id: `dz-${d.id}`,
    deezerId: d.id,
    title,
    artist: d.artist?.name ?? 'Desconocido',
    collection,
    previewUrl: d.preview,
    storeUrl: d.link ?? `https://www.deezer.com/track/${d.id}`,
    cover: d.album?.cover_medium || d.album?.cover || undefined,
    rank: typeof d.rank === "number" ? d.rank : 0,
    origin: ORIGIN,
    license: LICENSE,
  };
}

export function toMixTrack(d: DeezerTrackRaw): MixTrack | null {
  const t = deezerToTrack(d, '');
  if (!t) return null;
  return { deezerId: d.id, title: t.title, artist: t.artist, cover: t.cover ?? null, rank: t.rank ?? 0, preview: t.previewUrl!, link: t.storeUrl! };
}

export class Deezer {
  private cache = new Map<string, { at: number; data: unknown }>();
  private inflight = new Map<string, Promise<unknown>>();

  constructor(
    readonly base = (process.env.DEEZER_API_BASE ?? 'https://api.deezer.com').replace(/\/$/, ''),
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string, ttlMs: number): Promise<T> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
    if (this.inflight.has(path)) return this.inflight.get(path) as Promise<T>;
    const p = (async () => {
      try {
        const r = await this.fetchImpl(`${this.base}${path}`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
        if (!r.ok) throw new DeezerError(`Deezer respondió ${r.status}`);
        const data = (await r.json()) as { error?: { message?: string } };
        if (data && typeof data === 'object' && 'error' in data && data.error) throw new DeezerError(`Deezer: ${data.error.message ?? 'error'}`);
        this.cache.set(path, { at: Date.now(), data });
        if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
        return data;
      } catch (e) {
        if (e instanceof DeezerError) throw e;
        throw new DeezerError('No se pudo conectar con Deezer.');
      } finally {
        this.inflight.delete(path);
      }
    })();
    this.inflight.set(path, p);
    return p as Promise<T>;
  }

  async searchArtists(q: string, limit = 12): Promise<CatalogSummary[]> {
    const query = q.trim().slice(0, 80);
    if (query.length < 2) return [];
    const res = await this.get<{ data: { id: number; name: string; nb_fan?: number; picture_medium?: string; nb_album?: number }[] }>(
      `/search/artist?q=${encodeURIComponent(query)}&limit=${limit}`,
      10 * 60_000,
    );
    return (res.data ?? []).map((a) => ({
      id: `deezer:artist:${a.id}`,
      kind: 'artist' as const,
      source: 'deezer' as const,
      name: a.name,
      subtitle: a.nb_fan ? `Deezer · ${formatFans(a.nb_fan)} fans` : 'Deezer',
      trackCount: null,
      playable: true,
      artists: [a.name],
      picture: a.picture_medium ?? null,
    }));
  }

  async artist(id: number): Promise<{ name: string; tracks: Track[] }> {
    const [info, top] = await Promise.all([
      this.get<{ name: string }>(`/artist/${id}`, 6 * 3600_000),
      this.get<{ data: DeezerTrackRaw[] }>(`/artist/${id}/top?limit=100`, 30 * 60_000),
    ]);
    return { name: info.name, tracks: (top.data ?? []).map((d) => deezerToTrack(d, info.name)).filter((t): t is Track => !!t) };
  }

  async playlist(id: number): Promise<{ name: string; tracks: Track[] }> {
    const [info, list] = await Promise.all([
      this.get<{ title: string }>(`/playlist/${id}`, 6 * 3600_000),
      this.get<{ data: DeezerTrackRaw[] }>(`/playlist/${id}/tracks?limit=300`, 30 * 60_000),
    ]);
    return { name: info.title, tracks: (list.data ?? []).map((d) => deezerToTrack(d, info.title)).filter((t): t is Track => !!t) };
  }

  async chart(): Promise<{ name: string; tracks: Track[] }> {
    const res = await this.get<{ data: DeezerTrackRaw[] }>(`/chart/0/tracks?limit=100`, 30 * 60_000);
    const name = 'Éxitos del momento';
    return { name, tracks: (res.data ?? []).map((d) => deezerToTrack(d, name)).filter((t): t is Track => !!t) };
  }

  /** Artistas más escuchados ahora mismo (lista de éxitos de Deezer, se renueva sola). */
  async chartArtists(limit = 12): Promise<CatalogSummary[]> {
    const res = await this.get<{ data: { id: number; name: string; picture_medium?: string; position?: number }[] }>(`/chart/0/artists?limit=${limit}`, 6 * 3600_000);
    return (res.data ?? []).map((a, i) => ({
      id: `deezer:artist:${a.id}`, kind: 'artist' as const, source: 'deezer' as const, name: a.name,
      subtitle: `#${a.position ?? i + 1} esta semana`, trackCount: null, playable: true, artists: [a.name], picture: a.picture_medium ?? null,
    }));
  }

  /** Playlists oficiales de Deezer más escuchadas (tops por país, del mundo…). */
  async chartPlaylists(limit = 10): Promise<CatalogSummary[]> {
    const res = await this.get<{ data: { id: number; title: string; picture_medium?: string; nb_tracks?: number; user?: { name?: string } }[] }>(`/chart/0/playlists?limit=${limit}`, 6 * 3600_000);
    return (res.data ?? []).map((p) => ({
      id: `deezer:playlist:${p.id}`, kind: 'playlist' as const, source: 'deezer' as const, name: p.title,
      subtitle: `Playlist oficial${p.nb_tracks ? ` · ${p.nb_tracks} canciones` : ''}`, trackCount: null, playable: true, artists: [], picture: p.picture_medium ?? null,
    }));
  }

  /** Datos de una playlist (para pegar su enlace). */
  async playlistSummary(id: number): Promise<CatalogSummary> {
    const p = await this.get<{ id: number; title: string; picture_medium?: string; nb_tracks?: number; creator?: { name?: string } }>(`/playlist/${id}`, 3600_000);
    return {
      id: `deezer:playlist:${p.id}`, kind: 'playlist', source: 'deezer', name: p.title,
      subtitle: `Playlist${p.creator?.name ? ` de ${p.creator.name}` : ''}${p.nb_tracks ? ` · ${p.nb_tracks} canciones` : ''}`, trackCount: null, playable: true, artists: [], picture: p.picture_medium ?? null,
    };
  }

  /** Empareja una línea «Artista - Canción» (o «Canción, Artista» de un CSV) con Deezer. */
  async matchLine(artist: string, title: string): Promise<MixTrack | null> {
    const a = artist.trim().slice(0, 80), t = title.trim().slice(0, 120);
    if (!t) return null;
    const strict = a ? `artist:"${a.replace(/"/g, '')}" track:"${t.replace(/"/g, '')}"` : t;
    for (const q of [strict, `${a} ${t}`.trim()]) {
      const res = await this.get<{ data: DeezerTrackRaw[] }>(`/search?q=${encodeURIComponent(q)}&limit=3`, 24 * 3600_000).catch(() => ({ data: [] as DeezerTrackRaw[] }));
      const hit = (res.data ?? []).map(toMixTrack).find((x): x is MixTrack => !!x);
      if (hit) return hit;
    }
    return null;
  }

  /** Búsqueda de canciones (para armar playlists). */
  async searchTracks(q: string, limit = 25): Promise<MixTrack[]> {
    const query = q.trim().slice(0, 80);
    if (query.length < 2) return [];
    const res = await this.get<{ data: DeezerTrackRaw[] }>(`/search?q=${encodeURIComponent(query)}&limit=${limit}`, 10 * 60_000);
    return (res.data ?? []).map(toMixTrack).filter((t): t is MixTrack => !!t);
  }

  /** Canciones top de un artista en formato de playlist (para la mezcla aleatoria). */
  async artistMixTracks(id: number): Promise<MixTrack[]> {
    const top = await this.get<{ data: DeezerTrackRaw[] }>(`/artist/${id}/top?limit=100`, 30 * 60_000);
    return (top.data ?? []).map(toMixTrack).filter((t): t is MixTrack => !!t);
  }

  /** Las URL de vista previa de Deezer caducan: pide una nueva para una pista. */
  async freshPreview(trackId: number): Promise<string | null> {
    try {
      this.cache.delete(`/track/${trackId}`);
      const t = await this.get<DeezerTrackRaw>(`/track/${trackId}`, 0);
      return t.preview || null;
    } catch {
      return null;
    }
  }
}

function formatFans(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} mil`;
  return String(n);
}
