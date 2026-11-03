// Импорт истории ТО из Excel (.xlsx) или CSV: колонки сопоставляются автоматически (можно поправить),
// строки группируются в записи по дате/пробегу, перед загрузкой — предпросмотр.
import React, { useMemo, useRef, useState } from 'react';
import { LuFileSpreadsheet, LuUpload } from 'react-icons/lu';
import { getAll, putMany, stamp, uid, useQuery } from '../data/db';
import { serviceTotal } from '../data/logic';
import type { ServiceEntry, ServiceKind, ServicePart, ServiceWork } from '../data/types';
import { dateShort, km, money, plural, startOfDay } from '../lib/format';
import { refreshReminders } from '../lib/notify';
import { cellText, readSpreadsheet, type Cell, type Sheet } from '../lib/xlsx';
import { useApp } from '../state';
import { Badge, Button, Card, Chips, Field, Page, Row, Section, Select, go, toast } from '../ui/kit';

type Key = 'date' | 'mileage' | 'number' | 'kind' | 'name' | 'partNumber' | 'brand' | 'qty' | 'price' | 'sum' | 'station' | 'notes';
const FIELDS: { key: Key; label: string; re: RegExp }[] = [
  { key: 'date', label: 'Дата', re: /дата|date/i },
  { key: 'number', label: 'Номер ТО', re: /(№|номер|n)\s*то(?![а-яё])|^то\s*(№|n)?$|^то-?\s*№?$/i },
  { key: 'mileage', label: 'Пробег', re: /пробег|одометр|^км$|mileage/i },
  { key: 'kind', label: 'Вид (ТО / ремонт)', re: /^(вид|тип|категория)/i },
  { key: 'partNumber', label: 'Артикул', re: /артикул|каталож|номер\s+(детали|запчасти)|^код|oem|p\/n/i },
  { key: 'brand', label: 'Бренд', re: /бренд|производител/i },
  { key: 'qty', label: 'Кол-во', re: /^кол|количеств|qty/i },
  { key: 'price', label: 'Цена за ед.', re: /^цена|за\s*ед/i },
  { key: 'sum', label: 'Сумма', re: /сумм|стоимост|итог|всего|руб|₽|цена/i },
  { key: 'name', label: 'Работа / запчасть', re: /наимен|работ|описан|операц|детал|запчаст|позици|что\s+дела|перечень|содержан/i },
  { key: 'station', label: 'Сервис', re: /сервис|^сто$|дилер|исполнит|где|место/i },
  { key: 'notes', label: 'Примечание', re: /примеч|коммент|заметк/i },
];

const PART_RE = /(масло|фильтр|свеч|колодк|диск|жидкост|прокладк|болт|шайб|пробк|антифриз|омыват|лампа|щетк|ремень|ролик|насос|амортиз|сайлент|втулк|подшипн|датчик|кольцо|уплотн|g\s?\d{3}|adblue|аккумулят)/i;
const WORK_RE = /(замен|сняти|установ|диагност|регулир|провер|ремонт|мойк|осмотр|развал|схожд|шиномонтаж|балансир|кодирован|адаптац|работ|обслуживан|монтаж)/i;

function toNumber(c: Cell): number | undefined {
  if (c == null || c instanceof Date) return undefined;
  if (typeof c === 'number') return c;
  const m = /-?\d[\d\s ]*(?:[.,]\d+)?/.exec(c.replace(/(?<=\d)\s(?=\d{3}\b)/g, ''));
  if (!m) return undefined;
  const n = parseFloat(m[0].replace(/[\s ]/g, '').replace(',', '.'));
  return isNaN(n) ? undefined : n;
}

function toDate(c: Cell): number | undefined {
  if (c == null) return undefined;
  if (c instanceof Date) return isNaN(c.getTime()) ? undefined : c.getTime();
  if (typeof c === 'number') return undefined;
  let m = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(c);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1], 12);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }
  m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(c);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime();
  return undefined;
}

