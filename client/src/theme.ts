// Tema claro/oscuro. «auto» sigue al sistema. Se recuerda en el navegador.
export type Theme = 'auto' | 'light' | 'dark';
const KEY = 'hc.theme';
const listeners = new Set<(t: Theme) => void>();

export function getTheme(): Theme {
  try { const t = localStorage.getItem(KEY); if (t === 'light' || t === 'dark') return t; } catch { /* sin almacenamiento */ }
  return 'auto';
}
export function effectiveTheme(t = getTheme()): 'light' | 'dark' {
  if (t !== 'auto') return t;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme(t = getTheme()) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', effectiveTheme(t) === 'dark' ? '#0f1a0b' : '#ffffff');
}
export function setTheme(t: Theme) {
  try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* sin almacenamiento */ }
  applyTheme(t);
  listeners.forEach((l) => l(t));
}
export const onTheme = (fn: (t: Theme) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
