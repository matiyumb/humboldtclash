import { useEffect, useState } from 'react';

// Huecos reservados para publicidad. Están desactivados: no ocupan espacio ni cargan nada
// hasta que el servidor arranque con ADS=1 (ver README, sección «Publicidad»).
let configPromise: Promise<{ ads: boolean; adsClient: string | null }> | null = null;
function adsConfig() {
  configPromise ??= fetch('/api/config').then((r) => r.json()).catch(() => ({ ads: false, adsClient: null }));
  return configPromise;
}

export function AdSlot({ slot, format = 'rect' }: { slot: string; format?: 'rect' | 'banner' }) {
  const [on, setOn] = useState(false);
  useEffect(() => { void adsConfig().then((c) => setOn(!!c.ads)); }, []);
  if (!on) return null;
  return (
    <aside className={`ad-slot ad-slot--${format}`} data-ad-slot={slot} aria-label="Publicidad">
      <span className="ad-slot__label">Publicidad</span>
      {/* Aquí va el código del proveedor de anuncios (p. ej. un <ins> de AdSense con data-ad-slot={slot}). */}
    </aside>
  );
}
