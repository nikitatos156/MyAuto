// План обслуживания по двигателю: что и с каким интервалом менять, с номерами запчастей.
// Последнее выполнение берётся из истории ТО (по словам в работах и запчастях) или отмечается вручную.
// Номера — ориентир: у VAG они зависят от комплектации и даты выпуска, перед заказом сверяйте по VIN.
import { addMonths, DAY } from '../lib/format';
import type { Car, ServiceEntry } from './types';

export interface PlanPart {
  name: string;
  partNumber?: string;
  brand?: string;
  qty?: number;
  note?: string;
}

export interface PlanItem {
  key: string;
  title: string;
  km?: number;
  months?: number;
  work?: string; // название работы для заказ-наряда
  parts?: PlanPart[];
  note?: string;
  match: RegExp; // как узнать работу в истории
}

export interface Plan {
  id: string;
  title: string;
  source: string;
  items: PlanItem[];
}

const OIL = /^(?!.*(кпп|акпп|коробк|редуктор|раздат|dsg|s\s?tronic|гур|мост|муфт|haldex|трансмисс|вариатор|щуп)).*(масл|\boil\b)/i;
const CABIN = /салон|пыльцев|pollen/i;
const AIR = /воздушн[а-я]*\s+фильтр|фильтр\s+воздушн/i;
const FUEL = /топливн[а-я]*\s+фильтр|фильтр\s+топливн/i;
const BRAKE = /тормозн[а-я]*\s+жидк/i;
const PLUGS = /свеч[а-я]*\s+зажиган/i;

