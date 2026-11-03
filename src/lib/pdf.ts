// PDF-отчёты по ТО (jsPDF + шрифт DejaVu Sans с кириллицей). Загружается по требованию.
// @ts-ignore — UMD-сборка jsPDF
import * as JSPDF from '../vendor/jspdf.umd.min.cjs';
// @ts-ignore
import fontRegular from '../vendor/fonts/DejaVuSans.ttf';
// @ts-ignore
import fontBold from '../vendor/fonts/DejaVuSans-Bold.ttf';
import { getAttachment } from './attachments';
import { dateShort, km, money, num } from './format';
import { partsTotal, serviceTotal, worksTotal } from '../data/logic';
import type { Car, DocEntry, ServiceEntry } from '../data/types';

const jsPDF: any = (JSPDF as any).jsPDF || (JSPDF as any).default?.jsPDF || (JSPDF as any).default;

const M = 14; // поля, мм
const ACCENT: [number, number, number] = [232, 89, 12];
const INK: [number, number, number] = [22, 24, 29];
const MUTED: [number, number, number] = [110, 114, 122];
const LINE: [number, number, number] = [220, 218, 212];

const KIND: Record<string, string> = { to: 'Плановое ТО', repair: 'Ремонт', other: 'Прочее' };

interface Col {
  title: string;
  w: number; // доля ширины
  align?: 'left' | 'right' | 'center';
}

function createDoc() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('DejaVuSans.ttf', fontRegular);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fontBold);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  doc.setLineHeightFactor(1.25);
  return doc;
}

class Writer {
  doc: any;
  y = M;
  W: number;
  H: number;
  constructor(doc: any) {
    this.doc = doc;
    this.W = doc.internal.pageSize.getWidth();
    this.H = doc.internal.pageSize.getHeight();
  }
  get inner() {
    return this.W - M * 2;
  }
  ensure(h: number) {
    if (this.y + h > this.H - M - 8) {
      this.doc.addPage();
      this.y = M;
      return true;
    }
    return false;
  }
  text(s: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number; x?: number; maxW?: number } = {}) {
    const { size = 10, bold = false, color = INK, gap = 1.5, x = M, maxW = this.inner } = opts;
    this.doc.setFont('DejaVu', bold ? 'bold' : 'normal');
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
    const lines = this.doc.splitTextToSize(s, maxW);
    const lh = (size * 0.3528) * 1.25;
    this.ensure(lines.length * lh);
    this.doc.text(lines, x, this.y + size * 0.3528);
    this.y += lines.length * lh + gap;
  }
  rule(color = LINE, w = 0.2) {
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(w);
    this.doc.line(M, this.y, this.W - M, this.y);
    this.y += 2;
  }
  kv(pairs: [string, string][], cols = 2) {
    const colW = this.inner / cols;
    const size = 9;
    const lh = size * 0.3528 * 1.25;
    for (let i = 0; i < pairs.length; i += cols) {
      const row = pairs.slice(i, i + cols);
      let rowH = 0;
      const prepared = row.map(([k, v]) => {
        this.doc.setFontSize(size);
        const lines = this.doc.splitTextToSize(v || '—', colW - 4);
        rowH = Math.max(rowH, lh + lines.length * lh);
        return { k, lines };
      });
      this.ensure(rowH + 1);
      prepared.forEach((p, j) => {
        const x = M + j * colW;
        this.doc.setFont('DejaVu', 'normal');
        this.doc.setFontSize(7.5);
        this.doc.setTextColor(...MUTED);
        this.doc.text(p.k.toUpperCase(), x, this.y + 2.6);
        this.doc.setFontSize(size);
        this.doc.setTextColor(...INK);
        this.doc.text(p.lines, x, this.y + 2.6 + lh);
      });
      this.y += rowH + 1.5;
    }
  }
  table(cols: Col[], rows: string[][], opts: { total?: string[]; zebra?: boolean } = {}) {
    const size = 8.5;
    const lh = size * 0.3528 * 1.3;
    const pad = 1.6;
    const widths = cols.map((c) => c.w * this.inner);
    const drawHeader = () => {
      this.doc.setFillColor(244, 243, 239);
      this.doc.rect(M, this.y, this.inner, lh + pad * 2, 'F');
      this.doc.setFont('DejaVu', 'bold');
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(...MUTED);
      let x = M;
      cols.forEach((c, i) => {
        const tx = c.align === 'right' ? x + widths[i] - pad : c.align === 'center' ? x + widths[i] / 2 : x + pad;
        this.doc.text(c.title.toUpperCase(), tx, this.y + pad + lh * 0.75, { align: c.align || 'left' });
        x += widths[i];
      });
      this.y += lh + pad * 2;
    };
    this.ensure(lh * 3 + pad * 4);
    drawHeader();
    const drawRow = (r: string[], bold = false, fill = false) => {
      this.doc.setFont('DejaVu', bold ? 'bold' : 'normal');
      this.doc.setFontSize(size);
      const cells = r.map((v, i) => this.doc.splitTextToSize(v ?? '', widths[i] - pad * 2));
      const h = Math.max(...cells.map((c: string[]) => c.length)) * lh + pad * 2;
      if (this.ensure(h)) drawHeader();
      if (fill) {
        this.doc.setFillColor(250, 249, 246);
        this.doc.rect(M, this.y, this.inner, h, 'F');
      }
      this.doc.setFont('DejaVu', bold ? 'bold' : 'normal');
      this.doc.setFontSize(size);
      this.doc.setTextColor(...INK);
      let x = M;
      cells.forEach((lines: string[], i: number) => {
        const c = cols[i];
        const tx = c.align === 'right' ? x + widths[i] - pad : c.align === 'center' ? x + widths[i] / 2 : x + pad;
        this.doc.text(lines, tx, this.y + pad + lh * 0.75, { align: c.align || 'left' });
        x += widths[i];
      });
      this.y += h;
      this.doc.setDrawColor(...LINE);
      this.doc.setLineWidth(0.15);
      this.doc.line(M, this.y, this.W - M, this.y);
    };
    rows.forEach((r, i) => drawRow(r, false, opts.zebra !== false && i % 2 === 1));
    if (opts.total) drawRow(opts.total, true);
    this.y += 3;
  }
  async image(blob: Blob, caption?: string) {
    const dataUrl: string = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const maxW = this.inner;
    const maxH = (this.H - M * 2) * 0.62;
    let w = maxW;
    let h = (img.naturalHeight / img.naturalWidth) * w;
    if (h > maxH) {
      h = maxH;
      w = (img.naturalWidth / img.naturalHeight) * h;
    }
    this.ensure(h + 8);
    if (caption) this.text(caption, { size: 8, color: MUTED, gap: 1 });
    const fmt = blob.type.includes('png') ? 'PNG' : 'JPEG';
    this.doc.addImage(dataUrl, fmt, M, this.y, w, h, undefined, 'FAST');
    this.doc.setDrawColor(...LINE);
    this.doc.rect(M, this.y, w, h);
    this.y += h + 5;
  }
}

