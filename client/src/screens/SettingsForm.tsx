import { DIFFICULTIES, MAX_ROUNDS, MIN_ROUNDS, type GameSettings } from '../../../shared/types';

interface Props {
  value: GameSettings;
  onChange?: (s: GameSettings) => void; // sin onChange = solo lectura (invitados en la sala)
  showShuffle?: boolean; // solo tiene sentido en playlists
}

/** Rondas (5–20), dificultad, modo 1 segundo y orden aleatorio. */
export function SettingsForm({ value, onChange, showShuffle = true }: Props) {
  const ro = !onChange;
  const set = (patch: Partial<GameSettings>) => onChange?.({ ...value, ...patch });
  return (
    <div className={`settings ${ro ? 'is-readonly' : ''}`}>
      <label className="settings__row">
        <span className="settings__label">Canciones por partida <b className="settings__value">{value.rounds}</b></span>
        <input
          type="range"
          className="range"
          min={MIN_ROUNDS}
          max={MAX_ROUNDS}
          step={1}
          value={value.rounds}
          disabled={ro}
          onChange={(e) => set({ rounds: Number(e.target.value) })}
          style={{ ['--p' as string]: `${((value.rounds - MIN_ROUNDS) / (MAX_ROUNDS - MIN_ROUNDS)) * 100}%` }}
        />
        <span className="settings__scale" aria-hidden="true"><span>{MIN_ROUNDS}</span><span>{MAX_ROUNDS}</span></span>
      </label>

      <fieldset className="settings__row">
        <legend className="settings__label">Dificultad</legend>
        <div className="segmented" role="radiogroup" aria-label="Dificultad">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={value.difficulty === d.id}
              className={`segmented__opt ${value.difficulty === d.id ? 'is-on' : ''}`}
              disabled={ro}
              onClick={() => set({ difficulty: d.id })}
            >
              <b>{d.name}</b>
              <small>{d.hint}</small>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="settings__toggles">
        <label className="switch">
          <input type="checkbox" checked={value.clip === 'one'} disabled={ro} onChange={(e) => set({ clip: e.target.checked ? 'one' : 'normal' })} />
          <span className="switch__track" aria-hidden="true" />
          <span><b>Modo 1 segundo</b><small>La canción suena solo un instante</small></span>
        </label>
        {showShuffle && (
          <label className="switch">
            <input type="checkbox" checked={value.shuffle} disabled={ro} onChange={(e) => set({ shuffle: e.target.checked })} />
            <span className="switch__track" aria-hidden="true" />
            <span><b>Orden aleatorio</b><small>Baraja las canciones de la playlist</small></span>
          </label>
        )}
      </div>
    </div>
  );
}
