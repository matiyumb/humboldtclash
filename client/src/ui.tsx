import { useMemo } from 'react';

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

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? 'logo--small' : ''}`}>
      <span className="logo__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32"><g fill="currentColor"><rect x="5" y="13" width="3" height="6" rx="1.5" /><rect x="10" y="8" width="3" height="16" rx="1.5" /><rect x="15" y="4" width="3" height="24" rx="1.5" /><rect x="20" y="10" width="3" height="12" rx="1.5" /><rect x="25" y="14" width="3" height="4" rx="1.5" /></g></svg>
      </span>
      <span className="logo__text">Humboldt<b>clash</b></span>
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
