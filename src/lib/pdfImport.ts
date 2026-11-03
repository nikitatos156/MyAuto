// PDF из почты (электронные чеки, полисы ОСАГО/КАСКО, постановления): текстовый слой через pdf.js,
// а если текста нет (скан) — страницы рисуются в картинки для распознавания. Библиотека грузится по требованию.
// Файлы pdf.js лежат с расширением .js (не .mjs): так их MIME-тип верно отдают и GitHub Pages, и WebView Android.

let lib: any = null;
const base = () => new URL('pdfjs/', document.baseURI).href;

async function pdfjs() {
  if (lib) return lib;
  const url = base() + 'pdf.min.js';
  lib = await import(/* @vite-ignore */ url);
  lib.GlobalWorkerOptions.workerSrc = base() + 'pdf.worker.min.js';
  return lib;
}

export const isPdf = (f: Blob & { name?: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');

export interface PdfContent {
  text: string; // текстовый слой (строки собраны по координатам)
  pages: HTMLCanvasElement[]; // картинки страниц — если текста нет
  pageCount: number;
}

export async function readPdf(file: Blob, opts: { maxPages?: number; renderIfNoText?: boolean } = {}): Promise<PdfContent> {
  const { maxPages = 3, renderIfNoText = true } = opts;
  const pdf = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdf.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const n = Math.min(doc.numPages, maxPages);
  const textParts: string[] = [];
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // группируем фрагменты в строки по вертикали
    const items = (tc.items as any[])
      .filter((it) => typeof it.str === 'string' && it.str.trim())
      .map((it) => ({ s: it.str as string, x: it.transform[4] as number, y: it.transform[5] as number, w: (it.width as number) || 0, h: Math.abs(it.transform[3] || it.height || 10) }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: { y: number; h: number; parts: typeof items }[] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r.y - it.y) < Math.max(2, Math.min(r.h, it.h) * 0.5));
      if (row) row.parts.push(it);
      else rows.push({ y: it.y, h: it.h, parts: [it] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      // колонки таблиц (заказ-наряды, чеки) разделяем несколькими пробелами, слова — одним
      let line = '';
      let end = -Infinity;
      for (const p of r.parts) {
        const gap = p.x - end;
        if (line) line += gap > p.h * 0.9 ? '   ' : gap > p.h * 0.12 || /\S$/.test(line) && /^\S/.test(p.s) && gap > 0 ? ' ' : '';
        line += p.s;
        end = p.x + p.w;
      }
      textParts.push(line.replace(/[ \t]{3,}/g, '   ').replace(/(\S) {2}(?=\S)/g, '$1 ').trim());
    }
    textParts.push('');
  }
  const text = textParts.join('\n').trim();
  const pages: HTMLCanvasElement[] = [];
  if (renderIfNoText && text.replace(/\s/g, '').length < 40) {
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(3, 2200 / Math.max(vp1.width, vp1.height));
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      pages.push(c);
    }
  }
  await doc.destroy?.();
  return { text, pages, pageCount: doc.numPages };
}
