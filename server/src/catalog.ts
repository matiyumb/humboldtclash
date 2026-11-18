import { existsSync, openSync, readSync, closeSync, statSync, readFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { MIN_TRACKS, type CatalogCheck, type CatalogSummary } from '../../shared/types.js';

export interface Track {
  id: string;
  title: string;
  artist: string;
  collection: string;
  /** Archivo dentro de audio/ … */
  file?: string;
  /** … o una vista previa remota oficial (https), que el servidor sirve como proxy. */
  previewUrl?: string;
  /** Enlace a la tienda/plataforma (se muestra al revelar, como atribución). */
  storeUrl?: string;
  origin: string;
  license: string;
  licenseUrl?: string;
  /** Pistas de Deezer: id para renovar la URL de vista previa cuando caduca. */
  deezerId?: number;
}

const titleKey = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s*[([].*?(feat|ft\.|with|con ).*?[)\]]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();

/** Se queda con una pista por título (sin repetir canciones ni versiones "feat."). */
export function distinctByTitle(tracks: Track[], keep: (t: Track) => boolean = () => true): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    const k = titleKey(t.title);
    if (!k || !keep(t) || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function remoteAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    // Solo para pruebas automáticas con un servidor falso local.
    return process.env.HUMBOLDTCLASH_TEST === '1' && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
  } catch {
    return false;
  }
}

export const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

/** Comprueba que el archivo existe y empieza como un audio real (no un HTML de error, no vacío). */
export function isPlayableFile(path: string): boolean {
  const type = AUDIO_TYPES[extname(path).toLowerCase()];
  if (!type || !existsSync(path)) return false;
  if (statSync(path).size < 2048) return false;
  const head = Buffer.alloc(12);
  const fd = openSync(path, 'r');
  try { readSync(fd, head, 0, 12, 0); } finally { closeSync(fd); }
  const ascii = head.toString('latin1');
  if (ascii.startsWith('ID3')) return true; // MP3 con etiqueta
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true; // trama MPEG / ADTS
  if (ascii.startsWith('OggS')) return true;
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return true;
  if (ascii.slice(4, 8) === 'ftyp') return true; // MP4/M4A
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true; // WebM
  return false;
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export class Catalog {
  readonly tracks: Track[];
  private playable = new Map<string, boolean>();

  constructor(readonly root: string, tracks?: Track[]) {
    if (tracks) {
      this.tracks = tracks;
    } else {
      const raw = JSON.parse(readFileSync(join(root, 'catalog/catalog.json'), 'utf8'));
      this.tracks = raw.tracks as Track[];
    }
    this.validateShape();
    this.refresh();
  }

  private validateShape() {
    const ids = new Set<string>();
    for (const t of this.tracks) {
      for (const k of ['id', 'title', 'artist', 'collection', 'origin', 'license'] as const) {
        if (!t[k] || typeof t[k] !== 'string') throw new Error(`Pista inválida en el catálogo (${t.id ?? '?'}): falta «${k}»`);
      }
      if (!t.file && !t.previewUrl) throw new Error(`Pista inválida en el catálogo (${t.id}): necesita «file» o «previewUrl»`);
      if (ids.has(t.id)) throw new Error(`Id repetido en el catálogo: ${t.id}`);
      ids.add(t.id);
    }
  }

  audioPath(t: Track): string {
    if (!t.file) throw new Error(`La pista ${t.id} no tiene archivo local`);
    const base = resolve(this.root, 'audio');
    const p = resolve(base, t.file);
    if (!p.startsWith(base)) throw new Error('Ruta de audio fuera de la carpeta audio/');
    return p;
  }

  /** Vuelve a comprobar los archivos en disco. */
  refresh() {
    this.playable.clear();
    for (const t of this.tracks) {
      // Las remotas se validan al importarlas; si fallan en partida, se sustituyen.
      this.playable.set(t.id, t.file ? isPlayableFile(this.audioPath(t)) : remoteAllowed(t.previewUrl!));
    }
  }

  isPlayable(t: Track) {
    return this.playable.get(t.id) === true;
  }

  byId(id: string) {
    return this.tracks.find((t) => t.id === id);
  }

  private groups(): { id: string; kind: CatalogSummary['kind']; name: string; tracks: Track[] }[] {
    const out: { id: string; kind: CatalogSummary['kind']; name: string; tracks: Track[] }[] = [];
    const artists = [...new Set(this.tracks.map((t) => t.artist))];
    for (const a of artists) out.push({ id: `artista:${slug(a)}`, kind: 'artist', name: a, tracks: this.tracks.filter((t) => t.artist === a) });
    const cols = [...new Set(this.tracks.map((t) => t.collection))];
    for (const c of cols) out.push({ id: `coleccion:${slug(c)}`, kind: 'collection', name: c, tracks: this.tracks.filter((t) => t.collection === c) });
    out.push({ id: 'todo', kind: 'all', name: 'Todo el catálogo', tracks: [...this.tracks] });
    return out;
  }

  /** Pistas reproducibles con títulos distintos (se queda con la primera de cada título). */
  playableTracks(catalogId: string): Track[] | null {
    const g = this.groups().find((x) => x.id === catalogId);
    if (!g) return null;
    return distinctByTitle(g.tracks, (t) => this.isPlayable(t));
  }

  list(): CatalogSummary[] {
    return this.groups().map((g) => {
      const count = this.playableTracks(g.id)!.length;
      const artists = [...new Set(g.tracks.map((t) => t.artist))];
      const subtitle =
        g.kind === 'artist' ? 'Artista' : g.kind === 'collection' ? `Colección · ${artists.length} artistas` : `${artists.length} artistas`;
      return { id: g.id, kind: g.kind, source: 'local' as const, name: g.name, subtitle, trackCount: count, playable: count >= MIN_TRACKS, artists, picture: null };
    });
  }

  name(catalogId: string) {
    return this.groups().find((g) => g.id === catalogId)?.name ?? catalogId;
  }

  check(catalogId: string): CatalogCheck {
    this.refresh();
    const tracks = this.playableTracks(catalogId);
    if (!tracks) return { ok: false, catalogId, playableCount: 0, required: MIN_TRACKS, message: 'Ese catálogo no existe.' };
    const ok = tracks.length >= MIN_TRACKS;
    return {
      ok,
      catalogId,
      playableCount: tracks.length,
      required: MIN_TRACKS,
      message: ok
        ? `${tracks.length} canciones distintas listas para sonar.`
        : `Solo hay ${tracks.length} canciones distintas con audio reproducible; hacen falta ${MIN_TRACKS}.`,
    };
  }
}
