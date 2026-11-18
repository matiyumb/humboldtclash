import { useEffect, useState } from 'react';
import type { CatalogCheck, CatalogSummary } from '../../../shared/types';
import { Banner, Icon } from '../ui';
import { CatalogPicker, type Catalogs } from './CatalogPicker';

interface Props {
  catalogs: Catalogs | null;
  initial: CatalogSummary | null;
  nickname: string;
  setNickname: (n: string) => void;
  busy: boolean;
  onBack: () => void;
  onSolo: (catalogId: string) => void;
  onCreateRoom: (catalogId: string) => void;
}

export function useCatalogCheck(id: string | null) {
  const [check, setCheck] = useState<CatalogCheck | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!id) { setCheck(null); return; }
    let cancelled = false;
    setChecking(true);
    setCheck(null);
    fetch(`/api/catalogs/${encodeURIComponent(id)}/check`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((c: CatalogCheck) => { if (!cancelled) setCheck(c); })
      .catch(() => { if (!cancelled) setCheck({ ok: false, catalogId: id, playableCount: 0, required: 10, message: 'No se pudo verificar el catálogo. Revisa tu conexión.' }); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [id]);
  return { check: check && check.catalogId === id ? check : null, checking };
}

export function Setup(p: Props) {
  const [selected, setSelected] = useState<CatalogSummary | null>(p.initial);
  const { check, checking } = useCatalogCheck(selected?.id ?? null);
  const ready = !!selected && !!check?.ok && !checking;

  return (
    <section className="setup">
      <button className="btn btn--ghost btn--sm back" onClick={p.onBack}>{Icon.back} Inicio</button>
      <h1 className="h1">Configura la partida</h1>
      <p className="muted">10 rondas · 10 segundos por ronda · 4 opciones</p>

      <label className="field setup__nick">
        <span className="field__label">Tu apodo</span>
        <input id="nickname" className="input" value={p.nickname} maxLength={16} placeholder="Ej.: La Ballena" onChange={(e) => p.setNickname(e.target.value)} />
      </label>

      <h2 className="h3">Elige artista o colección</h2>
      {selected && (
        <p className="selected-line">Seleccionado: <b>{selected.name}</b>{selected.source === 'deezer' ? ' · Deezer' : ''}</p>
      )}
      <CatalogPicker catalogs={p.catalogs} selectedId={selected?.id} onSelect={setSelected} radio />

      <div className="setup__bar">
        <div className="setup__status" aria-live="polite">
          {!selected && <span className="muted">Selecciona un catálogo para continuar.</span>}
          {selected && checking && <span className="muted">Comprobando canciones de «{selected.name}»…</span>}
          {selected && !checking && check && (
            <Banner kind={check.ok ? 'info' : 'error'}>
              <span className="banner__icon">{check.ok ? Icon.check : Icon.cross}</span>
              <span><b>{check.name ?? selected.name}:</b> {check.message}</span>
            </Banner>
          )}
        </div>
        <div className="setup__actions">
          <button className="btn btn--primary btn--lg" disabled={!ready || p.busy} onClick={() => selected && p.onSolo(selected.id)}>
            {Icon.speaker} Empezar partida
          </button>
          <button className="btn btn--outline" disabled={!ready || p.busy} onClick={() => selected && p.onCreateRoom(selected.id)}>
            Crear sala con este catálogo
          </button>
        </div>
      </div>
    </section>
  );
}
