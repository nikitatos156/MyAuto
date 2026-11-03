// Сканер документов «как Adobe Scan»: поиск краёв листа, выравнивание перспективы,
// удаление теней и выравнивание фона, ч/б или цветной режим, компактный JPEG.
// Всё считается на устройстве, без сторонних библиотек.

export type Pt = { x: number; y: number };
export type ScanMode = 'bw' | 'color' | 'original';

const MAX_SOURCE = 4000; // ограничение исходника по длинной стороне (память телефона)

export async function loadImageCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode(); // браузер сам учитывает EXIF-поворот
    const k = Math.min(1, MAX_SOURCE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

// ---------- поиск документа ----------
function grayscaleSmall(src: HTMLCanvasElement, maxSide: number) {
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.max(8, Math.round(src.width * k));
  const h = Math.max(8, Math.round(src.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  return { g, w, h, k };
}

function boxBlur(a: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(a.length);
  const out = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / (2 * r + 1);
      s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / (2 * r + 1);
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function otsu(a: Float32Array) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < a.length; i++) hist[Math.max(0, Math.min(255, a[i] | 0))]++;
  const total = a.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** Крупнейшая связная область маски; возвращает индексы пикселей и касается ли она краёв кадра. */
function largestComponent(mask: Uint8Array, w: number, h: number) {
  const label = new Int32Array(w * h);
  let bestPixels: number[] = [];
  let bestBorder = 0;
  let cur = 0;
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i]) continue;
    cur++;
    const pixels: number[] = [];
    let border = 0;
    stack.push(i);
    label[i] = cur;
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border++;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && mask[q] && !label[q]) {
          label[q] = cur;
          stack.push(q);
        }
      }
    }
    if (pixels.length > bestPixels.length) {
      bestPixels = pixels;
      bestBorder = border;
    }
  }
  return { pixels: bestPixels, border: bestBorder };
}

const area = (q: Pt[]) => {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
};

function isConvex(q: Pt[]) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Углы по крайним точкам области; перебираем поворот осей и берём четырёхугольник наибольшей площади. */
function quadFromPixels(pixels: number[], w: number): Pt[] | null {
  // берём только граничные точки для скорости
  const pts: Pt[] = [];
  const step = Math.max(1, Math.floor(pixels.length / 6000));
  for (let i = 0; i < pixels.length; i += step) {
    const p = pixels[i];
    pts.push({ x: p % w, y: Math.floor(p / w) });
  }
  let best: Pt[] | null = null;
  let bestA = 0;
  for (let deg = 0; deg < 90; deg += 7.5) {
    const t = (deg * Math.PI) / 180;
    const c = Math.cos(t), s = Math.sin(t);
    let a = Infinity, b = -Infinity, cc = Infinity, d = -Infinity;
    let pa = pts[0], pb = pts[0], pc = pts[0], pd = pts[0];
    for (const p of pts) {
      const u = p.x * c + p.y * s;
      const v = -p.x * s + p.y * c;
      if (u + v < a) { a = u + v; pa = p; }
      if (u + v > b) { b = u + v; pb = p; }
      if (u - v < cc) { cc = u - v; pc = p; }
      if (u - v > d) { d = u - v; pd = p; }
    }
    const q = orderQuad([pa, pd, pb, pc]);
    const ar = area(q);
    if (ar > bestA && isConvex(q)) {
      bestA = ar;
      best = q;
    }
  }
  return best;
}

/** Упорядочить углы: левый верхний, правый верхний, правый нижний, левый нижний. */
export function orderQuad(q: Pt[]): Pt[] {
  const cx = q.reduce((s, p) => s + p.x, 0) / q.length;
  const cy = q.reduce((s, p) => s + p.y, 0) / q.length;
  const sorted = [...q].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // начинаем с точки с минимальной суммой x+y (левый верхний)
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
}

export function fullQuad(c: { width: number; height: number }, inset = 0): Pt[] {
  const dx = c.width * inset, dy = c.height * inset;
  return [
    { x: dx, y: dy },
    { x: c.width - dx, y: dy },
    { x: c.width - dx, y: c.height - dy },
    { x: dx, y: c.height - dy },
  ];
}

