// Popularidad real de las canciones según Last.fm (oyentes únicos), para afinar la dificultad.
// Es opcional: solo se usa si hay LASTFM_API_KEY. Last.fm no da audio; el audio sigue siendo de Deezer.
// Se pide el top de cada artista (artist.getTopTracks) y se empareja por título, con caché de 24 h.
// Si Last.fm falla o tarda, se devuelve lo que haya y la dificultad usa el «rank» de Deezer.
import { titleKey, type Track } from './catalog.js';

interface TopTracksResponse {
  toptracks?: { track?: { name?: string; listeners?: string | number }[] };
  error?: number;
  message?: string;
}

const OK_TTL = 24 * 3600_000;
const FAIL_TTL = 10 * 60_000;

/** Clave más laxa: quita todo lo que vaya entre paréntesis/corchetes y lo que siga a « - » (remixes, versiones…). */
export const looseKey = (t: string) => titleKey(t.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, ''));

const artistKey = (a: string) => a.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export class LastFm {
  private cache = new Map<string, { at: number; ttl: number; data: Map<string, number> }>();
  private inflight = new Map<string, Promise<Map<string, number>>>();

  constructor(
    private apiKey: string,
    readonly base = (process.env.LASTFM_API_BASE ?? 'https://ws.audioscrobbler.com/2.0').replace(/\/$/, ''),
    private fetchImpl: typeof fetch = fetch,
  ) {}

  /** Oyentes por canción del top de un artista: clave de título → oyentes. Nunca lanza error. */
  async artistTop(artist: string): Promise<Map<string, number>> {
    const key = artistKey(artist);
    if (!key) return new Map();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = (async () => {
      const data = new Map<string, number>();
      let ttl = FAIL_TTL;
      try {
        const qs = new URLSearchParams({ method: 'artist.gettoptracks', artist: artist.slice(0, 120), autocorrect: '1', limit: '500', format: 'json', api_key: this.apiKey });
        const r = await this.fetchImpl(`${this.base}/?${qs}`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
        if (r.ok) {
          const body = (await r.json()) as TopTracksResponse;
          if (!body.error) {
            for (const t of body.toptracks?.track ?? []) {
              const n = Number(t.listeners);
              if (!t.name || !Number.isFinite(n) || n < 0) continue;
              // El primero que aparece es el más escuchado: no se sobrescribe con versiones menores.
              for (const k of [titleKey(t.name), looseKey(t.name)]) if (k && !data.has(k)) data.set(k, n);
            }
            ttl = OK_TTL;
          }
        }
      } catch {
        // Sin conexión o tiempo agotado: se reintenta en unos minutos.
      } finally {
        this.inflight.delete(key);
      }
      this.cache.set(key, { at: Date.now(), ttl, data });
      if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value!);
      return data;
    })();
    this.inflight.set(key, p);
    return p;
  }

  /**
   * Oyentes de Last.fm para cada pista (id de pista → oyentes). Consulta como mucho `maxArtists`
   * artistas (los que más canciones tienen en el catálogo), de `concurrency` en `concurrency`, y no
   * espera más de `budgetMs`: lo que llegue tarde queda en caché para la próxima vez.
   */
  async listenersFor(tracks: Track[], opts: { maxArtists?: number; concurrency?: number; budgetMs?: number } = {}): Promise<Map<string, number>> {
    const { maxArtists = 30, concurrency = 4, budgetMs = 3000 } = opts;
    const counts = new Map<string, { name: string; n: number }>();
    for (const t of tracks) {
      const k = artistKey(t.artist);
      if (!k) continue;
      const c = counts.get(k) ?? { name: t.artist, n: 0 };
      c.n++;
      counts.set(k, c);
    }
    const artists = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, maxArtists).map((c) => c.name);
    const tops = new Map<string, Map<string, number>>();
    const queue = [...artists];
    const worker = async () => {
      for (let a = queue.shift(); a !== undefined; a = queue.shift()) tops.set(artistKey(a), await this.artistTop(a));
    };
    const all = Promise.all(Array.from({ length: Math.min(concurrency, artists.length) }, worker));
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([all, new Promise<void>((r) => { timer = setTimeout(r, budgetMs); })]);
    clearTimeout(timer);

    const out = new Map<string, number>();
    for (const t of tracks) {
      const top = tops.get(artistKey(t.artist));
      if (!top) continue;
      const n = top.get(titleKey(t.title)) ?? top.get(looseKey(t.title));
      if (n !== undefined) out.set(t.id, n);
    }
    return out;
  }
}
