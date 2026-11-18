// Un solo elemento <audio> reutilizado: así el desbloqueo por clic sirve para toda la partida.
const SILENCE =
  'data:audio/wav;base64,UklGRpYDAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YXIDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const el = typeof Audio !== 'undefined' ? new Audio() : (null as unknown as HTMLAudioElement);
if (el) { el.preload = 'auto'; el.setAttribute('playsinline', ''); }
let unlocked = false;
let currentObjectUrl: string | null = null;
let loadedFor: string | null = null;
const listeners = new Set<(s: AudioStatus) => void>();

export type AudioStatus = 'idle' | 'playing' | 'blocked';
let status: AudioStatus = 'idle';
function setStatus(s: AudioStatus) { status = s; listeners.forEach((l) => l(s)); }
export const onAudioStatus = (fn: (s: AudioStatus) => void) => { listeners.add(fn); fn(status); return () => { listeners.delete(fn); }; };

/** Llamar dentro de un clic del usuario. */
export function unlockAudio() {
  if (!el || unlocked) return;
  try {
    el.src = SILENCE;
    const p = el.play();
    if (p) p.then(() => { unlocked = true; }).catch(() => {});
    else unlocked = true;
  } catch { /* se reintenta en el siguiente clic */ }
}
export const isUnlocked = () => unlocked;

/** Descarga el audio completo y comprueba que el navegador puede decodificarlo. */
export async function loadClip(key: string, url: string, timeoutMs = 9000): Promise<boolean> {
  if (!el) return false;
  if (loadedFor === key) return true;
  stopClip();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (blob.size < 1024) return false;
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(blob);
    el.src = currentObjectUrl;
    const ok = await new Promise<boolean>((resolve) => {
      const done = (v: boolean) => { el.removeEventListener('canplay', yes); el.removeEventListener('loadeddata', yes); el.removeEventListener('error', no); resolve(v); };
      const yes = () => done(true);
      const no = () => done(false);
      el.addEventListener('canplay', yes);
      el.addEventListener('loadeddata', yes);
      el.addEventListener('error', no);
      ctrl.signal.addEventListener('abort', no);
      el.load();
    });
    if (ok) loadedFor = key;
    return ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function playClip(key: string, offsetSec = 0) {
  if (!el || loadedFor !== key) return;
  try {
    el.currentTime = Math.max(0, offsetSec);
    await el.play();
    unlocked = true;
    setStatus('playing');
  } catch (e) {
    setStatus((e as DOMException)?.name === 'NotAllowedError' ? 'blocked' : 'idle');
  }
}

export function stopClip() {
  if (!el) return;
  el.pause();
  if (status === 'playing') setStatus('idle');
}

export function forgetClip() {
  stopClip();
  loadedFor = null;
}