export const PLANS: Plan[] = [
  {
    id: 'CFNA',
    title: 'VW Polo Sedan 1.6 MPI (CFNA)',
    source: 'Регламент VW для Polo Sedan и каталоги запчастей. Интервалы и номера — ориентир, сверьте с сервисной книжкой и по VIN.',
    items: [
      {
        key: 'oil',
        title: 'Масло двигателя и масляный фильтр',
        km: 15000,
        months: 12,
        work: 'Замена масла двигателя и масляного фильтра',
        parts: [
          { name: 'Масло моторное VW 502 00, 5W-40 (или VW 504 00, 5W-30)', note: 'объём — по сервисной книжке, доливать по щупу' },
          { name: 'Фильтр масляный', partNumber: '03C 115 561 H', note: 'для 1.6 MPI 77 кВт; сверьте по VIN' },
          { name: 'Шайба сливной пробки', note: 'номер по VIN' },
        ],
        match: OIL,
      },
      {
        key: 'cabin',
        title: 'Салонный фильтр',
        km: 15000,
        months: 12,
        work: 'Замена салонного фильтра',
        parts: [{ name: 'Фильтр салона', partNumber: '6R0 819 653' }],
        match: CABIN,
      },
      {
        key: 'air',
        title: 'Воздушный фильтр',
        km: 30000,
        work: 'Замена воздушного фильтра',
        parts: [{ name: 'Фильтр воздушный', note: 'номер по VIN' }],
        note: 'В пыльных условиях — каждые 15 000 км',
        match: AIR,
      },
      {
        key: 'plugs',
        title: 'Свечи зажигания',
        km: 60000,
        work: 'Замена свечей зажигания',
        parts: [{ name: 'Свеча зажигания', qty: 4, note: 'номер по VIN' }],
        note: 'В разных версиях сервисной книжки — 45–60 тыс. км',
        match: PLUGS,
      },
      {
        key: 'brake',
        title: 'Тормозная жидкость',
        months: 24,
        work: 'Замена тормозной жидкости',
        parts: [{ name: 'Тормозная жидкость VW 501 14 (DOT 4)', qty: 1 }],
        note: 'Первая замена — через 3 года, затем каждые 2 года',
        match: BRAKE,
      },
      {
        key: 'belt',
        title: 'Ремень навесного оборудования — проверка',
        km: 30000,
        work: 'Проверка ремня и роликов навесного оборудования',
        note: 'Цепь ГРМ на CFNA меняется по состоянию (шум при запуске)',
        match: /(ремн[яеи]|ремень)\s+(навесн|привод|генерат)|приводн[а-я]*\s+ремен|ремн[яеи]\s+и\s+ролик/i,
      },
    ],
  },
  {
    id: 'DECA',
    title: 'Audi A5 B9 2.0 TDI 190 л.с. (DECA), quattro, S tronic',
    source: 'Регламент Audi для 2.0 TDI (сервисные интервалы Audi) и каталоги запчастей для A5 2.0 TDI 140 кВт. Интервалы и номера — ориентир, сверьте с сервисной книжкой и по VIN.',
    items: [
      {
        key: 'oil',
        title: 'Масло двигателя и масляный фильтр',
        km: 15000,
        months: 12,
        work: 'Замена масла двигателя и масляного фильтра',
        parts: [
          { name: 'Масло моторное VW 507 00, 5W-30 (0W-30)', qty: 4.7, note: '≈4,7 л для 2.0 TDI 190 л.с.; точный объём — по сервисной книжке, доливать по щупу' },
          { name: 'Фильтр масляный (элемент)', partNumber: '05L 115 562', note: 'аналог MANN HU 7020 z' },
        ],
        match: OIL,
      },
      {
        key: 'cabin',
        title: 'Салонный фильтр',
        km: 30000,
        months: 24,
        work: 'Замена салонного фильтра',
        parts: [{ name: 'Фильтр салона с активированным углём', partNumber: '4M0 819 439 A', note: 'аналог MANN CUK 31 003' }],
        match: CABIN,
      },
      {
        key: 'air',
        title: 'Воздушный фильтр',
        km: 30000,
        work: 'Замена воздушного фильтра',
        parts: [{ name: 'Фильтр воздушный', partNumber: '8W0 133 843 A', note: 'аналог MANN C 17 011' }],
        match: AIR,
      },
      {
        key: 'fuel',
        title: 'Топливный фильтр',
        km: 60000,
        work: 'Замена топливного фильтра',
        parts: [{ name: 'Фильтр топливный', note: 'оригинал по VIN, аналог MANN WK 6003' }],
        match: FUEL,
      },
      {
        key: 'brake',
        title: 'Тормозная жидкость',
        months: 24,
        work: 'Замена тормозной жидкости',
        parts: [{ name: 'Тормозная жидкость VW 501 14 (DOT 4)', qty: 1 }],
        match: BRAKE,
      },
      {
        key: 'dsg',
        title: 'Масло S tronic (7 ступ., DL382)',
        km: 60000,
        work: 'Замена масла и фильтра коробки S tronic',
        parts: [
          { name: 'Масло коробки S tronic', note: 'по VIN' },
          { name: 'Фильтр гидравлики коробки', partNumber: '0CK 325 149 D' },
        ],
        note: 'Интервал уточните в сервисной книжке',
        match: /(s\s?tronic|dsg|коробк[а-я]*\s+передач|кпп|акпп).*(масл)|масл[а-я]*.*(s\s?tronic|dsg|кпп|акпп|коробк)|трансмиссионн[а-я]*\s+масл|масл[а-я]*\s+трансмисс/i,
      },
      {
        key: 'timing',
        title: 'Ремень ГРМ с роликами и помпой',
        km: 210000,
        work: 'Замена ремня ГРМ, роликов и помпы',
        note: 'Для EA288 обычно ~210 000 км — уточните в сервисной книжке',
        match: /грм|зубчат[а-я]*\s+ремен/i,
      },
    ],
  },
  {
    id: 'generic',
    title: 'Базовый план',
    source: 'Общие рекомендации. Интервалы для вашей машины — в сервисной книжке.',
    items: [
      { key: 'oil', title: 'Масло двигателя и масляный фильтр', km: 15000, months: 12, work: 'Замена масла двигателя и масляного фильтра', parts: [{ name: 'Масло моторное' }, { name: 'Фильтр масляный' }], match: OIL },
      { key: 'cabin', title: 'Салонный фильтр', km: 15000, months: 12, work: 'Замена салонного фильтра', parts: [{ name: 'Фильтр салона' }], match: CABIN },
      { key: 'air', title: 'Воздушный фильтр', km: 30000, work: 'Замена воздушного фильтра', parts: [{ name: 'Фильтр воздушный' }], match: AIR },
      { key: 'brake', title: 'Тормозная жидкость', months: 24, work: 'Замена тормозной жидкости', parts: [{ name: 'Тормозная жидкость DOT 4' }], match: BRAKE },
    ],
  },
];

