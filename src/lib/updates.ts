// Обновления по воздуху.
// iPhone / браузер: service worker; новая версия скачивается в фоне, применяется по кнопке «Обновить».
// Android: обновления берутся из релизов репозитория на GitHub (публичный API, без токена).
//   Веб-часть (zip) ставится через Capgo Updater, новый APK предлагается, когда меняется нативная часть.
import { APP_VERSION, NATIVE_VERSION, UPDATE_REPO, UPDATE_TOKEN } from '../env';
import { call, isNative, nativeInfo, openExternal } from './native';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest'; remote?: string }
  | { kind: 'web-ready'; version?: string; notes?: string; id?: string }
  | { kind: 'apk'; version: string; assetUrl: string; notes?: string }
  | { kind: 'downloading'; version: string }
  | { kind: 'error'; message: string };

let state: UpdateState = { kind: 'idle' };
const subs = new Set<(s: UpdateState) => void>();
export const getUpdateState = () => state;
export function onUpdateState(fn: (s: UpdateState) => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}
function setState(s: UpdateState) {
  state = s;
  subs.forEach((f) => f(s));
}

export function cmpVersion(a: string, b: string) {
  const pa = a.split(/[.-]/).map((x) => parseInt(x) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export const REPO_PAGE = `https://github.com/${UPDATE_REPO || 'nikitatos156/MyAuto'}`;
export const RELEASES_PAGE = `${REPO_PAGE}/releases/latest`;
export const canAutoUpdate = () => (isNative() ? !!UPDATE_REPO : 'serviceWorker' in navigator);
// Токен нужен для приватного репозитория. Если репозиторий открыт (или токен отозван) — запросы идут без него.
let useToken = !!UPDATE_TOKEN;

// ---------- Web / PWA ----------
async function fetchWebVersion(): Promise<{ version: string; notes?: string }> {
  const res = await fetch(`${new URL('.', location.href).href}version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
  return res.json();
}

let registration: ServiceWorkerRegistration | null = null;
let waiting: ServiceWorker | null = null;

function markWaiting(w: ServiceWorker) {
  waiting = w;
  fetchWebVersion()
    .then((r) => setState({ kind: 'web-ready', version: r.version, notes: r.notes }))
    .catch(() => setState({ kind: 'web-ready' }));
}

function initWeb() {
  if (!('serviceWorker' in navigator)) return;
  if (location.hostname === 'localhost' && !location.search.includes('sw=1')) return; // разработка
  navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) markWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) markWaiting(w);
        });
      });
      const check = () => reg.update().catch(() => {});
      setInterval(check, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    })
    .catch((e) => console.warn('SW register failed', e));
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}

// ---------- Android: релизы на GitHub ----------
const PENDING_KEY = 'myauto.otaPending';

interface GhAsset {
  id: number;
  name: string;
  url: string; // API-адрес ассета
  size: number;
}
interface GhRelease {
  tag_name: string;
  name?: string;
  body?: string;
  assets: GhAsset[];
}

// Нативный HTTP (без CORS); редиректы можно отключить, чтобы получить подписанную ссылку на файл.
async function ghRequest(url: string, opts: { accept?: string; disableRedirects?: boolean; responseType?: string } = {}) {
  return call<{ status: number; data: any; headers: Record<string, string> }>('CapacitorHttp', 'request', {
    url,
    method: 'GET',
    headers: {
      ...(useToken ? { Authorization: `Bearer ${UPDATE_TOKEN}` } : {}),
      Accept: opts.accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    readTimeout: 20000,
    connectTimeout: 15000,
    disableRedirects: !!opts.disableRedirects,
    responseType: opts.responseType || 'json',
  });
}

async function latestRelease(): Promise<GhRelease> {
  if (!UPDATE_REPO) throw new Error('В этой сборке не задан репозиторий обновлений');
  const url = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
  let res = await ghRequest(url);
  if ((res.status === 401 || res.status === 403) && useToken) {
    // токен отозван — пробуем без него (сработает, если репозиторий публичный)
    useToken = false;
    res = await ghRequest(url);
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      useToken = true;
      throw new Error('Токен обновлений недействителен или истёк');
    }
  }
  if (res.status === 404) throw new Error('Релизы не найдены');
  if (res.status === 403) throw new Error('GitHub временно ограничил запросы — попробуйте позже');
  if (res.status !== 200) throw new Error(`GitHub ответил ${res.status}`);
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
}

/** Временная (несколько минут) прямая ссылка на файл релиза — без токена. */
async function signedAssetUrl(asset: GhAsset): Promise<string> {
  const res = await ghRequest(asset.url, { accept: 'application/octet-stream', disableRedirects: true, responseType: 'text' });
  const h = res.headers || {};
  const loc = h.Location || h.location || (h as any).LOCATION;
  if ((res.status === 302 || res.status === 301 || res.status === 307) && loc) return loc;
  throw new Error(`Не удалось получить файл обновления (${res.status})`);
}

function releaseInfo(r: GhRelease) {
  const version = r.tag_name.replace(/^v/, '');
  const m = (r.body || '').match(/myauto:native=(\d+)/);
  const native = m ? parseInt(m[1], 10) : NATIVE_VERSION;
  const notes = (r.body || '').split('\n')[0].replace(/<!--.*?-->/g, '').trim().slice(0, 140);
  const zip = r.assets.find((a) => /^web-.*\.zip$/.test(a.name));
  const apk = r.assets.find((a) => /^MyAuto-\d.*\.apk$/.test(a.name)) || r.assets.find((a) => /\.apk$/.test(a.name));
  const sha = (r.body || '').match(/sha256=([0-9a-f]{64})/)?.[1]; // Capgo проверяет SHA-256 архива
  return { version, native, notes, zip, apk, sha };
}

async function installedNativeVersion(): Promise<number> {
  const info = await nativeInfo();
  const build = parseInt(info?.build || '0');
  return build >= 100000 ? Math.floor(build / 100000) : NATIVE_VERSION;
}

async function checkNative(): Promise<UpdateState> {
  const rel = releaseInfo(await latestRelease());
  const installed = await installedNativeVersion();
  if (rel.native > installed && rel.apk) {
    return { kind: 'apk', version: rel.version, assetUrl: rel.apk.url, notes: rel.notes };
  }
  if (cmpVersion(rel.version, APP_VERSION) <= 0 || !rel.zip) return { kind: 'latest', remote: rel.version };
  if (!rel.sha) {
    // старый релиз без контрольной суммы — веб-обновление не поставить, предлагаем APK
    if (rel.apk) return { kind: 'apk', version: rel.version, assetUrl: rel.apk.url, notes: rel.notes };
    return { kind: 'latest', remote: rel.version };
  }
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (pending?.version === rel.version && pending.id) {
      return { kind: 'web-ready', version: rel.version, id: pending.id, notes: rel.notes };
    }
  } catch {
    /* ignore */
  }
  setState({ kind: 'downloading', version: rel.version });
  const url = await signedAssetUrl(rel.zip);
  const bundle = await call<{ id: string }>('CapacitorUpdater', 'download', { url, version: rel.version, checksum: rel.sha });
  await call('CapacitorUpdater', 'next', { id: bundle.id }); // применится при следующем запуске
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ version: rel.version, id: bundle.id }));
  } catch {
    /* ignore */
  }
  return { kind: 'web-ready', version: rel.version, id: bundle.id, notes: rel.notes };
}

// ---------- общее ----------
let lastCheck = 0;
export async function checkForUpdates(manual = false): Promise<UpdateState> {
  if (!manual && Date.now() - lastCheck < 20 * 60 * 1000) return state;
  lastCheck = Date.now();
  if (state.kind === 'web-ready' || state.kind === 'downloading') return state;
  if (manual) setState({ kind: 'checking' });
  try {
    if (isNative()) {
      const s = await checkNative();
      setState(s);
      return s;
    }
    if (registration) {
      await registration.update();
      await new Promise((r) => setTimeout(r, 1500));
      if (waiting) return state;
    }
    const remote = await fetchWebVersion().catch(() => null);
    const s: UpdateState =
      remote && cmpVersion(remote.version, APP_VERSION) > 0 && !registration
        ? { kind: 'web-ready', version: remote.version, notes: remote.notes }
        : { kind: 'latest', remote: remote?.version };
    setState(s);
    return s;
  } catch (e: any) {
    let message = e?.message || String(e);
    if (/Failed to download/i.test(message)) message = 'не удалось скачать обновление — проверьте интернет и попробуйте ещё раз';
    const s: UpdateState = { kind: 'error', message };
    if (manual) setState(s);
    return s;
  }
}

export async function applyUpdate() {
  const s = state;
  if (s.kind === 'apk') {
    try {
      const url = await signedAssetUrl({ id: 0, name: 'apk', url: s.assetUrl, size: 0 });
      await openExternal(url); // браузер скачает APK, дальше — «Установить»
    } catch (e: any) {
      setState({ kind: 'error', message: e?.message || String(e) });
    }
    return;
  }
  if (s.kind !== 'web-ready') return;
  if (isNative() && s.id) {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    await call('CapacitorUpdater', 'set', { id: s.id }); // перезагрузит приложение
    return;
  }
  if (waiting) {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => location.reload(), 3000);
  } else {
    location.reload();
  }
}

export function initUpdates() {
  if (isNative()) {
    call('CapacitorUpdater', 'notifyAppReady').catch(() => {});
    try {
      const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
      if (pending && cmpVersion(pending.version, APP_VERSION) <= 0) localStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    if (!UPDATE_REPO) return;
    setTimeout(() => checkForUpdates(), 4000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdates();
    });
  } else {
    initWeb();
  }
}

/** Скачать последний APK (на Android — сразу файл, иначе — страница релизов на GitHub). */
export async function downloadLatestApk() {
  if (isNative() && UPDATE_REPO) {
    const rel = releaseInfo(await latestRelease());
    if (rel.apk) return openExternal(await signedAssetUrl(rel.apk));
  }
  await openExternal(RELEASES_PAGE);
}
