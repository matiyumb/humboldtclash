import { useEffect, useRef, useState } from 'react';
import type { CatalogSummary, RoomState } from '../../../shared/types';
import { call } from '../net';
import { isUnlocked, unlockAudio } from '../audio';
import { sfx } from '../sfx';
import { Banner, Icon, RankBadge, Waveform } from '../ui';
import { CatalogPicker, type Catalogs } from './CatalogPicker';
import { SettingsForm } from './SettingsForm';
import type { ChatMessage, GameSettings } from '../../../shared/types';
import { Chat } from './Chat';

export function Lobby({ room, catalogs, chat, onLeave }: { room: RoomState; catalogs: Catalogs | null; chat: ChatMessage[]; onLeave: () => void }) {
  const isHost = room.hostId === room.you;
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [soundOn, setSoundOn] = useState(isUnlocked());
  const [picking, setPicking] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(!room.catalog);
  const link = `${location.origin}/sala/${room.code}`;
  const active = room.players.filter((p) => !p.left);
  const connected = active.filter((p) => p.connected).length;
  const canStart = isHost && connected >= room.minPlayers && !!room.catalog && !picking;

  const count = active.length;
  const prevCount = useRef(count);
  useEffect(() => {
    if (count > prevCount.current) sfx.join();
    prevCount.current = count;
  }, [count]);

  useEffect(() => {
    const t = setInterval(() => setSoundOn(isUnlocked()), 800);
    return () => clearInterval(t);
  }, []);

  const copy = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Humboldtclash', text: `¡Únete a mi sala ${room.code}!`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      (document.getElementById('share-link') as HTMLInputElement | null)?.select();
    }
  };

  const setCatalog = async (c: CatalogSummary) => {
    setPicking(c.id);
    setError(null);
    const r = await call('room:setCatalog', { catalogId: c.id }, 15000);
    setPicking(null);
    if (r.ok) setShowPicker(false);
    else setError(`${c.name}: ${r.error}`);
  };

  const changeSettings = async (s: GameSettings) => {
    const r = await call('room:setSettings', { settings: s });
    if (!r.ok) setError(r.error);
  };

  const resize = async (size: number) => {
    const r = await call('room:setSize', { size });
    if (!r.ok) setError(r.error);
  };

  const togglePublic = async () => {
    const r = await call('room:setPublic', { isPublic: !room.isPublic });
    if (!r.ok) setError(r.error);
  };

  const kick = async (playerId: string, nickname: string) => {
    if (!confirm(`¿Expulsar a ${nickname}? No podrá volver a entrar en esta sala.`)) return;
    const r = await call('room:kick', { playerId });
    setError(r.ok ? null : r.error);
  };

  const start = async () => {
    unlockAudio();
    const r = await call('room:start', {}, 15000);
    setError(r.ok ? null : r.error);
  };

  return (
    <section className="lobby">
      <div className="lobby__head">
        <div>
          <p className="eyebrow">{room.isPublic ? 'Sala pública' : 'Sala privada'}</p>
          <h1 className="h1 code code--big" aria-label={`Código de sala ${room.code.split('').join(' ')}`}>{room.code}</h1>
        </div>
        <Waveform bars={28} seed={room.code.charCodeAt(0)} className="lobby__wave" />
      </div>

      <div className="share">
        <label className="sr-only" htmlFor="share-link">Enlace para compartir</label>
        <input id="share-link" className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn btn--outline" onClick={copy}>{Icon.link} {copied ? '¡Copiado!' : 'Compartir enlace'}</button>
      </div>

      <div className="lobby__cols">
        <div className="panel">
          <h2 className="h3">Jugadores <span className="muted">({active.length}/{room.maxPlayers})</span></h2>
          <ul className="players">
            {active.map((p) => (
              <li key={p.id} className={`player ${p.connected ? '' : 'is-off'}`}>
                <span className="player__avatar" aria-hidden="true">{p.nickname.slice(0, 1).toUpperCase()}</span>
                <RankBadge rank={p.rank} compact />
                <span className="player__name">
                  {p.nickname}
                  {p.id === room.you && <span className="tag">tú</span>}
                </span>
                {p.isHost && <span className="tag tag--host">{Icon.crown} Anfitrión</span>}
                {!p.connected && <span className="tag tag--off">desconectado</span>}
                {isHost && p.id !== room.you && (
                  <button type="button" className="btn btn--ghost btn--sm player__kick" onClick={() => kick(p.id, p.nickname)} aria-label={`Expulsar a ${p.nickname}`}>
                    Expulsar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {connected < room.minPlayers && <p className="hint">Comparte el código: hacen falta al menos {room.minPlayers} jugadores.</p>}
          {isHost && (
            <label className="check">
              <input type="checkbox" checked={room.isPublic} onChange={togglePublic} />
              <span>Sala pública: aparece en la lista de salas del inicio</span>
            </label>
          )}
          {isHost && (
            <div className="stepper" role="group" aria-label="Tamaño de la sala">
              <span className="stepper__label">Tamaño de la sala</span>
              <button type="button" className="icon-btn" aria-label="Menos jugadores" disabled={room.maxPlayers <= Math.max(2, active.length)} onClick={() => resize(room.maxPlayers - 1)}>−</button>
              <b className="stepper__value" aria-live="polite">{room.maxPlayers}</b>
              <button type="button" className="icon-btn" aria-label="Más jugadores" disabled={room.maxPlayers >= 10} onClick={() => resize(room.maxPlayers + 1)}>+</button>
            </div>
          )}
        </div>

        <div className="panel">
          <h2 className="h3">Catálogo</h2>
          <p className="lobby__catalog">{room.catalog ? room.catalog.name : isHost ? 'Aún no has elegido.' : 'El anfitrión aún no ha elegido.'}</p>
          {picking && <p className="muted">Cargando canciones…</p>}
          {isHost ? (
            <>
              {room.catalog && !showPicker && (
                <button className="btn btn--ghost btn--sm" onClick={() => setShowPicker(true)}>Cambiar catálogo</button>
              )}
              <button className="btn btn--primary btn--lg btn--block" disabled={!canStart} onClick={start}>
                {Icon.speaker} Empezar partida
              </button>
              {!room.catalog && <p className="hint">Elige abajo un artista o una colección para poder empezar.</p>}
            </>
          ) : (
            <p className="muted">Esperando a que el anfitrión empiece la partida…</p>
          )}
          {!soundOn && (
            <button className="btn btn--ghost btn--sm" onClick={() => { unlockAudio(); setTimeout(() => setSoundOn(isUnlocked()), 300); }}>
              {Icon.speaker} Activar sonido
            </button>
          )}
        </div>
      </div>

      <Chat messages={chat} you={room.you} />

      <div className="panel">
        <h2 className="h3">Ajustes de la partida{!isHost && <span className="muted"> · los elige el anfitrión</span>}</h2>
        <SettingsForm value={room.settings} onChange={isHost ? changeSettings : undefined} showShuffle={!!room.catalog && /^(mix|deezer:playlist)/.test(room.catalog.id)} />
      </div>

      {error && <Banner>{error}</Banner>}

      {isHost && showPicker && (
        <div className="panel">
          <h2 className="h3">Elige artista o colección</h2>
          <CatalogPicker catalogs={catalogs} selectedId={picking ?? room.catalog?.id} onSelect={setCatalog} radio />
        </div>
      )}

      <button className="btn btn--ghost" onClick={onLeave}>Salir de la sala</button>
    </section>
  );
}
