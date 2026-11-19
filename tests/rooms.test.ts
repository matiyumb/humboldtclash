import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Catalog, titleKey, type Track } from '../server/src/catalog';
import { Deezer } from '../server/src/deezer';
import { Library } from '../server/src/library';
import { GameManager, cleanChat, pickDistractors, CHAT_MAX_PER_WINDOW, CHAT_WINDOW_MS } from '../server/src/game';
import { JsonStore } from '../server/src/store';
import { CHAT_MAX_LENGTH, INTRO_MS, REVEAL_PAUSE_MS, type ChatMessage, type RoomState } from '../shared/types';

const catalog = new Catalog(`${process.cwd()}/tests/fixtures`);
const id = (n: string) => ({ playerId: `player-${n}-xxxxxxxxxxxx`, secret: `secret-${n}-yyyyyyyyyyyy` });

type Sent = { ev: string; payload: any };
function setup(lib = new Library(catalog, null, new JsonStore(null))) {
  const last = new Map<string, RoomState>();
  const sent = new Map<string, Sent[]>();
  const gm = new GameManager(lib, (sid, ev, payload) => {
    if (!sent.has(sid)) sent.set(sid, []);
    sent.get(sid)!.push({ ev, payload });
    if (ev === 'room:state') last.set(sid, payload as RoomState);
  });
  const got = (sid: string, ev: string) => (sent.get(sid) ?? []).filter((m) => m.ev === ev).map((m) => m.payload);
  return { gm, last, got, store: lib.store as JsonStore };
}

/** Juega una ronda: `plan` dice quién acierta (true), quién falla (false) y quién no responde (omitido). */
function playRound(gm: GameManager, last: Map<string, RoomState>, code: string, plan: Record<string, boolean>) {
  const any = [...last.keys()].find((s) => last.get(s)?.code === code && last.get(s)?.round)!;
  const q = last.get(any)!.round!.questionId;
  for (const sid of last.keys()) if (last.get(sid)?.code === code) gm.ready(sid, q);
  const correct = gm._debugCorrect(code)!;
  for (const [sid, ok] of Object.entries(plan)) {
    const wrong = last.get(sid)!.round!.options.find((o) => o.id !== correct)!.id;
    gm.answer(sid, q, ok ? correct : wrong);
  }
  vi.advanceTimersByTime(REVEAL_PAUSE_MS);
}

async function multiRoom(gm: GameManager, players: string[], catalogId = 'todo') {
  const [host, ...rest] = players;
  const code = ((await gm.createRoom(host, id(host), host.toUpperCase(), 'multi', catalogId)) as any).code as string;
  for (const p of rest) expect(gm.joinRoom(p, code, id(p), p.toUpperCase()).ok).toBe(true);
  return code;
}

