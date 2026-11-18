// Revisa catalog/catalog.json y la carpeta audio/: campos obligatorios, archivos
// que faltan o no son audio, y qué artistas/colecciones se pueden jugar.
// Uso: npm run check-catalog
import { Catalog } from '../server/src/catalog.js';

try {
  const c = new Catalog(process.cwd());
  let bad = 0;
  for (const t of c.tracks) {
    if (!c.isPlayable(t)) { bad++; console.log(`✗ ${t.title} — ${t.artist}: no se encuentra o no es audio válido (audio/${t.file})`); }
  }
  console.log(`\n${c.tracks.length} pistas en el catálogo, ${c.tracks.length - bad} reproducibles.\n`);
  for (const s of c.list()) {
    console.log(`${s.playable ? '✓' : '·'} ${s.name.padEnd(24)} ${String(s.trackCount).padStart(3)} canciones ${s.playable ? '' : '(faltan para llegar a 10)'}`);
  }
  process.exit(bad ? 1 : 0);
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
}