function header(w: Writer, title: string, car: Car, plate?: string) {
  const d = w.doc;
  d.setFillColor(...ACCENT);
  d.rect(0, 0, w.W, 3, 'F');
  w.y = M;
  w.text('MY AUTO', { size: 7.5, bold: true, color: ACCENT, gap: 1 });
  w.text(title, { size: 17, bold: true, gap: 2 });
  const spec = [car.year, car.body, [car.engine, car.engineCode].filter(Boolean).join(' '), car.power ? `${car.power} л.с.` : '', car.drive]
    .filter(Boolean)
    .join(' · ');
  w.text(`${car.make} ${car.model}`, { size: 11.5, bold: true, gap: 0.5 });
  w.text(spec, { size: 9, color: MUTED, gap: 2 });
  w.kv(
    [
      ['VIN', car.vin || '—'],
      ['Госномер', plate || '—'],
      ['Сформирован', dateShort(Date.now())],
      ['Интервал ТО', `${num(car.serviceIntervalKm)} км / ${car.serviceIntervalMonths} мес.`],
    ],
    4,
  );
  w.rule(INK, 0.4);
  w.y += 1;
}

async function entryBlock(w: Writer, s: ServiceEntry, withReceipts: boolean) {
  w.ensure(30);
  const title =
    s.kind === 'to' ? `ТО-${s.number ?? '?'}${s.title ? ' · ' + s.title : ''}` : `${KIND[s.kind] || 'Работы'}${s.title ? ' · ' + s.title : ''}`;
  w.text(title, { size: 13, bold: true, gap: 1 });
  w.kv(
    [
      ['Дата', dateShort(s.date)],
      ['Пробег', s.mileage ? km(s.mileage) : '—'],
      ['Сервис', s.station || '—'],
      ['Итого', money(serviceTotal(s), true)],
    ],
    4,
  );
  if (s.works.length) {
    w.text('Работы', { size: 9.5, bold: true, gap: 1.2 });
    w.table(
      [
        { title: '№', w: 0.06, align: 'center' },
        { title: 'Наименование', w: 0.74 },
        { title: 'Стоимость', w: 0.2, align: 'right' },
      ],
      s.works.map((x, i) => [String(i + 1), x.name, money(x.price, true)]),
      { total: ['', 'Итого работы', money(worksTotal(s), true)] },
    );
  }
  if (s.parts.length) {
    w.text('Запчасти и материалы', { size: 9.5, bold: true, gap: 1.2 });
    w.table(
      [
        { title: '№', w: 0.05, align: 'center' },
        { title: 'Наименование', w: 0.36 },
        { title: 'Артикул / бренд', w: 0.21 },
        { title: 'Кол-во', w: 0.09, align: 'right' },
        { title: 'Цена', w: 0.13, align: 'right' },
        { title: 'Сумма', w: 0.16, align: 'right' },
      ],
      s.parts.map((p, i) => [
        String(i + 1),
        p.name,
        [p.partNumber, p.brand].filter(Boolean).join(' · ') || '—',
        num(p.qty, 2).replace(/,00$/, ''),
        money(p.price, true),
        money((p.price || 0) * (p.qty || 1), true),
      ]),
      { total: ['', 'Итого запчасти', '', '', '', money(partsTotal(s), true)] },
    );
  }
  if (s.notes) {
    w.text('Примечания', { size: 9, bold: true, gap: 0.8 });
    w.text(s.notes, { size: 9, color: INK, gap: 2 });
  }
  if (s.nextMileage || s.nextDate) {
    w.text(
      `Следующее ТО: ${[s.nextMileage ? km(s.nextMileage) : '', s.nextDate ? 'до ' + dateShort(s.nextDate) : ''].filter(Boolean).join(', ')}`,
      { size: 9, color: MUTED, gap: 2 },
    );
  }
  if (withReceipts && s.attachments.length) {
    let i = 0;
    for (const id of s.attachments) {
      const a = await getAttachment(id);
      if (!a) continue;
      i++;
      if (a.type.startsWith('image/')) {
        await w.image(a.blob, `Чек ${i}${s.kind === 'to' ? ` к ТО-${s.number ?? ''}` : ''} · ${a.name}`);
      } else {
        w.text(`Вложение ${i}: ${a.name} (PDF-файл хранится в приложении)`, { size: 8.5, color: MUTED });
      }
    }
  }
  w.y += 2;
  w.rule();
  w.y += 2;
}

