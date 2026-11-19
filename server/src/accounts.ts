// Cuentas registradas (usuario + contraseña). Al registrarte, tu identidad de este navegador
// queda protegida con contraseña: puedes entrar desde otro dispositivo y conservar puntos, rango y MMR.
// El competitivo exige cuenta para que nadie juegue con perfiles desechables.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
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

export async function register(
  store: Store,
  { username, email, password, confirmation }: { username: unknown; email: unknown; password: unknown; confirmation: unknown },
  identity: Identity,
): Promise<AuthResult> {
  const address = typeof email === 'string' ? email.trim() : '';
  if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { ok: false, error: 'Escribe un correo electrónico válido.' };
  }
  if (!validUsername(username)) return { ok: false, error: 'El usuario debe tener de 3 a 16 letras, números, «_», «-» o «.».' };
  if (!validPassword(password)) return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' };
  if (password !== confirmation) return { ok: false, error: 'Las contraseñas no coinciden.' };
  if (await store.accountOf(identity.playerId)) return { ok: false, error: 'Este navegador ya tiene una cuenta. Inicia sesión.' };
  const acc: Account = {
    email: address, username: username.trim(), usernameKey: usernameKey(username), passHash: await hashPassword(password),
    playerId: identity.playerId, secret: identity.secret, createdAt: Date.now(),
  };
  if (!(await store.createAccount(acc))) {
    if (await store.accountOf(identity.playerId)) return { ok: false, error: 'Este navegador ya tiene una cuenta. Inicia sesión.' };
    return { ok: false, error: 'Ese nombre de usuario ya está ocupado.' };
  }
  return { ok: true, username: acc.username, identity };
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
