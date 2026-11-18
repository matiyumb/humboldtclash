import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Catalog } from '../server/src/catalog';
import { Deezer } from '../server/src/deezer';
import { Library } from '../server/src/library';
import { GameManager, rankStandings, LOAD_TIMEOUT_MS } from '../server/src/game';
import { scoreFor, ROUND_MS, REVEAL_PAUSE_MS, INTRO_MS, DEFAULT_SETTINGS, LIGHTNING_MS, rankFor, sanitizeSettings, type RoomState } from '../shared/types';
import { JsonStore } from '../server/src/store';
import { byDifficulty } from '../server/src/library';

const catalog = new Catalog(`${process.cwd()}/tests/fixtures`);

// Deezer simulado (misma forma de respuesta que api.deezer.com).
const BB_TITLES = ['Tití Me Preguntó', 'Me Porto Bonito', 'Dakiti', 'Callaíta', 'Yonaguni', 'Moscow Mule', 'Ojitos Lindos', 'Efecto', 'La Canción', 'Safaera', 'Vete', 'Neverita', 'Dakiti (feat. Jhay Cortez)', 'Sin Preview'];
const fakeDeezer: typeof fetch = async (input) => {
  const url = new URL(String(input));
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/search/artist') return json({ data: [{ id: 10583405, name: 'Bad Bunny', nb_fan: 12_400_000, picture_medium: 'https://e-cdns-images.dzcdn.net/x.jpg' }] });
  if (url.pathname === '/artist/10583405') return json({ id: 10583405, name: 'Bad Bunny' });
  if (url.pathname === '/artist/10583405/top')
    return json({ data: BB_TITLES.map((t, i) => ({ id: 1000 + i, title: t, title_short: t, readable: true, preview: t === 'Sin Preview' ? '' : `https://cdnt-preview.dzcdn.net/api/1/${i}.mp3`, link: `https://www.deezer.com/track/${1000 + i}`, rank: 900000 - i * 50000, album: { cover_medium: `https://e-cdns-images.dzcdn.net/images/cover/${i}/250x250.jpg` }, artist: { id: 10583405, name: 'Bad Bunny' } })) });
  if (url.pathname === '/artist/99') return json({ id: 99, name: 'Artista Pequeño' });
  if (url.pathname === '/artist/99/top') return json({ data: [{ id: 1, title: 'Única', preview: 'https://cdnt-preview.dzcdn.net/1.mp3', artist: { id: 99, name: 'Artista Pequeño' } }] });
  if (url.pathname === '/artist/404') return json({ error: { type: 'DataException', message: 'no data', code: 800 } });
  return new Response('not found', { status: 404 });
};
const store = new JsonStore(null);
const library = new Library(catalog, new Deezer('https://api.deezer.test', fakeDeezer), store);
const id = (n: string) => ({ playerId: `player-${n}-xxxxxxxxxxxx`, secret: `secret-${n}-yyyyyyyyyyyy` });

function setup() {
  const last = new Map<string, RoomState>();
  const events: [string, string][] = [];
  const gm = new GameManager(library, (sid, ev, payload) => {
    events.push([sid, ev]);
    if (ev === 'room:state') last.set(sid, payload as RoomState);
  });
  return { gm, last, events };
}

describe('puntuación', () => {
  it('sigue la fórmula 500 + 50 × segundos completos, máximo 1000', () => {
    expect(scoreFor(true, 10_000)).toBe(1000);
    expect(scoreFor(true, 9_999)).toBe(950);
    expect(scoreFor(true, 4_500)).toBe(700);
    expect(scoreFor(true, 999)).toBe(500);
    expect(scoreFor(true, 0)).toBe(500);
    expect(scoreFor(false, 9_000)).toBe(0);
  });
  it('los empates comparten posición', () => {
    const rows = rankStandings([
      { playerId: 'a', nickname: 'Ana', score: 3000, correct: 4, left: false },
      { playerId: 'b', nickname: 'Beto', score: 5000, correct: 6, left: false },
      { playerId: 'c', nickname: 'Cata', score: 3000, correct: 5, left: false },
      { playerId: 'd', nickname: 'Dani', score: 100, correct: 0, left: false },
    ]);
    expect(rows.map((r) => [r.nickname, r.position])).toEqual([['Beto', 1], ['Ana', 2], ['Cata', 2], ['Dani', 4]]);
  });
});

