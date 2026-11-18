import { io, type Socket } from 'socket.io-client';
import type { Ack, Identity } from '../../shared/types';

function randomId(bytes = 18) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a); // funciona también sin HTTPS (a diferencia de randomUUID)
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string | null) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* sin almacenamiento */ }
}

let memoryIdentity: Identity | null = null;
/** Identidad del navegador: permite recuperar el puesto al reconectar. */
export function identity(): Identity {
  if (memoryIdentity) return memoryIdentity;
  try {
    const raw = safeGet('hc.identity');
    if (raw) {
      const parsed = JSON.parse(raw) as Identity;
      if (parsed.playerId && parsed.secret) return (memoryIdentity = parsed);
    }
  } catch { /* se regenera */ }
  memoryIdentity = { playerId: randomId(), secret: randomId(24) };
  safeSet('hc.identity', JSON.stringify(memoryIdentity));
  return memoryIdentity;
}

export const store = {
  nickname: () => safeGet('hc.nickname') ?? '',
  setNickname: (n: string) => safeSet('hc.nickname', n),
  room: () => safeGet('hc.room'),
  setRoom: (code: string | null) => safeSet('hc.room', code),
};

export const socket: Socket = io({ autoConnect: true, reconnectionDelay: 500, reconnectionDelayMax: 3000 });

export function call<T = {}>(event: string, data: object = {}, timeoutMs = 8000): Promise<Ack<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      // Socket.IO lo enviará al reconectar; avisamos si tarda demasiado.
    }
    socket.timeout(timeoutMs).emit(event, data, (err: unknown, res: Ack<T>) => {
      if (err) resolve({ ok: false, error: 'Sin conexión con el servidor. Reintentando…' });
      else resolve(res);
    });
  });
}

// Desfase entre el reloj local y el del servidor (para la cuenta regresiva).
let offset = 0;
export const serverNow = () => Date.now() + offset;
export function noteServerTime(serverTs: number) {
  // Sin medición de ida y vuelta: solo corrige si el desfase cambia mucho.
  const est = serverTs - Date.now();
  if (Math.abs(est - offset) > 400) offset = est;
}
export async function syncClock() {
  const samples: { rtt: number; off: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    const r = await call<{ now: number }>('time:sync', {}, 3000);
    const t1 = Date.now();
    if (r.ok) samples.push({ rtt: t1 - t0, off: r.now + (t1 - t0) / 2 - t1 });
  }
  if (samples.length) offset = samples.sort((a, b) => a.rtt - b.rtt)[0].off;
}
socket.on('connect', () => { void syncClock(); });
