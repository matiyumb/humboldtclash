import { useCallback, useEffect, useState } from 'react';
import type { CatalogSummary, Mix, MixSummary, MixTrack } from '../../../shared/types';
import { identity } from '../net';
import { Banner, Cover, Icon } from '../ui';

const MIN_SONGS = 5;
const MAX_SONGS = 200;

export function mixToSummary(m: MixSummary): CatalogSummary {
  return {
    id: `mix:${m.id}`, kind: 'mix', source: 'mix', name: m.name,
    subtitle: `Tu playlist · ${m.count} canciones`, trackCount: m.count, playable: m.count >= MIN_SONGS,
    artists: m.artists, picture: m.covers[0] ?? null,
  };
}

export function useMyMixes(refresh = 0) {
  const [mixes, setMixes] = useState<MixSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/mixes/mias', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: identity() }) })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive) setMixes(d); })
      .catch(() => { if (alive) setMixes([]); });
    return () => { alive = false; };
  }, [refresh]);
  return mixes;
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

interface Draft { id?: string; name: string; tracks: MixTrack[] }

export function Mixes({ nickname, onBack, onPlay }: { nickname: string; onBack: () => void; onPlay: (c: CatalogSummary) => void }) {
  const [refresh, setRefresh] = useState(0);
  const mixes = useMyMixes(refresh);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const edit = async (m: MixSummary) => {
    const r = await fetch(`/api/mixes/${m.id}`);
    if (!r.ok) return setError('No se pudo abrir la playlist.');
    const full = (await r.json()) as Mix;
    setDraft({ id: full.id, name: full.name, tracks: full.tracks });
  };

  const remove = async (m: MixSummary) => {
    if (!confirm(`¿Borrar «${m.name}»?`)) return;
    await fetch(`/api/mixes/${m.id}/borrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: identity() }) });
    setRefresh((x) => x + 1);
  };

  if (draft) {
    return <MixEditor draft={draft} nickname={nickname} onCancel={() => setDraft(null)} onSaved={(m, play) => { setDraft(null); setRefresh((x) => x + 1); if (play) onPlay(mixToSummary(m)); }} />;
  }

  return (
    <section className="mixes">
      <button className="btn btn--ghost btn--sm back" onClick={onBack}>{Icon.back} Inicio</button>
      <div className="row mixes__head">
        <div>
          <h1 className="h1">Mis playlists</h1>
          <p className="muted">Mezcla canciones de varios artistas y juega con ellas, solo o en sala.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setDraft({ name: '', tracks: [] })}>+ Nueva playlist</button>
      </div>
      {error && <Banner>{error}</Banner>}
      {!mixes && <p className="muted">Cargando…</p>}
      {mixes && mixes.length === 0 && (
        <div className="empty panel">
          <p><b>Aún no tienes playlists.</b></p>
          <p className="muted">Crea una con tus canciones favoritas o rellénala al azar con tus artistas.</p>
        </div>
      )}
      <div className="mix-grid">
        {mixes?.map((m, i) => (
          <article key={m.id} className="mix-card" style={{ ['--i' as string]: i }}>
            <div className="mix-card__art" aria-hidden="true">
              {[0, 1, 2, 3].map((k) => <Cover key={k} src={m.covers[k] ?? null} title={`${m.name}${k}`} size={60} />)}
            </div>
            <div className="mix-card__body">
              <h3>{m.name}</h3>
              <p className="muted">{m.count} canciones · {m.artists.slice(0, 3).join(', ')}{m.artists.length > 3 ? '…' : ''}</p>
              <div className="row">
                <button className="btn btn--primary btn--sm" onClick={() => onPlay(mixToSummary(m))} disabled={m.count < MIN_SONGS}>Jugar</button>
                <button className="btn btn--outline btn--sm" onClick={() => edit(m)}>Editar</button>
                <button className="btn btn--ghost btn--sm" onClick={() => remove(m)}>Borrar</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MixEditor({ draft, nickname, onCancel, onSaved }: { draft: Draft; nickname: string; onCancel: () => void; onSaved: (m: MixSummary, play: boolean) => void }) {
  const [name, setName] = useState(draft.name);
  const [tracks, setTracks] = useState<MixTrack[]>(draft.tracks);
  const [q, setQ] = useState('');
  const [songs, setSongs] = useState<MixTrack[] | null>(null);
  const [artists, setArtists] = useState<CatalogSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const has = useCallback((id: number) => tracks.some((t) => t.deezerId === id), [tracks]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setSongs(null); setArtists(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const [s, a] = await Promise.all([
          fetch(`/api/deezer/canciones?q=${encodeURIComponent(term)}`, { signal: ctrl.signal }).then((r) => r.json()),
          fetch(`/api/deezer/artistas?q=${encodeURIComponent(term)}`, { signal: ctrl.signal }).then((r) => r.json()),
        ]);
        setSongs(Array.isArray(s) ? s : []);
        setArtists(Array.isArray(a) ? a.slice(0, 4) : []);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('No se pudo buscar en Deezer.');
      }
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const runImport = async () => {
    setBusy('import');
    setImportMsg(null);
    try {
      const r = await fetch('/api/deezer/emparejar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: importText }) });
      const d = (await r.json()) as { found: MixTrack[]; missing: string[] };
      const fresh = d.found.filter((t) => !tracks.some((x) => x.deezerId === t.deezerId));
      setTracks((x) => [...x, ...fresh].slice(0, MAX_SONGS));
      setImportMsg(`${fresh.length} añadidas${d.missing.length ? ` · no encontradas: ${d.missing.slice(0, 3).join(', ')}${d.missing.length > 3 ? '…' : ''}` : ''}`);
      if (fresh.length) setImportText('');
    } catch {
      setImportMsg('No se pudo importar. Inténtalo otra vez.');
    } finally {
      setBusy(null);
    }
  };

  const add = (t: MixTrack) => { if (!has(t.deezerId) && tracks.length < MAX_SONGS) setTracks((x) => [...x, t]); };

  /** Añade N canciones al azar de un artista (las que aún no estén). */
  const addRandom = async (a: CatalogSummary, n = 5) => {
    const id = a.id.split(':').pop();
    setBusy(a.id);
    try {
      const all = (await fetch(`/api/deezer/artista/${id}/canciones`).then((r) => r.json())) as MixTrack[];
      const fresh = shuffle(all.filter((t) => !has(t.deezerId))).slice(0, n);
      setTracks((x) => [...x, ...fresh].slice(0, MAX_SONGS));
      if (!fresh.length) setError(`Ya tienes todas las canciones de ${a.name}.`);
    } catch {
      setError('No se pudieron traer canciones de ese artista.');
    } finally {
      setBusy(null);
    }
  };

  const save = async (play: boolean) => {
    setError(null);
    setBusy('save');
    try {
      const r = await fetch('/api/mixes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identity: identity(), nickname, id: draft.id, name: name.trim() || 'Mi mezcla', tracks }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'No se pudo guardar.');
      onSaved(data, play);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const artistCount = new Set(tracks.map((t) => t.artist)).size;

  return (
    <section className="mix-editor">
      <button className="btn btn--ghost btn--sm back" onClick={onCancel}>{Icon.back} Mis playlists</button>
      <h1 className="h1">{draft.id ? 'Editar playlist' : 'Nueva playlist'}</h1>
      <label className="field">
        <span className="field__label">Nombre</span>
        <input className="input" value={name} maxLength={40} placeholder="Ej.: Perreo del recreo" onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="mix-editor__cols">
        <div className="panel">
          <h2 className="h3">Añadir canciones</h2>
          <label className="search">
            <span className="sr-only">Buscar canción o artista</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
            <input type="search" className="input" placeholder="Canción o artista…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </label>
          {artists && artists.length > 0 && (
            <div className="artist-chips" aria-label="Rellenar al azar">
              {artists.map((a) => (
                <button key={a.id} className="artist-chip" onClick={() => addRandom(a)} disabled={busy === a.id}>
                  {a.picture ? <img src={a.picture} alt="" /> : <span className="artist-chip__dot" />}
                  <span>🎲 5 al azar de <b>{a.name}</b></span>
                </button>
              ))}
            </div>
          )}
          {songs && songs.length === 0 && <p className="muted">Sin resultados.</p>}
          <details className="import">
            <summary>📋 Importar una lista (texto o CSV)</summary>
            <p className="hint">Una canción por línea como <b>Artista - Canción</b>, o pega el CSV que exporta <a href="https://exportify.net" target="_blank" rel="noreferrer">Exportify</a> desde tu playlist de Spotify. La buscamos en Deezer.</p>
            <textarea className="input import__text" rows={5} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'Quevedo - Columbia\nBad Bunny - Tití Me Preguntó'} />
            <div className="row">
              <button type="button" className="btn btn--outline btn--sm" disabled={!importText.trim() || busy === 'import'} onClick={runImport}>{busy === 'import' ? 'Buscando…' : 'Importar'}</button>
              {importMsg && <span className="muted">{importMsg}</span>}
            </div>
          </details>
          <ul className="song-list">
            {songs?.map((t) => (
              <li key={t.deezerId}>
                <Cover src={t.cover} title={t.title} size={44} />
                <span className="song-list__txt"><b>{t.title}</b><small>{t.artist}</small></span>
                <button className="icon-btn" onClick={() => add(t)} disabled={has(t.deezerId)} aria-label={`Añadir ${t.title}`}>{has(t.deezerId) ? Icon.check : '+'}</button>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <div className="row mix-editor__listhead">
            <h2 className="h3">En la playlist <span className="muted">({tracks.length} · {artistCount} {artistCount === 1 ? 'artista' : 'artistas'})</span></h2>
            <button className="btn btn--ghost btn--sm" onClick={() => setTracks((x) => shuffle(x))} disabled={tracks.length < 2}>🎲 Barajar</button>
          </div>
          {tracks.length === 0 && <p className="muted">Busca canciones o usa «🎲 5 al azar» con tus artistas favoritos.</p>}
          <ol className="song-list song-list--mine">
            {tracks.map((t, i) => (
              <li key={t.deezerId} style={{ ['--i' as string]: Math.min(i, 12) }}>
                <span className="song-list__n">{i + 1}</span>
                <Cover src={t.cover} title={t.title} size={40} />
                <span className="song-list__txt"><b>{t.title}</b><small>{t.artist}</small></span>
                <button className="icon-btn icon-btn--danger" onClick={() => setTracks((x) => x.filter((y) => y.deezerId !== t.deezerId))} aria-label={`Quitar ${t.title}`}>{Icon.cross}</button>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {error && <Banner>{error}</Banner>}
      <div className="setup__bar">
        <div className="setup__actions">
          <button className="btn btn--primary btn--lg" disabled={tracks.length < MIN_SONGS || busy === 'save'} onClick={() => save(true)}>Guardar y jugar</button>
          <button className="btn btn--outline" disabled={tracks.length < MIN_SONGS || busy === 'save'} onClick={() => save(false)}>Guardar</button>
          {tracks.length < MIN_SONGS && <span className="muted">Añade al menos {MIN_SONGS} canciones.</span>}
        </div>
      </div>
    </section>
  );
}