describe('catálogo', () => {
  it('exige tantas canciones como rondas', async () => {
    const marea = catalog.list().find((c) => c.name === 'Marea Baja')!;
    expect(marea.trackCount).toBe(6);
    expect((await library.check(marea.id, DEFAULT_SETTINGS)).ok).toBe(false); // 10 rondas
    expect((await library.check(marea.id, { ...DEFAULT_SETTINGS, rounds: 5 })).ok).toBe(true);
    expect((await library.check('todo', { ...DEFAULT_SETTINGS, rounds: 20 })).ok).toBe(true);
    expect(catalog.check('artista:luna-brava').ok).toBe(true);
  });
});

describe('partidas', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('solitario: 10 rondas, revelación al responder, una respuesta por ronda', async () => {
    const { gm, last } = setup();
    const r = await gm.createRoom('s1', id('a'), 'Ana', 'solo', 'artista:luna-brava');
    vi.advanceTimersByTime(INTRO_MS); // cuenta atrás inicial
    expect(r.ok).toBe(true);
    const code = (r as any).code;
    for (let i = 1; i <= 10; i++) {
      let st = last.get('s1')!;
      expect(st.round!.index).toBe(i);
      expect(st.round!.phase).toBe('loading');
      expect(st.round!.options).toHaveLength(0); // nada visible antes de tiempo
      expect(st.round!.audioUrl).not.toMatch(/luna|mp3/i);
      gm.ready('s1', st.round!.questionId);
      st = last.get('s1')!;
      expect(st.round!.phase).toBe('answering');
      expect(st.round!.options).toHaveLength(4);
      expect(new Set(st.round!.options.map((o) => o.title)).size).toBe(4);
      vi.advanceTimersByTime(2_500); // quedan 7,5 s → 7 completos
      const correct = gm._debugCorrect(code)!;
      const pick = i % 2 ? correct : st.round!.options.find((o) => o.id !== correct)!.id;
      expect(gm.answer('s1', st.round!.questionId, pick).ok).toBe(true);
      const dup = gm.answer('s1', st.round!.questionId, pick);
      expect(dup).toEqual({ ok: false, error: 'Ya respondiste en esta ronda.' });
      st = last.get('s1')!;
      expect(st.round!.phase).toBe('reveal');
      expect(st.round!.reveal!.correctOptionId).toBe(correct);
      expect(st.round!.yourAnswer!.points).toBe(i % 2 ? 850 : 0);
      vi.advanceTimersByTime(REVEAL_PAUSE_MS);
    }
    const st = last.get('s1')!;
    expect(st.phase).toBe('results');
    expect(st.results!.standings[0].score).toBe(5 * 850);
    expect(st.results!.standings[0].correct).toBe(5);
    expect(st.results!.missed).toHaveLength(5);
  });

  it('el servidor rechaza respuestas fuera de plazo y el tiempo agotado vale 0', async () => {
    const { gm, last } = setup();
    await gm.createRoom('s1', id('a'), 'Ana', 'solo', 'todo');
    vi.advanceTimersByTime(INTRO_MS); // cuenta atrás inicial
    const q = last.get('s1')!.round!.questionId;
    gm.ready('s1', q);
    vi.advanceTimersByTime(ROUND_MS + 31);
    const st = last.get('s1')!;
    expect(st.round!.phase).toBe('reveal');
    expect(st.round!.reveal!.results[0].timedOut).toBe(true);
    expect(gm.answer('s1', q, st.round!.options[0].id).ok).toBe(false);
  });

  it('multijugador: sala 2–5, anfitrión, cierre tras empezar, reconexión y traspaso', async () => {
    const { gm, last, events } = setup();
    const r = await gm.createRoom('h', id('h'), 'Host', 'multi');
    const code = (r as any).code as string;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(await gm.start('h')).toEqual({ ok: false, error: 'Hacen falta al menos 2 jugadores conectados.' });
    expect(gm.joinRoom('g', code.toLowerCase(), id('g'), 'Gaby').ok).toBe(true);
    expect((await gm.setCatalog('g', 'todo')).ok).toBe(false); // solo el anfitrión
    expect((await gm.start('h')).ok).toBe(false); // sin catálogo elegido
    expect((await gm.setCatalog('h', 'artista:marea-baja')).ok).toBe(true);
    expect((await gm.start('h')).ok).toBe(false); // 6 canciones no alcanzan para 10 rondas
    expect(gm.setSettings('g', { rounds: 5 }).ok).toBe(false); // solo el anfitrión
    await gm.setCatalog('h', 'coleccion:verano-eterno');
    for (const n of ['3', '4', '5']) expect(gm.joinRoom(`p${n}`, code, id(n), `J${n}`).ok).toBe(true);
    expect(gm.joinRoom('p6', code, id('6'), 'J6')).toEqual({ ok: false, error: 'La sala está llena (máximo 5 jugadores).' });
    for (const n of ['3', '4', '5']) gm.leave(`p${n}`);
    expect((await gm.start('h')).ok).toBe(true);
    expect(last.get('g')!.intro).not.toBeNull(); // todos ven la cuenta atrás
    vi.advanceTimersByTime(INTRO_MS);
    expect(gm.joinRoom('late', code, id('late'), 'Tarde')).toEqual({ ok: false, error: 'La partida ya empezó: no se pueden unir más jugadores.' });

    // Misma pregunta y misma hora límite para todos.
    const q = last.get('h')!.round!.questionId;
    expect(last.get('g')!.round!.questionId).toBe(q);
    gm.ready('h', q);
    expect(last.get('h')!.round!.phase).toBe('loading'); // espera a Gaby
    gm.ready('g', q);
    expect(last.get('h')!.round!.deadline).toBe(last.get('g')!.round!.deadline);

    // El anfitrión se desconecta → Gaby pasa a ser anfitriona.
    gm.disconnect('h');
    expect(last.get('g')!.hostId).toBe(id('g').playerId);
    // Gaby responde; como Host está desconectado, se revela ya.
    const correct = gm._debugCorrect(code)!;
    gm.answer('g', q, correct);
    expect(last.get('g')!.round!.phase).toBe('reveal');

    // Host vuelve desde el mismo navegador y recupera su puesto (no puede entrar otro).
    expect(gm.joinRoom('h2', code, { ...id('h'), secret: 'secret-otro-zzzzzzzzzzzz' }, 'Host').ok).toBe(false);
    const back = gm.joinRoom('h2', code, id('h'), 'Host');
    expect(back).toMatchObject({ ok: true, rejoined: true });
    expect(last.get('h2')!.phase).toBe('playing');
    expect(last.get('h2')!.players.find((p) => p.id === id('h').playerId)!.connected).toBe(true);

    // Al reconectar en otra pestaña, la anterior recibe aviso.
    gm.joinRoom('h3', code, id('h'), 'Host');
    expect(events).toContainEqual(['h2', 'session:replaced']);
  });

  it('si el audio falla se sustituye la canción antes de iniciar el temporizador', async () => {
    const { gm, last } = setup();
    await gm.createRoom('s1', id('a'), 'Ana', 'solo', 'todo');
    vi.advanceTimersByTime(INTRO_MS); // cuenta atrás inicial
    const first = last.get('s1')!.round!;
    gm.audioFailed('s1', first.questionId);
    const second = last.get('s1')!.round!;
    expect(second.index).toBe(1);
    expect(second.questionId).not.toBe(first.questionId);
    expect(second.audioUrl).not.toBe(first.audioUrl);
    expect(gm.audio(first.audioUrl.split('/').pop()!)).toBeUndefined();
    expect(second.phase).toBe('loading');
    // Si nadie carga, al vencer la espera también se sustituye.
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS + 1);
    expect(last.get('s1')!.round!.questionId).not.toBe(second.questionId);
  });

  it('con un empate en multijugador ambos comparten posición', async () => {
    const { gm, last } = setup();
    const code = ((await gm.createRoom('a', id('a'), 'Ana', 'multi', 'todo')) as any).code;
    gm.joinRoom('b', code, id('b'), 'Beto');
    await gm.start('a');
    vi.advanceTimersByTime(INTRO_MS);
    for (let i = 0; i < 10; i++) {
      const q = last.get('a')!.round!.questionId;
      gm.ready('a', q); gm.ready('b', q);
      const c = gm._debugCorrect(code)!;
      gm.answer('a', q, c); gm.answer('b', q, c);
      vi.advanceTimersByTime(REVEAL_PAUSE_MS);
    }
    const st = last.get('b')!;
    expect(st.phase).toBe('results');
    expect(st.results!.standings.map((s) => s.position)).toEqual([1, 1]);
    expect(st.results!.standings[0].score).toBe(10_000);
  });
});

