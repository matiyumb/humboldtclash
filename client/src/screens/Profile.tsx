import { useEffect, useState } from 'react';
import type { LeaderRow, Profile, RankDef } from '../../../shared/types';
import { identity } from '../net';
import { CountUp, RankBadge } from '../ui';

export interface ProfileResp extends Profile { rank: RankDef; nextRank: RankDef | null; persistent: boolean }

export function useProfile(refresh = 0) {
  const [p, setP] = useState<ProfileResp | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/perfil/${identity().playerId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setP(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [refresh]);
  return p;
}

/** Tarjeta con tu rango, victorias y lo que falta para el siguiente. */
export function ProfileCard({ profile, highlight = false }: { profile: ProfileResp | null; highlight?: boolean }) {
  if (!profile) return null;
  const { rank, nextRank, wins } = profile;
  const pct = nextRank ? Math.min(100, ((wins - rank.min) / (nextRank.min - rank.min)) * 100) : 100;
  return (
    <div className={`profile profile--${rank.tone} ${highlight ? 'is-highlight' : ''}`}>
      <div className="profile__top">
        <RankBadge rank={rank.id} />
        <span className="profile__wins"><b><CountUp value={wins} /></b> {wins === 1 ? 'victoria' : 'victorias'}</span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Progreso de rango">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="profile__next">
        {nextRank ? <>Te faltan <b>{nextRank.min - wins}</b> para <b>{nextRank.name}</b></> : <>¡Rango máximo! Eres leyenda.</>}
      </p>
      <dl className="profile__stats">
        <div><dt>Puntos</dt><dd><CountUp value={profile.points} /></dd></div>
        <div><dt>Partidas</dt><dd>{profile.games}</dd></div>
        <div><dt>Mejor</dt><dd>{profile.best.toLocaleString('es')}</dd></div>
      </dl>
    </div>
  );
}

export function Leaderboard() {
  const [rows, setRows] = useState<(LeaderRow & { rank: string })[] | null>(null);
  useEffect(() => {
    fetch('/api/ranking', { cache: 'no-store' }).then((r) => r.json()).then(setRows).catch(() => setRows([]));
  }, []);
  const me = identity().playerId;
  if (!rows) return <p className="muted">Cargando ranking…</p>;
  if (!rows.length) return <p className="muted">Aún nadie ha jugado. ¡Sé el primero del ranking!</p>;
  return (
    <ol className="leaders">
      {rows.map((r, i) => (
        <li key={r.playerId} className={r.playerId === me ? 'is-me' : ''} style={{ ['--i' as string]: i }}>
          <span className={`pos pos--${r.position}`}>{r.position}º</span>
          <RankBadge rank={r.rank} compact />
          <span className="leaders__name">{r.nickname}</span>
          <span className="leaders__wins"><b>{r.wins}</b> vict.</span>
          <span className="leaders__pts">{r.points.toLocaleString('es')} pts</span>
        </li>
      ))}
    </ol>
  );
}
