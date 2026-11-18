// API propia de Humboldtclash sobre la API pública de Deezer (sin clave).
// Busca artistas, trae sus canciones top / playlists / éxitos con vista previa de 30 s,
// y guarda en caché las respuestas para no superar el límite de Deezer (≈50 peticiones / 5 s).
import type { CatalogSummary } from '../../shared/types.js';
import type { Track } from './catalog.js';

export interface DeezerTrackRaw {
  id: number;
  title: string;
  title_short?: string;
  preview?: string;
  link?: string;
  readable?: boolean;
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
    origin: ORIGIN,
    license: LICENSE,
  };
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
