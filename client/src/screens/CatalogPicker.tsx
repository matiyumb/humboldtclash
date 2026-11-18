import { useEffect, useMemo, useState } from 'react';
import type { CatalogSummary } from '../../../shared/types';
import { CatalogCard } from './CatalogCard';
import { mixToSummary, useMyMixes } from './Mixes';

export interface Catalogs {
  trending: CatalogSummary[]; // artistas más sonados esta semana (Deezer)
  playlists: CatalogSummary[]; // éxitos y playlists oficiales de Deezer
  featured: CatalogSummary[]; // extras fijos (catalog/destacados.json)
  local: CatalogSummary[]; // canciones propias
  deezerOnline: boolean;
}

interface Props {
  catalogs: Catalogs | null;
  error?: string | null;
  onRetry?: () => void;
  selectedId?: string | null;
  onSelect: (c: CatalogSummary) => void;
  radio?: boolean;
  autoFocus?: boolean;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Detecta un enlace (o id) de playlist de Deezer pegado en el buscador. */
export function deezerPlaylistId(q: string): number | null {
  const m = q.match(/deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?playlist\/(\d{3,15})/i) ?? q.match(/^playlist[:/](\d{3,15})$/i);
  return m ? Number(m[1]) : null;
}

/** Buscador de artistas (Deezer + catálogo propio) con tarjetas seleccionables. */
export function CatalogPicker(p: Props) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<CatalogSummary[] | null>(null);
  const [linked, setLinked] = useState<CatalogSummary | null>(null);
  const [searching, setSearching] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const plId = deezerPlaylistId(query.trim());

  useEffect(() => {
    const q = query.trim();
    setLinked(null);
    if (q.length < 2) { setRemote(null); setRemoteError(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const url = plId ? `/api/deezer/playlist/${plId}` : `/api/deezer/artistas?q=${encodeURIComponent(q)}`;
        const r = await fetch(url, { signal: ctrl.signal });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error ?? 'Error buscando en Deezer.');
        if (plId) { setLinked(data); setRemote([]); } else setRemote(data);
        setRemoteError(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') { setRemote([]); setRemoteError((e as Error).message || 'No se pudo buscar en Deezer.'); }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, plId]);

  const q = plId ? '' : norm(query.trim());
  const filter = (list: CatalogSummary[]) => (q ? list.filter((c) => norm(c.name).includes(q) || c.artists.some((a) => norm(a).includes(q))) : list);
  const myMixesRaw = useMyMixes();
  const mine = useMemo(() => filter((myMixesRaw ?? []).map(mixToSummary)), [myMixesRaw, q]);
  const trending = useMemo(() => filter(p.catalogs?.trending ?? []), [p.catalogs, q]);
  const playlists = useMemo(() => filter(p.catalogs?.playlists ?? []), [p.catalogs, q]);
  const featured = useMemo(() => filter(p.catalogs?.featured ?? []), [p.catalogs, q]);
  const local = useMemo(() => filter(p.catalogs?.local ?? []), [p.catalogs, q]);
  const shown = new Set([...trending, ...featured].map((c) => c.id));
  const remoteOnly = (remote ?? []).filter((r) => !shown.has(r.id));

  const grid = (list: CatalogSummary[]) => (
    <div className="grid" role={p.radio ? 'radiogroup' : undefined}>
      {list.map((c, i) => (
        <CatalogCard key={c.id} c={c} index={i} role={p.radio ? 'radio' : undefined} selected={c.id === p.selectedId} onClick={() => p.onSelect(c)} />
      ))}
    </div>
  );
  const section = (title: React.ReactNode, list: CatalogSummary[]) =>
    list.length > 0 && (
      <section className="picker__section">
        <h3 className="picker__title">{title}</h3>
        {grid(list)}
      </section>
    );

  return (
    <div className="picker">
      <label className="search">
        <span className="sr-only">Buscar artista o pegar enlace de playlist</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        <input type="search" className="input" placeholder="Busca un artista o pega un enlace de playlist de Deezer" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus={p.autoFocus} />
      </label>

      {p.error && (
        <div className="banner banner--error" role="alert">
          {p.error} {p.onRetry && <button className="btn btn--ghost btn--sm" onClick={p.onRetry}>Reintentar</button>}
        </div>
      )}
      {!p.catalogs && !p.error && <p className="muted">Cargando catálogo…</p>}

      {plId && (
        <section className="picker__section" aria-live="polite">
          <h3 className="picker__title"><span className="dz-badge">Deezer</span> Playlist del enlace</h3>
          {searching && !linked && <p className="muted">Abriendo la playlist…</p>}
          {remoteError && <p className="muted">{remoteError}</p>}
          {linked && grid([linked])}
        </section>
      )}

      {!plId && query.trim().length >= 2 && (
        <section className="picker__section" aria-live="polite">
          <h3 className="picker__title"><span className="dz-badge">Deezer</span> Resultados</h3>
          {searching && !remote && <p className="muted">Buscando en Deezer…</p>}
          {remoteError && <p className="muted">{remoteError}</p>}
          {remote && remoteOnly.length === 0 && !trending.length && !remoteError && <p className="muted">No encontramos «{query}» en Deezer.</p>}
          {remoteOnly.length > 0 && grid(remoteOnly)}
        </section>
      )}

      {section(<><span className="mix-badge">Tuyas</span> Mis playlists</>, mine)}
      {section(<><span className="dz-badge">Deezer</span> Lo más sonado esta semana</>, trending)}
      {section(<><span className="dz-badge">Deezer</span> Éxitos y playlists oficiales</>, playlists)}
      {section('Destacados', featured)}
      {p.catalogs && !p.catalogs.deezerOnline && !q && (
        <p className="hint">Deezer no responde ahora mismo: prueba a buscar un artista o vuelve en un rato.</p>
      )}
      {section('Canciones propias', local)}
    </div>
  );
}