describe('victorias: solo cuenta el 1.º en solitario', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('un empate en cabeza no da victoria a nadie', async () => {
    const { gm, last, store } = setup();
    const code = await multiRoom(gm, ['a', 'b']);
    await gm.start('a');
    vi.advanceTimersByTime(INTRO_MS);
    for (let i = 0; i < 10; i++) playRound(gm, last, code, { a: true, b: true });
    await vi.runAllTimersAsync();
    for (const sid of ['a', 'b']) {
      const r = last.get(sid)!.results!;
      expect(r.tie).toBe(true);
      expect(r.youWon).toBe(false);
    }
    expect(await store.profile(id('a').playerId)).toMatchObject({ games: 1, wins: 0 });
    expect(await store.profile(id('b').playerId)).toMatchObject({ games: 1, wins: 0 });
  });

  it('con un ganador claro solo gana él, aunque haya empate por detrás', async () => {
    const { gm, last, store } = setup();
    const code = await multiRoom(gm, ['a', 'b', 'c']);
    await gm.start('a');
    vi.advanceTimersByTime(INTRO_MS);
    for (let i = 0; i < 10; i++) playRound(gm, last, code, { a: true, b: i < 5, c: i < 5 });
    await vi.runAllTimersAsync();
    expect(last.get('a')!.results!).toMatchObject({ youWon: true, tie: false });
    expect(last.get('b')!.results!.youWon).toBe(false);
    expect(last.get('c')!.results!.youWon).toBe(false);
    expect((await store.profile(id('a').playerId))!.wins).toBe(1);
    expect((await store.profile(id('b').playerId))!.wins).toBe(0);
  });

  it('competitivo: el empate no es victoria ni derrota', async () => {
    const s = new JsonStore(null);
    const deezerChart: typeof fetch = async (input) => {
      const u = new URL(String(input));
      if (u.pathname === '/chart/0/tracks') return new Response(JSON.stringify({ data: Array.from({ length: 30 }, (_, i) => ({ id: 70 + i, title: `Hit ${i}`, preview: `https://cdnt-preview.dzcdn.net/h${i}.mp3`, rank: 1000 - i, artist: { id: 1, name: 'Varios' } })) }), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    const { gm, last } = setup(new Library(catalog, new Deezer('https://api.deezer.test', deezerChart), s));
    const r = await gm.createRankedRoom({ socketId: 'a', identity: id('ra'), nickname: 'Ana' }, { socketId: 'b', identity: id('rb'), nickname: 'Beto' });
    const code = (r as any).code as string;
    vi.advanceTimersByTime(INTRO_MS);
    for (let i = 0; i < 10; i++) playRound(gm, last, code, { a: true, b: true });
    await vi.runAllTimersAsync();
    expect(last.get('a')!.results!).toMatchObject({ youWon: false, tie: true });
    for (const who of ['ra', 'rb']) {
      const p = (await s.profile(id(who).playerId))!;
      expect(p).toMatchObject({ rankedGames: 1, rankedWins: 0, rankedDraws: 1, wins: 0 });
      expect(p.rankedGames - p.rankedWins - p.rankedDraws).toBe(0); // 0 derrotas
    }
    expect(gm._debugRating(code, id('ra').playerId)!.delta).toBe(0);
  });
});

describe('expulsar jugadores', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('solo el anfitrión expulsa; el expulsado sale y no puede volver', async () => {
    const { gm, last, got } = setup();
    const code = await multiRoom(gm, ['h', 'g', 'x']);
    expect(gm.kick('g', id('x').playerId)).toEqual({ ok: false, error: 'Solo el anfitrión puede expulsar jugadores.' });
    expect(gm.kick('h', id('h').playerId).ok).toBe(false);
    expect(gm.kick('h', 'nadie').ok).toBe(false);
    expect(gm.kick('h', id('g').playerId).ok).toBe(true);
    expect(got('g', 'room:kicked')).toHaveLength(1);
    expect(last.get('h')!.players.map((p) => p.id)).not.toContain(id('g').playerId);
    expect(gm.chat('g', 'sigo aquí').ok).toBe(false); // ya no está en la sala
    expect(gm.joinRoom('g2', code, id('g'), 'Gaby')).toEqual({ ok: false, error: 'El anfitrión te ha expulsado de esta sala.' });
    expect(gm.joinRoom('z', code, id('z'), 'Zoe').ok).toBe(true); // los demás sí pueden entrar
  });

  it('en plena partida el expulsado queda fuera y la ronda no le espera', async () => {
    const { gm, last } = setup();
    const code = await multiRoom(gm, ['h', 'g', 'x']);
    await gm.start('h');
    vi.advanceTimersByTime(INTRO_MS);
    expect(gm.kick('h', id('x').playerId).ok).toBe(true);
    const st = last.get('h')!;
    expect(st.players.find((p) => p.id === id('x').playerId)!.left).toBe(true);
    const q = st.round!.questionId;
    gm.ready('h', q); gm.ready('g', q);
    expect(last.get('h')!.round!.phase).toBe('answering');
    gm.answer('h', q, gm._debugCorrect(code)!);
    gm.answer('g', q, gm._debugCorrect(code)!);
    expect(last.get('h')!.round!.phase).toBe('reveal');
    expect(gm.joinRoom('x2', code, id('x'), 'X')).toEqual({ ok: false, error: 'El anfitrión te ha expulsado de esta sala.' });
  });

  it('no hay expulsiones en solitario', async () => {
    const { gm } = setup();
    await gm.createRoom('s', id('s'), 'Sola', 'solo', 'todo');
    expect(gm.kick('s', 'otro').ok).toBe(false);
  });
});

