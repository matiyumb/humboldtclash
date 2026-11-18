import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, sanitizeSettings, type CatalogCheck, type CatalogSummary, type GameSettings } from '../../../shared/types';
import { Banner, Icon } from '../ui';
import { CatalogPicker, type Catalogs } from './CatalogPicker';
import { SettingsForm } from './SettingsForm';

interface Props {
  catalogs: Catalogs | null;
  initial: CatalogSummary | null;
  nickname: string;
  setNickname: (n: string) => void;
  busy: boolean;
  onBack: () => void;
  onSolo: (catalogId: string, settings: GameSettings) => void;
  onCreateRoom: (catalogId: string, settings: GameSettings) => void;
}

/** Últimos ajustes usados (se recuerdan en el navegador). */
export function useSavedSettings(): [GameSettings, (s: GameSettings) => void] {
  const [s, setS] = useState<GameSettings>(() => {
    try { return sanitizeSettings(JSON.parse(localStorage.getItem('hc.settings') ?? 'null') ?? DEFAULT_SETTINGS); } catch { return DEFAULT_SETTINGS; }
  });
  const save = (v: GameSettings) => { setS(v); try { localStorage.setItem('hc.settings', JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
  return [s, save];
}

export function useCatalogCheck(id: string | null, settings: GameSettings) {
  const [check, setCheck] = useState<CatalogCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const key = `${id}|${settings.rounds}|${settings.difficulty}`;
  useEffect(() => {
    if (!id) { setCheck(null); return; }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(() => {
      fetch(`/api/catalogs/${encodeURIComponent(id)}/check?rondas=${settings.rounds}&dificultad=${settings.difficulty}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((c: CatalogCheck) => { if (!cancelled) setCheck(c); })
        .catch(() => { if (!cancelled) setCheck({ ok: false, catalogId: id, playableCount: 0, required: settings.rounds, message: 'No se pudo verificar el catálogo. Revisa tu conexión.' }); })
        .finally(() => { if (!cancelled) setChecking(false); });
    }, 180); // espera a que dejes de mover el deslizador
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { check: check && check.catalogId === id ? check : null, checking };
}

export function Setup(p: Props) {
  const [selected, setSelected] = useState<CatalogSummary | null>(p.initial);
  const [settings, setSettings] = useSavedSettings();
  const { check, checking } = useCatalogCheck(selected?.id ?? null, settings);
  const ready = !!selected && !!check?.ok && !checking;
  const isList = !!selected && (selected.kind === 'mix' || selected.kind === 'playlist');

  return (
    <section className="setup">
      <button className="btn btn--ghost btn--sm back" onClick={p.onBack}>{Icon.back} Inicio</button>
      <h1 className="h1">Configura la partida</h1>

      <label className="field setup__nick">
        <span className="field__label">Tu apodo</span>
        <input id="nickname" className="input" value={p.nickname} maxLength={16} placeholder="Ej.: La Ballena" onChange={(e) => p.setNickname(e.target.value)} />
      </label>

      <div className="panel">
        <h2 className="h3">Ajustes</h2>
        <SettingsForm value={settings} onChange={setSettings} showShuffle={isList} />
      </div>

      <h2 className="h3">Elige artista, playlist o mezcla</h2>
      {selected && (
        <p className="selected-line">Seleccionado: <b>{selected.name}</b>{selected.source === 'deezer' ? ' · Deezer' : selected.source === 'mix' ? ' · tu playlist' : ''}</p>
      )}
      <CatalogPicker catalogs={p.catalogs} selectedId={selected?.id} onSelect={setSelected} radio />

      <div className="setup__bar">
        <div className="setup__status" aria-live="polite">
          {!selected && <span className="muted">Selecciona un catálogo para continuar.</span>}
          {selected && (checking || !check) && <span className="muted">Comprobando canciones de «{selected.name}»…</span>}
          {selected && !checking && check && (
            <Banner kind={check.ok ? 'info' : 'error'}>
              <span className="banner__icon">{check.ok ? Icon.check : Icon.cross}</span>
              <span><b>{check.name ?? selected.name}:</b> {check.message}</span>
            </Banner>
          )}
        </div>
        <div className="setup__actions">
          <button className="btn btn--primary btn--lg" disabled={!ready || p.busy} onClick={() => selected && p.onSolo(selected.id, settings)}>
            {Icon.speaker} Empezar partida
          </button>
          <button className="btn btn--outline" disabled={!ready || p.busy} onClick={() => selected && p.onCreateRoom(selected.id, settings)}>
            Crear sala con este catálogo
          </button>
        </div>
      </div>
    </section>
  );
}
