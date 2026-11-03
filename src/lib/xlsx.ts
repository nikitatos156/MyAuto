// Excel без сторонних библиотек: чтение .xlsx/.csv (импорт истории ТО) и запись .xlsx (отчёты).
import { readZip, writeZip } from './zip';

export type Cell = string | number | Date | null;
export interface Sheet {
  name: string;
  rows: Cell[][];
}

// ---------- чтение ----------
const xml = (bytes?: Uint8Array) => (bytes ? new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml') : null);
const kids = (el: Element | Document | null, tag: string) => (el ? Array.from(el.getElementsByTagName(tag)) : []);

function colIndex(ref: string) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
function isDateFormat(id: number, code?: string) {
  if (BUILTIN_DATE.has(id)) return true;
  if (!code) return false;
  const c = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dmyhs]/i.test(c) && !/0|#/.test(c.replace(/[dmyhs]/gi, ''));
}

export function excelDate(serial: number): Date {
  const ms = Math.round((serial - 25569) * 86400000);
  const u = new Date(ms);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes());
}

export async function readXlsx(file: Blob): Promise<Sheet[]> {
  const files = await readZip(file, (n) => n.startsWith('xl/'));
  const wb = xml(files.get('xl/workbook.xml'));
  if (!wb) throw new Error('В файле нет листов Excel');
  const rels = xml(files.get('xl/_rels/workbook.xml.rels'));
  const relMap = new Map(kids(rels, 'Relationship').map((r) => [r.getAttribute('Id') || '', r.getAttribute('Target') || '']));
  const shared = kids(xml(files.get('xl/sharedStrings.xml')), 'si').map((si) => kids(si, 't').map((t) => t.textContent || '').join(''));
  const styles = xml(files.get('xl/styles.xml'));
  const fmts = new Map(kids(styles, 'numFmt').map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') || '']));
  const cellXfs = styles ? kids(styles, 'cellXfs')[0] : null;
  const dateStyle = (cellXfs ? kids(cellXfs, 'xf') : []).map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') || 0);
    return isDateFormat(id, fmts.get(id));
  });
  const out: Sheet[] = [];
  for (const s of kids(wb, 'sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || '';
    let target = relMap.get(rid) || '';
    if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const doc = xml(files.get(target));
    if (!doc) continue;
    const rows: Cell[][] = [];
    for (const row of kids(doc, 'row')) {
      const r = Number(row.getAttribute('r') || rows.length + 1) - 1;
      const cells: Cell[] = [];
      for (const c of kids(row, 'c')) {
        const ref = c.getAttribute('r');
        const ci = ref ? colIndex(ref) : cells.length;
        const t = c.getAttribute('t');
        const v = kids(c, 'v')[0]?.textContent ?? null;
        let val: Cell = null;
        if (t === 's') val = v != null ? shared[Number(v)] ?? '' : '';
        else if (t === 'inlineStr') val = kids(c, 't').map((x) => x.textContent || '').join('');
        else if (t === 'str' || t === 'e') val = v ?? '';
        else if (t === 'b') val = v === '1' ? 'да' : 'нет';
        else if (t === 'd') val = v ? new Date(v) : null;
        else if (v != null && v !== '') {
          const n = Number(v);
          val = dateStyle[Number(c.getAttribute('s') || 0)] && n > 59 && n < 2958466 ? excelDate(n) : n;
        }
        if (typeof val === 'string') val = val.trim() || null;
        cells[ci] = val;
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
      rows[r] = cells;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    out.push({ name: s.getAttribute('name') || `Лист ${out.length + 1}`, rows });
  }
  return out;
}

/** CSV: разделитель «;», «,» или табуляция; кодировка UTF-8 или Windows-1251. */
export async function readCsv(file: Blob): Promise<Sheet[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf);
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cur = '';
  let q = false;
  const push = () => {
    const v = cur.trim();
    row.push(v === '' ? null : v);
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) push();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      push();
      rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur || row.length) {
    push();
    rows.push(row);
  }
  return [{ name: 'CSV', rows }];
}

export async function readSpreadsheet(file: File): Promise<Sheet[]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return readCsv(file);
  if (/\.xls$/i.test(file.name)) throw new Error('Старый формат .xls не поддерживается — сохраните файл в Excel как .xlsx');
  return readXlsx(file);
}

// ---------- запись ----------
export type OutCell = Cell | { v: Cell; style?: 'bold' | 'money' | 'int' | 'date' | 'boldMoney' };
export interface OutSheet {
  name: string;
  rows: OutCell[][];
  widths?: number[];
  freezeHeader?: boolean;
}

const STYLE_ID = { bold: 1, date: 2, money: 3, int: 4, boldMoney: 5 } as const;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i: number) => {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};
const toSerial = (d: Date) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 86400000) + 25569;

function sheetXml(s: OutSheet) {
  const rows = s.rows
    .map((row, ri) => {
      const cells = row
        .map((raw, ci) => {
          const cell = raw && typeof raw === 'object' && !(raw instanceof Date) ? raw : { v: raw as Cell };
          const v = cell.v;
          if (v == null || v === '') return '';
          const ref = colName(ci) + (ri + 1);
          let style = cell.style ? STYLE_ID[cell.style] : 0;
          if (v instanceof Date) return `<c r="${ref}" s="${STYLE_ID.date}"><v>${toSerial(v)}</v></c>`;
          if (typeof v === 'number') return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
          if (style === STYLE_ID.money || style === STYLE_ID.int) style = 0;
          return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  const cols = s.widths?.length ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const view = s.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

export function writeXlsx(sheets: OutSheet[]): Blob {
  const enc = new TextEncoder();
  const names = sheets.map((s, i) => (s.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || `Лист${i + 1}`));
  const files = [
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })),
  ];
  const blob = writeZip(files.map((f) => ({ name: f.name, data: enc.encode(f.text) })));
  return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Значение ячейки как текст (для сопоставления колонок и превью). */
export function cellText(c: Cell | undefined): string {
  if (c == null) return '';
  if (c instanceof Date) return c.toLocaleDateString('ru-RU');
  return String(c);
}