function footer(doc: any) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('DejaVu', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    doc.text('My Auto — учёт обслуживания автомобиля', M, H - 7);
    doc.text(`Стр. ${i} из ${n}`, W - M, H - 7, { align: 'right' });
  }
}

export async function serviceReportPdf(args: {
  car: Car;
  entries: ServiceEntry[];
  docs?: DocEntry[];
  withReceipts?: boolean;
  single?: boolean;
}): Promise<Blob> {
  const { car, entries, docs = [], withReceipts = true, single } = args;
  const doc = createDoc();
  const w = new Writer(doc);
  const grz = docs.find((d) => d.type === 'grz' && d.status === 'active' && d.carId === car.id);
  const plate = grz?.number ? `${grz.number}${grz.region ? ' ' + grz.region : ''}` : undefined;
  const sorted = [...entries].sort((a, b) => a.date - b.date || (a.mileage || 0) - (b.mileage || 0));
  header(w, single ? 'Заказ-наряд / отчёт о ТО' : 'История технического обслуживания', car, plate);

  if (!single) {
    const total = sorted.reduce((a, s) => a + serviceTotal(s), 0);
    w.kv(
      [
        ['Записей', String(sorted.length)],
        ['Плановых ТО', String(sorted.filter((s) => s.kind === 'to').length)],
        ['Период', sorted.length ? `${dateShort(sorted[0].date)} — ${dateShort(sorted[sorted.length - 1].date)}` : '—'],
        ['Всего потрачено', money(total)],
      ],
      4,
    );
    w.text('Сводка', { size: 11, bold: true, gap: 1.5 });
    w.table(
      [
        { title: 'ТО', w: 0.09, align: 'center' },
        { title: 'Дата', w: 0.13 },
        { title: 'Пробег', w: 0.14, align: 'right' },
        { title: 'Вид / сервис', w: 0.32 },
        { title: 'Работы', w: 0.11, align: 'right' },
        { title: 'Запчасти', w: 0.11, align: 'right' },
        { title: 'Итого', w: 0.1, align: 'right' },
      ],
      sorted.map((s) => [
        s.kind === 'to' ? String(s.number ?? '—') : '—',
        dateShort(s.date),
        s.mileage ? num(s.mileage) : '—',
        [KIND[s.kind], s.title, s.station].filter(Boolean).join(' · '),
        num(worksTotal(s)),
        num(partsTotal(s)),
        num(serviceTotal(s)),
      ]),
      {
        total: [
          '',
          '',
          '',
          'Итого, ₽',
          num(sorted.reduce((a, s) => a + worksTotal(s), 0)),
          num(sorted.reduce((a, s) => a + partsTotal(s), 0)),
          num(total),
        ],
      },
    );
    w.y += 2;
    w.text('Подробно', { size: 11, bold: true, gap: 2 });
  }
  for (const s of single ? sorted : [...sorted].reverse()) await entryBlock(w, s, withReceipts);
  footer(doc);
  return doc.output('blob');
}