/** Найти лист на фото. Возвращает углы в координатах исходника или null. */
export function detectQuad(src: HTMLCanvasElement): Pt[] | null {
  const { g, w, h, k } = grayscaleSmall(src, 360);
  const b = boxBlur(boxBlur(g, w, h, 2), w, h, 2);
  const total = w * h;
  const tries: Uint8Array[] = [];
  const thr = otsu(b);
  const bright = new Uint8Array(total);
  const dark = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    bright[i] = b[i] > thr ? 1 : 0;
    dark[i] = b[i] <= thr ? 1 : 0;
  }
  tries.push(bright, dark);
  let best: Pt[] | null = null;
  let bestScore = 0;
  for (const m of tries) {
    const { pixels, border } = largestComponent(m, w, h);
    const frac = pixels.length / total;
    if (frac < 0.12 || frac > 0.97) continue;
    const borderFrac = border / (2 * (w + h));
    if (borderFrac > 0.6) continue; // это фон, а не лист
    const q = quadFromPixels(pixels, w);
    if (!q) continue;
    const ar = area(q) / total;
    // доля заполнения четырёхугольника областью — насколько она «прямоугольная»
    const fill = pixels.length / Math.max(1, area(q));
    const score = ar * Math.min(1, fill) * (1 - borderFrac);
    if (ar > 0.12 && fill > 0.7 && score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  if (!best) return null;
  return best.map((p) => ({ x: Math.min(src.width, Math.max(0, (p.x + 0.5) / k)), y: Math.min(src.height, Math.max(0, (p.y + 0.5) / k)) }));
}

// ---------- перспектива ----------
function solve(A: number[][], bv: number[]): number[] {
  const n = bv.length;
  const M = A.map((r, i) => [...r, bv[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let j = c; j <= n; j++) M[c][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (!f) continue;
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r) => r[n]);
}

/** Гомография: точки прямоугольника назначения → углы на исходнике. */
function homography(dst: Pt[], src: Pt[]) {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i];
    const { x, y } = src[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  return solve(A, b);
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function warp(src: HTMLCanvasElement, quadIn: Pt[], maxLong = 2200, maxShort = 1500): HTMLCanvasElement {
  const q = orderQuad(quadIn);
  let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxLong / Math.max(W, H), maxShort / Math.min(W, H));
  W = Math.max(16, Math.round(W * k));
  H = Math.max(16, Math.round(H * k));
  const h = homography(
    [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ],
    q,
  );
  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  const sd = sctx.getImageData(0, 0, src.width, src.height).data;
  const sw = src.width, sh = src.height;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(W, H);
  const od = img.data;
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const den = h[6] * u + h[7] * v + 1;
      let x = (h[0] * u + h[1] * v + h[2]) / den;
      let y = (h[3] * u + h[4] * v + h[5]) / den;
      x = Math.min(sw - 1.001, Math.max(0, x));
      y = Math.min(sh - 1.001, Math.max(0, y));
      const x0 = x | 0, y0 = y | 0;
      const fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (v * W + u) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx;
        const bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
        od[o + c] = top + (bot - top) * fy;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// ---------- улучшение ----------
/** Оценка освещённости (фон без текста) — для удаления теней. */
function backgroundMap(L: Float32Array, w: number, h: number) {
  const s = Math.max(4, Math.round(Math.max(w, h) / 90));
  const bw = Math.ceil(w / s), bh = Math.ceil(h / s);
  const small = new Float32Array(bw * bh);
  // максимум в блоке — убирает тёмный текст
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let m = 0;
      for (let y = by * s; y < Math.min(h, (by + 1) * s); y++)
        for (let x = bx * s; x < Math.min(w, (bx + 1) * s); x++) if (L[y * w + x] > m) m = L[y * w + x];
      small[by * bw + bx] = m;
    }
  // ещё одна дилатация 3x3 и размытие
  const dil = new Float32Array(small.length);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(bw - 1, Math.max(0, x + dx)), yy = Math.min(bh - 1, Math.max(0, y + dy));
          m = Math.max(m, small[yy * bw + xx]);
        }
      dil[y * bw + x] = m;
    }
  const blur = boxBlur(dil, bw, bh, 2);
  return { blur, bw, bh, s };
}

function sampleBg(bg: ReturnType<typeof backgroundMap>, x: number, y: number) {
  const { blur, bw, bh, s } = bg;
  const fx = Math.min(bw - 1.001, Math.max(0, x / s - 0.5));
  const fy = Math.min(bh - 1.001, Math.max(0, y / s - 0.5));
  const x0 = fx | 0, y0 = fy | 0;
  const ax = fx - x0, ay = fy - y0;
  const x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1);
  const t = blur[y0 * bw + x0] + (blur[y0 * bw + x1] - blur[y0 * bw + x0]) * ax;
  const b = blur[y1 * bw + x0] + (blur[y1 * bw + x1] - blur[y1 * bw + x0]) * ax;
  return t + (b - t) * ay;
}

export function enhance(src: HTMLCanvasElement, mode: ScanMode): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  if (mode === 'original') {
    octx.drawImage(src, 0, 0);
    return out;
  }
  const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h);
  const p = d.data;
  const L = new Float32Array(w * h);
  for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = 0.299 * p[j] + 0.587 * p[j + 1] + 0.114 * p[j + 2];
  const bg = backgroundMap(L, w, h);
  if (mode === 'bw') {
    // уровни подбираем по распределению отношения «пиксель / фон»
    const lo = 0.5, hi = 0.88;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const r = L[i] / Math.max(24, sampleBg(bg, x, y));
        let v = (r - lo) / (hi - lo);
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        v = Math.pow(v, 1.6) * 255; // плотнее текст
        const j = i * 4;
        p[j] = p[j + 1] = p[j + 2] = v;
      }
  } else {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const k = 255 / Math.max(40, sampleBg(bg, x, y));
        const j = i * 4;
        for (let c = 0; c < 3; c++) {
          let v = (p[j + c] * k - 30) * 1.12; // белый фон и немного контраста
          p[j + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
  }
  octx.putImageData(d, 0, 0);
  return out;
}

export function rotate(src: HTMLCanvasElement, dir: 1 | -1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.height;
  c.height = src.width;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((dir * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Итоговый файл: ч/б — сильнее сжатие, цвет — помягче. Длинная сторона до 2000 px. */
export function encode(c: HTMLCanvasElement, mode: ScanMode): Promise<Blob> {
  const k = Math.min(1, 2000 / Math.max(c.width, c.height), 1400 / Math.min(c.width, c.height));
  let out = c;
  if (k < 1) {
    out = document.createElement('canvas');
    out.width = Math.round(c.width * k);
    out.height = Math.round(c.height * k);
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, out.width, out.height);
  }
  const q = mode === 'bw' ? 0.6 : mode === 'color' ? 0.68 : 0.72;
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось сохранить изображение'))), 'image/jpeg', q));
}

/** Уменьшенная копия (для показа и сохранения), большие стороны ≤ max. */
export function downscale(src: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  if (k === 1) return src;
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k);
  c.height = Math.round(src.height * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Картинка для распознавания текста (ч/б, PNG). */
export function forOcr(warped: HTMLCanvasElement): Promise<Blob> {
  const bw = enhance(warped, 'bw');
  return new Promise((resolve, reject) => bw.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}
