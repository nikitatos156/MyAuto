// Вычисления: пробег, расход, следующее ТО, сроки штрафов и документов, напоминания.
import { addMonths, DAY, daysUntil, dateShort, km, money, relDays, startOfDay } from '../lib/format';
import type { Car, DocEntry, Fine, FuelEntry, ServiceEntry, TireSet } from './types';
import { tireAdvice } from './tires';
import { planStatus, type PlanOverrides } from './maintenance';

export const isAdBlue = (t?: string) => !!t && /adblue/i.test(t);

export function currentMileage(car: Car, fuel: FuelEntry[], services: ServiceEntry[]): number | undefined {
  let m = car.mileage;
  for (const f of fuel) if (f.carId === car.id && f.mileage && (!m || f.mileage > m)) m = f.mileage;
  for (const s of services) if (s.carId === car.id && s.mileage && (!m || s.mileage > m)) m = s.mileage;
  return m;
}

export const serviceTotal = (s: ServiceEntry) =>
  s.works.reduce((a, w) => a + (w.price || 0), 0) + s.parts.reduce((a, p) => a + (p.price || 0) * (p.qty || 1), 0);
export const worksTotal = (s: ServiceEntry) => s.works.reduce((a, w) => a + (w.price || 0), 0);
export const partsTotal = (s: ServiceEntry) => s.parts.reduce((a, p) => a + (p.price || 0) * (p.qty || 1), 0);

// --- расход топлива: метод «от полного бака до полного бака» ---
export interface ConsumptionInfo {
  avg?: number; // л/100 км
  last?: number;
  perEntry: Map<string, number>; // id заправки -> расход на отрезке
  distance: number;
  liters: number;
}

export function consumption(entries: FuelEntry[]): ConsumptionInfo {
  const list = entries
    .filter((e) => !isAdBlue(e.fuelType) && e.mileage)
    .sort((a, b) => a.mileage! - b.mileage! || a.date - b.date);
  const perEntry = new Map<string, number>();
  let prevFull: FuelEntry | null = null;
  let acc = 0;
  let distance = 0;
  let litersSum = 0;
  let last: number | undefined;
  for (const e of list) {
    if (prevFull) acc += e.liters;
    if (e.fullTank) {
      if (prevFull && e.mileage! > prevFull.mileage!) {
        const d = e.mileage! - prevFull.mileage!;
        const c = (acc / d) * 100;
        if (c > 1 && c < 40) {
          perEntry.set(e.id, c);
          distance += d;
          litersSum += acc;
          last = c;
        }
      }
      prevFull = e;
      acc = 0;
    }
  }
  return { avg: distance ? (litersSum / distance) * 100 : undefined, last, perEntry, distance, liters: litersSum };
}

// --- следующее ТО ---
export interface NextService {
  number: number;
  mileage?: number;
  date?: number;
  kmLeft?: number;
  daysLeft?: number;
  last?: ServiceEntry;
  overdue: boolean;
  soon: boolean;
}

export function nextService(car: Car, services: ServiceEntry[], mileage?: number): NextService | null {
  const tos = services
    .filter((s) => s.carId === car.id && s.kind === 'to')
    .sort((a, b) => (b.mileage || 0) - (a.mileage || 0) || b.date - a.date);
  const last = tos[0];
  if (!last) return null;
  const nextMileage = last.nextMileage ?? (last.mileage ? last.mileage + car.serviceIntervalKm : undefined);
  const nextDate = last.nextDate ?? addMonths(last.date, car.serviceIntervalMonths);
  const maxNum = tos.reduce((m, s) => Math.max(m, s.number || 0), 0);
  const kmLeft = nextMileage && mileage ? nextMileage - mileage : undefined;
  const daysLeft = nextDate ? daysUntil(nextDate) : undefined;
  const overdue = (kmLeft !== undefined && kmLeft < 0) || (daysLeft !== undefined && daysLeft < 0);
  const soon = !overdue && ((kmLeft !== undefined && kmLeft <= 1000) || (daysLeft !== undefined && daysLeft <= 30));
  return { number: maxNum + 1, mileage: nextMileage, date: nextDate, kmLeft, daysLeft, last, overdue, soon };
}

export function nextServiceNumber(carId: string, services: ServiceEntry[]) {
  return services.filter((s) => s.carId === carId && s.kind === 'to').reduce((m, s) => Math.max(m, s.number || 0), 0) + 1;
}

