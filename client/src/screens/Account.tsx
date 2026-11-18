import { useEffect, useState } from 'react';
import type { Identity } from '../../../shared/types';
import { identity, onAccount, postJson, setSession, store } from '../net';
import { Banner } from '../ui';

export function useAccount() {
  const [u, setU] = useState<string | null>(store.username());
  useEffect(() => onAccount(setU), []);
  return u;
}

type Resp = { ok: true; username: string; identity: Identity } | { ok: false; error: string };

/** Crear cuenta o iniciar sesión. Tu progreso de este navegador pasa a la cuenta. */
export function AccountPanel({ compact = false, intro }: { compact?: boolean; intro?: React.ReactNode }) {
  const username = useAccount();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (username) {
    return (
      <div className={`account ${compact ? 'account--compact' : ''}`}>
        <span className="account__who"><span className="account__dot" aria-hidden="true" />Conectado como <b>{username}</b></span>
        <button className="btn btn--ghost btn--sm" onClick={() => { if (confirm('¿Cerrar sesión en este navegador?')) setSession(null); }}>Cerrar sesión</button>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<Resp>(mode === 'register' ? '/api/cuenta/registro' : '/api/cuenta/entrar', { username: user, password: pass, identity: identity() });
      if (r.ok) setSession(r.username, r.identity);
      else setError(r.error);
    } catch {
      setError('No se pudo conectar. Inténtalo otra vez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`account panel ${compact ? 'account--compact' : ''}`} onSubmit={submit}>
      {intro}
      <div className="tabs tabs--small" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-on' : ''} onClick={() => setMode('register')}>Crear cuenta</button>
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-on' : ''} onClick={() => setMode('login')}>Entrar</button>
      </div>
      <label className="field">
        <span className="field__label">Usuario</span>
        <input className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" maxLength={16} required minLength={3} />
      </label>
      <label className="field">
        <span className="field__label">Contraseña</span>
        <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={6} required />
      </label>
      {mode === 'register' && <p className="hint">Tus puntos, rango y playlists de este navegador pasan a tu cuenta. Entra desde cualquier dispositivo.</p>}
      {error && <Banner>{error}</Banner>}
      <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{mode === 'register' ? 'Crear cuenta' : 'Entrar'}</button>
    </form>
  );
}
