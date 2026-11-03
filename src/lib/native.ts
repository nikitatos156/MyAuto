// Мост к нативным плагинам Capacitor (Android). В браузере/на iPhone — веб-аналоги.
// Используем window.Capacitor.nativePromise напрямую: так веб-сборка одинакова для всех платформ.

declare global {
  interface Window {
    Capacitor?: any;
  }
}

export const cap = () => (typeof window !== 'undefined' ? window.Capacitor : undefined);
export const isNative = () => !!cap()?.isNativePlatform?.();
export const platform = (): 'android' | 'ios' | 'web' => {
  const p = cap()?.getPlatform?.();
  if (p === 'android' || p === 'ios') return p;
  return 'web';
};
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export function call<T = any>(plugin: string, method: string, options: any = {}): Promise<T> {
  const c = cap();
  if (!c?.nativePromise) return Promise.reject(new Error('Нативный мост недоступен'));
  return c.nativePromise(plugin, method, options);
}

export function listen(plugin: string, eventName: string, cb: (data: any) => void) {
  const c = cap();
  if (!c?.nativeCallback) return;
  try {
    c.nativeCallback(plugin, 'addListener', { eventName }, cb);
  } catch (e) {
    console.warn(e);
  }
}

// --- файлы ---
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64: string, type = 'application/octet-stream'): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

function webDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Отдать файл пользователю: на Android — меню «Поделиться» (сохранить в Файлы, Telegram, Диск),
 * на iPhone — системное меню «Поделиться / Сохранить в Файлы», в браузере — скачивание.
 */
/** Сообщить блокировке, что приложение сейчас уйдёт в системное окно (поделиться, браузер). */
export const markExternal = () => window.dispatchEvent(new Event('myauto:external'));

export async function exportFile(blob: Blob, filename: string, title = filename): Promise<'shared' | 'downloaded'> {
  markExternal();
  if (isNative()) {
    const data = await blobToBase64(blob);
    const res = await call<{ uri: string }>('Filesystem', 'writeFile', {
      path: filename,
      data,
      directory: 'CACHE',
      recursive: true,
    });
    await call('Share', 'share', { title, dialogTitle: title, files: [res.uri] });
    return 'shared';
  }
  const file = new File([blob], filename, { type: blob.type });
  const nav: any = navigator;
  if (nav.canShare?.({ files: [file] }) && (isIOS() || /android/i.test(navigator.userAgent))) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
    }
  }
  webDownload(blob, filename);
  return 'downloaded';
}

/** Сохранить файл в папку «Документы/MyAuto» на Android (для автобэкапов). */
export async function saveToDocuments(blob: Blob, filename: string): Promise<string | null> {
  if (!isNative()) return null;
  const data = await blobToBase64(blob);
  for (const directory of ['DOCUMENTS', 'EXTERNAL', 'DATA']) {
    try {
      const res = await call<{ uri: string }>('Filesystem', 'writeFile', {
        path: `MyAuto/${filename}`,
        data,
        directory,
        recursive: true,
      });
      return res.uri || directory;
    } catch (e) {
      console.warn('writeFile failed in', directory, e);
    }
  }
  return null;
}

export async function listDocuments(): Promise<{ name: string; size?: number; mtime?: number; dir: string }[]> {
  if (!isNative()) return [];
  const out: any[] = [];
  for (const directory of ['DOCUMENTS', 'EXTERNAL', 'DATA']) {
    try {
      const res = await call<{ files: any[] }>('Filesystem', 'readdir', { path: 'MyAuto', directory });
      for (const f of res.files || []) {
        const name = typeof f === 'string' ? f : f.name;
        if (/\.json$/i.test(name)) out.push({ name, size: f.size, mtime: f.mtime, dir: directory });
      }
    } catch {
      /* папки нет */
    }
  }
  return out.sort((a, b) => (b.name > a.name ? 1 : -1));
}

export async function readDocument(name: string, dir: string): Promise<string> {
  const res = await call<{ data: string }>('Filesystem', 'readFile', { path: `MyAuto/${name}`, directory: dir, encoding: 'utf8' });
  return res.data;
}

export async function deleteDocument(name: string, dir: string) {
  await call('Filesystem', 'deleteFile', { path: `MyAuto/${name}`, directory: dir });
}

// --- внешние ссылки ---
export async function openExternal(url: string) {
  markExternal();
  if (isNative()) {
    try {
      await call('Browser', 'open', { url });
      return;
    } catch (e) {
      console.warn(e);
    }
  }
  const w = window.open(url, '_blank', 'noopener');
  if (!w) location.href = url;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

// --- информация о приложении ---
export async function nativeInfo(): Promise<{ version: string; build: string } | null> {
  if (!isNative()) return null;
  try {
    return await call('App', 'getInfo');
  } catch {
    return null;
  }
}
