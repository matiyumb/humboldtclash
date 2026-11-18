import { useEffect, useMemo, useState } from 'react';
import type { CatalogSummary } from '../../../shared/types';
import { CatalogCard } from './CatalogCard';

export interface Catalogs {
  featured: CatalogSummary[];
  local: CatalogSummary[];
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

/** Buscador de artistas (Deezer + catálogo local) con tarjetas seleccionables. */
export function CatalogPicker(p: Props) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<CatalogSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setRemote(null); setRemoteError(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/deezer/artistas?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error ?? 'Error buscando en Deezer.');
        setRemote(data);
        setRemoteError(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') { setRemote([]); setRemoteError((e as Error).message || 'No se pudo buscar en Deezer.'); }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query]);

  const q = norm(query.trim());
  const filter = (list: CatalogSummary[]) => (q ? list.filter((c) => norm(c.name).includes(q) || c.artists.some((a) => norm(a).includes(q))) : list);
  const featured = useMemo(() => filter(p.catalogs?.featured ?? []), [p.catalogs, q]);
  const local = useMemo(() => filter(p.catalogs?.local ?? []), [p.catalogs, q]);
  const remoteOnly = (remote ?? []).filter((r) => !featured.some((f) => f.id === r.id));

  const grid = (list: CatalogSummary[]) => (
    <div className="grid" role={p.radio ? 'radiogroup' : undefined}>
      {list.map((c) => (
        <CatalogCard key={c.id} c={c} role={p.radio ? 'radio' : undefined} selected={c.id === p.selectedId} onClick={() => p.onSelect(c)} />
      ))}
    </div>
  );

  return (
    <div className="picker">
      <label className="search">
        <span className="sr-only">Buscar artista</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        <input type="search" className="input" placeholder="Busca cualquier artista: Quevedo, Bad Bunny…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus={p.autoFocus} />
      </label>

      {p.error && (
        <div className="banner banner--error" role="alert">
          {p.error} {p.onRetry && <button className="btn btn--ghost btn--sm" onClick={p.onRetry}>Reintentar</button>}
        </div>
      )}
      {!p.catalogs && !p.error && <p className="muted">Cargando catálogo…</p>}

      {q.length >= 2 && (
        <section className="picker__section" aria-live="polite">
          <h3 className="picker__title"><span className="dz-badge">Deezer</span> Resultados</h3>
          {searching && !remote && <p className="muted">Buscando en Deezer…</p>}
          {remoteError && <p className="muted">{remoteError}</p>}
          {remote && remoteOnly.length === 0 && featured.length === 0 && !remoteError && <p className="muted">No encontramos «{query}» en Deezer.</p>}
          {remoteOnly.length > 0 && grid(remoteOnly)}
        </section>
      )}

      {featured.length > 0 && (
        <section className="picker__section">
          <h3 className="picker__title"><span className="dz-badge">Deezer</span> Destacados</h3>
          {grid(featured)}
        </section>
      )}
      {p.catalogs && !p.catalogs.deezerOnline && !q && (
        <p className="hint">Deezer no responde ahora mismo: puedes buscar artistas igualmente o jugar con el catálogo de demostración.</p>
      )}

      {local.length > 0 && (
        <section className="picker__section">
          <h3 className="picker__title">Catálogo de demostración</h3>
          {grid(local)}
        </section>
      )}
      {p.catalogs && q && !featured.length && !local.length && !remoteOnly.length && !searching && remote && <p className="muted">Prueba con otro nombre.</p>}
    </div>
  );
}