export function planFor(car: Car): Plan {
  const code = (car.engineCode || '').toUpperCase();
  return PLANS.find((p) => p.id === code) || PLANS.find((p) => p.id === 'generic')!;
}

/** Пользовательские правки плана: интервалы, отметка «сделано» без записи ТО, отключение пункта. */
export interface PlanOverride {
  km?: number | null;
  months?: number | null;
  doneDate?: number;
  doneKm?: number;
  off?: boolean;
}
export type PlanOverrides = Record<string, PlanOverride>;

export interface PlanStatus {
  item: PlanItem;
  km?: number;
  months?: number;
  lastDate?: number;
  lastKm?: number;
  lastSource?: 'history' | 'manual';
  dueKm?: number;
  dueDate?: number;
  kmLeft?: number;
  daysLeft?: number;
  state: 'overdue' | 'soon' | 'ok' | 'unknown';
  off: boolean;
}

const entryText = (s: ServiceEntry) => [s.title || '', ...s.works.map((w) => w.name), ...s.parts.map((p) => p.name)].join('\n');

export function planStatus(car: Car, services: ServiceEntry[], mileage: number | undefined, overrides: PlanOverrides = {}, now = Date.now()): PlanStatus[] {
  const plan = planFor(car);
  const hist = services.filter((s) => s.carId === car.id).sort((a, b) => b.date - a.date);
  return plan.items.map((item) => {
    const o = overrides[item.key] || {};
    const km = o.km === null ? undefined : o.km ?? item.km;
    const months = o.months === null ? undefined : o.months ?? item.months;
    const done = hist.find((s) => entryText(s).split('\n').some((line) => item.match.test(line)));
    let lastDate = done?.date;
    let lastKm = done?.mileage;
    let lastSource: PlanStatus['lastSource'] = done ? 'history' : undefined;
    if (o.doneDate && (!lastDate || o.doneDate > lastDate)) {
      lastDate = o.doneDate;
      lastKm = o.doneKm;
      lastSource = 'manual';
    }
    const dueKm = km && lastKm !== undefined ? lastKm + km : undefined;
    const dueDate = months && lastDate ? addMonths(lastDate, months) : undefined;
    const kmLeft = dueKm !== undefined && mileage ? dueKm - mileage : undefined;
    const daysLeft = dueDate ? Math.round((dueDate - now) / DAY) : undefined;
    let state: PlanStatus['state'] = 'unknown';
    if (lastDate) {
      if ((kmLeft !== undefined && kmLeft < 0) || (daysLeft !== undefined && daysLeft < 0)) state = 'overdue';
      else if ((kmLeft !== undefined && kmLeft <= 1500) || (daysLeft !== undefined && daysLeft <= 30)) state = 'soon';
      else state = 'ok';
    }
    return { item, km, months, lastDate, lastKm, lastSource, dueKm, dueDate, kmLeft, daysLeft, state, off: !!o.off };
  });
}

const RANK = { overdue: 0, soon: 1, unknown: 2, ok: 3 };
export const sortPlan = (list: PlanStatus[]) => [...list].sort((a, b) => Number(a.off) - Number(b.off) || RANK[a.state] - RANK[b.state] || (a.kmLeft ?? 1e9) - (b.kmLeft ?? 1e9));
