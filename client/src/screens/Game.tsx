import { useCallback, useEffect, useRef, useState } from 'react';
import { ROUND_MS, type RoomState } from '../../../shared/types';
import { call, serverNow, socket } from '../net';
import { fragmentStart, loadClip, onAudioStatus, playClip, stopClip, unlockAudio, type AudioStatus } from '../audio';
import { sfx } from '../sfx';
import { Banner, CountUp, Cover, Icon, RankBadge, Waveform } from '../ui';

const RING = 2 * Math.PI * 26;

const MAX_ATTEMPTS = 3;
type LoadState = 'loading' | 'ready' | 'failed' | 'replacing';

export function Game({ room, onLeave }: { room: RoomState; onLeave: () => void }) {
  const round = room.round!;
  const q = round.questionId;
  const me = room.players.find((p) => p.id === room.you)!;
  const multi = room.mode === 'multi';

  const [load, setLoad] = useState<LoadState>('loading');
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(serverNow());
  const [audio, setAudio] = useState<AudioStatus>('idle');
  const currentQ = useRef(q);
  currentQ.current = q;

  useEffect(() => onAudioStatus(setAudio), []);

  // Carga del audio (con reintentos) antes de que arranque el temporizador.
  const tryLoad = useCallback(async (questionId: string, url: string, n: number) => {
    setLoad('loading');
    setAttempt(n);
    const ok = await loadClip(questionId, url);
    if (currentQ.current !== questionId) return;
    if (ok) {
      setLoad('ready');
      socket.emit('round:ready', { questionId });
    } else if (n >= MAX_ATTEMPTS) {
      setLoad('replacing');
      socket.emit('round:audioFailed', { questionId });
    } else {
      setLoad('failed');
    }
  }, []);

  useEffect(() => {
    setPending(null);
    setError(null);
    if (round.phase !== 'reveal') void tryLoad(q, round.audioUrl, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Reproducción sincronizada: el mismo fragmento (inicio aleatorio común) para todos.
  // Si reconectas a mitad de ronda, entra por donde va. En modo 1 s se corta al segundo.
  const startPlayback = useCallback(() => {
    if (!round.deadline) return;
    const elapsed = Math.max(0, (ROUND_MS - (round.deadline - serverNow())) / 1000);
    const left = round.clip.seconds - elapsed;
    if (left <= 0) return;
    const base = fragmentStart(round.clip.start, round.clip.seconds);
    void playClip(q, base + elapsed, round.clip.seconds < ROUND_MS / 1000 ? left : undefined);
  }, [q, round.deadline, round.clip.start, round.clip.seconds]);
  useEffect(() => {
    if (round.phase === 'answering' && load === 'ready' && round.deadline) startPlayback();
    if (round.phase === 'reveal') stopClip();
  }, [round.phase, load, q, round.deadline, startPlayback]);

  useEffect(() => () => stopClip(), []);

  // Cuenta regresiva.
  useEffect(() => {
    if (round.phase !== 'answering') return;
    const t = setInterval(() => {
      const n = serverNow();
      setNow(n);
      if (round.deadline && n >= round.deadline) stopClip();
    }, 100);
    return () => clearInterval(t);
  }, [round.phase, round.deadline]);

  const answered = round.yourAnswer?.optionId ?? pending;
  // En la revelación el reloj se queda congelado donde estaba (el `now` deja de actualizarse).
  const remainingMs = round.phase === 'loading' ? ROUND_MS : round.deadline ? Math.min(ROUND_MS, Math.max(0, round.deadline - now)) : 0;
  const secondsLeft = Math.ceil(remainingMs / 1000);

  // Sonidos: inicio de ronda, tic-tac de los últimos 5 s y resultado.
  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (round.phase === 'answering') sfx.roundStart();
    lastTick.current = null;
  }, [round.phase, q]);
  useEffect(() => {
    if (round.phase !== 'answering' || answered) return;
    if (secondsLeft >= 1 && secondsLeft <= 5 && lastTick.current !== secondsLeft) {
      lastTick.current = secondsLeft;
      sfx.tick(secondsLeft <= 3);
    }
  }, [secondsLeft, round.phase, answered]);
  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    if (round.phase !== 'reveal' || !round.reveal || revealedFor.current === q) return;
    revealedFor.current = q;
    const mine = round.reveal.results.find((r) => r.playerId === room.you);
    if (round.reveal.voided) sfx.timeout();
    else if (mine?.lightning) sfx.lightning();
    else if (mine?.correct) sfx.correct();
    else if (mine?.timedOut) sfx.timeout();
    else sfx.wrong();
  }, [round.phase, round.reveal, q, room.you]);

  const choose = useCallback(async (optionId: string) => {
    if (round.phase !== 'answering' || answered) return;
    sfx.pick();
    setPending(optionId);
    const r = await call('round:answer', { questionId: q, optionId });
    if (!r.ok) {
      setError(r.error);
      if (r.error !== 'Ya respondiste en esta ronda.') setPending(null);
    }
  }, [round.phase, answered, q]);

  // Teclas 1–4.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && round.options[n - 1]) {
        e.preventDefault();
        void choose(round.options[n - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, round.options]);

  const reveal = round.reveal;
  const myResult = reveal?.results.find((r) => r.playerId === room.you);
  const waitingOthers = multi && round.phase === 'answering' && !!answered;

  return (
    <section className="game">
      <header className="hud">
        <div className="hud__item">
          <span className="hud__label">Ronda</span>
          <span className="hud__value">{round.index}<small>/{round.total}</small></span>
        </div>
        <div className={`timer ${secondsLeft <= 3 && round.phase === 'answering' ? 'is-low' : ''} ${round.phase === 'answering' ? 'is-running' : ''}`} role="timer" aria-label={`${secondsLeft} segundos restantes`}>
          <svg className="timer__ring" viewBox="0 0 60 60" aria-hidden="true">
            <circle cx="30" cy="30" r="26" className="timer__track" />
            <circle cx="30" cy="30" r="26" className="timer__fill" style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - remainingMs / ROUND_MS) }} />
          </svg>
          <span className="timer__num" key={secondsLeft}>{round.phase === 'loading' ? '10' : secondsLeft}</span>
        </div>
        <div className="hud__item hud__item--right">
          <span className="hud__label">Puntos</span>
          <span className="hud__value" data-value={me.score}><CountUp value={me.score} /></span>
        </div>
      </header>

      <div className="stage" key={`stage-${round.index}`}>
        <Waveform bars={56} seed={round.index * 13} active={audio === 'playing' && round.phase === 'answering'} className="stage__wave" />
        <div className="stage__status" aria-live="polite">
          {round.phase === 'loading' && load === 'loading' && <p>{attempt > 1 ? `Reintentando (${attempt}/${MAX_ATTEMPTS})…` : multi ? 'Cargando audio para todos…' : 'Preparando la ronda…'}</p>}
          {round.phase === 'loading' && load === 'ready' && <p>{multi ? 'Esperando a que los demás carguen el audio…' : 'Listo…'}</p>}
          {round.phase === 'loading' && load === 'replacing' && <p>El audio no responde. Buscando otra canción…</p>}
          {round.phase === 'loading' && load === 'failed' && (
            <div className="stack center">
              <p><b>No se pudo cargar el audio.</b> El temporizador no empieza hasta que suene.</p>
              <div className="row center">
                <button className="btn btn--primary" onClick={() => { unlockAudio(); void tryLoad(q, round.audioUrl, attempt + 1); }}>{Icon.retry} Reintentar</button>
                <button className="btn btn--ghost" onClick={() => { setLoad('replacing'); socket.emit('round:audioFailed', { questionId: q }); }}>Cambiar canción</button>
              </div>
            </div>
          )}
          {round.phase === 'answering' && audio === 'blocked' && (
            <button className="btn btn--primary" onClick={() => { unlockAudio(); startPlayback(); }}>
              {Icon.speaker} Toca para escuchar
            </button>
          )}
          {round.phase === 'answering' && audio !== 'blocked' && (
            <p>{waitingOthers ? 'Respuesta enviada. Esperando al resto…' : round.clip.seconds < 2 ? '⚡ Modo 1 segundo: ¿qué canción era?' : '¿Qué canción es?'} <span className="kbd-hint">Teclas 1–4</span></p>
          )}
          {round.phase === 'reveal' && reveal && <RevealLine reveal={reveal} result={myResult} />}
        </div>
      </div>

      <div className={`answers ${round.options.length ? 'is-live' : ''}`} role="group" aria-label="Opciones de respuesta" key={round.options.length ? q : 'ph'}>
        {(round.options.length ? round.options : Array.from({ length: 4 }, (_, i) => ({ id: `ph${i}`, title: '', cover: null }))).map((o, i) => {
          const isMine = answered === o.id;
          const isCorrect = reveal?.correctOptionId === o.id;
          let state = '';
          let badge: React.ReactNode = null;
          if (round.phase === 'reveal') {
            if (isCorrect) { state = 'is-correct'; badge = <span className="answer__badge">{Icon.check} Correcta</span>; }
            else if (isMine) { state = 'is-wrong'; badge = <span className="answer__badge">{Icon.cross} Tu respuesta</span>; }
            else state = 'is-dim';
          } else if (isMine) {
            state = 'is-picked';
            badge = <span className="answer__badge">Enviada</span>;
          }
          const disabled = round.phase !== 'answering' || !!answered || !o.title;
          return (
            <button
              key={o.id}
              className={`answer ${state} ${!o.title ? 'is-placeholder' : ''}`}
              disabled={disabled}
              aria-disabled={disabled}
              onClick={() => choose(o.id)}
              aria-keyshortcuts={String(i + 1)}
              style={{ ['--i' as string]: i }}
            >
              {o.title ? <Cover src={o.cover} title={o.title} className="answer__cover" /> : <span className="cover cover--skeleton answer__cover" />}
              <span className="answer__key" aria-hidden="true">{i + 1}</span>
              <span className="answer__title">{o.title || ' '}</span>
              {badge}
            </button>
          );
        })}
      </div>

      {multi && (
        <ul className="scoreline" aria-label="Jugadores">
          {room.players.filter((p) => !p.left).map((p) => {
            const r = reveal?.results.find((x) => x.playerId === p.id);
            return (
              <li key={p.id} className={`chip ${p.connected ? '' : 'is-off'} ${p.id === room.you ? 'is-me' : ''}`}>
                <RankBadge rank={p.rank} compact />
                <span className="chip__name">{p.nickname}{p.isHost ? ' ♛' : ''}</span>
                <span className="chip__score"><CountUp value={p.score} /></span>
                {round.phase === 'answering' && <span className="chip__state">{p.answered ? '✓ respondió' : p.connected ? '…' : 'sin conexión'}</span>}
                {round.phase === 'reveal' && r && <span className="chip__state">{r.correct ? `+${r.points}` : r.timedOut ? '⏱ 0' : '✗ 0'}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {error && <Banner>{error}</Banner>}
      <button className="btn btn--ghost btn--sm leave" onClick={() => { if (confirm('¿Abandonar la partida?')) onLeave(); }}>Abandonar</button>
    </section>
  );
}

function RevealLine({ reveal, result }: { reveal: NonNullable<RoomState['round']>['reveal'] & {}; result?: { correct: boolean; points: number; timedOut: boolean; lightning: boolean; ms: number | null } }) {
  if (reveal.voided) {
    return <p className="verdict verdict--timeout">{Icon.cross}<span><b>Ronda anulada:</b> no hubo audio disponible. Nadie suma.</span></p>;
  }
  const song = (
    <span className="verdict__song">
      «{reveal.title}» · {reveal.artist}
      {reveal.link && <> · <a href={reveal.link} target="_blank" rel="noreferrer">{reveal.linkLabel ?? 'Escuchar completa'}</a></>}
    </span>
  );
  const secs = result?.ms != null ? ` en ${(result.ms / 1000).toLocaleString('es', { maximumFractionDigits: 2 })} s` : '';
  if (result?.lightning) return <p className="verdict verdict--lightning"><span className="verdict__bolt" aria-hidden="true">⚡</span><span><b>¡Oído biónico! +{result.points}{secs}</b>{song}</span></p>;
  if (result?.correct) return <p className="verdict verdict--ok">{Icon.check}<span><b>¡Acierto! +{result.points}{secs}</b>{song}</span></p>;
  if (result?.timedOut) return <p className="verdict verdict--timeout">{Icon.clock}<span><b>Tiempo agotado · 0</b>{song}</span></p>;
  return <p className="verdict verdict--bad">{Icon.cross}<span><b>Fallaste · 0</b>{song}</span></p>;
}
