import { useEffect, useState } from 'react';
import type { QueueStatus } from '../../../shared/types';
import { call, identity, socket } from '../net';
import { unlockAudio } from '../audio';
import { sfx } from '../sfx';
import { Banner, RankBadge, Waveform } from '../ui';
import { AccountPanel, useAccount } from './Account';
import { Leaderboard, useProfile } from './Profile';

/** Modo competitivo: 1v1 contra jugadores registrados de tu rango, con MMR (Glicko-2). */
export function Ranked({ onFound, autoSearch = false }: { onFound: (code: string) => void; autoSearch?: boolean }) {
  const username = useAccount();
  const profile = useProfile(username ? 1 : 0);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const onStatus = (s: QueueStatus) => setStatus(s.searching ? s : null);
    const onFoundEv = ({ code }: { code: string }) => { sfx.go(); setStatus(null); onFound(code); };
    const onError = ({ error: e }: { error: string }) => { setStatus(null); setError(e); };
    socket.on('ranked:status', onStatus);
    socket.on('ranked:found', onFoundEv);
    socket.on('ranked:error', onError);
    return () => { socket.off('ranked:status', onStatus); socket.off('ranked:found', onFoundEv); socket.off('ranked:error', onError); };
  }, [onFound]);

  useEffect(() => {
    if (!status) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [status]);

  // Al salir de la pantalla, sal de la cola.
  useEffect(() => () => { void call('ranked:cancel', { identity: identity() }); }, []);

  const search = async () => {
    unlockAudio();
    setError(null);
    const r = await call('ranked:queue', { identity: identity() });
    if (!r.ok) setError(r.error);
    else setStatus({ searching: true, since: Date.now(), queued: 1 });
  };
  const cancel = async () => { await call('ranked:cancel', { identity: identity() }); setStatus(null); };

  useEffect(() => { if (autoSearch && username) void search(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [autoSearch, username]);

  if (!username) {
    return (
      <div className="ranked">
        <div className="ranked__hero">
          <h2 className="h2">⚔️ Competitivo 1v1</h2>
          <p className="muted">Duelos contra jugadores registrados de tu rango y nivel parecido.</p>
        </div>
        <AccountPanel intro={<p className="account__intro">Para jugar en competitivo necesitas una cuenta (así nadie juega con perfiles desechables).</p>} />
      </div>
    );
  }

  const waited = status ? Math.max(0, Math.floor((now - status.since) / 1000)) : 0;
  return (
    <div className="ranked">
      <div className="ranked__card panel">
        <div className="ranked__top">
          <div>
            <p className="eyebrow">Competitivo 1v1</p>
            <div className="ranked__record"><b>{profile?.rankedWins ?? 0}</b><span>V</span><b>{(profile?.rankedGames ?? 0) - (profile?.rankedWins ?? 0)}</b><span>D</span></div>
            {profile && profile.rankedGames < 5 && <p className="muted">Partidas de calibración: {profile.rankedGames}/5</p>}
          </div>
          {profile && <RankBadge rank={profile.rank.id} />}
        </div>
        <ul className="ranked__rules">
          <li>10 canciones de los éxitos del momento, fragmento completo.</li>
          <li>Rival de tu mismo rango y nivel parecido (se amplía si tardas en encontrar).</li>
          <li>Tu nivel competitivo es secreto: solo sirve para emparejarte con justicia.</li>
          <li>Abandonar cuenta como derrota.</li>
        </ul>
        {status ? (
          <div className="searching" role="status" aria-live="polite">
            <Waveform bars={36} seed={waited % 7} active className="searching__wave" />
            <p><b>Buscando rival de tu nivel…</b> {waited} s · {status.queued} en cola{waited >= 20 ? ' · ampliando la búsqueda' : ''}</p>
            <button className="btn btn--ghost" onClick={cancel}>Cancelar</button>
          </div>
        ) : (
          <button className="btn btn--primary btn--lg btn--block" onClick={search}>⚔️ Buscar rival</button>
        )}
        {error && <Banner>{error}</Banner>}
      </div>
      <div className="panel">
        <h3 className="h3">Ranking competitivo</h3>
        <Leaderboard by="competitivo" />
      </div>
    </div>
  );
}