// --- штрафы ---
// Статьи КоАП, по которым скидка 50% не применяется.
const NO_DISCOUNT = [
  /12\.1\D+1\.1/, /^12\.8\b/, /12\.9\D+6\b/, /12\.9\D+7\b/, /12\.10\D+3\b/, /^12\.24\b/, /^12\.26\b/, /12\.27\D+3\b/,
];

export function discountAllowed(article?: string) {
  if (!article) return true;
  const a = article.replace(/ст\.?\s*/i, '').replace(/КоАП( РФ)?/i, '').trim();
  return !NO_DISCOUNT.some((re) => re.test(a));
}

export interface FineInfo {
  discountUntil?: number;
  discountActive: boolean;
  toPay: number;
  dueDate?: number;
  overdue: boolean;
  daysToDiscountEnd?: number;
}

export function fineInfo(f: Fine): FineInfo {
  const base = f.resolutionDate || f.violationDate;
  const allowed = discountAllowed(f.article);
  const discountUntil = base && allowed ? base + 20 * DAY : undefined;
  const discountActive = !!discountUntil && f.status === 'unpaid' && startOfDay(Date.now()) <= startOfDay(discountUntil);
  const dueDate = base ? base + 70 * DAY : undefined;
  const overdue = f.status === 'unpaid' && !!dueDate && Date.now() > dueDate;
  return {
    discountUntil,
    discountActive,
    toPay: discountActive ? Math.round(f.amount / 2) : f.amount,
    dueDate,
    overdue,
    daysToDiscountEnd: discountUntil ? daysUntil(discountUntil) : undefined,
  };
}

