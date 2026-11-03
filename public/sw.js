// Service worker: офлайн-работа и обновления. Версия подставляется при сборке.
const VERSION = '__VERSION__';
const CACHE = 'myauto-' + VERSION;
const ASSETS = __ASSETS__;
// модель распознавания хранится отдельно и не перекачивается при обновлениях приложения
const OCR_CACHE = 'myauto-ocr-v3';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  // Новая версия ждёт, пока пользователь нажмёт «Обновить» (первая установка активируется сразу).
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('myauto-') && k !== CACHE && k !== OCR_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // файлы обновлений всегда из сети
  if (/version\.json$|\.apk$|\.zip$/.test(url.pathname)) return;
  if (url.pathname.includes('/ocr/') || url.pathname.includes('/pdfjs/')) {
    event.respondWith(
      caches.open(OCR_CACHE).then((c) =>
        c.match(req).then(
          (r) =>
            r ||
            fetch(req).then((res) => {
              if (res.ok) c.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html', { cacheName: CACHE }).then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(
    caches.match(req, { cacheName: CACHE }).then(
      (r) =>
        r ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
