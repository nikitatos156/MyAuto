// QR-код кассового чека (ФНС): t=20251014T1842&s=3416.94&fn=…&i=…&fp=…&n=1 — точные дата и сумма без распознавания текста.
// Сначала системный BarcodeDetector (Android), иначе jsQR (грузится по требованию).

let jsqr: any = null;
async function loadJsQR() {
  if (!jsqr) {
    const m: any = await import('../vendor/jsqr.umd.cjs');
    jsqr = m.default || m;
  }
  return jsqr;
}

export interface FiscalQr {
  date?: number;
  total?: number;
  fn?: string; // номер фискального накопителя
  fd?: string; // номер фискального документа
  fp?: string; // фискальный признак
  kind?: number; // 1 — приход, 2 — возврат прихода
  raw: string;
}

export function parseFiscalQr(text: string): FiscalQr | null {
  const s = text.trim().replace(/^.*?\?/, '');
  if (!/(^|&)t=\d{8}T\d{4}/i.test(s) || !/(^|&)s=\d/.test(s)) return null;
  const p = new URLSearchParams(s);
  const out: FiscalQr = { raw: text };
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/i.exec(p.get('t') || '');
  if (t) {
    const d = new Date(+t[1], +t[2] - 1, +t[3], +t[4], +t[5]);
    if (!isNaN(d.getTime())) out.date = d.getTime();
  }
  const total = parseFloat((p.get('s') || '').replace(',', '.'));
  if (total > 0) out.total = Math.round(total * 100) / 100;
  out.fn = p.get('fn') || undefined;
  out.fd = p.get('i') || undefined;
  out.fp = p.get('fp') || undefined;
  const n = parseInt(p.get('n') || '', 10);
  if (n) out.kind = n;
  return out;
}

function scaled(src: HTMLCanvasElement, maxSide: number) {
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * k));
  c.height = Math.max(1, Math.round(src.height * k));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return { c, ctx };
}

/** Найти QR-код на изображении и вернуть его текст. */
export async function findQr(src: HTMLCanvasElement): Promise<string | null> {
  const BD = (globalThis as any).BarcodeDetector;
  if (BD) {
    try {
      const det = new BD({ formats: ['qr_code'] });
      const r = await det.detect(src);
      if (r?.[0]?.rawValue) return r[0].rawValue;
    } catch {
      /* нет поддержки форматов — пробуем jsQR */
    }
  }
  const decode = await loadJsQR();
  for (const side of [1400, 900, 2200]) {
    const { c, ctx } = scaled(src, side);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const r = decode(img.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
    if (r?.data) return r.data as string;
    if (Math.max(src.width, src.height) <= side) break;
  }
  return null;
}

/** QR чека на любой из страниц. */
export async function findReceiptQr(pages: HTMLCanvasElement[]): Promise<FiscalQr | null> {
  for (const p of pages) {
    try {
      const text = await findQr(p);
      const q = text ? parseFiscalQr(text) : null;
      if (q) return q;
    } catch (e) {
      console.warn('QR', e);
    }
  }
  return null;
}
