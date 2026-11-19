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
      <button type="button" className="account-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}>{username ? 'Mi cuenta' : 'Iniciar sesión'}</button>
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
  const [verification, setVerification] = useState<{ token: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    const password = data.get('password');
    const confirmation = data.get('confirmation');
    if (!verification && registering && password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      e.currentTarget.querySelector<HTMLInputElement>('[name="confirmation"]')?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (!verification && registering) {
        const email = String(data.get('email')).trim();
        const r = await postJson<{ ok: true; token: string } | { ok: false; error: string }>('/api/cuenta/registro', {
          username: data.get('username'), password, email, confirmation, identity: identity(),
        });
        if (r.ok) {
          setVerification({ token: r.token, email });
        } else setError(r.error);
        return;
      }

      const r = verification
        ? await postJson<Resp>('/api/cuenta/verificar', { token: verification.token, code: data.get('code'), identity: identity() })
        : await postJson<Resp>('/api/cuenta/entrar', { username: data.get('username'), password, identity: identity() });
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

  if (verification) {
    return (
      <form key="verification" className="account" onSubmit={submit}>
        <h3 className="h3">Verifica tu correo</h3>
        <p className="account__who">Enviamos un código de 6 cifras a <b>{verification.email}</b>. Caduca en 10 minutos.</p>
        <label className="field">
          <span className="field__label">Código de verificación</span>
          <input className="input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{6}" maxLength={6} autoFocus required />
        </label>
        {error && <Banner>{error}</Banner>}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>Verificar correo</button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setVerification(null); setError(null); }}>
          Volver al registro
        </button>
      </form>
    );
  }

  const passwordAutocomplete = registering ? 'new-password' : 'current-password';

  return (
    <form key="credentials" className="account" onSubmit={submit}>
      <div className="tabs tabs--small" role="group" aria-label="Acceso a la cuenta">
        <button type="button" aria-pressed={!registering} className={!registering ? 'is-on' : ''} disabled={busy}
          onClick={() => { setRegistering(false); setError(null); }}>Iniciar sesión</button>
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
      <PasswordField key={passwordAutocomplete} name="password" autoComplete={passwordAutocomplete} />
      {registering && <PasswordField name="confirmation" autoComplete="new-password" />}
      {error && <Banner>{error}</Banner>}
      <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{registering ? 'Registrarse' : 'Entrar'}</button>
    </form>
  );
}

function PasswordField({ name, autoComplete }: { name: 'password' | 'confirmation'; autoComplete: 'new-password' | 'current-password' }) {
  const [visible, setVisible] = useState(false);
  const confirmation = name === 'confirmation';
  const id = `account-${name}`;
  const action = visible ? 'Ocultar' : 'Ver';
  const target = confirmation ? 'confirmación de contraseña' : 'contraseña';

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{confirmation ? 'Repite la contraseña' : 'Contraseña'}</label>
      <div className="account-password">
        <input id={id} className="input" type={visible ? 'text' : 'password'} name={name}
          autoComplete={autoComplete} minLength={6} maxLength={100} required />
        <button type="button" className="account-password__toggle" aria-controls={id}
          aria-label={`${action} ${target}`} onClick={() => setVisible((previous) => !previous)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
            <circle cx="12" cy="12" r="2.5" />
            {!visible && <path d="M3 3l18 18" />}
          </svg>
        </button>
      </div>
    </div>
  );
}
