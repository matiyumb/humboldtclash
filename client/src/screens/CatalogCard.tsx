import type { CatalogSummary } from '../../../shared/types';
import { MIN_TRACKS } from '../../../shared/types';
import { Waveform } from '../ui';

const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7);

export function CatalogCard({ c, onClick, selected = false, role }: { c: CatalogSummary; onClick: () => void; selected?: boolean; role?: string }) {
  const kindLabel = c.kind === 'artist' ? 'Artista' : c.kind === 'collection' ? 'Colección' : c.kind === 'playlist' ? 'Playlist' : 'Mezcla';
  const meta =
    c.trackCount === null
      ? c.subtitle
      : c.playable
        ? `${c.trackCount} canciones`
        : `${c.trackCount}/${MIN_TRACKS} canciones · faltan pistas`;
  return (
    <button
      type="button"
      className={`card ${selected ? 'is-selected' : ''} ${c.playable ? '' : 'is-short'}`}
      onClick={onClick}
      role={role}
      aria-checked={role === 'radio' ? selected : undefined}
    >
      <span className={`card__art ${c.picture ? 'card__art--photo' : ''}`} aria-hidden="true">
        {c.picture ? <img src={c.picture} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Waveform bars={18} seed={hue(c.id)} />}
      </span>
      <span className="card__body">
        <span className="card__kind">{kindLabel}{c.source === 'deezer' ? ' · Deezer' : ''}</span>
        <span className="card__name">{c.name}</span>
        <span className="card__meta">{meta}</span>
      </span>
    </button>
  );
}