// ---------- отчёт о расходах ----------
export interface ExpenseReportArgs {
  title: string; // «Volkswagen Polo» или «Все машины»
  periodLabel: string;
  summary: { total: number; perMonth: number; distance?: number; perKm?: number; liters: number };
  cats: { label: string; amount: number; count: number; color: [number, number, number] }[];
  months: { title: string; byCat: number[]; total: number }[];
  items: { date: number; cat: string; car?: string; title: string; amount: number }[];
}

export async function expensesReportPdf(a: ExpenseReportArgs): Promise<Blob> {
  const doc = createDoc();
  const w = new Writer(doc);
  w.text('Расходы на автомобиль', { size: 18, bold: true, gap: 1 });
  w.text(`${a.title} · ${a.periodLabel}`, { size: 11, color: MUTED, gap: 3 });
  w.rule(ACCENT, 0.6);
  w.kv(
    [
      ['Всего', money(a.summary.total)],
      ['В среднем в месяц', money(Math.round(a.summary.perMonth))],
      ['Пробег за период', a.summary.distance ? km(a.summary.distance) : '—'],
      ['Стоимость 1 км', a.summary.perKm ? `${num(a.summary.perKm, 2)} ₽` : '—'],
    ],
    4,
  );
  // доли по категориям — полосой
  const total = a.summary.total || 1;
  let x = M;
  w.ensure(12);
  for (const c of a.cats) {
    const cw = (c.amount / total) * w.inner;
    if (cw <= 0) continue;
    doc.setFillColor(...c.color);
    doc.rect(x, w.y, Math.max(0.3, cw - 0.6), 4, 'F');
    x += cw;
  }
  w.y += 7;
  w.table(
    [
      { title: 'Категория', w: 0.46 },
      { title: 'Записей', w: 0.14, align: 'right' },
      { title: 'Доля', w: 0.14, align: 'right' },
      { title: 'Сумма, ₽', w: 0.26, align: 'right' },
    ],
    a.cats.filter((c) => c.amount > 0).map((c) => [c.label, String(c.count), `${Math.round((c.amount / total) * 100)}%`, num(c.amount)]),
    { total: ['Итого', String(a.cats.reduce((s, c) => s + c.count, 0)), '100%', num(a.summary.total)] },
  );
  if (a.months.length > 1) {
    w.text('По месяцам', { size: 11, bold: true, gap: 1.5 });
    const share = 0.62 / a.cats.length;
    w.table(
      [{ title: 'Период', w: 0.2 }, ...a.cats.map((c) => ({ title: c.label, w: share, align: 'right' as const })), { title: 'Итого', w: 0.18, align: 'right' }],
      a.months.filter((m) => m.total > 0).map((m) => [m.title, ...m.byCat.map((v) => (v ? num(v) : '—')), num(m.total)]),
    );
  }
  w.text('Все траты', { size: 11, bold: true, gap: 1.5 });
  w.table(
    [
      { title: 'Дата', w: 0.13 },
      { title: 'Категория', w: 0.16 },
      { title: 'Что', w: 0.53 },
      { title: 'Сумма, ₽', w: 0.18, align: 'right' },
    ],
    a.items.map((i) => [dateShort(i.date), i.cat, [i.car, i.title].filter(Boolean).join(' · '), num(i.amount)]),
  );
  footer(doc);
  return doc.output('blob');
}
