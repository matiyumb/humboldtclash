import { useEffect, useMemo, useRef, useState } from 'react';
import { getSfxVolume, isMuted, onMuted, setMuted, setSfxVolume, sfx, unlockSfx } from './sfx';
import { getMusicVolume, setMusicVolume } from './audio';
import { effectiveTheme, getTheme, onTheme, setTheme, type Theme } from './theme';
import { RANKS } from '../../shared/types';

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

/** Emblema propio: vinilo verde, árbol de barras de sonido y tres estrellas. */
export function Emblem({ size = 40, className = '' }: { size?: number; className?: string }) {
  return <img className={`emblem ${className}`} src="/emblema.svg" alt="" width={size} height={size} />;
}

export function Logo({ small = false }: { small?: boolean }) {
  if (small) {
    return (
      <div className="logo logo--small">
        <Emblem size={34} />
        <span className="logo__text">Humboldt<b>clash</b></span>
      </div>
    );
  }
  return (
    <div className="logo">
      <Emblem size={84} className="logo__emblem" />
      <div>
        <span className="logo__text logo__text--big">Humboldt<b>clash</b></span>
        <span className="logo__tag">★ ★ ★ &nbsp;edición del cole</span>
      </div>
    </div>
  );
}

/** Insignia de rango (bronce, plata, oro, realeza). */
export function RankBadge({ rank, compact = false }: { rank: string; compact?: boolean }) {
  const r = RANKS.find((x) => x.id === rank) ?? RANKS[0];
  return (
    <span className={`rank rank--${r.tone} ${compact ? 'rank--compact' : ''}`} title={`Rango ${r.name}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 15.4 6.8 18.1l1-5.8L3.5 8.2l5.9-.9z" fill="currentColor" /></svg>
      {!compact && r.name}
    </span>
  );
}

/** Botón de tema claro/oscuro (ciclo: auto → claro → oscuro). */
export function ThemeToggle() {
  const [t, setT] = useState<Theme>(getTheme());
  useEffect(() => onTheme(setT), []);
  const next: Record<Theme, Theme> = { auto: effectiveTheme('auto') === 'dark' ? 'light' : 'dark', light: 'dark', dark: 'light' };
  const dark = effectiveTheme(t) === 'dark';
  return (
    <button className="corner-btn" onClick={() => setTheme(next[t])} aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} title={dark ? 'Modo claro' : 'Modo oscuro'}>
      {dark ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" fill="currentColor" /></svg>
      )}
    </button>
  );
}

/** Panel de sonido: volumen de música y efectos, y silencio. */
export function SoundPanel() {
  const [open, setOpen] = useState(false);
  const [m, setM] = useState(isMuted());
  const [music, setMusic] = useState(getMusicVolume());
  const [fx, setFx] = useState(getSfxVolume());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => onMuted(setM), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const silent = m || (music === 0 && fx === 0);
  return (
    <div className="sound" ref={ref}>
      <button className="corner-btn" onClick={() => { unlockSfx(); setOpen(!open); }} aria-expanded={open} aria-label="Ajustar volumen" title="Volumen">
        {silent ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" /><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" /><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        )}
      </button>
      {open && (
        <div className="sound__panel" role="dialog" aria-label="Volumen">
          <label className="slider">
            <span>Música <b>{Math.round(music * 100)}%</b></span>
            <input type="range" min={0} max={100} value={Math.round(music * 100)} onChange={(e) => { const v = Number(e.target.value) / 100; setMusic(v); setMusicVolume(v); }} />
          </label>
          <label className="slider">
            <span>Efectos <b>{Math.round(fx * 100)}%</b></span>
            <input type="range" min={0} max={100} value={Math.round(fx * 100)} onChange={(e) => { const v = Number(e.target.value) / 100; setFx(v); setSfxVolume(v); }} onPointerUp={() => sfx.pick()} />
          </label>
          <label className="check">
            <input type="checkbox" checked={m} onChange={(e) => setMuted(e.target.checked)} />
            <span>Silenciar efectos</span>
          </label>
        </div>
      )}
    </div>
  );
}

export function CornerControls() {
  return (
    <div className="corner">
      <ThemeToggle />
      <SoundPanel />
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
  exit: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4H6.5A1.5 1.5 0 005 5.5v13A1.5 1.5 0 006.5 20H14M10 12h10m-3.5-3.5L20 12l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  chat: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a1.5 1.5 0 011.5 1.5v9A1.5 1.5 0 0119 17h-7l-4.5 3.5V17H5a1.5 1.5 0 01-1.5-1.5v-9A1.5 1.5 0 015 5z" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" /><path d="M8 10h8M8 13h5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /></svg>,
};

export function Banner({ kind = 'error', children }: { kind?: 'error' | 'info'; children: React.ReactNode }) {
  return (
    <div className={`banner banner--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
