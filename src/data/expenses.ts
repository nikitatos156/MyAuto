// Расходы на машину: все траты из заправок, ТО, страховок, оплаченных штрафов и шин — по категориям и месяцам.
import { serviceTotal } from './logic';
import type { Car, DocEntry, Fine, FuelEntry, ServiceEntry, TireSet } from './types';

export type ExpCat = 'fuel' | 'service' | 'insurance' | 'fines' | 'tires';

// Порядок = порядок слоёв в графике и цветов (палитра проверена на различимость соседних пар).
export const CATS: { key: ExpCat; label: string }[] = [
  { key: 'fuel', label: 'Топливо' },
  { key: 'service', label: 'ТО и ремонт' },
  { key: 'insurance', label: 'Страховка' },
  { key: 'fines', label: 'Штрафы' },
  { key: 'tires', label: 'Шины' },
];

export interface ExpenseItem {
  id: string;
  date: number;
  carId?: string;
  cat: ExpCat;
  amount: number;
  title: string;
  route: string;
  mileage?: number;
  liters?: number;
}

export interface ExpenseData {
  fuel: FuelEntry[];
  services: ServiceEntry[];
  docs: DocEntry[];
  fines: Fine[];
  tires: TireSet[];
}

export function collectExpenses(d: ExpenseData): ExpenseItem[] {
  const out: ExpenseItem[] = [];
  for (const f of d.fuel)
    if (f.total > 0)
      out.push({ id: 'f:' + f.id, date: f.date, carId: f.carId, cat: 'fuel', amount: f.total, title: `${f.fuelType} · ${String(f.liters).replace('.', ',')} л${f.station ? ' · ' + f.station : ''}`, route: `#/fuel/${f.id}`, mileage: f.mileage, liters: f.liters });
  for (const s of d.services) {
    const t = serviceTotal(s);
    if (t > 0) out.push({ id: 's:' + s.id, date: s.date, carId: s.carId, cat: 'service', amount: t, title: s.kind === 'to' ? `ТО-${s.number ?? ''}${s.station ? ' · ' + s.station : ''}` : s.title || 'Ремонт', route: `#/service/${s.id}`, mileage: s.mileage });
  }
  for (const doc of d.docs) {
    if ((doc.type !== 'osago' && doc.type !== 'kasko') || !doc.cost) continue;
    out.push({ id: 'd:' + doc.id, date: doc.startDate || doc.issueDate || doc.createdAt, carId: doc.carId, cat: 'insurance', amount: doc.cost, title: `${doc.type === 'osago' ? 'ОСАГО' : 'КАСКО'}${doc.issuer ? ' · ' + doc.issuer : ''}`, route: `#/docs/${doc.id}` });
  }
  for (const f of d.fines) {
    if (f.status !== 'paid') continue;
    const amount = f.paidAmount ?? f.amount;
    out.push({ id: 'p:' + f.id, date: f.paidDate || f.resolutionDate || f.violationDate || f.createdAt, carId: f.carId, cat: 'fines', amount, title: `Штраф${f.article ? ' · ' + f.article : ''}`, route: `#/fines/${f.id}` });
  }
  for (const t of d.tires) {
    const name = [t.brand, t.model].filter(Boolean).join(' ') || 'Шины';
    if (t.price) out.push({ id: 't:' + t.id, date: t.purchaseDate || t.createdAt, carId: t.carId, cat: 'tires', amount: t.price, title: `Покупка · ${name}`, route: `#/tires/${t.id}` });
    for (const e of t.events)
      if (e.cost) out.push({ id: 'te:' + e.id, date: e.date, carId: t.carId, cat: 'tires', amount: e.cost, title: `${e.action === 'install' ? 'Шиномонтаж' : 'Снятие'} · ${name}${e.place ? ' · ' + e.place : ''}`, route: `#/tires/${t.id}`, mileage: e.mileage });
  }
  return out.sort((a, b) => b.date - a.date);
}

export interface Period {
  key: string;
  label: string;
  from: number;
  to: number; // не включительно
  byYear?: boolean; // столбцы по годам, а не по месяцам
}