// Разбор текста уведомления о штрафе (СМС, Госуслуги, банк).
export function parseFineText(text: string): Partial<Fine> {
  const t = text.replace(/ /g, ' ');
  const out: Partial<Fine> = {};
  const uin = t.match(/(?:УИН|постановлени[ея]\s*(?:№|N|номер)?|№)\s*[:#]?\s*(\d[\d\s]{18,28}\d)/i) || t.match(/\b(188\d{17}(?:\d{5})?)\b/);
  if (uin) out.uin = uin[1].replace(/\s/g, '');
  const amount =
    t.match(/(?:сумм[аеы]|штраф[а]?|к оплате|размер)[^\d]{0,25}(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:руб|₽|р\.)/i) ||
    t.match(/(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:руб|₽|р\.)/i);
  if (amount) out.amount = parseFloat(amount[1].replace(/\s/g, '').replace(',', '.'));
  const art = t.match(/(?:ст(?:атья|\.)?\s*)?(12\.\d{1,2}(?:\.\d)?(?:\s*ч(?:асть|\.)?\s*\d(?:\.\d)?)?)/i);
  if (art) out.article = 'ст. ' + art[1].replace(/\s+/g, ' ').replace(/ч(?:асть)?\.?\s*/i, 'ч.');
  // даты: игнорируем «оплатить до …» и т.п.
  const dateHits = Array.from(t.matchAll(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/g))
    .filter((m) => !/(?:до|по)\s*$/i.test(t.slice(Math.max(0, (m.index || 0) - 8), m.index)))
    .map((m) => ({ day: new Date(+m[3], +m[2] - 1, +m[1], 12).getTime(), index: m.index || 0 }));
  if (dateHits.length) {
    const toTs = (s: string) => {
      const [d, m, y] = s.split('.').map(Number);
      return new Date(y, m - 1, d, 12).getTime();
    };
    const vd = t.match(/(?:нарушени[ея]|дата\s+нарушения|дата\s+и\s+время\s+нарушения)[^\d]{0,20}(\d{2}\.\d{2}\.\d{4})/i);
    const rd = t.match(/(?:постановлени[ея](?:\s+от)?|вынесен[оа]?|(?<![а-яё])от)\s*[:]?\s*(\d{2}\.\d{2}\.\d{4})/i);
    out.violationDate = vd ? toTs(vd[1]) : Math.min(...dateHits.map((d) => d.day));
    // постановление выносится не раньше нарушения — берём явную дату или самую позднюю
    const latest = Math.max(...dateHits.map((d) => d.day));
    out.resolutionDate = rd ? toTs(rd[1]) : latest;
    if (out.resolutionDate < out.violationDate) out.resolutionDate = latest;
  }
  const place = t.match(/(?:место(?: нарушения)?|адрес)\s*[:\-]\s*([^\n]+)/i);
  if (place) out.place = place[1].trim();
  const plate = t.toUpperCase().match(/([АВЕКМНОРСТУХABEKMHOPCTYX8])\s?(\d{3})\s?([АВЕКМНОРСТУХABEKMHOPCTYX8]{2})\s?(\d{2,3})(?!\d)/);
  if (plate) (out as any)._plate = (plate[1] + plate[2] + plate[3]).replace(/8/g, 'В') + plate[4];
  return out;
}

// --- ГРЗ: нормализация (латиница -> кириллица) ---
const LAT2CYR: Record<string, string> = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
export function normPlate(s?: string) {
  if (!s) return '';
  return s
    .toUpperCase()
    .replace(/\s/g, '')
    .replace(/[ABEKMHOPCTYX]/g, (c) => LAT2CYR[c] || c);
}

// --- документы ---
export const DOC_TYPES: { type: DocTypeKey; title: string; short: string; perCar: boolean; expiring: boolean }[] = [
  { type: 'sts', title: 'Свидетельство о регистрации (СТС)', short: 'СТС', perCar: true, expiring: false },
  { type: 'pts', title: 'Паспорт ТС (ПТС / ЭПТС)', short: 'ПТС', perCar: true, expiring: false },
  { type: 'grz', title: 'Госномер (ГРЗ)', short: 'ГРЗ', perCar: true, expiring: false },
  { type: 'osago', title: 'Полис ОСАГО', short: 'ОСАГО', perCar: true, expiring: true },
  { type: 'kasko', title: 'Полис КАСКО', short: 'КАСКО', perCar: true, expiring: true },
  { type: 'vu', title: 'Водительское удостоверение (ВУ)', short: 'ВУ', perCar: false, expiring: true },
];
type DocTypeKey = DocEntry['type'];
export const docMeta = (t: DocTypeKey) => DOC_TYPES.find((d) => d.type === t)!;

/**
 * Российские ВУ, срок которых истёк или истекает с 01.01.2022 по 31.12.2025, автоматически продлены на 3 года
 * от даты в графе 4b (постановление Правительства РФ № 353 от 12.03.2022 в ред. № 2269 от 23.12.2023).
 * Истекающие с 2026 года не продлеваются.
 */
export function vuExtendedUntil(d: Pick<DocEntry, 'type' | 'expiryDate'>): number | undefined {
  if (d.type !== 'vu' || !d.expiryDate) return undefined;
  const from = new Date(2022, 0, 1).getTime();
  const to = new Date(2025, 11, 31, 23, 59, 59).getTime();
  return d.expiryDate >= from && d.expiryDate <= to ? addMonths(d.expiryDate, 36) : undefined;
}

/** Фактический срок действия: у продлённых ВУ — с учётом продления. */
export const effectiveExpiry = (d: Pick<DocEntry, 'type' | 'expiryDate'>) => vuExtendedUntil(d) ?? d.expiryDate;

export function docExpiry(d: DocEntry) {
  const exp = effectiveExpiry(d);
  if (!exp) return null;
  const days = daysUntil(exp);
  return { days, expired: days < 0, soon: days >= 0 && days <= 30, until: exp, extended: !!vuExtendedUntil(d) };
}

// --- напоминания ---
export type Level = 'danger' | 'warn' | 'info';
export interface Reminder {
  id: string;
  kind: 'fine' | 'service' | 'doc' | 'backup' | 'tires';
  level: Level;
  title: string;
  text: string;
  route: string;
  carId?: string;
  sort: number;
}

export function buildReminders(args: {
  cars: Car[];
  fuel: FuelEntry[];
  services: ServiceEntry[];
  docs: DocEntry[];
  fines: Fine[];
  tires?: TireSet[];
  planOverrides?: Record<string, PlanOverrides>;
  lastBackup?: number;
}): Reminder[] {
  const { cars, fuel, services, docs, fines, lastBackup } = args;
  const out: Reminder[] = [];
  const carName = (id?: string) => {
    const c = cars.find((x) => x.id === id);
    return c ? `${c.make} ${c.model}` : '';
  };
  for (const f of fines) {
    if (f.status !== 'unpaid') continue;
    const fi = fineInfo(f);
    let level: Level = 'warn';
    let text = `К оплате ${money(fi.toPay)}`;
    if (fi.overdue) {
      level = 'danger';
      text += ' · срок оплаты истёк';
    } else if (fi.discountActive && fi.discountUntil) {
      text += ` · скидка 50% до ${dateShort(fi.discountUntil)}`;
      if ((fi.daysToDiscountEnd ?? 99) <= 3) level = 'danger';
    } else if (fi.dueDate) {
      text += ` · оплатить до ${dateShort(fi.dueDate)}`;
    }
    out.push({
      id: 'fine:' + f.id,
      kind: 'fine',
      level,
      title: `Неоплаченный штраф${f.carId ? ' · ' + carName(f.carId) : ''}`,
      text,
      route: `#/fines/${f.id}`,
      carId: f.carId,
      sort: level === 'danger' ? 0 : 10,
    });
  }
  for (const car of cars) {
    const m = currentMileage(car, fuel, services);
    const ns = nextService(car, services, m);
    if (ns && (ns.overdue || ns.soon)) {
      const parts: string[] = [];
      if (ns.kmLeft !== undefined) parts.push(ns.kmLeft < 0 ? `перепробег ${km(-ns.kmLeft)}` : `осталось ${km(ns.kmLeft)}`);
      if (ns.date) parts.push(ns.date < Date.now() ? `срок был ${dateShort(ns.date)}` : relDays(ns.date));
      out.push({
        id: 'service:' + car.id,
        kind: 'service',
        level: ns.overdue ? 'danger' : 'warn',
        title: `ТО-${ns.number} · ${car.make} ${car.model}`,
        text: parts.join(' · '),
        route: '#/service',
        carId: car.id,
        sort: ns.overdue ? 1 : 11,
      });
    }
  }
  for (const d of docs) {
    if (d.status !== 'active') continue;
    const e = docExpiry(d);
    if (!e || (!e.expired && !e.soon)) continue;
    const meta = docMeta(d.type);
    out.push({
      id: 'doc:' + d.id,
      kind: 'doc',
      level: e.expired ? 'danger' : 'warn',
      title: `${meta.short}${d.carId ? ' · ' + carName(d.carId) : d.holder ? ' · ' + d.holder : ''}`,
      text: e.expired ? `Истёк ${dateShort(e.until)}${e.extended ? ' (с учётом продления на 3 года)' : ''}` : `Истекает ${relDays(e.until)} (${dateShort(e.until)})${e.extended ? ' · продлено на 3 года' : ''}`,
      route: `#/docs/${d.id}`,
      carId: d.carId,
      sort: e.expired ? 2 : 12,
    });
  }
  // план обслуживания: только пункты, у которых известна дата прошлой замены (масло — в напоминании о ТО)
  for (const car of cars) {
    const m = currentMileage(car, fuel, services);
    for (const p of planStatus(car, services, m, args.planOverrides?.[car.id])) {
      if (p.off || p.item.key === 'oil' || !p.lastDate || (p.state !== 'overdue' && p.state !== 'soon')) continue;
      const when = [p.kmLeft !== undefined ? (p.kmLeft < 0 ? `просрочено на ${km(-p.kmLeft)}` : `через ${km(p.kmLeft)}`) : '', p.dueDate ? ((p.daysLeft ?? 0) < 0 ? `просрочено с ${dateShort(p.dueDate)}` : `до ${dateShort(p.dueDate)}`) : ''].filter(Boolean).join(' · ');
      out.push({
        id: `plan:${car.id}:${p.item.key}`,
        kind: 'service',
        level: p.state === 'overdue' ? 'warn' : 'info',
        title: `${p.item.title} · ${car.make} ${car.model}`,
        text: when,
        route: '#/service/plan?item=' + p.item.key,
        carId: car.id,
        sort: p.state === 'overdue' ? 14 : 24,
      });
    }
  }
  for (const car of cars) {
    for (const [i, a] of tireAdvice(args.tires || [], car.id).entries()) {
      out.push({
        id: `tires:${car.id}:${i}`,
        kind: 'tires',
        level: a.level,
        title: `${a.title} · ${car.make} ${car.model}`,
        text: a.text,
        route: '#/tires',
        carId: car.id,
        sort: a.level === 'danger' ? 3 : a.level === 'warn' ? 13 : 25,
      });
    }
  }
  if (!lastBackup || Date.now() - lastBackup > 31 * DAY) {
    out.push({
      id: 'backup',
      kind: 'backup',
      level: 'info',
      title: 'Резервная копия',
      text: lastBackup ? `Последняя — ${dateShort(lastBackup)}. Пора сделать новую` : 'Копий ещё не было',
      route: '#/settings',
      sort: 30,
    });
  }
  return out.sort((a, b) => a.sort - b.sort);
}