describe('Deezer', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('busca artistas y arma el catálogo con canciones distintas y con vista previa', async () => {
    const found = await library.search('bad bunny');
    expect(found[0]).toMatchObject({ id: 'deezer:artist:10583405', name: 'Bad Bunny', source: 'deezer' });
    const check = await library.check('deezer:artist:10583405', DEFAULT_SETTINGS);
    expect(check.ok).toBe(true);
    // 14 títulos − 1 sin preview − 1 repetido «feat.» = 12
    expect(check.playableCount).toBe(12);
    expect(check.resolved!.tracks.every((t) => t.previewUrl && t.storeUrl && t.license)).toBe(true);
  });

  it('rechaza artistas con menos de 10 canciones y errores de Deezer', async () => {
    expect((await library.check('deezer:artist:99', DEFAULT_SETTINGS)).ok).toBe(false);
    const err = await library.check('deezer:artist:404', DEFAULT_SETTINGS);
    expect(err.ok).toBe(false);
    expect(err.message).toMatch(/Deezer/);
    expect((await library.check('deezer:artist:abc', DEFAULT_SETTINGS)).ok).toBe(false);
  });

  it('partida en solitario con Deezer: audio opaco y enlace a Deezer al revelar', async () => {
    const { gm, last } = setup();
    const r = await gm.createRoom('s1', id('a'), 'Ana', 'solo', 'deezer:artist:10583405');
    vi.advanceTimersByTime(INTRO_MS); // cuenta atrás inicial
    expect(r.ok).toBe(true);
    const code = (r as any).code;
    let st = last.get('s1')!;
    expect(st.catalog!.name).toBe('Bad Bunny');
    const token = st.round!.audioUrl.split('/').pop()!;
    expect(st.round!.audioUrl).not.toMatch(/dzcdn|deezer|bunny/i);
    expect(gm.audio(token)).toMatchObject({ deezerId: expect.any(Number) });
    gm.ready('s1', st.round!.questionId);
    gm.answer('s1', st.round!.questionId, gm._debugCorrect(code));
    st = last.get('s1')!;
    expect(st.round!.reveal!.link).toMatch(/^https:\/\/www\.deezer\.com\/track\//);
    expect(st.round!.reveal!.linkLabel).toBe('Escuchar en Deezer');
  });

  it('salas públicas: aparecen en la lista solo en espera y con hueco', async () => {
    const { gm } = setup();
    const pub = ((await gm.createRoom('h', id('h'), 'Host', 'multi', 'deezer:artist:10583405', true)) as any).code;
    await gm.createRoom('p', id('p'), 'Priv', 'multi');
    let list = gm.publicRooms();
    expect(list).toEqual([{ code: pub, host: 'Host', catalogName: 'Bad Bunny', players: 1, maxPlayers: 5 }]);
    gm.joinRoom('g', pub, id('g'), 'Gaby');
    expect(gm.setPublic('g', false).ok).toBe(false); // solo el anfitrión
    await gm.start('h');
    list = gm.publicRooms();
    expect(list).toEqual([]);
  });
});

