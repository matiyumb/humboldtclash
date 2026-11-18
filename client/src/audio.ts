import { unlockSfx } from './sfx';

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
  unlockSfx();
  if (typeof resumeAudioGraph === 'function') resumeAudioGraph();
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

// Volumen de la música (0..1), recordado en el navegador.
let musicVolume = (() => { try { const v = Number(localStorage.getItem('hc.vol.music')); return Number.isFinite(v) && localStorage.getItem('hc.vol.music') !== null ? v : 0.9; } catch { return 0.9; } })();
if (el) el.volume = musicVolume;
export const getMusicVolume = () => musicVolume;
export function setMusicVolume(v: number) {
  musicVolume = Math.min(1, Math.max(0, v));
  if (el) el.volume = musicVolume;
  try { localStorage.setItem('hc.vol.music', String(musicVolume)); } catch { /* sin almacenamiento */ }
}

/** Duración del audio cargado (s), o 0 si no se conoce. */
export const clipDuration = () => (el && Number.isFinite(el.duration) ? el.duration : 0);

/**
 * Punto de inicio del fragmento: `start` (0..1, el mismo para toda la sala) recorre la parte
 * de la canción donde caben `seconds` segundos completos.
 */
export function fragmentStart(start: number, seconds: number) {
  const d = clipDuration();
  return Math.max(0, (d - seconds - 0.25) * Math.min(1, Math.max(0, start)));
}

let stopTimer: ReturnType<typeof setTimeout> | undefined;

/** Reproduce desde `offsetSec`; si `maxSec` se indica, se corta a los `maxSec` segundos. */
export async function playClip(key: string, offsetSec = 0, maxSec?: number) {
  if (!el || loadedFor !== key) return;
  clearTimeout(stopTimer);
  if (maxSec !== undefined && maxSec <= 0.05) return;
  try {
    el.volume = musicVolume;
    el.currentTime = Math.max(0, offsetSec);
    await el.play();
    if (maxSec !== undefined) stopTimer = setTimeout(() => stopClip(), maxSec * 1000);
    unlocked = true;
    setStatus('playing');
  } catch (e) {
    setStatus((e as DOMException)?.name === 'NotAllowedError' ? 'blocked' : 'idle');
  }
}

export function stopClip() {
  if (!el) return;
  clearTimeout(stopTimer);
  el.pause();
  if (status === 'playing') setStatus('idle');
}

export function forgetClip() {
  stopClip();
  loadedFor = null;
}

// ---------- Modo instrumental (efecto karaoke) ----------
// La voz suele grabarse en el centro de la mezcla estéreo: restando el canal derecho al izquierdo
// se cancela casi toda la voz. Los graves (también centrados) se recuperan con un filtro de paso bajo.
// Es una aproximación: en canciones con voz muy abierta o en mono no hace milagros.
let graph: { ctx: AudioContext; dry: GainNode; wet: GainNode } | null = null;
let instrumental = false;

function buildGraph() {
  if (graph || !el) return graph;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    const ctx = new AC();
    const src = ctx.createMediaElementSource(el);
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    // Rama normal
    src.connect(dry).connect(ctx.destination);
    // Rama sin voz: (L − R) + graves de (L + R)
    const split = ctx.createChannelSplitter(2);
    const invR = ctx.createGain(); invR.gain.value = -1;
    const side = ctx.createGain();
    src.connect(split);
    split.connect(side, 0);
    split.connect(invR, 1).connect(side);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
    const mid = ctx.createGain(); mid.gain.value = 0.5;
    split.connect(mid, 0); split.connect(mid, 1);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const boost = ctx.createGain(); boost.gain.value = 1.4;
    side.connect(hp).connect(boost).connect(wet);
    mid.connect(lp).connect(wet);
    wet.connect(ctx.destination);
    dry.gain.value = 1; wet.gain.value = 0;
    graph = { ctx, dry, wet };
  } catch {
    graph = null;
  }
  return graph;
}

/** Activa/desactiva el modo instrumental. Llamar tras un gesto del usuario la primera vez. */
export function setInstrumental(on: boolean) {
  instrumental = on;
  if (!on && !graph) return; // sin cambios: el audio sigue su camino normal
  const g = buildGraph();
  if (!g) return;
  if (g.ctx.state === 'suspended') void g.ctx.resume();
  const t = g.ctx.currentTime;
  g.dry.gain.setTargetAtTime(on ? 0 : 1, t, 0.03);
  g.wet.gain.setTargetAtTime(on ? 1 : 0, t, 0.03);
}
export const isInstrumental = () => instrumental;
export function resumeAudioGraph() { if (graph && graph.ctx.state === 'suspended') void graph.ctx.resume(); }
