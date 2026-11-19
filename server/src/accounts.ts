// Cuentas registradas (usuario + contraseña). Al registrarte, tu identidad de este navegador
// queda protegida con contraseña: puedes entrar desde otro dispositivo y conservar puntos, rango y MMR.
// El competitivo exige cuenta para que nadie juegue con perfiles desechables.
import { createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Identity } from '../../shared/types.js';
import type { Account, Store } from './store.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const usernameKey = (u: string) => u.normalize('NFKC').trim().toLowerCase();
export function validUsername(u: unknown): u is string {
  return typeof u === 'string' && /^[A-Za-z0-9_.ñÑáéíóúÁÉÍÓÚ-]{3,16}$/.test(u.trim());
}
export const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 6 && p.length <= 100;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [, s, h] = stored.split('$');
  if (!s || !h) return false;
  const hash = await scrypt(pw, Buffer.from(s, 'base64'), 32);
  const expected = Buffer.from(h, 'base64');
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

/** Límite simple de intentos de inicio de sesión (por usuario e IP). */
const attempts = new Map<string, { n: number; until: number }>();
export function tooManyAttempts(key: string): boolean {
  const a = attempts.get(key);
  return !!a && a.n >= 8 && Date.now() < a.until;
}
export function noteFailure(key: string) {
  const a = attempts.get(key);
  const fresh = !a || Date.now() > a.until;
  attempts.set(key, { n: fresh ? 1 : a!.n + 1, until: Date.now() + 10 * 60_000 });
  if (attempts.size > 5000) attempts.clear();
}
export const clearFailures = (key: string) => attempts.delete(key);

export type AuthResult = { ok: true; username: string; identity: Identity } | { ok: false; error: string };

type RegistrationFields = { username: unknown; email: unknown; password: unknown; confirmation: unknown };
type PendingRegistration = { account: Account; digest: Buffer; expiresAt: number; failures: number };
type Mailer = (address: string, code: string) => Promise<void>;
const CODE_TTL = 10 * 60_000;
const MAX_PENDING = 2000;

export class Registration {
  private readonly pending = new Map<string, PendingRegistration>();
  private readonly limits = new Map<string, { count: number; until: number }>();
  private readonly key = randomBytes(32);

  constructor(private readonly store: Store, private readonly sendCode: Mailer | null) {}

  private digest(token: string, code: string) {
    return createHmac('sha256', this.key).update(token).update(code).digest();
  }

  async start(
    { username, email, password, confirmation }: RegistrationFields,
    identity: Identity,
    ip: string,
  ): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
    const address = typeof email === 'string' ? email.trim() : '';
    if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return { ok: false, error: 'Escribe un correo electrónico válido.' };
    }
    if (!validUsername(username)) return { ok: false, error: 'El usuario debe tener de 3 a 16 letras, números, «_», «-» o «.».' };
    if (!validPassword(password)) return { ok: false, error: 'La contraseña debe tener entre 6 y 100 caracteres.' };
    if (password !== confirmation) return { ok: false, error: 'Las contraseñas no coinciden.' };
    if (!this.sendCode) return { ok: false, error: 'El registro por correo no está disponible ahora.' };

    const now = Date.now();
    const limits = [['ip:' + ip, 12], ['email:' + address.toLowerCase(), 3]] as const;
    for (const [token, entry] of this.pending) if (entry.expiresAt <= now) this.pending.delete(token);
    for (const [key, entry] of this.limits) if (entry.until <= now) this.limits.delete(key);
    if (this.limits.size >= MAX_PENDING * 2 || limits.some(([key, max]) => (this.limits.get(key)?.count ?? 0) >= max)) {
      return { ok: false, error: 'Demasiadas solicitudes. Espera unos minutos antes de pedir otro código.' };
    }
    for (const [key] of limits) {
      const entry = this.limits.get(key);
      if (entry) entry.count++;
      else this.limits.set(key, { count: 1, until: now + CODE_TTL });
    }

    const nameKey = usernameKey(username);
    if (await this.store.accountOf(identity.playerId)) return { ok: false, error: 'Este navegador ya tiene una cuenta. Inicia sesión.' };
    if (await this.store.account(nameKey)) return { ok: false, error: 'Ese nombre de usuario ya está ocupado.' };
    const passHash = await hashPassword(password);
    if (this.pending.size >= MAX_PENDING) return { ok: false, error: 'El registro está ocupado. Inténtalo en unos minutos.' };

    const token = randomBytes(32).toString('base64url');
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    const account: Account = {
      email: address, username: username.trim(), usernameKey: nameKey, passHash,
      playerId: identity.playerId, secret: identity.secret, createdAt: now,
    };
    this.pending.set(token, { account, digest: this.digest(token, code), expiresAt: now + CODE_TTL, failures: 0 });
    try {
      await this.sendCode(address, code);
    } catch {
      this.pending.delete(token);
      return { ok: false, error: 'No pudimos enviar el código. Revisa el correo e inténtalo de nuevo.' };
    }
    return { ok: true, token };
  }

  async verify(token: unknown, code: unknown, identity: Identity): Promise<AuthResult> {
    const expired = { ok: false, error: 'Este código ya no está disponible. Vuelve al registro para pedir otro.' } as const;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return expired;
    const pending = this.pending.get(token);
    if (!pending) return expired;
    if (pending.expiresAt <= Date.now()) {
      this.pending.delete(token);
      return expired;
    }
    const { account } = pending;
    if (account.playerId !== identity.playerId || account.secret !== identity.secret) return expired;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !timingSafeEqual(pending.digest, this.digest(token, code))) {
      if (++pending.failures >= 5) {
        this.pending.delete(token);
        return expired;
      }
      return { ok: false, error: 'El código no coincide. Revisa el correo y vuelve a intentarlo.' };
    }

    this.pending.delete(token);
    if (!(await this.store.createAccount(account))) {
      if (await this.store.accountOf(identity.playerId)) return { ok: false, error: 'Este navegador ya tiene una cuenta. Inicia sesión.' };
      return { ok: false, error: 'Ese nombre de usuario ya está ocupado. Vuelve al registro y elige otro.' };
    }
    return { ok: true, username: account.username, identity };
  }
}

export async function login(store: Store, username: unknown, password: unknown, ip: string): Promise<AuthResult> {
  if (!validUsername(username) || typeof password !== 'string') return { ok: false, error: 'Usuario o contraseña incorrectos.' };
  const key = `${usernameKey(username)}|${ip}`;
  if (tooManyAttempts(key)) return { ok: false, error: 'Demasiados intentos. Espera unos minutos.' };
  const acc = await store.account(usernameKey(username));
  if (!acc || !(await verifyPassword(password, acc.passHash))) {
    noteFailure(key);
    return { ok: false, error: 'Usuario o contraseña incorrectos.' };
  }
  clearFailures(key);
  return { ok: true, username: acc.username, identity: { playerId: acc.playerId, secret: acc.secret } };
}
