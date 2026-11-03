// Небольшая обёртка над IndexedDB: хранилища, CRUD и событие изменения данных.
import { useEffect, useRef, useState } from 'react';
import type { StoreName } from './types';

const DB_NAME = 'myauto';
const DB_VERSION = 2; // 2: шины

const STORES: { name: StoreName; key: string; indexes?: string[] }[] = [
  { name: 'cars', key: 'id' },
  { name: 'fuel', key: 'id', indexes: ['carId'] },
  { name: 'services', key: 'id', indexes: ['carId'] },
  { name: 'documents', key: 'id', indexes: ['carId', 'type'] },
  { name: 'fines', key: 'id', indexes: ['carId'] },
  { name: 'codings', key: 'id', indexes: ['carId'] },
  { name: 'tires', key: 'id', indexes: ['carId'] },
  { name: 'attachments', key: 'id' },
  { name: 'settings', key: 'key' },
];

export const ALL_STORES = STORES.map((s) => s.name);

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s.name)) {
          const os = db.createObjectStore(s.name, { keyPath: s.key });
          for (const ix of s.indexes || []) os.createIndex(ix, ix, { unique: false });
        }
      }
    };
    req.onsuccess = () => {
      // другая вкладка с новой версией приложения обновляет базу — отпускаем соединение
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('IndexedDB blocked');
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: StoreName, mode: IDBTransactionMode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

// --- события изменений ---
type Listener = (store: StoreName) => void;
const listeners = new Set<Listener>();
export function onChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
let pending = new Set<StoreName>();
let scheduled = false;
export function emit(name: StoreName) {
  pending.add(name);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const names = pending;
    pending = new Set();
    names.forEach((n) => listeners.forEach((l) => l(n)));
  });
}

// --- CRUD ---
export async function getAll<T>(name: StoreName): Promise<T[]> {
  return wrap((await store(name)).getAll()) as Promise<T[]>;
}

export async function getByIndex<T>(name: StoreName, index: string, value: any): Promise<T[]> {
  const s = await store(name);
  return wrap(s.index(index).getAll(value)) as Promise<T[]>;
}

export async function get<T>(name: StoreName, id: string): Promise<T | undefined> {
  return wrap((await store(name)).get(id)) as Promise<T | undefined>;
}

export async function put<T>(name: StoreName, value: T): Promise<T> {
  await wrap((await store(name, 'readwrite')).put(value as any));
  emit(name);
  return value;
}

export async function putMany<T>(name: StoreName, values: T[]): Promise<void> {
  if (!values.length) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const os = tx.objectStore(name);
    values.forEach((v) => os.put(v as any));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  emit(name);
}

export async function del(name: StoreName, id: string): Promise<void> {
  await wrap((await store(name, 'readwrite')).delete(id));
  emit(name);
}

export async function clear(name: StoreName): Promise<void> {
  await wrap((await store(name, 'readwrite')).clear());
  emit(name);
}

// --- настройки ---
export async function getSetting<T = any>(key: string, fallback?: T): Promise<T> {
  const row = await get<{ key: string; value: T }>('settings', key);
  return row ? row.value : (fallback as T);
}
export async function setSetting(key: string, value: any) {
  await put('settings', { key, value });
}

// --- React-хук: перезапрашивает данные при изменении нужных хранилищ ---
export function useQuery<T>(
  fn: () => Promise<T>,
  deps: any[] = [],
  stores: StoreName[] | 'all' = 'all',
): T | undefined {
  const [data, setData] = useState<T | undefined>(undefined);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    let seq = 0;
    const run = () => {
      const my = ++seq;
      fnRef
        .current()
        .then((v) => {
          if (alive && my === seq) setData(v);
        })
        .catch((e) => console.error(e));
    };
    run();
    const off = onChange((s) => {
      if (stores === 'all' || stores.includes(s)) run();
    });
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return data;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function stamp<T extends object>(obj: T, isNew = false): T & { createdAt: number; updatedAt: number } {
  const now = Date.now();
  const o: any = { ...obj, updatedAt: now };
  if (isNew || !o.createdAt) o.createdAt = now;
  return o;
}
