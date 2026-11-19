import { useEffect, useState } from 'react';
import type { ChatMessage, RoomState } from '../../../shared/types';
import { Chat } from './Chat';
import { call } from '../net';
import { unlockAudio } from '../audio';
import { sfx } from '../sfx';
import { Banner, Confetti, CountUp, Icon, Waveform } from '../ui';
import { ProfileCard, useProfile } from './Profile';

const REASON = {
  wrong: { icon: Icon.cross, text: 'Fallaste' },
  timeout: { icon: Icon.clock, text: 'Tiempo agotado' },
  voided: { icon: Icon.cross, text: 'Ronda anulada' },
} as const;

const secs = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} s`);

export function Results({ room, chat, onHome, onRanked }: { room: RoomState; chat: ChatMessage[]; onHome: () => void; onRanked?: () => void }) {
  const r = room.results!;
  const isHost = room.hostId === room.you;
  const [error, setError] = useState<string | null>(null);
  const mine = r.standings.find((s) => s.playerId === room.you);
  const celebrate = r.youWon;
  useEffect(() => { sfx.fanfare(); }, []);
  // El perfil se guarda en el servidor al terminar: se vuelve a pedir tras un momento.
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { const t = setTimeout(() => setRefresh(1), 900); return () => clearTimeout(t); }, []);
  const profile = useProfile(refresh);

  const again = async () => {
    unlockAudio();
    const res = await call('room:playAgain');
    if (!res.ok) setError(res.error);
  };

  return (
    <section className="results">
      {celebrate && <Confetti />}
      <Waveform bars={40} seed={5} active className="results__wave" />
      {room.mode === 'solo' ? (
        <>
          <p className="eyebrow">Resultado · {room.catalog?.name}</p>
          <h1 className="score-big" data-value={mine?.score ?? 0}><CountUp value={mine?.score ?? 0} from={0} ms={1400} /><small> puntos</small></h1>
          <p className="results__hits"><b>{mine?.correct ?? 0}</b> aciertos de {r.totalRounds}{mine?.avgMs != null && <span className="muted"> · respondes en {secs(mine.avgMs)} de media</span>}</p>
          <p className="practice-note">🎯 Modo práctica: no suma victorias. Las victorias se ganan en salas y en competitivo.</p>
          {r.missed.length > 0 ? (
            <div className="panel">
              <h2 className="h3">Canciones falladas</h2>
              <ul className="missed">
                {r.missed.map((m) => (
                  <li key={m.round}>
                    <span className={`missed__icon missed__icon--${m.reason}`} title={REASON[m.reason].text}>{REASON[m.reason].icon}</span>
                    <span className="missed__song"><b>{m.title}</b> · {m.artist}</span>
                    <span className="missed__why">R{m.round} · {REASON[m.reason].text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="verdict verdict--ok">{Icon.check}<span><b>¡Partida perfecta!</b> Acertaste todas.</span></p>
          )}
        </>
      ) : (
        <>
          <p className="eyebrow">{room.mode === 'ranked' ? 'Competitivo 1v1' : `Sala ${room.code}`} · {room.catalog?.name}</p>
          <h1 className="h1">{room.mode === 'ranked' ? (r.youWon ? '¡Ganaste el duelo!' : r.tie ? 'Empate' : 'Derrota') : 'Clasificación final'}</h1>
          {room.mode === 'ranked' && <p className="muted">{r.youWon ? '+1 victoria competitiva.' : r.tie ? 'Un empate no cuenta como victoria ni como derrota.' : 'Sigue practicando: la próxima es tuya.'}</p>}
          {room.mode === 'multi' && r.tie && <p className="tie-note" role="status">🤝 Empate en el primer puesto: nadie suma victoria ni derrota.</p>}
          <div className="panel table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Pos.</th><th scope="col">Apodo</th><th scope="col" className="num">Puntaje</th><th scope="col" className="num">Aciertos</th><th scope="col" className="num">Tiempo medio</th></tr>
              </thead>
              <tbody>
                {r.standings.map((s, i) => (
                  <tr key={s.playerId} className={s.playerId === room.you ? 'is-me' : ''} style={{ ['--i' as string]: i }}>
                    <td><span className={`pos pos--${s.position}`}>{s.position}º</span></td>
                    <td>{s.nickname}{s.playerId === room.you && <span className="tag">tú</span>}{s.left && <span className="tag tag--off">se fue</span>}</td>
                    <td className="num">{s.score.toLocaleString('es')}</td>
                    <td className="num">{s.correct}/{r.totalRounds}</td>
                    <td className="num">{secs(s.avgMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.missed.length > 0 && (
            <details className="panel">
              <summary>Tus canciones falladas ({r.missed.length})</summary>
              <ul className="missed">
                {r.missed.map((m) => (
                  <li key={m.round}>
                    <span className={`missed__icon missed__icon--${m.reason}`}>{REASON[m.reason].icon}</span>
                    <span className="missed__song"><b>{m.title}</b> · {m.artist}</span>
                    <span className="missed__why">{REASON[m.reason].text}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {r.youWon && <p className="win-flag">🏆 ¡Victoria! Suma para tu rango</p>}
      {refresh > 0 && room.mode !== 'solo' && <ProfileCard profile={profile} highlight={r.youWon} />}
      {room.mode === 'multi' && <Chat messages={chat} you={room.you} />}
      {error && <Banner>{error}</Banner>}
      <div className="row center results__actions">
        {room.mode === 'ranked' ? (
          <button className="btn btn--primary btn--lg" onClick={onRanked}>⚔️ Buscar otro duelo</button>
        ) : room.mode === 'solo' || isHost ? (
          <button className="btn btn--primary btn--lg" onClick={again}>Jugar otra vez</button>
        ) : (
          <button className="btn btn--primary btn--lg" disabled title="Solo el anfitrión puede reiniciar">Jugar otra vez <small>(espera al anfitrión)</small></button>
        )}
        <button className="btn btn--outline btn--lg" onClick={onHome}>Volver al inicio</button>
      </div>
    </section>
  );
}
