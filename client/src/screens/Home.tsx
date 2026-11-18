import { useEffect, useState } from 'react';
import type { CatalogSummary, PublicRoom } from '../../../shared/types';
import { Icon, Logo, Waveform } from '../ui';
import { CatalogPicker, type Catalogs } from './CatalogPicker';

interface Props {
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
}

function usePublicRooms() {
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  useEffect(() => {
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
  }, []);
  return rooms;
}

export function Home(p: Props) {
  const [code, setCode] = useState(p.prefillCode ?? '');
  const [isPublic, setIsPublic] = useState(false);
  const rooms = usePublicRooms();

  return (
    <div className="home">
      <section className="hero">
        <Waveform className="hero__wave" bars={64} seed={11} />
        <Logo />
        <p className="hero__tag">Escucha 10 segundos. Elige el título. Gana el oído más rápido.</p>

        <div className="hero__card">
          <label className="field">
            <span className="field__label">Tu apodo <small>(juegas como invitado)</small></span>
            <input
              id="nickname"
              className="input"
              value={p.nickname}
              maxLength={16}
              autoComplete="nickname"
              placeholder="Ej.: La Ballena"
              onChange={(e) => p.setNickname(e.target.value)}
              autoFocus={!!p.prefillCode}
            />
          </label>

          {p.prefillCode && (
            <p className="hint">Te invitaron a la sala <b className="code">{p.prefillCode}</b>. Escribe tu apodo y pulsa «Unirme».</p>
          )}

          <div className="hero__actions">
            <button className="btn btn--primary btn--lg" onClick={p.onSolo} disabled={p.busy}>Jugar solo</button>
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
              <input
                className="input input--code"
                value={code}
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="ABC234"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </label>
            <button className="btn btn--outline" type="submit" disabled={p.busy}>Unirme</button>
          </form>
        </div>
      </section>

      <section className="public" aria-labelledby="public-title">
        <h2 id="public-title" className="h2">Salas públicas</h2>
        {rooms === null && <p className="muted">Cargando salas…</p>}
        {rooms && rooms.length === 0 && <p className="muted">No hay salas públicas abiertas ahora. ¡Crea una y marca «Sala pública»!</p>}
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

      <section className="catalogs" aria-labelledby="catalogs-title">
        <h2 id="catalogs-title" className="h2">Artistas y colecciones</h2>
        <CatalogPicker catalogs={p.catalogs} error={p.catalogError} onRetry={p.onRetryCatalogs} onSelect={p.onPickCatalog} />
      </section>
      <footer className="foot">
        Vistas previas de 30 s proporcionadas por <a href="https://www.deezer.com" target="_blank" rel="noreferrer">Deezer</a>.
        Catálogo de demostración original (CC0). Más info en GUIA-CANCIONES.md.
      </footer>
    </div>
  );
}
