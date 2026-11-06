// Чеки и фото документов: сжатие изображений и хранение в IndexedDB.
import { delMany, get, getAll, put, sweep, uid } from '../data/db';
import type { Attachment } from '../data/types';

const MAX_SIDE = 1600;
const QUALITY = 0.72;
const MAX_FILE = 15 * 1024 * 1024;

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function compressImage(file: Blob): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 600 * 1024 && file.type === 'image/jpeg') return file;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
    return blob && blob.size < file.size ? blob : file;
  } catch (e) {
    console.warn('compress failed', e);
    return file;
  }
}

export async function addAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE && !file.type.startsWith('image/')) throw new Error('Файл больше 15 МБ');
  const blob = await compressImage(file);
  const att: Attachment = {
    id: uid(),
    blob,
    type: blob.type || file.type || 'application/octet-stream',
    name: file.name || 'файл',
    size: blob.size,
    createdAt: Date.now(),
  };
  await put('attachments', att);
  return att;
}

export const getAttachment = (id: string) => get<Attachment>('attachments', id);

export async function removeAttachments(ids: string[]) {
  if (!ids.length) return;
  await delMany('attachments', ids);
  for (const id of ids) {
    const u = urlCache.get(id);
    if (u) URL.revokeObjectURL(u);
    urlCache.delete(id);
  }
}

/**
 * Фото, которые добавили в форму, но форму не сохранили (или убрали фото до сохранения), остаются в базе
 * и попадают в резервные копии. Раз в день удаляем такие «потерянные» файлы старше двух суток.
 */
export async function cleanupAttachments(minAge = 2 * 24 * 3600 * 1000): Promise<number> {
  const used = new Set<string>();
  for (const s of ['fuel', 'services', 'documents', 'fines', 'tires'] as const) {
    for (const r of await getAll<{ attachments?: string[] }>(s)) for (const id of r.attachments || []) used.add(id);
  }
  const before = Date.now() - minAge;
  return sweep<Attachment>('attachments', (a) => !used.has(a.id) && (a.createdAt || 0) < before);
}

const urlCache = new Map<string, string>();
export async function attachmentUrl(id: string): Promise<string | null> {
  if (urlCache.has(id)) return urlCache.get(id)!;
  const a = await getAttachment(id);
  if (!a) return null;
  const u = URL.createObjectURL(a.blob);
  urlCache.set(id, u);
  return u;
}

export const isImage = (a?: { type: string }) => !!a && a.type.startsWith('image/');
