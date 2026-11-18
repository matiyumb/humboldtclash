import { describe, it, expect, vi } from 'vitest';
import { AudioProxy } from '../server/src/audioProxy';

const mp3 = Buffer.alloc(4096, 1);
const ok = () => new Response(mp3, { status: 200, headers: { 'content-type': 'audio/mpeg' } });

describe('proxy de audio', () => {
  it('renueva una URL de Deezer caducada y reintenta', async () => {
    const fetchImpl = vi.fn(async (u: RequestInfo | URL) => (String(u).includes('exp=1') ? new Response('expired', { status: 403 }) : ok()));
    const refresh = vi.fn(async () => 'https://cdnt-preview.dzcdn.net/a.mp3?hdnea=fresh');
    const proxy = new AudioProxy(refresh, fetchImpl as unknown as typeof fetch);
    const got = await proxy.get('https://cdnt-preview.dzcdn.net/a.mp3?hdnea=exp=1', 3000);
    expect(got?.body.length).toBe(4096);
    expect(refresh).toHaveBeenCalledWith(3000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('comparte la descarga entre jugadores (una sola petición)', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const proxy = new AudioProxy(async () => null, fetchImpl as unknown as typeof fetch);
    const url = 'https://cdnt-preview.dzcdn.net/b.mp3';
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => proxy.get(url, 77)));
    expect(all.every((x) => x?.type === 'audio/mpeg')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rechaza URL que no son https y respuestas que no son audio', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 }));
    const proxy = new AudioProxy(async () => null, fetchImpl as unknown as typeof fetch);
    expect(await proxy.get('http://evil.example/x.mp3')).toBeNull();
    expect(await proxy.get('file:///etc/passwd')).toBeNull();
    expect(await proxy.get('https://cdnt-preview.dzcdn.net/c.mp3')).toBeNull(); // demasiado pequeño
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
