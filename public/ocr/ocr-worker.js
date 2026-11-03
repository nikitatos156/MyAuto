/* Распознавание текста на устройстве: Tesseract (WASM) + модели rus и eng. Фото никуда не отправляется.
 *
 * Сообщения:
 *  { type: 'recognize', id, base, image: ArrayBuffer (jpeg/png), psm }        → { text, confidence }
 *  { type: 'passes', id, base, gray: ArrayBuffer, w, h, passes: [...], psm }  → { texts: string[], confs: number[] }
 *     pass = { layer: 'full' } | { layer: 'soft', a, b } | { layer: 'raw' }
 *     Слои строятся из одного изображения в оттенках серого: освещение выравнивается по локальному
 *     фону и локальному «чёрному», после чего бледные типографские подписи можно отделить от
 *     тёмного напечатанного текста (значений полей в СТС, ПТС, ВУ).
 */
/* global importScripts, TesseractCore, DecompressionStream */
let ready = null;
let M = null;
let api = null;

function progress(stage, value) {
  postMessage({ type: 'progress', stage, value });
}

// Модели хранятся сжатыми (.gzip). Android-сборщик может распаковать их сам — тогда берём обычный файл.
async function loadModel(base, lang) {
  let res = await fetch(base + lang + '.traineddata.gzip').catch(() => null);
  if (res && res.ok && typeof DecompressionStream !== 'undefined') {
    const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  res = await fetch(base + lang + '.traineddata').catch(() => null);
  if (res && res.ok) return new Uint8Array(await res.arrayBuffer());
  throw new Error('Не удалось загрузить модель распознавания (' + lang + ')');
}

function init(base) {
  return (async () => {
    progress('init', 0);
    importScripts(base + 'tesseract-core-simd-lstm.js');
    M = await TesseractCore({
      locateFile: (p) => base + p.split('/').pop(),
      TesseractProgress: (p) => progress('recognize', Math.max(0, Math.min(1, p / 100))),
    });
    progress('init', 0.3);
    const [rus, eng] = await Promise.all([loadModel(base, 'rus'), loadModel(base, 'eng')]);
    M.FS.writeFile('/rus.traineddata', rus);
    M.FS.writeFile('/eng.traineddata', eng);
    progress('init', 0.8);
    api = new M.TessBaseAPI();
    // русский — основной, английский — для VIN, латиницы в номерах, марках и транслитерации ФИО
    const status = api.Init('/', 'rus+eng', 1); // OEM 1 = LSTM
    if (status === -1) throw new Error('Не удалось запустить распознавание');
    api.SetVariable('debug_file', '/dev/null'); // без служебных сообщений в консоли
    progress('init', 1);
  })();
}

function run(psm) {
  api.SetVariable('tessedit_pageseg_mode', String(psm || 3));
  api.SetVariable('user_defined_dpi', '300');
  api.SetVariable('preserve_interword_spaces', '1');
  if (api.SetImageFile(1, 0) === 1) throw new Error('Не удалось прочитать изображение');
  api.Recognize(null);
  const text = api.GetUTF8Text();
  const confidence = api.MeanTextConf();
  api.Clear();
  return { text, confidence };
}

// ---------- подготовка слоёв ----------
function boxBlur(a, w, h, r) {
  if (r <= 0) return a;
  const tmp = new Float32Array(a.length);
  const out = new Float32Array(a.length);
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / d;
      s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / d;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function morph(a, w, h, r, fn) {
  const out = new Float32Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = a[y * w + x];
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          m = fn(m, a[yy * w + xx]);
        }
      }
      out[y * w + x] = m;
    }
  return out;
}

/** Нормированная яркость: 0 — локальный «чёрный», 1 — локальный фон. */
function normalize(gray, w, h) {
  const s = Math.max(4, Math.round(Math.max(w, h) / 90));
  const bw = Math.ceil(w / s);
  const bh = Math.ceil(h / s);
  const bmax = new Float32Array(bw * bh);
  const bmin = new Float32Array(bw * bh).fill(255);
  for (let y = 0; y < h; y++) {
    const by = (y / s) | 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      const i = by * bw + ((x / s) | 0);
      if (v > bmax[i]) bmax[i] = v;
      if (v < bmin[i]) bmin[i] = v;
    }
  }
  const bg = boxBlur(morph(bmax, bw, bh, 1, Math.max), bw, bh, 2);
  const bk = boxBlur(morph(bmin, bw, bh, 3, Math.min), bw, bh, 2);
  const n = new Float32Array(w * h);
  const sample = (m, x, y) => {
    const fx = Math.min(bw - 1.001, Math.max(0, x / s - 0.5));
    const fy = Math.min(bh - 1.001, Math.max(0, y / s - 0.5));
    const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
    const x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1);
    const t = m[y0 * bw + x0] + (m[y0 * bw + x1] - m[y0 * bw + x0]) * ax;
    const b = m[y1 * bw + x0] + (m[y1 * bw + x1] - m[y1 * bw + x0]) * ax;
    return t + (b - t) * ay;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const g = sample(bg, x, y);
      const k = Math.min(sample(bk, x, y), 0.75 * g); // на чистом фоне не растягиваем шум
      n[y * w + x] = (gray[y * w + x] - k) / Math.max(30, g - k);
    }
  return n;
}

function layer(n, pass) {
  const out = new Uint8Array(n.length);
  if (pass.layer === 'soft') {
    const a = pass.a, d = pass.b - pass.a;
    for (let i = 0; i < n.length; i++) {
      const v = (n[i] - a) / d;
      out[i] = v <= 0 ? 0 : v >= 1 ? 255 : v * 255;
    }
  } else {
    for (let i = 0; i < n.length; i++) {
      let v = (n[i] - 0.15) / 0.6;
      v = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, 1.3);
      out[i] = v * 255;
    }
  }
  return out;
}

function writePgm(gray, w, h) {
  const header = new TextEncoder().encode(`P5\n${w} ${h}\n255\n`);
  const buf = new Uint8Array(header.length + gray.length);
  buf.set(header, 0);
  buf.set(gray, header.length);
  M.FS.writeFile('/input', buf);
}

self.onmessage = async ({ data }) => {
  const { id, base, psm } = data;
  try {
    if (!ready) ready = init(base);
    await ready;
    if (data.type === 'passes') {
      const gray = new Uint8Array(data.gray);
      const { w, h, passes } = data;
      const needN = passes.some((p) => p.layer !== 'raw');
      const n = needN ? normalize(gray, w, h) : null;
      const texts = [];
      const confs = [];
      for (let i = 0; i < passes.length; i++) {
        postMessage({ type: 'progress', stage: 'pass', value: i / passes.length });
        const img = passes[i].layer === 'raw' ? gray : layer(n, passes[i]);
        writePgm(img, w, h);
        const r = run(passes[i].psm || psm || 6);
        texts.push(r.text);
        confs.push(r.confidence);
      }
      postMessage({ type: 'result', id, texts, confs });
      return;
    }
    M.FS.writeFile('/input', new Uint8Array(data.image));
    const r = run(psm);
    postMessage({ type: 'result', id, text: r.text, confidence: r.confidence });
  } catch (e) {
    if (!(M && api)) ready = null;
    postMessage({ type: 'error', id, error: String((e && e.message) || e) });
  }
};
