import { useEffect, useRef, useState } from 'react';
import type { RoomState } from '../../../shared/types';
import { serverNow } from '../net';
import { sfx } from '../sfx';
import { Waveform } from '../ui';

/** Cuenta atrás «3, 2, 1, ¡Ya!» común para todos los jugadores antes de la primera ronda. */
export function Intro({ room }: { room: RoomState }) {
  const startsAt = room.intro?.startsAt ?? serverNow();
  const [left, setLeft] = useState(() => Math.max(0, startsAt - serverNow()));
  const last = useRef<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, startsAt - serverNow())), 50);
    return () => clearInterval(t);
  }, [startsAt]);

  // 3500 ms → «3» (3.5–2.5 s), «2», «1», y «¡Ya!» en el último medio segundo.
  const n = Math.ceil((left - 500) / 1000);
  const label = n >= 1 ? String(Math.min(3, n)) : '¡Ya!';

  useEffect(() => {
    if (last.current === n) return;
    last.current = n;
    if (n >= 1 && n <= 3) sfx.countdown();
    else if (n <= 0) sfx.go();
  }, [n]);

  return (
    <section className="intro" aria-live="assertive">
      <p className="eyebrow">{room.catalog?.name ?? 'Humboldtclash'}</p>
      <div className="intro__ring">
        <span className={`intro__num ${n <= 0 ? 'is-go' : ''}`} key={label}>{label}</span>
      </div>
      <p className="intro__hint">Prepárate: 10 rondas · 10 segundos cada una</p>
      <Waveform bars={48} seed={9} active className="intro__wave" />
    </section>
  );
}
