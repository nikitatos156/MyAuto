// Блокировка приложения: PIN-код (хранится только хеш PBKDF2) и вход по отпечатку / Face ID.
// Android — системный BiometricPrompt через нативный плагин MyAutoNative, iPhone/браузер — WebAuthn
// (встроенный аутентификатор устройства). Это защита от посторонних глаз: данные на телефоне не шифруются.
import { useSyncExternalStore } from 'react';
import { getSetting, setSetting } from '../data/db';
import { call, isNative } from './native';

export interface LockConfig {
  enabled: boolean;
  salt?: string;
  hash?: string;
  bio?: boolean;
  webauthnId?: string;
  /** Через сколько миллисекунд в фоне снова спрашивать PIN (0 — сразу). */
  timeout: number;
}

export const PIN_LENGTH = 4;
const KEY = 'lock';
const DEFAULTS: LockConfig = { enabled: false, timeout: 60000 };

let cfg: LockConfig = DEFAULTS;
let locked = false;
let hiddenAt = 0;
let suspendedUntil = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const isLocked = () => locked;
export const lockConfig = () => cfg;
export function onLockChange(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}
export const useLocked = () => useSyncExternalStore(onLockChange, isLocked);
export const useLockConfig = () => useSyncExternalStore(onLockChange, lockConfig);

export async function loadLock() {
  const saved = await getSetting<Partial<LockConfig>>(KEY, {}).catch(() => ({}));
  cfg = { ...DEFAULTS, ...saved };
  if (!cfg.hash) cfg.enabled = false;
  return cfg;
}

async function save(next: Partial<LockConfig>) {
  cfg = { ...cfg, ...next };
  await setSetting(KEY, cfg);
  emit();
}

export function lockNow() {
  if (!cfg.enabled) return;
  locked = true;
  emit();
}

export function unlock() {
  locked = false;
  hiddenAt = 0;
  emit();
}

/** Не блокировать при возврате: приложение уходит в фон из-за камеры, выбора файла или «Поделиться». */
export function suspendLock(ms = 10 * 60000) {
  suspendedUntil = Date.now() + ms;
}

// ---------- PIN ----------
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => {
  const bin = atob(s);
  const u = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
  return b64(new Uint8Array(bits));
}

export async function setPin(pin: string) {
  const salt = rnd(16);
  await save({ enabled: true, salt: b64(salt), hash: await derive(pin, salt) });
}

export async function checkPin(pin: string) {
  if (!cfg.salt || !cfg.hash) return false;
  return (await derive(pin, unb64(cfg.salt))) === cfg.hash;
}

export async function disableLock() {
  await save({ enabled: false, salt: undefined, hash: undefined, bio: false, webauthnId: undefined });
  unlock();
}

export const setLockTimeout = (timeout: number) => save({ timeout });

// ---------- отпечаток / Face ID ----------
export type BioKind = 'native' | 'web' | null;

export async function bioAvailable(): Promise<BioKind> {
  if (isNative()) {
    try {
      const r = await call<{ available: boolean }>('MyAutoNative', 'biometricAvailable');
      return r?.available ? 'native' : null;
    } catch {
      return null; // старый APK без плагина
    }
  }
  try {
    const PKC: any = (window as any).PublicKeyCredential;
    if (PKC && (await PKC.isUserVerifyingPlatformAuthenticatorAvailable())) return 'web';
  } catch {
    /* нет WebAuthn */
  }
  return null;
}

export function bioName(): string {
  if (isNative()) return 'Отпечаток или лицо';
  return /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent) ? 'Face ID / Touch ID' : 'Биометрия устройства';
}

async function nativePrompt(subtitle: string) {
  suspendLock(60000);
  const r = await call<{ ok: boolean; code?: number; error?: string }>('MyAutoNative', 'biometricAuth', { title: 'My Auto', subtitle }).catch(() => null);
  return !!r?.ok;
}

/** Включить вход по биометрии: на iPhone создаётся ключ доступа (passkey) только для этого приложения. */
export async function enrollBio(): Promise<boolean> {
  const kind = await bioAvailable();
  if (kind === 'native') {
    if (!(await nativePrompt('Подтвердите, чтобы включить вход по отпечатку'))) return false;
    await save({ bio: true });
    return true;
  }
  if (kind === 'web') {
    const cred: any = await navigator.credentials.create({
      publicKey: {
        challenge: rnd(32),
        rp: { name: 'My Auto' },
        user: { id: rnd(16), name: 'My Auto', displayName: 'My Auto' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        attestation: 'none',
        timeout: 60000,
      },
    });
    if (!cred) return false;
    await save({ bio: true, webauthnId: b64(new Uint8Array(cred.rawId)) });
    return true;
  }
  return false;
}

export const disableBio = () => save({ bio: false, webauthnId: undefined });

/** Проверка биометрией. true — личность подтверждена (сама блокировка не снимается). */
export async function bioVerify(subtitle = 'Вход в приложение'): Promise<boolean> {
  if (!cfg.bio) return false;
  if (isNative()) return nativePrompt(subtitle);
  if (!cfg.webauthnId) return false;
  try {
    const a: any = await navigator.credentials.get({
      publicKey: {
        challenge: rnd(32),
        allowCredentials: [{ type: 'public-key', id: unb64(cfg.webauthnId) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    if (!a) return false;
    // флаг UV (бит 2 байта флагов) — пользователь подтвердил лицом, пальцем или кодом устройства
    const flags = new Uint8Array(a.response.authenticatorData)[32];
    return (flags & 0x04) !== 0;
  } catch {
    return false;
  }
}

export async function bioUnlock() {
  const ok = await bioVerify();
  if (ok) unlock();
  return ok;
}

// ---------- жизненный цикл ----------
/** Вызывается до первого рендера: если защита включена, приложение открывается заблокированным. */
export async function initLock() {
  await loadLock();
  locked = cfg.enabled;
  // камера, галерея, PDF — системные окна уводят приложение в фон; это не повод спрашивать PIN
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement && t.type === 'file') suspendLock();
    },
    true,
  );
  window.addEventListener('myauto:external', () => suspendLock());
  document.addEventListener('visibilitychange', () => {
    if (!cfg.enabled) return;
    if (document.hidden) {
      if (!locked) hiddenAt = Date.now();
      return;
    }
    if (locked || !hiddenAt) return;
    const away = Date.now() - hiddenAt;
    hiddenAt = 0;
    if (Date.now() < suspendedUntil) {
      suspendedUntil = 0;
      return;
    }
    if (away >= cfg.timeout) lockNow();
  });
}
