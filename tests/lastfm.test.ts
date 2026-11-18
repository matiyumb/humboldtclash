import { describe, it, expect } from 'vitest';
import { Catalog, type Track } from '../server/src/catalog';
import { Deezer } from '../server/src/deezer';
import { LastFm, looseKey } from '../server/src/lastfm';
import { Library, byDifficulty, byPopularity } from '../server/src/library';
import { DEFAULT_SETTINGS } from '../shared/types';

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

// 12 canciones: en Deezer la 0 es la más popular; en Last.fm es al revés (la 11 es la más escuchada).
const TITLES = Array.from({ length: 12 }, (_, i) => `Tema ${i}`);
const fakeDeezer: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname === '/artist/7') return json({ id: 7, name: 'Quevedo' });
  if (url.pathname === '/artist/7/top')
    return json({ data: TITLES.map((t, i) => ({ id: 700 + i, title: t, readable: true, preview: `https://cdnt-preview.dzcdn.net/${i}.mp3`, rank: 900_000 - i * 10_000, artist: { id: 7, name: 'Quevedo' } })) });
  return new Response('not found', { status: 404 });
};

function fakeLastFm(opts: { calls?: string[]; delayMs?: number; fail?: boolean } = {}): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    opts.calls?.push(url.searchParams.get('artist') ?? '');
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.fail) return json({ error: 6, message: 'The artist you supplied could not be found' });
    const track = TITLES.map((t, i) => ({ name: i === 3 ? `${t} (Remix)` : t, listeners: String(1000 + i * 500) })).reverse();
    return json({ toptracks: { track } });
  };
}

const track = (i: number, extra: Partial<Track> = {}): Track => ({ id: `t${i}`, title: `T${i}`, artist: 'A', collection: 'C', origin: 'o', license: 'l', rank: 1000 - i, ...extra });

describe('Last.fm: popularidad para la dificultad', () => {
  it('empareja títulos (también versiones entre paréntesis) y guarda en caché por artista', async () => {
    const calls: string[] = [];
    const fm = new LastFm('clave', 'https://lastfm.test/2.0', fakeLastFm({ calls }));
    const tracks = TITLES.map((t, i) => track(i, { title: t, artist: 'Quevedo' }));
    const got = await fm.listenersFor(tracks);
    expect(got.size).toBe(12);
    expect(got.get('t11')).toBe(1000 + 11 * 500);
    expect(got.get('t3')).toBe(1000 + 3 * 500); // «Tema 3 (Remix)» en Last.fm ↔ «Tema 3» en Deezer
    await fm.listenersFor(tracks);
    expect(calls).toEqual(['Quevedo']);
  });

  it('si Last.fm falla, no lanza error y no devuelve oyentes', async () => {
    const fm = new LastFm('clave', 'https://lastfm.test/2.0', fakeLastFm({ fail: true }));
    await expect(fm.listenersFor([track(1, { artist: 'Nadie' })])).resolves.toEqual(new Map());
  });

  it('no espera más del presupuesto de tiempo', async () => {
    const fm = new LastFm('clave', 'https://lastfm.test/2.0', fakeLastFm({ delayMs: 400 }));
    const t0 = Date.now();
    const got = await fm.listenersFor([track(1, { title: 'Tema 1', artist: 'Lento' })], { budgetMs: 30 });
    expect(Date.now() - t0).toBeLessThan(300);
    expect(got.size).toBe(0);
  });

  it('la clave laxa quita paréntesis y sufijos « - »', () => {
    expect(looseKey('Columbia - Live')).toBe(looseKey('Columbia (Remix)'));
  });

  it('con cobertura suficiente manda Last.fm; si no, el rank de Deezer', () => {
    // rank: t0 > t1 > … ; oyentes al revés.
    const full = Array.from({ length: 10 }, (_, i) => track(i, { listeners: i * 100 }));
    expect(byPopularity(full)[0].id).toBe('t9');
    const sparse = Array.from({ length: 10 }, (_, i) => track(i, i < 3 ? { listeners: i * 100 } : {}));
    expect(byPopularity(sparse)[0].id).toBe('t0');
    // Sin oyentes, el comportamiento de siempre.
    const none = Array.from({ length: 30 }, (_, i) => track(i));
    expect(byDifficulty(none, 'mainstream', 10).map((t) => t.id)).toEqual(Array.from({ length: 10 }, (_, i) => `t${i}`));
  });

  it('Library usa los oyentes de Last.fm para repartir por dificultad', async () => {
    const catalog = new Catalog(`${process.cwd()}/tests/fixtures`);
    const deezer = new Deezer('https://api.deezer.test', fakeDeezer);
    const settings = { ...DEFAULT_SETTINGS, difficulty: 'mainstream' as const, rounds: 4 };

    const sinFm = await new Library(catalog, deezer, null).resolve('deezer:artist:7', settings);
    expect(sinFm!.deck.map((t) => t.title)).toEqual(['Tema 0', 'Tema 1', 'Tema 2', 'Tema 3']);

    const conFm = await new Library(catalog, deezer, null, new LastFm('clave', 'https://lastfm.test/2.0', fakeLastFm())).resolve('deezer:artist:7', settings);
    expect(conFm!.deck.map((t) => t.title)).toEqual(['Tema 8', 'Tema 9', 'Tema 10', 'Tema 11']);
    expect(conFm!.tracks).toHaveLength(12);
  });

  it('en dificultad general no consulta Last.fm', async () => {
    const calls: string[] = [];
    const catalog = new Catalog(`${process.cwd()}/tests/fixtures`);
    const lib = new Library(catalog, new Deezer('https://api.deezer.test', fakeDeezer), null, new LastFm('clave', 'https://lastfm.test/2.0', fakeLastFm({ calls })));
    await lib.resolve('deezer:artist:7', { ...DEFAULT_SETTINGS, difficulty: 'general', rounds: 4 });
    expect(calls).toEqual([]);
  });
});
