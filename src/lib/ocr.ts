// Распознавание текста на устройстве (Tesseract WASM в отдельном воркере, модели rus + eng).
export interface OcrResult {
  text: string;
  confidence: number;
}
interface PassesResult {
  texts: string[];
  confs: number[];
}
type Job = {
  msg: any;
  transfer: Transferable[];
  onProgress?: (stage: string, value: number) => void;
  resolve: (r: any) => void;
  reject: (e: Error) => void;
  retried?: boolean;
};
interface Slot {
  w: Worker;
  job: (Job & { id: number }) | null;
}

// Несколько воркеров: проходы и страницы распознаются параллельно (на телефоне обычно 2, на мощном — 3).
const slots: Slot[] = [];
const queue: Job[] = [];
let seq = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let crashLimit = Infinity; // если воркер упал (например, не хватило памяти), дальше работаем меньшим числом

export function ocrSupported() {
  try {
    // проверка WebAssembly SIMD (используем сборку ядра с SIMD)
    const simd = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
    return typeof Worker !== 'undefined' && typeof WebAssembly === 'object' && WebAssembly.validate(simd) && typeof (window as any).DecompressionStream !== 'undefined';
  } catch {
    return false;
  }
}

const baseUrl = () => new URL('ocr/', document.baseURI).href;

/** Сколько воркеров держать: каждый — отдельный экземпляр Tesseract с моделями (~100 МБ памяти). */
export function ocrParallelism() {
  const cores = navigator.hardwareConcurrency || 2;
  const mem = (navigator as any).deviceMemory || 4;
  const forced = (globalThis as any).__OCR_WORKERS; // для тестов
  const n = forced || (cores >= 8 && mem >= 8 ? 3 : cores >= 4 && mem >= 3 ? 2 : 1);
  return Math.max(1, Math.min(n, crashLimit));
}

function makeSlot(): Slot {
  const slot: Slot = { w: new Worker(baseUrl() + 'ocr-worker.js'), job: null };
  slot.w.onmessage = ({ data }) => {
    const job = slot.job;
    if (!job) return;
    if (data.type === 'progress') job.onProgress?.(data.stage, data.value);
    else if (data.id === job.id && (data.type === 'result' || data.type === 'error')) {
      slot.job = null;
      if (data.type === 'result') job.resolve(data);
      else job.reject(new Error(data.error));
      pump();
    }
  };
  slot.w.onerror = (e) => {
    const job = slot.job;
    slot.job = null;
    slot.w.terminate();
    slots.splice(slots.indexOf(slot), 1);
    crashLimit = Math.max(1, slots.length);
    if (job && !job.retried) {
      // повторяем задание один раз — уже с меньшим числом параллельных воркеров
      // (изображение передаётся копией, поэтому у нас оно сохранилось)
      const { id: _id, ...rest } = job;
      if ((rest.msg.gray as ArrayBuffer)?.byteLength) queue.unshift({ ...rest, retried: true });
      else job.reject(new Error(e.message || 'Ошибка распознавания'));
    } else job?.reject(new Error(e.message || 'Ошибка распознавания'));
    pump();
  };
  slots.push(slot);
  return slot;
}

function pump() {
  clearTimeout(idleTimer);
  while (queue.length) {
    const slot = slots.find((s) => !s.job) || (slots.length < ocrParallelism() ? makeSlot() : null);
    if (!slot) return;
    const job = queue.shift()!;
    const id = ++seq;
    slot.job = { ...job, id };
    slot.w.postMessage({ ...job.msg, id, base: baseUrl() }, job.transfer);
  }
  // простаивающие воркеры освобождают память через минуту
  if (slots.every((s) => !s.job)) idleTimer = setTimeout(() => slots.splice(0).forEach((s) => s.w.terminate()), 60000);
}

function send<T>(msg: any, transfer: Transferable[], onProgress?: (stage: string, value: number) => void): Promise<T> {
  if (!ocrSupported()) return Promise.reject(new Error('Распознавание не поддерживается на этом устройстве'));
  return new Promise<T>((resolve, reject) => {
    queue.push({ msg, transfer, onProgress, resolve, reject });
    pump();
  });
}

/** Простое распознавание готового изображения. */
export async function recognize(image: Blob, onProgress?: (stage: string, value: number) => void, psm = 3): Promise<OcrResult> {
  const buf = await image.arrayBuffer();
  const r: any = await send({ type: 'recognize', image: buf, psm }, [buf], onProgress);
  return { text: r.text || '', confidence: r.confidence || 0 };
}

