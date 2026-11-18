import { useEffect, useState } from 'react';
import type { CatalogSummary, PublicRoom } from '../../../shared/types';
import { Icon, Logo, Waveform } from '../ui';
import { Leaderboard, ProfileCard, useProfile } from './Profile';
import { CatalogPicker, type Catalogs } from './CatalogPicker';
import { AccountPanel, useAccount } from './Account';
import { Ranked } from './Ranked';
import { AdSlot } from './AdSlot';

export type HomeTab = 'casual' | 'ranked';

interface Props {
  tab: HomeTab;
  setTab: (t: HomeTab) => void;
  autoSearch?: boolean;
  catalogs: Catalogs | null;
  catalogError: string | null;
  onRetryCatalogs: () => void;
  nickname: string;
  setNickname: (n: string) => void;
  prefillCode: string | null;
  busy: boolean;
  onPickCatalog: (c: CatalogSummary) => void;
  onSolo: () => void;
  onCreateRoom: (isPublic: boolean) => void;
  onJoin: (code: string) => void;
  onMixes: () => void;
  onRankedFound: (code: string) => void;
}

function usePublicRooms(active: boolean) {
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/salas-publicas', { cache: 'no-store' });
        if (r.ok && alive) setRooms(await r.json());
      } catch { /* se reintenta en el próximo ciclo */ }
    };
    void load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [active]);
  return rooms;
}

export function Home(p: Props) {
  const [code, setCode] = useState(p.prefillCode ?? '');
  const [isPublic, setIsPublic] = useState(false);
  const rooms = usePublicRooms(p.tab === 'casual');
  const username = useAccount();
  const profile = useProfile(username ? 2 : 1);

  return (
    <div className="home">
      <header className="home__head">
        <Logo />
        <div className="home__headtext">
          <p className="hero__tag">Escucha un fragmento. Elige el título. Gana el oído más rápido.</p>
          <Waveform className="hero__wave" bars={48} seed={11} />
        </div>
      </header>

      <div className="mode-tabs" role="tablist" aria-label="Modo de juego">
        <button role="tab" aria-selected={p.tab === 'casual'} className={p.tab === 'casual' ? 'is-on' : ''} onClick={() => p.setTab('casual')}>
          <span aria-hidden="true">🎵</span> Casual <small>práctica y salas con amigos</small>
        </button>
        <button role="tab" aria-selected={p.tab === 'ranked'} className={p.tab === 'ranked' ? 'is-on' : ''} onClick={() => p.setTab('ranked')}>
          <span aria-hidden="true">⚔️</span> Competitivo <small>duelos 1v1 por rangos</small>
        </button>
      </div>

      <div className="home__grid">
        <div className="home__main">
          {p.tab === 'ranked' ? (
            <Ranked onFound={p.onRankedFound} autoSearch={p.autoSearch} />
          ) : (
            <>
              <div className="hero__card">
                <label className="field">
                  <span className="field__label">Tu apodo <small>{username ? '(tu cuenta)' : '(juegas como invitado)'}</small></span>
                  <input id="nickname" className="input" value={p.nickname} maxLength={16} autoComplete="nickname" placeholder="Ej.: La Ballena"
                    onChange={(e) => p.setNickname(e.target.value)} autoFocus={!!p.prefillCode} />
                </label>
                {p.prefillCode && <p className="hint">Te invitaron a la sala <b className="code">{p.prefillCode}</b>. Escribe tu apodo y pulsa «Unirme».</p>}
                <div className="hero__actions">
                  <button className="btn btn--primary btn--lg" onClick={p.onSolo} disabled={p.busy}>Practicar solo</button>
                  <div className="create">
                    <button className="btn btn--secondary btn--lg" onClick={() => p.onCreateRoom(isPublic)} disabled={p.busy}>Crear sala</button>
                    <label className="check">
                      <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                      <span>Sala pública (aparece en la lista)</span>
                    </label>
                  </div>
                </div>
                <form className="join" onSubmit={(e) => { e.preventDefault(); p.onJoin(code); }}>
                  <label className="field join__field">
                    <span className="field__label">Código de sala</span>
                    <input className="input input--code" value={code} maxLength={6} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="ABC234"
                      onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
                  </label>
                  <button className="btn btn--outline" type="submit" disabled={p.busy}>Unirme</button>
                </form>
              </div>

              <section className="public" aria-labelledby="public-title">
                <h2 id="public-title" className="h2">Salas públicas</h2>
                {rooms === null && <p className="muted">Cargando salas…</p>}
                {rooms && rooms.length === 0 && <p className="muted">No hay salas públicas abiertas. ¡Crea una y marca «Sala pública»!</p>}
                {rooms && rooms.length > 0 && (
                  <ul className="rooms">
                    {rooms.map((r) => (
                      <li key={r.code} className="room">
                        <span className="room__code code">{r.code}</span>
                        <span className="room__info">
                          <b>{r.catalogName ?? 'Catálogo por elegir'}</b>
                          <span className="muted">{Icon.crown} {r.host} · {r.players}/{r.maxPlayers} jugadores</span>
                        </span>
                        <button className="btn btn--outline btn--sm" onClick={() => p.onJoin(r.code)} disabled={p.busy}>Unirme</button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <AdSlot slot="home-inline" format="banner" />

              <section className="catalogs" aria-labelledby="catalogs-title">
                <h2 id="catalogs-title" className="h2">¿Qué quieres escuchar?</h2>
                <CatalogPicker catalogs={p.catalogs} error={p.catalogError} onRetry={p.onRetryCatalogs} onSelect={p.onPickCatalog} />
              </section>
            </>
          )}
        </div>

        <aside className="home__side" aria-label="Tu perfil y ranking">
          <ProfileCard profile={profile} />
          {p.tab === 'casual' && <AccountPanel compact />}
          <button className="mixes-cta" onClick={p.onMixes}>
            <span className="mixes-cta__icon" aria-hidden="true">♫</span>
            <span><b>Mis playlists</b><small>Mezcla artistas o importa tus listas</small></span>
            <span aria-hidden="true" className="mixes-cta__arrow">→</span>
          </button>
          <section className="leaderboard panel" aria-labelledby="ranking-title">
            <h2 id="ranking-title" className="h3">Ranking por victorias</h2>
            <p className="muted">Solo multijugador. Rookie 50 · Conocedor 100 · Fan 500 · Melófano 5000.</p>
            <Leaderboard limit={10} />
          </section>
          <AdSlot slot="home-side" />
        </aside>
      </div>
      <footer className="foot">
        Vistas previas de 30 s proporcionadas por <a href="https://www.deezer.com" target="_blank" rel="noreferrer">Deezer</a>. Hecho por y para el cole ★★★
      </footer>
    </div>
  );
}