type Mapping = Partial<Record<Key, number>>;

function detect(rows: Cell[][]): { header: number; map: Mapping } {
  let best = { header: 0, score: -1, map: {} as Mapping };
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r] || [];
    const map: Mapping = {};
    let score = 0;
    row.forEach((c, ci) => {
      if (typeof c !== 'string') return;
      const f = FIELDS.find((f) => map[f.key] === undefined && f.re.test(c.trim()));
      if (f) {
        map[f.key] = ci;
        score++;
      }
    });
    if (score > best.score) best = { header: r, score, map };
  }
  return { header: best.header, map: best.map };
}

interface Draft {
  date?: number;
  mileage?: number;
  number?: number;
  kind: ServiceKind;
  station?: string;
  notes: string[];
  works: ServiceWork[];
  parts: ServicePart[];
  row: number;
}

function buildDrafts(rows: Cell[][], header: number, map: Mapping): Draft[] {
  const get = (row: Cell[], k: Key) => (map[k] !== undefined ? row[map[k]!] ?? null : null);
  const out: Draft[] = [];
  let cur = null as Draft | null;
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (!row.some((c) => c != null && c !== '')) continue;
    const d = toDate(get(row, 'date'));
    const m = toNumber(get(row, 'mileage'));
    const kindText = cellText(get(row, 'kind')).toLowerCase();
    const numCell = get(row, 'number');
    const n = typeof numCell === 'number' ? numCell : toNumber(cellText(numCell).replace(/[^\d]/g, ' ').trim() || null);
    const isNew = !cur || (d !== undefined && startOfDay(d) !== startOfDay(cur.date || 0)) || (m !== undefined && m !== cur.mileage) || (n !== undefined && n !== cur.number);
    if (isNew && (d !== undefined || m !== undefined || n !== undefined || !cur)) {
      cur = { date: d ?? cur?.date, mileage: m, number: n && n < 100 ? Math.round(n) : undefined, kind: 'repair', notes: [], works: [], parts: [], row: r + 1 };
      if (/ремонт/.test(kindText)) cur.kind = 'repair';
      else if (/(^|\s)то(?![а-яё])|обслуж|регламент/.test(kindText) || cur.number) cur.kind = 'to';
      out.push(cur);
    }
    if (!cur) continue;
    const st = cellText(get(row, 'station'));
    if (st && !cur.station) cur.station = st;
    const nt = cellText(get(row, 'notes'));
    if (nt) cur.notes.push(nt);
    const name = cellText(get(row, 'name')).replace(/\s*\n\s*/g, '; ').trim();
    const art = cellText(get(row, 'partNumber'));
    const brand = cellText(get(row, 'brand'));
    const qty = toNumber(get(row, 'qty'));
    const price = toNumber(get(row, 'price'));
    let sum = toNumber(get(row, 'sum'));
    if (sum === undefined && price !== undefined) sum = price * (qty || 1);
    if (!name) {
      if (sum && !cur.works.length && !cur.parts.length) cur.works.push({ name: cur.kind === 'to' ? 'Техническое обслуживание' : 'Работы', price: sum });
      continue;
    }
    if (cur.kind !== 'to' && /(^|\s)то[-\s]?\d|техобслуж|техническое обслуж/i.test(name)) cur.kind = 'to';
    const isPart = !!art || !!brand || (qty !== undefined && qty !== 1) || (PART_RE.test(name) && !WORK_RE.test(name));
    if (isPart) {
      const q = qty && qty > 0 ? qty : 1;
      cur.parts.push({ name, partNumber: art || undefined, brand: brand || undefined, qty: q, price: price ?? (sum ? Math.round((sum / q) * 100) / 100 : 0) });
    } else cur.works.push({ name, price: sum || 0 });
  }
  return out.filter((d) => d.date && (d.works.length || d.parts.length || d.mileage));
}