export type OcrPass = { layer: 'full' } | { layer: 'raw' } | { layer: 'soft'; a: number; b: number };

/** Набор проходов для бланков (СТС, ПТС, ВУ): полный текст + слои «напечатанных значений». */
export const FORM_PASSES: OcrPass[] = [{ layer: 'full' }, { layer: 'soft', a: 0.1, b: 0.35 }, { layer: 'soft', a: 0.15, b: 0.45 }];
/** Для обычной бумаги (полисы, постановления, чеки). */
export const PAPER_PASSES: OcrPass[] = [{ layer: 'full' }];

/** Изображение → оттенки серого в масштабе, удобном для распознавания (короткая сторона ≈ target). */
export function toGray(src: HTMLCanvasElement, target = 2000, maxLong = 3400) {
  let k = target / Math.min(src.width, src.height);
  k = Math.min(k, maxLong / Math.max(src.width, src.height), 2.5);
  if (k > 0.92 && k < 1.08) k = 1;
  const w = Math.round(src.width * k);
  const h = Math.round(src.height * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return { gray, w, h };
}

/** Задания «страница × проход»: каждое уходит свободному воркеру; ответы собираются в исходном порядке. */
async function runPasses(
  pages: HTMLCanvasElement[],
  passes: OcrPass[],
  onProgress?: (done: number, total: number, initializing: boolean) => void,
): Promise<{ texts: string[][]; confs: number[][] }> {
  const total = pages.length * passes.length;
  const part = new Array(total).fill(0);
  let initializing = true;
  const report = () => onProgress?.(part.reduce((a, b) => a + b, 0), total, initializing);
  const jobs: Promise<void>[] = [];
  const texts: string[][] = pages.map(() => []);
  const confs: number[][] = pages.map(() => []);
  pages.forEach((page, i) => {
    const { gray, w, h } = toGray(page);
    passes.forEach((pass, j) => {
      const k = i * passes.length + j;
      // без передачи владения: если воркер упадёт, задание можно повторить с тем же изображением
      jobs.push(
        send<any>({ type: 'passes', gray: gray.buffer, w, h, passes: [pass], psm: 6 }, [], (stage, v) => {
          if (stage === 'init') initializing = v < 1;
          else if (stage === 'recognize') {
            initializing = false;
            part[k] = Math.max(part[k], Math.min(0.99, v));
          }
          report();
        }).then((r) => {
          texts[i][j] = (r.texts || [])[0] || '';
          confs[i][j] = (r.confs || [])[0] || 0;
          part[k] = 1;
          report();
        }),
      );
    });
  });
  await Promise.all(jobs);
  return { texts, confs };
}

/** Несколько проходов распознавания по одному изображению. */
export async function recognizePasses(
  src: HTMLCanvasElement,
  passes: OcrPass[],
  onProgress?: (stage: string, value: number) => void,
): Promise<PassesResult> {
  const r = await runPasses([src], passes, (done, total, init) => onProgress?.(init ? 'init' : 'pass', init ? 0.5 : done / total));
  return { texts: r.texts[0], confs: r.confs[0] };
}

/**
 * Распознать страницы документа. Возвращает тексты всех проходов всех страниц —
 * разбор полей выбирает значения голосованием. Проходы идут параллельно в нескольких воркерах.
 */
export async function recognizePages(
  pages: HTMLCanvasElement[],
  passes: OcrPass[],
  onProgress?: (p: number, label: string) => void,
): Promise<string[]> {
  const label = `Распознаю${pages.length > 1 ? ` ${pages.length} стр.` : ''}`;
  const r = await runPasses(pages, passes, (done, total, init) =>
    init && done === 0 ? onProgress?.(0.03, 'Загружаю модель распознавания') : onProgress?.(0.05 + (done / total) * 0.95, label),
  );
  return r.texts.flat();
}

/** Совместимость: распознать готовые изображения и склеить текст. */
export async function recognizeAll(images: Blob[], onProgress?: (p: number, label: string) => void): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const r = await recognize(images[i], (stage, v) => {
      const label = stage === 'init' ? 'Загружаю модель' : `Распознаю${images.length > 1 ? ` стр. ${i + 1}/${images.length}` : ''}`;
      onProgress?.(stage === 'init' ? 0 : i / images.length + v / images.length, label);
    });
    parts.push(r.text);
  }
  return parts.join('\n');
}