describe('ajustes, dificultad, rangos y easter egg', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('limita los ajustes a valores válidos', () => {
    expect(sanitizeSettings({ rounds: 99, difficulty: 'x', clip: 'one', shuffle: false })).toEqual({ rounds: 20, difficulty: 'general', clip: 'one', shuffle: false });
    expect(sanitizeSettings({ rounds: 2 }).rounds).toBe(5);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('rangos por victorias: Rookie 50, Conocedor 100, Fan 500, Melófano 5000', () => {
    expect(rankFor(0).current.id).toBe('aprendiz');
    expect(rankFor(49).next!.id).toBe('rookie');
    expect(rankFor(50).current.id).toBe('rookie');
    expect(rankFor(100).current.id).toBe('conocedor');
    expect(rankFor(500).current.id).toBe('fan');
    expect(rankFor(5000).current.id).toBe('melofano');
    expect(rankFor(9999).next).toBeNull();
  });

  it('easter egg: acertar casi al instante vale 1000', () => {
    expect(scoreFor(true, 9_700, 300)).toBe(1000);
    expect(scoreFor(true, 9_500, LIGHTNING_MS + 100)).toBe(950);
    expect(scoreFor(false, 9_900, 100)).toBe(0);
  });

  it('dificultad por popularidad: mainstream arriba, nicho abajo, siempre ≥ rondas', () => {
    const tracks = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, artist: 'A', collection: 'C', origin: 'o', license: 'l', rank: 1000 - i }));
    const main = byDifficulty(tracks, 'mainstream', 10).map((t) => t.id);
    const nicho = byDifficulty(tracks, 'nicho', 10).map((t) => t.id);
    const fan = byDifficulty(tracks, 'fan', 10).map((t) => t.id);
    expect(main).toHaveLength(10);
    expect(main[0]).toBe('t0');
    expect(nicho).toContain('t29');
    expect(nicho).not.toContain('t0');
    expect(fan).toContain('t15');
    expect(byDifficulty(tracks, 'nicho', 20)).toHaveLength(20);
  });

  it('partida de 5 rondas en modo 1 segundo; fragmento común aleatorio; rayo; victoria guardada', async () => {
    const { gm, last } = setup();
    const r = await gm.createRoom('s1', id('z'), 'Zoe', 'solo', 'deezer:artist:10583405', false, { rounds: 5, clip: 'one', difficulty: 'mainstream' });
    expect(r.ok).toBe(true);
    const code = (r as any).code;
    vi.advanceTimersByTime(INTRO_MS);
    for (let i = 1; i <= 5; i++) {
      let st = last.get('s1')!;
      expect(st.round!.total).toBe(5);
      expect(st.round!.clip.seconds).toBe(1);
      expect(st.round!.clip.start).toBeGreaterThanOrEqual(0);
      expect(st.round!.clip.start).toBeLessThan(1);
      gm.ready('s1', st.round!.questionId);
      st = last.get('s1')!;
      expect(st.round!.options.every((o) => o.cover?.startsWith('https://'))).toBe(true);
      vi.advanceTimersByTime(i === 1 ? 200 : 1_500);
      gm.answer('s1', st.round!.questionId, gm._debugCorrect(code));
      st = last.get('s1')!;
      const res = st.round!.reveal!.results[0];
      if (i === 1) { expect(res.lightning).toBe(true); expect(res.points).toBe(1000); }
      else { expect(res.lightning).toBe(false); expect(res.points).toBe(900); }
      vi.advanceTimersByTime(REVEAL_PAUSE_MS);
    }
    const st = last.get('s1')!;
    expect(st.phase).toBe('results');
    expect(st.results!.totalRounds).toBe(5);
    expect(st.results!.youWon).toBe(true);
    await vi.runAllTimersAsync();
    const p = await store.profile(id('z').playerId);
    expect(p).toMatchObject({ games: 1, wins: 1, points: 1000 + 4 * 900, correct: 5, best: 4600 });
  });

  it('playlist de usuario: respeta el orden si no se baraja', async () => {
    const tracks = Array.from({ length: 6 }, (_, i) => ({ deezerId: 500 + i, title: `Canción ${i}`, artist: i % 2 ? 'Quevedo' : 'Feid', cover: null, rank: i, preview: `https://cdnt-preview.dzcdn.net/${i}.mp3`, link: `https://www.deezer.com/track/${500 + i}` }));
    const mix = await store.saveMix('dueño', 'Ana', { name: 'Mi mezcla', tracks });
    const ordered = await library.resolve(`mix:${mix.id}`, { ...DEFAULT_SETTINGS, rounds: 5, shuffle: false });
    expect(ordered!.ordered).toBe(true);
    expect(ordered!.deck.map((t) => t.title)).toEqual(tracks.map((t) => t.title));
    const { gm, last } = setup();
    await gm.createRoom('s9', id('y'), 'Yeni', 'solo', `mix:${mix.id}`, false, { rounds: 5, shuffle: false });
    vi.advanceTimersByTime(INTRO_MS);
    const titles: string[] = [];
    for (let i = 0; i < 5; i++) {
      const q = last.get('s9')!.round!.questionId;
      gm.ready('s9', q);
      titles.push(gm._debugCorrectTitle((last.get('s9')!).code)!.title);
      gm.answer('s9', q, gm._debugCorrect(last.get('s9')!.code));
      vi.advanceTimersByTime(REVEAL_PAUSE_MS);
    }
    expect(titles).toEqual(tracks.slice(0, 5).map((t) => t.title));
    expect(await store.deleteMix('otro', mix.id)).toBe(false);
    expect(await store.deleteMix('dueño', mix.id)).toBe(true);
  });
});
