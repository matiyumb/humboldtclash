import { remoteAllowed } from './catalog.js';

export type Cached = { body: Buffer; type: string };

/**
 * Descarga vistas previas remotas para servirlas tras /api/audio/<token>.
 * - Caché pequeña en memoria: todos los jugadores de una sala comparten la descarga.
 * - Si la URL ha caducado (Deezer firma sus URL), pide una nueva con `refresh` y reintenta.
 */
export class AudioProxy {
  private cache = new Map<string, Cached>();
  private pending = new Map<string, Promise<Cached | null>>();

  constructor(
    private refresh: (deezerId: number) => Promise<string | null>,
    private fetchImpl: typeof fetch = fetch,
    private maxEntries = 80,
  ) {}

  private async download(url: string): Promise<Cached | null> {
    if (!remoteAllowed(url)) return null;
    try {
      const r = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
      if (!r.ok) return null;
      const body = Buffer.from(await r.arrayBuffer());
      if (body.length < 2048 || body.length > 15 * 1024 * 1024) return null;
      const upstream = r.headers.get('content-type') ?? '';
      return { body, type: upstream.startsWith('audio/') ? upstream : 'audio/mpeg' };
    } catch {
      return null;
    }
  }

  get(url: string, deezerId?: number): Promise<Cached | null> {
    const key = deezerId ? `dz:${deezerId}` : url;
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const job = (async () => {
      let got = await this.download(url);
      if (!got && deezerId) {
        const fresh = await this.refresh(deezerId);
        if (fresh && fresh !== url) got = await this.download(fresh);
      }
      if (got) {
        this.cache.set(key, got);
        if (this.cache.size > this.maxEntries) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
      }
      return got;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }
}