export function ServiceImport() {
  const { car, cars } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [header, setHeader] = useState(0);
  const [map, setMap] = useState<Mapping>({});
  const [carId, setCarId] = useState(car?.id || '');
  const [busy, setBusy] = useState(false);
  const existing = useQuery(() => getAll<ServiceEntry>('services'), [], ['services']);

  const sheet = sheets[sheetIdx];
  const drafts = useMemo(() => (sheet ? buildDrafts(sheet.rows, header, map) : []), [sheet, header, map]);
  const dupKey = (e: { date?: number; mileage?: number }) => `${startOfDay(e.date || 0)}|${e.mileage || ''}`;
  const existingKeys = new Set((existing || []).filter((s) => s.carId === carId).map(dupKey));
  const fresh = drafts.filter((d) => !existingKeys.has(dupKey(d)));

  const load = async (f?: File) => {
    if (!f) return;
    try {
      const sh = (await readSpreadsheet(f)).filter((s) => s.rows.length);
      if (!sh.length) throw new Error('В файле нет данных');
      // лист, где больше всего строк с датами
      const scored = sh.map((s, i) => ({ i, n: s.rows.filter((r) => r.some((c) => c instanceof Date || (typeof c === 'string' && /\d{1,2}\.\d{1,2}\.\d{2,4}/.test(c)))).length }));
      const i = scored.sort((a, b) => b.n - a.n)[0].i;
      setSheets(sh);
      setFileName(f.name);
      pickSheet(sh, i);
    } catch (e: any) {
      toast(e?.message || 'Не удалось прочитать файл', 'danger');
    }
  };
  const pickSheet = (sh: Sheet[], i: number) => {
    setSheetIdx(i);
    const d = detect(sh[i].rows);
    setHeader(d.header);
    setMap(d.map);
  };

  const run = async () => {
    const target = cars.find((c) => c.id === carId);
    if (!target || !fresh.length) return;
    setBusy(true);
    try {
      const entries: ServiceEntry[] = fresh.map((d) =>
        stamp<ServiceEntry>(
          {
            id: uid(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            carId: target.id,
            kind: d.kind,
            number: d.kind === 'to' ? d.number : undefined,
            title: d.kind !== 'to' ? d.works[0]?.name?.slice(0, 60) || d.parts[0]?.name?.slice(0, 60) : undefined,
            date: d.date!,
            mileage: d.mileage ? Math.round(d.mileage) : undefined,
            station: d.station,
            works: d.works,
            parts: d.parts,
            notes: [...d.notes, `Импорт из ${fileName}, строка ${d.row}`].join('\n'),
            attachments: [],
          },
          true,
        ),
      );
      // номера ТО, если в файле их нет: по порядку пробега
      const allTo = [...(existing || []).filter((s) => s.carId === target.id && s.kind === 'to'), ...entries.filter((e) => e.kind === 'to')];
      if (entries.some((e) => e.kind === 'to' && !e.number) && !entries.some((e) => e.kind === 'to' && e.number)) {
        allTo.sort((a, b) => a.date - b.date);
        allTo.forEach((e, i) => {
          if (!e.number && entries.includes(e)) e.number = i + 1;
        });
      }
      await putMany('services', entries);
      refreshReminders();
      toast(`Загружено записей: ${entries.length}`);
      go('#/service');
    } catch (e: any) {
      toast('Не удалось загрузить: ' + (e?.message || e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const headerRow = sheet?.rows[header] || [];
  const colCount = Math.max(0, ...(sheet?.rows.slice(header, header + 30).map((r) => r.length) || [0]));
  const colOptions = [{ value: '', label: '— нет —' }, ...Array.from({ length: colCount }, (_, i) => ({ value: String(i), label: `${String.fromCharCode(65 + (i % 26))}: ${cellText(headerRow[i]).slice(0, 28) || '(без названия)'}` }))];

  return (
    <Page title="Импорт истории ТО" back="#/service">
      <Card>
        <p className="small">
          Загрузите таблицу Excel (.xlsx) или CSV с историей обслуживания. Колонки (дата, пробег, номер ТО, работы, запчасти, артикулы, суммы) подберутся сами —
          их можно поправить. Строки без даты считаются продолжением записи выше.
        </p>
        <Button variant="primary" icon={<LuUpload />} onClick={() => fileRef.current?.click()}>
          {fileName ? 'Выбрать другой файл' : 'Выбрать файл'}
        </Button>
        {fileName && (
          <div className="small muted" style={{ marginTop: 8 }}>
            <LuFileSpreadsheet className="inline-icon" /> {fileName}
          </div>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={(e) => (load(e.target.files?.[0]), (e.target.value = ''))} />
      </Card>

      {sheet && (
        <>
          {sheets.length > 1 && (
            <Section title="Лист">
              <Chips value={sheets[sheetIdx].name} onChange={(n) => pickSheet(sheets, sheets.findIndex((s) => s.name === n))} options={sheets.map((s) => s.name)} />
            </Section>
          )}
          <Section title="Колонки" action={<span className="muted small">заголовок — строка {header + 1}</span>}>
            <div className="map-grid">
              <Field label="Строка заголовка">
                <Select value={String(header)} onChange={(v) => setHeader(+v)} options={Array.from({ length: Math.min(15, sheet.rows.length) }, (_, i) => ({ value: String(i), label: `${i + 1}: ${(sheet.rows[i] || []).map(cellText).filter(Boolean).join(' · ').slice(0, 40)}` }))} />
              </Field>
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  <Select
                    value={map[f.key] !== undefined ? String(map[f.key]) : ''}
                    onChange={(v) => setMap({ ...map, [f.key]: v === '' ? undefined : +v })}
                    options={colOptions}
                  />
                </Field>
              ))}
            </div>
          </Section>

          <Section title="Машина">
            <Chips value={cars.find((c) => c.id === carId)?.model || ''} onChange={(m) => setCarId(cars.find((c) => c.model === m)?.id || carId)} options={cars.map((c) => c.model)} />
          </Section>

          <Section title={`Найдено записей: ${drafts.length}`} action={drafts.length !== fresh.length ? <Badge tone="warn">уже есть: {drafts.length - fresh.length}</Badge> : undefined}>
            {drafts.length === 0 ? (
              <Card className="muted-card">Записи не найдены — проверьте, что выбраны колонки «Дата» и «Работа / запчасть» или «Сумма».</Card>
            ) : (
              <div className="list">
                {drafts.slice(0, 40).map((d, i) => {
                  const total = serviceTotal({ works: d.works, parts: d.parts } as ServiceEntry);
                  const dup = existingKeys.has(dupKey(d));
                  return (
                    <Row
                      key={i}
                      className={dup ? 'is-muted' : undefined}
                      title={`${d.kind === 'to' ? `ТО${d.number ? '-' + d.number : ''}` : 'Ремонт'} · ${dateShort(d.date)}${dup ? ' · уже есть' : ''}`}
                      subtitle={[d.mileage ? km(d.mileage) : '', d.works.length ? `${d.works.length} раб.` : '', d.parts.length ? `${d.parts.length} зап.` : '', d.station].filter(Boolean).join(' · ')}
                      right={<b className="num">{money(total)}</b>}
                    />
                  );
                })}
                {drafts.length > 40 && <div className="muted small" style={{ padding: 8 }}>…и ещё {drafts.length - 40}</div>}
              </div>
            )}
          </Section>
          <div className="form-actions">
            <Button variant="primary" size="lg" block busy={busy} disabled={!fresh.length} onClick={run}>
              {fresh.length ? `Загрузить ${fresh.length} ${plural(fresh.length, 'запись', 'записи', 'записей')}` : 'Нечего загружать'}
            </Button>
          </div>
        </>
      )}
    </Page>
  );
}
