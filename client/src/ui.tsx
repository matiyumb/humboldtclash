import { useEffect, useMemo, useRef, useState } from 'react';
import { isMuted, onMuted, setMuted, unlockSfx } from './sfx';

/** Forma de onda decorativa (determinista para que no "salte" entre renders). */
export function Waveform({ bars = 48, seed = 7, active = false, className = '' }: { bars?: number; seed?: number; active?: boolean; className?: string }) {
  const heights = useMemo(() => {
    let s = seed;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    return Array.from({ length: bars }, (_, i) => {
      const env = Math.sin((Math.PI * (i + 0.5)) / bars);
      return Math.max(0.12, env * (0.35 + 0.65 * rnd()));
    });
  }, [bars, seed]);
  const w = bars * 6;
  return (
    <svg className={`waveform ${active ? 'is-active' : ''} ${className}`} viewBox={`0 0 ${w} 40`} preserveAspectRatio="none" aria-hidden="true">
      {heights.map((h, i) => (
        <rect key={i} x={i * 6 + 1} y={20 - h * 18} width={3.2} height={h * 36} rx={1.6} style={{ animationDelay: `${(i % 9) * 70}ms` }} />
      ))}
    </svg>
  );
}

/** Logo grande (inicio): escudo del colegio + nombre del juego. */
export function Logo({ small = false }: { small?: boolean }) {
  if (small) {
    return (
      <div className="logo logo--small">
        <img className="logo__shield" src="/escudo.png" alt="" width={34} height={34} />
        <span className="logo__text">Humboldt<b>clash</b></span>
      </div>
    );
  }
  return (
    <div className="logo">
      <img className="logo__school" src="/logo-humboldt.png" alt="Colegio Peruano Alemán Alexander von Humboldt" width={500} height={201} />
      <span className="logo__text logo__text--big">Humboldt<b>clash</b></span>
    </div>
  );
}

const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 90);

/** Portada del álbum; si no hay o falla, un disco de color con nota musical. */
export function Cover({ src, title, size = 56, className = '' }: { src: string | null; title: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) {
    return <img className={`cover ${className}`} src={src} alt="" width={size} height={size} loading="eager" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  const h = hue(title || '?');
  return (
    <span className={`cover cover--placeholder ${className}`} style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h} 55% 52%), hsl(${(h + 40) % 360} 60% 38%))` }} aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M9 18.5a2.5 2.5 0 11-2-2.45V5l11-2v11.5a2.5 2.5 0 11-2-2.45V6.4l-7 1.27z" fill="rgba(255,255,255,.92)" /></svg>
    </span>
  );
}

/** Botón flotante para silenciar los efectos de sonido. */
export function MuteButton() {
  const [m, setM] = useState(isMuted());
  useEffect(() => onMuted(setM), []);
  return (
    <button
      className="mute"
      onClick={() => { unlockSfx(); setMuted(!m); }}
      aria-pressed={m}
      aria-label={m ? 'Activar efectos de sonido' : 'Silenciar efectos de sonido'}
      title={m ? 'Efectos silenciados' : 'Efectos activados'}
    >
      {m ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" /><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" /><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      )}
    </button>
  );
}

/** Número que sube animado hasta su valor (marcadores). */
export function useCountUp(value: number, ms = 650, start?: number) {
  const [shown, setShown] = useState(start ?? value);
  const from = useRef(start ?? value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    if (a === value || matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); from.current = value; return; }
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, ms]);
  return shown;
}

export function CountUp({ value, from, ms }: { value: number; from?: number; ms?: number }) {
  return <>{useCountUp(value, ms ?? 650, from).toLocaleString('es')}</>;
}

/** Confeti verde y dorado (solo CSS). */
export function Confetti({ pieces = 60 }: { pieces?: number }) {
  const items = useMemo(
    () => Array.from({ length: pieces }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      dur: 2.2 + Math.random() * 1.6,
      rot: Math.random() * 360,
      color: ['#66952e', '#e9bf0f', '#8cc152', '#ffffff', '#4a7a1f'][i % 5],
      w: 6 + Math.random() * 6,
    })),
    [pieces],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {items.map((p, i) => (
        <span key={i} style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, background: p.color, width: p.w, height: p.w * 0.45, transform: `rotate(${p.rot}deg)` }} />
      ))}
    </div>
  );
}

export const Icon = {
  check: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  cross: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>,
  clock: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M12 9v4.5l3 2M9.5 2.5h5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>,
  crown: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="currentColor" /></svg>,
  speaker: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" /><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
  link: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>,
  user: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="currentColor" /><path d="M4 21a8 8 0 0116 0" fill="currentColor" /></svg>,
  retry: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  back: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
};

export function Banner({ kind = 'error', children }: { kind?: 'error' | 'info'; children: React.ReactNode }) {
  return (
    <div className={`banner banner--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
