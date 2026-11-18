import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Catalog } from '../server/src/catalog';
import { Deezer } from '../server/src/deezer';
import { Library } from '../server/src/library';
import { GameManager, rankStandings, LOAD_TIMEOUT_MS } from '../server/src/game';
import { scoreFor, ROUND_MS, REVEAL_PAUSE_MS, INTRO_MS, type RoomState } from '../shared/types';

const catalog = new Catalog(process.cwd());

// Deezer simulado (misma forma de respuesta que api.deezer.com).
const BB_TITLES = ['Tití Me Preguntó', 'Me Porto Bonito', 'Dakiti', 'Callaíta', 'Yonaguni', 'Moscow Mule', 'Ojitos Lindos', 'Efecto', 'La Canción', 'Safaera', 'Vete', 'Neverita', 'Dakiti (feat. Jhay Cortez)', 'Sin Preview'];
const fakeDeezer: typeof fetch = async (input) => {
  const url = new URL(String(input));
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/search/artist') return json({ data: [{ id: 10583405, name: 'Bad Bunny', nb_fan: 12_400_000, picture_medium: 'https://e-cdns-images.dzcdn.net/x.jpg' }] });
  if (url.pathname === '/artist/10583405') return json({ id: 10583405, name: 'Bad Bunny' });
  if (url.pathname === '/artist/10583405/top')
    return json({ data: BB_TITLES.map((t, i) => ({ id: 1000 + i, title: t, title_short: t, readable: true, preview: t === 'Sin Preview' ? '' : `https://cdnt-preview.dzcdn.net/api/1/${i}.mp3`, link: `https://www.deezer.com/track/${1000 + i}`, artist: { id: 10583405, name: 'Bad Bunny' } })) });
  if (url.pathname === '/artist/99') return json({ id: 99, name: 'Artista Pequeño' });
  if (url.pathname === '/artist/99/top') return json({ data: [{ id: 1, title: 'Única', preview: 'https://cdnt-preview.dzcdn.net/1.mp3', artist: { id: 99, name: 'Artista Pequeño' } }] });
  if (url.pathname === '/artist/404') return json({ error: { type: 'DataException', message: 'no data', code: 800 } });
  return new Response('not found', { status: 404 });
};
const library = new Library(catalog, new Deezer('https://api.deezer.test', fakeDeezer));
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
  it('marca como no jugable un catálogo con menos de 10 canciones', () => {
    const marea = catalog.list().find((c) => c.name === 'Marea Baja')!;
    expect(marea.trackCount).toBe(6);
    expect(marea.playable).toBe(false);
    expect(catalog.check(marea.id).ok).toBe(false);
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
    expect((await gm.setCatalog('h', 'artista:marea-baja')).ok).toBe(false); // catálogo insuficiente
    expect((await gm.start('h')).ok).toBe(false); // sin catálogo elegido
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
    const check = await library.check('deezer:artist:10583405');
    expect(check.ok).toBe(true);
    // 14 títulos − 1 sin preview − 1 repetido «feat.» = 12
    expect(check.playableCount).toBe(12);
    expect(check.resolved!.tracks.every((t) => t.previewUrl && t.storeUrl && t.license)).toBe(true);
  });

  it('rechaza artistas con menos de 10 canciones y errores de Deezer', async () => {
    expect((await library.check('deezer:artist:99')).ok).toBe(false);
    const err = await library.check('deezer:artist:404');
    expect(err.ok).toBe(false);
    expect(err.message).toMatch(/Deezer/);
    expect((await library.check('deezer:artist:abc')).ok).toBe(false);
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