export function periods(items: ExpenseItem[], now = new Date()): Period[] {
  const y = now.getFullYear();
  const out: Period[] = [{ key: '12m', label: '12 месяцев', from: new Date(y, now.getMonth() - 11, 1).getTime(), to: new Date(y, now.getMonth() + 1, 1).getTime() }];
  const years = Array.from(new Set(items.map((i) => new Date(i.date).getFullYear()))).filter((x) => x <= y);
  if (!years.includes(y)) years.push(y);
  years.sort((a, b) => b - a);
  for (const yr of years.slice(0, 6)) out.push({ key: String(yr), label: String(yr), from: new Date(yr, 0, 1).getTime(), to: new Date(yr + 1, 0, 1).getTime() });
  if (items.length) {
    const first = Math.min(...items.map((i) => i.date));
    out.push({ key: 'all', label: 'Всё время', from: new Date(new Date(first).getFullYear(), 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime(), byYear: true });
  }
  return out;
}

export interface Bucket {
  key: string;
  label: string; // подпись оси
  title: string; // для подсказки
  from: number;
  to: number;
  byCat: Record<ExpCat, number>;
  total: number;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const emptyCats = (): Record<ExpCat, number> => ({ fuel: 0, service: 0, insurance: 0, fines: 0, tires: 0 });

export function buckets(items: ExpenseItem[], p: Period): Bucket[] {
  const out: Bucket[] = [];
  const start = new Date(p.from);
  if (p.byYear) {
    for (let y = start.getFullYear(); new Date(y, 0, 1).getTime() < p.to; y++)
      out.push({ key: String(y), label: String(y), title: `${y} год`, from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime(), byCat: emptyCats(), total: 0 });
  } else {
    for (let d = new Date(start); d.getTime() < p.to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const m = d.getMonth();
      out.push({ key: `${d.getFullYear()}-${m}`, label: MONTHS[m], title: `${MONTHS_FULL[m]} ${d.getFullYear()}`, from: d.getTime(), to: new Date(d.getFullYear(), m + 1, 1).getTime(), byCat: emptyCats(), total: 0 });
    }
  }
  for (const it of items) {
    const b = out.find((x) => it.date >= x.from && it.date < x.to);
    if (!b) continue;
    b.byCat[it.cat] += it.amount;
    b.total += it.amount;
  }
  return out;
}

export interface Summary {
  total: number;
  byCat: Record<ExpCat, number>;
  count: Record<ExpCat, number>;
  months: number; // месяцев с начала периода (или с первой траты) по сегодня
  perMonth: number;
  distance?: number; // км за период по показаниям одометра
  perKm?: number;
  fuelPerKm?: number;
  liters: number;
}

export function summarize(items: ExpenseItem[], p: Period, cars: Car[], all: ExpenseData, now = Date.now()): Summary {
  const inP = items.filter((i) => i.date >= p.from && i.date < p.to);
  const byCat = emptyCats();
  const count = emptyCats();
  let liters = 0;
  for (const i of inP) {
    byCat[i.cat] += i.amount;
    count[i.cat]++;
    if (i.liters) liters += i.liters;
  }
  const total = inP.reduce((a, i) => a + i.amount, 0);
  const firstDate = inP.length ? Math.min(...inP.map((i) => i.date)) : p.from;
  const from = Math.max(p.from, p.key === 'all' ? firstDate : p.from);
  const to = Math.min(p.to, now);
  const months = Math.max(1, Math.round((to - from) / (30.44 * 864e5)));
  // пробег за период: по каждой машине — разница показаний одометра внутри периода
  let distance = 0;
  const carIds = new Set(inP.map((i) => i.carId).filter(Boolean) as string[]);
  for (const id of carIds.size ? carIds : new Set(cars.map((c) => c.id))) {
    const readings = [
      ...all.fuel.filter((f) => f.carId === id && f.mileage).map((f) => ({ t: f.date, m: f.mileage! })),
      ...all.services.filter((s) => s.carId === id && s.mileage).map((s) => ({ t: s.date, m: s.mileage! })),
    ].filter((r) => r.t >= p.from && r.t < p.to);
    if (readings.length >= 2) {
      const ms = readings.map((r) => r.m);
      distance += Math.max(...ms) - Math.min(...ms);
    }
  }
  return {
    total,
    byCat,
    count,
    months,
    perMonth: total / months,
    distance: distance > 50 ? distance : undefined,
    perKm: distance > 50 ? total / distance : undefined,
    fuelPerKm: distance > 50 ? byCat.fuel / distance : undefined,
    liters,
  };
}
