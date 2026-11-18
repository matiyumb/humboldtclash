// Servidor que imita api.deezer.com para las pruebas (sin red).
// Uso: node tests/fake-deezer.mjs [puerto]   → luego arranca Humboldtclash con DEEZER_API_BASE=http://127.0.0.1:<puerto>
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.argv[2] ?? 4100);
const BASE = `http://127.0.0.1:${PORT}`;
const AUDIO = join(process.cwd(), 'tests/fixtures/audio');
const mp3s = readdirSync(AUDIO).filter((f) => f.endsWith('.mp3')).sort();

const ARTISTS = {
  1: { name: 'Quevedo', fans: 3_100_000, songs: ['Columbia', 'Playa del Inglés', 'Punto G', 'Cayó la Noche', 'Ahora Qué', 'Vista al Mar', 'Gran Vía', 'Kassandra', 'Si Quieres', 'Wanda', 'Halo', 'Sin Señal'] },
  2: { name: 'Bad Bunny', fans: 12_400_000, songs: ['Tití Me Preguntó', 'Me Porto Bonito', 'Dakiti', 'Callaíta', 'Yonaguni', 'Moscow Mule', 'Ojitos Lindos', 'Efecto', 'La Canción', 'Safaera', 'Neverita', 'Vete'] },
  3: { name: 'Omar Courtz', fans: 600_000, songs: ['Una Foto', 'Pa Que Me Escribes', 'Me Pasé', 'Así Es la Vida', 'Bandida', 'Te Busco', 'No Me Llames', 'Bebé Dime', 'Otra Noche', 'Recuerdos', 'Ella No Es Tuya', 'Dime Si'] },
};
const tracks = [];
for (const [aid, a] of Object.entries(ARTISTS)) {
  a.songs.forEach((title, i) => tracks.push({ id: Number(aid) * 1000 + i, title, artist: { id: Number(aid), name: a.name } }));
}
// La primera pista de Omar Courtz tiene una URL «caducada»: obliga a renovarla con /track/:id.
const EXPIRED = 3000;
const fileFor = (id) => mp3s[id % mp3s.length];
const toApi = (t, fresh = false) => ({
  id: t.id, title: t.title, title_short: t.title, readable: true,
  preview: `${BASE}/preview/${t.id}.mp3${t.id === EXPIRED && !fresh ? '?hdnea=exp=1' : '?hdnea=ok'}`,
  link: `https://www.deezer.com/track/${t.id}`,
  rank: 1_000_000 - (t.id % 1000) * 70_000, artist: t.artist, album: { title: 'Álbum', cover_medium: `${BASE}/cover/${t.id}.svg` },
});

const json = (res, data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };

createServer((req, res) => {
  const url = new URL(req.url, BASE);
  const p = url.pathname;
  let m;
  if (p === '/search') {
    const words = (url.searchParams.get('q') ?? '').toLowerCase().replace(/(artist|track):/g, ' ').replace(/"/g, ' ').split(/\s+/).filter(Boolean);
    const data = tracks.filter((t) => { const hay = `${t.title} ${t.artist.name}`.toLowerCase(); return words.length && words.every((w) => hay.includes(w)); }).slice(0, 25).map((t) => toApi(t));
    return json(res, { data, total: data.length });
  }
  if (p === '/search/artist') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const data = Object.entries(ARTISTS)
      .filter(([, a]) => a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase().split(' ')[0]))
      .map(([id, a]) => ({ id: Number(id), name: a.name, nb_fan: a.fans, picture_medium: null }));
    return json(res, { data, total: data.length });
  }
  if (p === '/chart/0/artists') return json(res, { data: Object.entries(ARTISTS).map(([id, a], i) => ({ id: Number(id), name: a.name, position: i + 1, picture_medium: null })) });
  if (p === '/chart/0/playlists') return json(res, { data: [{ id: 777, title: 'Top Perú', nb_tracks: 20, picture_medium: null, user: { name: 'Deezer' } }] });
  if (p === '/playlist/777') return json(res, { id: 777, title: 'Top Perú', nb_tracks: 20, creator: { name: 'Deezer' } });
  if (p === '/playlist/777/tracks') return json(res, { data: tracks.slice(0, 20).map((t) => toApi(t)) });
  if ((m = p.match(/^\/artist\/(\d+)$/)) && ARTISTS[m[1]]) return json(res, { id: Number(m[1]), name: ARTISTS[m[1]].name });
  if ((m = p.match(/^\/artist\/(\d+)\/top$/)) && ARTISTS[m[1]]) return json(res, { data: tracks.filter((t) => t.artist.id === Number(m[1])).map((t) => toApi(t)) });
  if (p === '/chart/0/tracks') return json(res, { data: tracks.slice(0, 30).map((t) => toApi(t)) });
  if ((m = p.match(/^\/track\/(\d+)$/))) {
    const t = tracks.find((x) => x.id === Number(m[1]));
    return t ? json(res, toApi(t, true)) : json(res, { error: { type: 'DataException', message: 'no data', code: 800 } });
  }
  if ((m = p.match(/^\/cover\/(\d+)\.svg$/))) {
    const id = Number(m[1]); const h = (id * 47) % 360;
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,55%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},70%,35%)"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="50" r="22" fill="rgba(0,0,0,.35)"/><circle cx="50" cy="50" r="6" fill="#fff"/></svg>`);
  }
  if ((m = p.match(/^\/preview\/(\d+)\.mp3$/))) {
    if (url.searchParams.get('hdnea') !== 'ok') { res.writeHead(403); return res.end('expired'); }
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    return res.end(readFileSync(join(AUDIO, fileFor(Number(m[1])))));
  }
  return json(res, { error: { type: 'DataException', message: 'no data', code: 800 } });
}).listen(PORT, '127.0.0.1', () => console.log(`Deezer falso en ${BASE}`));
