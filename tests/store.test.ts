// Pruebas del almacenamiento. Postgres solo se prueba si existe PG_TEST_URL, por ejemplo:
//   PG_TEST_URL=postgres://postgres@127.0.0.1:55432/hctest npm test
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore, PgStore, type Store } from '../server/src/store';

const track = (i: number) => ({ deezerId: 900 + i, title: `Tema ${i}`, artist: i % 2 ? 'Quevedo' : 'Bad Bunny', cover: `https://e-cdns-images.dzcdn.net/c${i}.jpg`, rank: 1000 - i, preview: `https://cdnt-preview.dzcdn.net/${i}.mp3`, link: `https://www.deezer.com/track/${900 + i}` });

function suite(name: string, make: () => Promise<Store>) {
  describe(name, () => {
    let s: Store;
    afterAll(async () => { await s?.close(); });

    it('acumula partidas, victorias y mejor puntaje; ranking por victorias', async () => {
      s = await make();
      const run = Date.now().toString(36);
      const a = `jugadora-a-${run}-xxxxxxxx`, b = `jugador-b-${run}-xxxxxxxxx`;
      await s.recordGame([{ playerId: a, nickname: 'Ana', score: 7000, correct: 8, won: true }, { playerId: b, nickname: 'Beto', score: 5000, correct: 6, won: false }]);
      await s.recordGame([{ playerId: a, nickname: 'Ana P.', score: 3000, correct: 4, won: false }, { playerId: b, nickname: 'Beto', score: 9000, correct: 9, won: true }]);
      await s.recordGame([{ playerId: b, nickname: 'Beto', score: 8000, correct: 9, won: true }]);
      expect(await s.profile(a)).toMatchObject({ nickname: 'Ana P.', games: 2, wins: 1, points: 10000, correct: 12, best: 7000 });
      expect(await s.profile(b)).toMatchObject({ games: 3, wins: 2, points: 22000, best: 9000 });
      const many = await s.profiles([a, b, 'no-existe-xxxxxxxxxxxx']);
      expect(many.size).toBe(2);
      const top = (await s.leaderboard(50)).filter((r) => r.playerId === a || r.playerId === b);
      expect(top.map((r) => r.nickname)).toEqual(['Beto', 'Ana P.']);
    });

    it('guarda, edita y borra playlists solo con la clave del dueño', async () => {
      const mix = await s.saveMix('clave-dueno', 'Ana', { name: 'Perreo', tracks: [1, 2, 3, 4, 5].map(track) });
      expect(mix).toMatchObject({ name: 'Perreo', count: 5, ownerName: 'Ana' });
      expect(mix.artists).toEqual(['Quevedo', 'Bad Bunny']);
      const edited = await s.saveMix('clave-dueno', 'Ana', { name: 'Perreo 2', tracks: [1, 2, 3, 4, 5, 6].map(track) }, mix.id);
      expect(edited.id).toBe(mix.id);
      expect((await s.mix(mix.id))!.tracks).toHaveLength(6);
      await expect(s.saveMix('otra-clave', 'Eve', { name: 'Robo', tracks: [1, 2, 3, 4, 5].map(track) }, mix.id)).rejects.toThrow();
      expect((await s.mixesOf('clave-dueno')).map((m) => m.name)).toContain('Perreo 2');
      expect(await s.deleteMix('otra-clave', mix.id)).toBe(false);
      expect(await s.deleteMix('clave-dueno', mix.id)).toBe(true);
      expect(await s.mix(mix.id)).toBeNull();
    });

    it('cuentas y MMR competitivo; ranking por MMR', async () => {
      const run = Date.now().toString(36);
      const acc = { username: `Ana${run}`.slice(0, 16), usernameKey: `ana${run}`.slice(0, 16), passHash: 'scrypt$x$y', playerId: `cuenta-${run}-xxxxxxxx`, secret: 'secreto-xxxxxxxxxxxx', createdAt: Date.now() };
      expect(await s.createAccount(acc)).toBe(true);
      expect(await s.createAccount({ ...acc, playerId: `otra-${run}-xxxxxxxxxx` })).toBe(false);
      expect((await s.account(acc.usernameKey))!.playerId).toBe(acc.playerId);
      expect((await s.accountOf(acc.playerId))!.username).toBe(acc.username);
      const p1 = `mmr-a-${run}-xxxxxxxxx`, p2 = `mmr-b-${run}-xxxxxxxxx`;
      await s.recordRanked([{ playerId: p1, mmr: 1662, rd: 290, vol: 0.06, won: true }, { playerId: p2, mmr: 1338, rd: 290, vol: 0.06, won: false }]);
      await s.recordRanked([{ playerId: p1, mmr: 1700, rd: 260, vol: 0.06, won: true }]);
      expect(await s.profile(p1)).toMatchObject({ mmr: 1700, rankedGames: 2, rankedWins: 2 });
      const top = (await s.leaderboard(100, 'mmr')).filter((r) => r.playerId === p1 || r.playerId === p2);
      expect(top.map((r) => r.mmr)).toEqual([1700, 1338]);
    });
  });
}

suite('almacenamiento JSON', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hc-store-')), 'datos.json');
  const s = new JsonStore(file);
  await s.init();
  return s;
});

describe('almacenamiento JSON en disco', () => {
  it('sobrevive a un reinicio', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hc-store-')), 'datos.json');
    const s1 = new JsonStore(file);
    await s1.init();
    await s1.recordGame([{ playerId: 'persistente-xxxxxxxxxx', nickname: 'Pepa', score: 100, correct: 1, won: true }]);
    await new Promise((r) => setTimeout(r, 400));
    expect(existsSync(file)).toBe(true);
    const s2 = new JsonStore(file);
    await s2.init();
    expect(await s2.profile('persistente-xxxxxxxxxx')).toMatchObject({ wins: 1, points: 100 });
  });
});

if (process.env.PG_TEST_URL) {
  suite('almacenamiento Postgres', async () => {
    const s = new PgStore(process.env.PG_TEST_URL!);
    await s.init();
    return s;
  });
}
