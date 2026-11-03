// Виджет Android на рабочем столе: ближайшее ТО и окончание ОСАГО по машинам, неоплаченные штрафы.
// Веб-часть собирает короткие строки и передаёт их нативному плагину MyAutoNative,
// виджет только показывает их (сроки — датами, поэтому строки не «стареют» без запуска приложения).
// Здесь же — открытие нужного экрана по ссылке myauto://… (кнопка «Документы» на виджете).
import type { Car, DocEntry, Fine, FuelEntry, ServiceEntry } from '../data/types';
import { currentMileage, fineInfo, nextService } from '../data/logic';
import { dateShort, money, num, plural, timeShort } from './format';
import { call, isNative, listen } from './native';

export interface WidgetLine {
  text: string;
  tone: 'ok' | 'warn' | 'danger' | 'muted';
}
export interface WidgetData {
  title: string;
  updated: string;
  lines: WidgetLine[];
}

export function buildWidgetData(d: { cars: Car[]; fuel: FuelEntry[]; services: ServiceEntry[]; docs: DocEntry[]; fines: Fine[] }, now = Date.now()): WidgetData {
  const lines: WidgetLine[] = [];
  for (const car of d.cars.slice(0, 3)) {
    const mileage = currentMileage(car, d.fuel, d.services);
    const ns = nextService(car, d.services, mileage);
    if (ns) {
      let when: string;
      if (ns.overdue) {
        const over = [ns.kmLeft !== undefined && ns.kmLeft < 0 ? `на ${num(-ns.kmLeft)} км` : '', ns.date && ns.date < now ? `срок был ${dateShort(ns.date)}` : ''];
        when = 'просрочено ' + over.filter(Boolean).join(', ');
      } else {
        const parts = [ns.kmLeft !== undefined ? `через ${num(ns.kmLeft)} км` : '', ns.date ? `до ${dateShort(ns.date)}` : ''];
        when = parts.filter(Boolean).join(' или ');
      }
      lines.push({ text: `${car.model} · ТО-${ns.number} ${when}`.trim(), tone: ns.overdue ? 'danger' : ns.soon ? 'warn' : 'ok' });
    }
    const osago = d.docs.filter((x) => x.type === 'osago' && x.status === 'active' && x.carId === car.id && x.expiryDate).sort((a, b) => b.expiryDate! - a.expiryDate!)[0];
    if (osago) {
      const days = Math.ceil((osago.expiryDate! - now) / 864e5);
      lines.push({
        text: `${car.model} · ОСАГО ${days < 0 ? 'истёк' : 'до'} ${dateShort(osago.expiryDate)}`,
        tone: days < 0 ? 'danger' : days <= 30 ? 'warn' : 'ok',
      });
    } else lines.push({ text: `${car.model} · ОСАГО не добавлен`, tone: 'muted' });
  }
  const unpaid = d.fines.filter((f) => f.status === 'unpaid');
  if (unpaid.length) {
    const infos = unpaid.map(fineInfo);
    const sum = infos.reduce((a, i) => a + i.toPay, 0);
    const disc = infos.filter((i) => i.discountActive && i.daysToDiscountEnd !== undefined).sort((a, b) => a.daysToDiscountEnd! - b.daysToDiscountEnd!)[0];
    lines.push({
      text: `Штрафы: ${unpaid.length} ${plural(unpaid.length, 'неоплаченный', 'неоплаченных', 'неоплаченных')} · ${money(sum)}${disc?.discountUntil ? ` · скидка до ${dateShort(disc.discountUntil)}` : ''}`,
      tone: infos.some((i) => i.overdue) ? 'danger' : 'warn',
    });
  } else lines.push({ text: 'Неоплаченных штрафов нет', tone: 'ok' });
  return { title: 'My Auto', updated: `${dateShort(now)} ${timeShort(now)}`, lines: lines.slice(0, 7) };
}

let last = '';
/** Передать данные виджету (только Android; без нового APK вызов молча игнорируется). */
export async function pushWidget(data: WidgetData) {
  if (!isNative()) return;
  const json = JSON.stringify(data);
  if (json === last) return;
  try {
    await call('MyAutoNative', 'updateWidget', { data: json });
    last = json;
  } catch {
    /* старый APK без виджета */
  }
}

/** Ссылки myauto://show и т.п. (кнопки виджета) → экран приложения. */
export function initDeepLinks() {
  if (!isNative()) return;
  const open = (url?: string) => {
    const m = /^myauto:\/\/([a-z0-9/_-]*)/i.exec(url || '');
    if (m) location.hash = '#/' + m[1];
  };
  call<{ url?: string }>('App', 'getLaunchUrl')
    .then((r) => open(r?.url))
    .catch(() => {});
  listen('App', 'appUrlOpen', (d) => open(d?.url));
}