describe('chat de sala', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('limpia el texto', () => {
    expect(cleanChat('  hola\u0000  qué\ntal  ')).toBe('hola qué tal');
    expect(cleanChat('a‮b')).toBe('a b');
    expect(cleanChat('x'.repeat(500))).toHaveLength(CHAT_MAX_LENGTH);
    expect(cleanChat('   ')).toBeNull();
    expect(cleanChat(42)).toBeNull();
  });

  it('en la sala de espera llega a todos; quien entra después recibe el historial', async () => {
    const { gm, got } = setup();
    const code = await multiRoom(gm, ['h', 'g']);
    expect(gm.chat('h', '¡Hola!')).toEqual({ ok: true, held: false });
    for (const sid of ['h', 'g']) expect(got(sid, 'chat:message').map((m: ChatMessage) => [m.nickname, m.text])).toEqual([['H', '¡Hola!']]);
    expect(gm.chat('g', '   ').ok).toBe(false);
    gm.joinRoom('z', code, id('z'), 'Zoe');
    const history = got('z', 'chat:history').at(-1) as ChatMessage[];
    expect(history.map((m) => m.text)).toEqual(['¡Hola!']);
  });

  it('límite anti-spam por jugador', async () => {
    const { gm } = setup();
    await multiRoom(gm, ['h', 'g']);
    for (let i = 0; i < CHAT_MAX_PER_WINDOW; i++) expect(gm.chat('h', `m${i}`).ok).toBe(true);
    expect(gm.chat('h', 'otra')).toEqual({ ok: false, error: 'Vas muy rápido: espera un momento.' });
    expect(gm.chat('g', 'yo sí puedo').ok).toBe(true);
    vi.advanceTimersByTime(CHAT_WINDOW_MS);
    expect(gm.chat('h', 'ya').ok).toBe(true);
  });

  it('durante la ronda los mensajes se retienen hasta la revelación (sin chivatazos)', async () => {
    const { gm, last, got } = setup();
    const code = await multiRoom(gm, ['h', 'g']);
    await gm.start('h');
    vi.advanceTimersByTime(INTRO_MS);
    const q = last.get('h')!.round!.questionId;
    gm.ready('h', q); gm.ready('g', q);
    expect(gm.chat('g', 'es la segunda')).toEqual({ ok: true, held: true });
    expect(got('g', 'chat:message').at(-1)).toMatchObject({ text: 'es la segunda', held: true });
    expect(got('h', 'chat:message')).toHaveLength(0);
    const c = gm._debugCorrect(code)!;
    gm.answer('h', q, c); gm.answer('g', q, c); // revelación
    const seen = got('h', 'chat:message').at(-1) as ChatMessage;
    expect(seen.text).toBe('es la segunda');
    expect(seen.held).toBeUndefined();
  });

  it('el chat es solo para salas con amigos', async () => {
    const { gm } = setup();
    await gm.createRoom('s', id('s'), 'Sola', 'solo', 'todo');
    expect(gm.chat('s', 'hola').ok).toBe(false);
  });
});

describe('canciones que ya sonaron', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const t = (i: number): Track => ({ id: `t${i}`, title: `Tema ${i}`, artist: 'A', collection: 'C', origin: 'o', license: 'l' });

  it('las opciones falsas evitan lo ya sonado; solo lo usan si no queda otra', () => {
    const pool = Array.from({ length: 10 }, (_, i) => t(i));
    const played = [t(1), t(2), t(3)];
    const seen = new Set([t(4), t(5)].map((x) => titleKey(x.title)));
    for (let n = 0; n < 20; n++) {
      const got = pickDistractors(pool, t(0), played, seen).map((x) => x.id);
      expect(got).toHaveLength(3);
      expect(got).not.toContain('t0');
      for (const x of ['t1', 't2', 't3', 't4', 't5']) expect(got).not.toContain(x);
    }
    // Catálogo mínimo: si no hay más, se completa con canciones ya sonadas (nunca la respuesta).
    const tiny = pickDistractors([t(0), t(1), t(2), t(3)], t(0), [t(1), t(2)], new Set());
    expect(tiny.map((x) => x.id).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('una canción que ya salió no vuelve como opción, y «Jugar otra vez» trae canciones nuevas', async () => {
    const { gm, last } = setup();
    const code = ((await gm.createRoom('s', id('s'), 'Sola', 'solo', 'todo')) as any).code as string;
    const playGame = () => {
      vi.advanceTimersByTime(INTRO_MS);
      const answers: string[] = [];
      for (let i = 0; i < 10; i++) {
        const q = last.get('s')!.round!.questionId;
        gm.ready('s', q);
        const options = last.get('s')!.round!.options.map((o) => titleKey(o.title));
        for (const prev of answers) expect(options).not.toContain(prev);
        answers.push(titleKey(gm._debugCorrectTitle(code)!.title));
        gm.answer('s', q, gm._debugCorrect(code)!);
        vi.advanceTimersByTime(REVEAL_PAUSE_MS);
      }
      return answers;
    };
    const first = playGame();
    expect(new Set(first).size).toBe(10);
    expect((await gm.playAgain('s')).ok).toBe(true);
    const second = playGame();
    for (const k of second) expect(first).not.toContain(k);
  });
});
