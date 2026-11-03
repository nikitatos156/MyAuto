import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { openDB } from './data/db';
import { ensureSeed } from './data/seed';
import { onChange } from './data/db';
import { autoBackupIfDue } from './lib/backup';
import { initNotificationTaps, refreshReminders } from './lib/notify';
import { initUpdates } from './lib/updates';
import { getSetting } from './data/db';
import { applyTheme } from './lib/theme';
import { isNative } from './lib/native';
import { initLock } from './lib/lock';
import { initDeepLinks } from './lib/widget';

async function boot() {
  applyTheme((await getSetting('theme', 'system').catch(() => 'system')) as string);
  await openDB();
  await ensureSeed();
  if (!isNative()) navigator.storage?.persist?.().catch(() => {});
  await initLock().catch((e) => console.warn('lock', e));
  initDeepLinks();
  createRoot(document.getElementById('root')!).render(<App />);
  document.getElementById('splash')?.remove();
  initUpdates();
  initNotificationTaps();
  // напоминания пересчитываются при любых изменениях данных
  let t: any;
  onChange((s) => {
    if (s === 'attachments' || s === 'settings' || s === 'codings') return;
    clearTimeout(t);
    t = setTimeout(refreshReminders, 1500);
  });
  setTimeout(async () => {
    // Android 13+: при первом запуске спрашиваем разрешение на уведомления-напоминания
    if (isNative() && !(await getSetting('askedNotifications', false))) {
      const { notificationPermission, requestNotificationPermission } = await import('./lib/notify');
      const { setSetting } = await import('./data/db');
      if ((await notificationPermission()).startsWith('prompt')) await requestNotificationPermission();
      await setSetting('askedNotifications', true);
    }
    refreshReminders();
    const r = await autoBackupIfDue().catch(() => 'skip');
    if (r === 'done') console.info('Автокопия сохранена');
  }, 2500);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', async () => applyTheme(await getSetting('theme', 'system')));
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('root');
  if (el) el.innerHTML = `<div style="padding:24px;font-family:system-ui">Не удалось запустить приложение: ${String(e?.message || e)}</div>`;
});
