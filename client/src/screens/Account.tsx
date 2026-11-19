import { useEffect, useRef, useState } from 'react';
import type { Identity } from '../../../shared/types';
import { identity, onAccount, postJson, setSession, store } from '../net';
import { Banner } from '../ui';

export function useAccount() {
  const [u, setU] = useState<string | null>(store.username());
  useEffect(() => onAccount(setU), []);
  return u;
}

type Resp = { ok: true; username: string; identity: Identity } | { ok: false; error: string };

export function AccountAccess() {
  const username = useAccount();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);

  const close = () => dialog.current?.close();

  return (
    <>
      <button type="button" className="account-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}>Mi cuenta</button>
      <dialog ref={dialog} className="account-dialog" aria-labelledby="account-title" onClose={() => setOpen(false)}
        onCancel={(e) => { if (busy) e.preventDefault(); }}>
        <header className="account-dialog__header">
          <h2 id="account-title" className="h2">Mi cuenta</h2>
          <button type="button" className="btn btn--ghost btn--sm" aria-label="Cerrar" disabled={busy} onClick={close}>×</button>
        </header>
        {open && (username ? (
          <div className="account">
            <p className="account__who">Conectado como <b>{username}</b></p>
            <button type="button" className="btn btn--outline" onClick={() => { setSession(null); close(); }}>Cerrar sesión</button>
          </div>
        ) : <AccountForm busy={busy} setBusy={setBusy} onSuccess={close} />)}
      </dialog>
    </>
  );
}

function AccountForm({ busy, setBusy, onSuccess }: { busy: boolean; setBusy: (value: boolean) => void; onSuccess: () => void }) {
  const [registering, setRegistering] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = data.get('password');
    const confirmation = data.get('confirmation');
    if (registering && password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      e.currentTarget.querySelector<HTMLInputElement>('[name="confirmation"]')?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const r = await postJson<Resp>(registering ? '/api/cuenta/registro' : '/api/cuenta/entrar', {
        username: data.get('username'),
        password,
        ...(registering ? { email: data.get('email'), confirmation } : {}),
        identity: identity(),
      });
      if (r.ok) {
        setSession(r.username, r.identity);
        onSuccess();
      } else setError(r.error);
    } catch {
      setError('No se pudo conectar. Inténtalo otra vez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="account" onSubmit={submit}>
      <div className="tabs tabs--small" role="group" aria-label="Acceso a la cuenta">
        <button type="button" aria-pressed={!registering} className={!registering ? 'is-on' : ''} disabled={busy}
          onClick={() => { setRegistering(false); setPasswordVisible(false); setError(null); }}>Iniciar sesión</button>
        <button type="button" aria-pressed={registering} className={registering ? 'is-on' : ''} disabled={busy}
          onClick={() => { setRegistering(true); setError(null); }}>Registrarse</button>
      </div>
      {registering && (
        <label className="field">
          <span className="field__label">Correo electrónico</span>
          <input className="input" type="email" name="email" autoComplete="email" maxLength={254} required />
        </label>
      )}
      <label className="field">
        <span className="field__label">Nombre de usuario</span>
        <input className="input" name="username" autoComplete="username" minLength={3} maxLength={16} required />
      </label>
      <div className="field">
        <label className="field__label" htmlFor="account-password">Contraseña</label>
        <div className={registering ? 'account-password account-password--with-toggle' : 'account-password'}>
          <input id="account-password" key={String(registering)} className="input" type={registering && passwordVisible ? 'text' : 'password'}
            name="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={6} maxLength={100} required />
          {registering && (
            <button type="button" className="account-password__toggle" aria-controls="account-password"
              aria-label={passwordVisible ? 'Ocultar contraseña' : 'Ver contraseña'}
              onClick={() => setPasswordVisible((visible) => !visible)}>
              {passwordVisible ? 'Ocultar' : 'Ver'}
            </button>
          )}
        </div>
      </div>
      {registering && (
        <label className="field">
          <span className="field__label">Repite la contraseña</span>
          <input className="input" type="password" name="confirmation" autoComplete="new-password" minLength={6} maxLength={100} required />
        </label>
      )}
      {error && <Banner>{error}</Banner>}
      <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{registering ? 'Crear cuenta' : 'Entrar'}</button>
    </form>
  );
}
