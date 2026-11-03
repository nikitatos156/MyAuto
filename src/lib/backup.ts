// Резервные копии: выгрузка всех данных (вместе с фото чеков) в один JSON-файл и восстановление.
import { ALL_STORES, clear, getAll, getSetting, putMany, setSetting } from '../data/db';
import type { Attachment, StoreName } from '../data/types';
import { APP_VERSION } from '../env';
import { pad } from './format';
import { base64ToBlob, blobToBase64, exportFile, isNative, listDocuments, deleteDocument, saveToDocuments } from './native';

const FORMAT = 'myauto-backup';
// PIN-код и биометрия привязаны к устройству — в копию не попадают и из копии не восстанавливаются
const SKIP_SETTINGS = new Set(['lastBackupAt', 'lastAutoBackupAt', 'lock']);

export interface BackupFile {
  format: typeof FORMAT;
  version: number;
  appVersion: string;
  createdAt: number;
  data: Record<string, any[]>;
}

export async function buildBackup(): Promise<Blob> {
  const data: Record<string, any[]> = {};
  for (const name of ALL_STORES) {
    const rows = await getAll<any>(name);
    if (name === 'attachments') {
      data[name] = await Promise.all(
        (rows as Attachment[]).map(async (a) => ({ ...a, blob: undefined, data: await blobToBase64(a.blob) })),
      );
    } else if (name === 'settings') {
      data[name] = rows.filter((r) => !SKIP_SETTINGS.has(r.key));
    } else {
      data[name] = rows;
    }
  }
  const file: BackupFile = { format: FORMAT, version: 1, appVersion: APP_VERSION, createdAt: Date.now(), data };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export function backupName(t = Date.now()) {
  const d = new Date(t);
  return `myauto-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

/** Ручная копия: файл отдаётся через «Поделиться» / скачивание. */
export async function backupNow() {
  const blob = await buildBackup();
  const name = backupName();
  let saved: string | null = null;
  if (isNative()) saved = await saveToDocuments(blob, name);
  await exportFile(blob, name, 'Резервная копия My Auto');
  await setSetting('lastBackupAt', Date.now());
  return { name, size: blob.size, saved };
}

export function parseBackup(text: string): BackupFile {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Файл повреждён или это не резервная копия');
  }
  if (obj?.format !== FORMAT || !obj.data) throw new Error('Это не резервная копия My Auto');
  return obj as BackupFile;
}

export async function restoreBackup(file: BackupFile, mode: 'replace' | 'merge' = 'replace') {
  // защита этого устройства (PIN, биометрия) сохраняется как есть
  const keep = (await getAll<{ key: string; value: any }>('settings')).filter((r) => r.key === 'lock');
  for (const name of ALL_STORES) {
    const rows = file.data[name];
    if (!Array.isArray(rows)) continue;
    if (mode === 'replace') await clear(name as StoreName);
    let list = name === 'settings' ? rows.filter((r: any) => r.key !== 'lock').concat(keep) : rows;
    if (name === 'attachments') {
      list = rows.map((a: any) => {
        const { data, ...rest } = a;
        return { ...rest, blob: base64ToBlob(data, a.type) } as Attachment;
      });
    }
    await putMany(name as StoreName, list);
  }
  await setSetting('seeded', true);
}

/**
 * Автокопия раз в месяц.
 * Android: тихо сохраняется в «Документы/MyAuto» (хранятся последние 6).
 * iPhone/браузер: сохранить файл без участия пользователя нельзя — показываем напоминание.
 */
export async function autoBackupIfDue(): Promise<'done' | 'due' | 'skip'> {
  const enabled = await getSetting<boolean>('autoBackup', true);
  if (!enabled) return 'skip';
  const last = Math.max(await getSetting<number>('lastBackupAt', 0), await getSetting<number>('lastAutoBackupAt', 0));
  const installed = await getSetting<number>('installedAt', Date.now());
  const ref = last || installed;
  const due = Date.now() - ref > 30 * 24 * 3600 * 1000;
  if (!due) return 'skip';
  if (!isNative()) return 'due';
  const blob = await buildBackup();
  const saved = await saveToDocuments(blob, backupName());
  if (!saved) return 'due';
  await setSetting('lastAutoBackupAt', Date.now());
  await setSetting('lastBackupAt', Date.now());
  // чистим старые автокопии
  try {
    const files = await listDocuments();
    for (const f of files.slice(6)) await deleteDocument(f.name, f.dir);
  } catch {
    /* ignore */
  }
  return 'done';
}
