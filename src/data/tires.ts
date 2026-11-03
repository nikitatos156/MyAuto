// Шины: какой комплект стоит, пробег комплекта, сезонная замена (ТР ТС 018/2011: зимние шины — декабрь–февраль,
// шипованные запрещены в июне–августе), износ протектора и возраст.
import type { TireSeason, TireSet } from './types';

export const SEASON_LABEL: Record<TireSeason, string> = { summer: 'Летние', winter: 'Зимние', allseason: 'Всесезонные' };

export const tireTitle = (s: TireSet) =>
  [SEASON_LABEL[s.season] + (s.season === 'winter' ? (s.studded ? ', шипы' : ', липучка') : ''), [s.brand, s.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

const day = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
// по дню, а внутри дня — в порядке добавления (сначала сняли старый, потом поставили новый)
const sorted = (s: TireSet) =>
  s.events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => day(a.e.date) - day(b.e.date) || a.i - b.i)
    .map((x) => x.e);

export const isMounted = (s: TireSet) => s.status === 'active' && sorted(s).slice(-1)[0]?.action === 'install';

export function mountedSet(sets: TireSet[], carId: string) {
  return sets.filter((s) => s.carId === carId && isMounted(s)).sort((a, b) => (sorted(b).slice(-1)[0]?.date || 0) - (sorted(a).slice(-1)[0]?.date || 0) || b.updatedAt - a.updatedAt)[0];
}

/** Пробег комплекта: сумма отрезков «поставили → сняли»; для стоящего сейчас — до текущего пробега. */
export function tireMileage(s: TireSet, currentMileage?: number): number {
  let total = 0;
  let from: number | undefined;
  for (const e of sorted(s)) {
    if (e.action === 'install') from = e.mileage;
    else if (from !== undefined && e.mileage !== undefined && e.mileage > from) {
      total += e.mileage - from;
      from = undefined;
    } else from = undefined;
  }
  if (from !== undefined && currentMileage && currentMileage > from && isMounted(s)) total += currentMileage - from;
  return total;
}

export const tireAge = (s: TireSet, now = Date.now()) => (s.year ? new Date(now).getFullYear() - s.year : undefined);

/** Год из DOT: последние 4 цифры — неделя и год (3523 → 2023). */
export function yearFromDot(dot?: string) {
  const m = /(\d{2})(\d{2})\s*$/.exec((dot || '').trim());
  if (!m) return undefined;
  const y = 2000 + +m[2];
  return +m[1] >= 1 && +m[1] <= 53 && y <= new Date().getFullYear() + 1 ? y : undefined;
}

export interface TireAdvice {
  level: 'danger' | 'warn' | 'info';
  title: string;
  text: string;
}

/** Советы по стоящему комплекту: сезон, протектор, возраст. */
export function tireAdvice(sets: TireSet[], carId: string, now = Date.now()): TireAdvice[] {
  const out: TireAdvice[] = [];
  const m = mountedSet(sets, carId);
  const month = new Date(now).getMonth() + 1;
  const has = (season: TireSeason) => sets.some((s) => s.carId === carId && s.status === 'active' && s.season === season);
  if (m) {
    if (m.season === 'summer') {
      if (month === 12 || month <= 2) out.push({ level: 'danger', title: 'Стоит летняя резина', text: 'С декабря по февраль зимние шины обязательны' });
      else if (month >= 10) out.push({ level: 'warn', title: 'Пора на зимнюю резину', text: has('winter') ? 'Зимние шины обязательны с 1 декабря' : 'С 1 декабря нужны зимние шины — добавьте комплект' });
    }
    if (m.season === 'winter') {
      if (m.studded && month >= 6 && month <= 8) out.push({ level: 'danger', title: 'Стоят шипованные шины', text: 'С июня по август шипы запрещены' });
      else if (month >= 4 && month <= 8) out.push({ level: month >= 5 ? 'warn' : 'info', title: 'Пора на летнюю резину', text: m.studded ? 'Шипы запрещены с 1 июня' : 'Зимние шины летом хуже тормозят и быстрее изнашиваются' });
    }
    if (m.tread !== undefined) {
      const min = m.season === 'summer' ? 1.6 : 4;
      if (m.tread <= min) out.push({ level: 'danger', title: 'Изношен протектор', text: `${m.tread} мм — для ${m.season === 'summer' ? 'летних' : 'зимних'} шин нужно больше ${String(min).replace('.', ',')} мм` });
      else if (m.tread <= min + 1.5) out.push({ level: 'warn', title: 'Протектор почти изношен', text: `Осталось ${String(m.tread).replace('.', ',')} мм (минимум ${String(min).replace('.', ',')} мм)` });
    }
    const age = tireAge(m, now);
    if (age !== undefined && age >= 6) out.push({ level: 'info', title: `Шинам ${age} лет`, text: 'После 5–6 лет резина дубеет — проверьте на шиномонтаже' });
  }
  return out;
}
