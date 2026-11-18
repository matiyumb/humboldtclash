// Efectos de sonido sintetizados (Web Audio): cuenta atrás, tic-tac, acierto, fallo, fanfarria.
// Suaves y cortos para no tapar la canción. Se pueden silenciar (se recuerda en el navegador).

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let master: GainNode | null = null;
let muted = (() => { try { return localStorage.getItem('hc.muted') === '1'; } catch { return false; } })();
const listeners = new Set<(m: boolean) => void>();

function ensure(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Llamar en un clic: los navegadores exigen un gesto para activar el audio. */
export function unlockSfx() {
  const c = ensure();
  if (c && c.state === 'suspended') void c.resume();
}

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('hc.muted', m ? '1' : '0'); } catch { /* sin almacenamiento */ }
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.02);
  listeners.forEach((l) => l(m));
}
export const onMuted = (fn: (m: boolean) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

interface Note { f: number; t?: number; d?: number; type?: OscillatorType; g?: number; slide?: number }

function play(notes: Note[]) {
  const c = ensure();
  if (!c || !master || muted) return;
  if (c.state === 'suspended') void c.resume();
  const now = c.currentTime + 0.01;
  for (const n of notes) {
    const start = now + (n.t ?? 0);
    const dur = n.d ?? 0.12;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = n.type ?? 'sine';
    osc.frequency.setValueAtTime(n.f, start);
    if (n.slide) osc.frequency.exponentialRampToValueAtTime(n.slide, start + dur);
    const peak = n.g ?? 0.18;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }
}

export const sfx = {
  /** «3», «2», «1» de la cuenta atrás inicial. */
  countdown: () => play([{ f: 660, d: 0.16, type: 'triangle', g: 0.22 }, { f: 1320, d: 0.08, g: 0.05 }]),
  /** «¡Ya!»: acorde ascendente alegre. */
  go: () => play([
    { f: 523.25, d: 0.35, type: 'triangle', g: 0.16 },
    { f: 659.25, t: 0.06, d: 0.35, type: 'triangle', g: 0.15 },
    { f: 783.99, t: 0.12, d: 0.45, type: 'triangle', g: 0.15 },
    { f: 1046.5, t: 0.18, d: 0.55, type: 'sine', g: 0.12 },
  ]),
  /** Comienza la ronda (suena la canción). */
  roundStart: () => play([{ f: 880, d: 0.09, type: 'sine', g: 0.08 }, { f: 1175, t: 0.07, d: 0.12, type: 'sine', g: 0.07 }]),
  /** Tic suave de los últimos segundos; `urgent` para 3-2-1. */
  tick: (urgent = false) =>
    play(urgent
      ? [{ f: 1046, d: 0.07, type: 'square', g: 0.05 }, { f: 1568, d: 0.05, g: 0.04 }]
      : [{ f: 1400, d: 0.035, type: 'triangle', g: 0.045 }]),
  /** Al pulsar una respuesta. */
  pick: () => play([{ f: 520, d: 0.08, type: 'sine', g: 0.1, slide: 760 }]),
  correct: () => play([
    { f: 783.99, d: 0.14, type: 'triangle', g: 0.16 },
    { f: 1046.5, t: 0.09, d: 0.22, type: 'triangle', g: 0.16 },
    { f: 1567.98, t: 0.18, d: 0.3, type: 'sine', g: 0.1 },
  ]),
  wrong: () => play([
    { f: 220, d: 0.18, type: 'sawtooth', g: 0.06, slide: 160 },
    { f: 233, t: 0.02, d: 0.2, type: 'triangle', g: 0.08, slide: 170 },
  ]),
  timeout: () => play([{ f: 440, d: 0.16, type: 'triangle', g: 0.1 }, { f: 330, t: 0.14, d: 0.28, type: 'triangle', g: 0.1 }]),
  fanfare: () => play([
    { f: 523.25, d: 0.16, type: 'triangle', g: 0.14 },
    { f: 659.25, t: 0.14, d: 0.16, type: 'triangle', g: 0.14 },
    { f: 783.99, t: 0.28, d: 0.16, type: 'triangle', g: 0.14 },
    { f: 1046.5, t: 0.42, d: 0.6, type: 'triangle', g: 0.16 },
    { f: 1318.5, t: 0.42, d: 0.6, type: 'sine', g: 0.08 },
  ]),
  join: () => play([{ f: 988, d: 0.08, g: 0.08 }, { f: 1319, t: 0.07, d: 0.12, g: 0.07 }]),
};
