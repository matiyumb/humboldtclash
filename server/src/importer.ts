/** Importar una lista pegada: «Artista - Canción» por línea, o el CSV de Exportify. */
export function parseSongLines(text: string): { artist: string; title: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const splitCsv = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
  const header = splitCsv(lines[0]).map((h) => h.toLowerCase());
  const ti = header.findIndex((h) => h === 'track name' || h === 'título' || h === 'title' || h === 'nombre de la canción');
  const ai = header.findIndex((h) => h.startsWith('artist name') || h === 'artista' || h === 'artist' || h === 'artistas');
  if (ti >= 0 && ai >= 0) {
    return lines.slice(1).map(splitCsv).map((c) => ({ artist: (c[ai] ?? '').split(/[,;]/)[0], title: c[ti] ?? '' })).filter((x) => x.title);
  }
  return lines.map((l) => {
    const m = l.replace(/^\d+[.)]\s*/, '').split(/\s+[-–—]\s+/);
    return m.length >= 2 ? { artist: m[0], title: m.slice(1).join(' - ') } : { artist: '', title: m[0] };
  });
}
