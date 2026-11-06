// Напоминания: системные уведомления на Android, значок на иконке и календарь (.ics) для iPhone.
import { getAll, getSetting, setSetting } from '../data/db';
import { buildWidgetData, pushWidget } from './widget';
import { buildReminders, currentMileage, docMeta, effectiveExpiry, fineInfo, nextService } from '../data/logic';
import type { Car, DocEntry, Fine, FuelEntry, ServiceEntry, TireSet } from '../data/types';
import { mountedSet } from '../data/tires';
import type { PlanOverrides } from '../data/maintenance';
import { DAY, dateShort, daysWord, money, pad } from './format';
import { call, exportFile, isIOS, isNative, listen } from './native';

export interface Deadline {
  key: string;
  title: string;
  body: string;
  at: number; // момент события
  offsets: number[]; // за сколько дней напомнить
  route: string;
}

export async function loadAll() {
  const [cars, fuel, services, docs, fines, tires] = await Promise.all([
    getAll<Car>('cars'),
    getAll<FuelEntry>('fuel'),
    getAll<ServiceEntry>('services'),
    getAll<DocEntry>('documents'),
    getAll<Fine>('fines'),
    getAll<TireSet>('tires').catch(() => [] as TireSet[]),
  ]);
  const planOverrides = await loadPlanOverrides();
  return { cars, fuel, services, docs, fines, tires, planOverrides };
}

/** Правки планов обслуживания всех машин (ключи «plan:<id машины>» в настройках). */
export async function loadPlanOverrides(): Promise<Record<string, PlanOverrides>> {
  const rows = await getAll<{ key: string; value: PlanOverrides }>('settings');
  return Object.fromEntries(rows.filter((r) => r.key.startsWith('plan:')).map((r) => [r.key.slice(5), r.value]));
}

export async function collectDeadlines(): Promise<Deadline[]> {
  const { cars, fuel, services, docs, fines, tires } = await loadAll();
  const name = (id?: string) => {
    const c = cars.find((x) => x.id === id);
    return c ? `${c.make} ${c.model}` : '';
  };
  const out: Deadline[] = [];
  for (const f of fines) {
    if (f.status !== 'unpaid') continue;
    const fi = fineInfo(f);
    const what = `${f.article || 'Штраф'}${f.carId ? ' · ' + name(f.carId) : ''}`;
    if (fi.discountUntil && fi.discountUntil > Date.now()) {
      out.push({
        key: `fine-d:${f.id}`,
        title: 'Скидка 50% на штраф заканчивается',
        body: `${what}: ${money(Math.round(f.amount / 2))} вместо ${money(f.amount)} до ${dateShort(fi.discountUntil)}`,
        at: fi.discountUntil,
        offsets: [5, 2, 0],
        route: `#/fines/${f.id}`,
      });
    }
    if (fi.dueDate) {
      out.push({
        key: `fine-p:${f.id}`,
        title: 'Срок оплаты штрафа',
        body: `${what}: ${money(f.amount)}, оплатить до ${dateShort(fi.dueDate)}`,
        at: fi.dueDate,
        offsets: [10, 3, 0],
        route: `#/fines/${f.id}`,
      });
    }
  }
  for (const car of cars) {
    const ns = nextService(car, services, currentMileage(car, fuel, services));
    if (ns?.date) {
      out.push({
        key: `to:${car.id}`,
        title: `Скоро ТО-${ns.number} · ${car.make} ${car.model}`,
        body: `Плановое ТО до ${dateShort(ns.date)}${ns.mileage ? ` или на ${ns.mileage.toLocaleString('ru-RU')} км` : ''}`,
        at: ns.date,
        offsets: [30, 14, 3, 0],
        route: '#/service',
      });
    }
  }
  // сезонная замена шин: зимние с 1 декабря, шипы снять до 1 июня
  const now = new Date();
  for (const car of cars) {
    const m = mountedSet(tires, car.id);
    if (!m) continue;
    const y = now.getFullYear();
    if (m.season === 'summer') {
      const dec1 = new Date(now.getMonth() === 11 ? y + 1 : y, 11, 1).getTime();
      out.push({ key: `tires-w:${car.id}`, title: `Зимняя резина · ${car.make} ${car.model}`, body: 'С 1 декабря зимние шины обязательны — запишитесь на шиномонтаж', at: dec1, offsets: [45, 21, 7, 1], route: '#/tires' });
    } else if (m.season === 'winter') {
      const jun1 = new Date(now.getMonth() >= 5 ? y + 1 : y, 5, 1).getTime();
      const apr15 = new Date(now.getMonth() >= 3 ? y + 1 : y, 3, 15).getTime();
      if (m.studded) out.push({ key: `tires-s:${car.id}`, title: `Снять шипы · ${car.make} ${car.model}`, body: 'С 1 июня шипованные шины запрещены', at: jun1, offsets: [30, 10, 2], route: '#/tires' });
      else out.push({ key: `tires-s:${car.id}`, title: `Летняя резина · ${car.make} ${car.model}`, body: 'Пора переобуваться на летние шины', at: apr15, offsets: [0], route: '#/tires' });
    }
  }
  for (const d of docs) {
    const until = effectiveExpiry(d);
    if (d.status !== 'active' || !until) continue;
    const meta = docMeta(d.type);
    out.push({
      key: `doc:${d.id}`,
      title: `Заканчивается ${meta.short}`,
      body: `${meta.short}${d.carId ? ' · ' + name(d.carId) : d.holder ? ' · ' + d.holder : ''} действует до ${dateShort(until)}`,
      at: until,
      offsets: [30, 14, 7, 1],
      route: `#/docs/${d.id}`,
    });
  }
  return out;
}

function hashId(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2000000000;
}

const at10 = (t: number) => {
  const d = new Date(t);
  d.setHours(10, 0, 0, 0);
  return d.getTime();
};

/** Пересобрать расписание уведомлений и значок на иконке. */
export async function refreshReminders() {
  try {
    const data = await loadAll();
    const lastBackup = await getSetting<number>('lastBackupAt', 0);
    const reminders = buildReminders({ ...data, lastBackup });
    pushWidget(buildWidgetData(data));
    const urgent = reminders.filter((r) => r.kind !== 'backup').length;
    const nav: any = navigator;
    if (nav.setAppBadge) (urgent ? nav.setAppBadge(urgent) : nav.clearAppBadge?.())?.catch?.(() => {});
    if (!isNative()) return;
    const enabled = await getSetting<boolean>('notifications', true);
    const prevIds: number[] = await getSetting<number[]>('scheduledIds', []);
    if (prevIds.length) {
      await call('LocalNotifications', 'cancel', { notifications: prevIds.map((id) => ({ id })) }).catch(() => {});
    }
    if (!enabled) {
      await setSetting('scheduledIds', []);
      return;
    }
    const perm = await call<{ display: string }>('LocalNotifications', 'checkPermissions').catch(() => ({ display: 'denied' }));
    if (perm.display !== 'granted') return;
    const deadlines = await collectDeadlines();
    const now = Date.now();
    const list: any[] = [];
    for (const d of deadlines) {
      for (const off of d.offsets) {
        const when = at10(d.at - off * DAY);
        if (when <= now + 60000) continue;
        list.push({
          id: hashId(`${d.key}:${off}`),
          title: d.title,
          body: off ? `${d.body} (через ${daysWord(off)})` : d.body,
          schedule: { at: new Date(when), allowWhileIdle: true },
          extra: { route: d.route },
          smallIcon: 'ic_stat_myauto',
          iconColor: '#E8590C',
        });
      }
    }
    // ежемесячное напоминание о резервной копии
    const bk = (lastBackup || now) + 31 * DAY;
    list.push({
      id: hashId('backup'),
      title: 'Пора сделать резервную копию',
      body: 'Откройте My Auto — копия сохранится автоматически',
      schedule: { at: new Date(Math.max(at10(bk), now + 3600000)), allowWhileIdle: true },
      extra: { route: '#/settings' },
      smallIcon: 'ic_stat_myauto',
    });
    // Android ограничивает число запланированных будильников — оставляем ближайшие 60
    list.sort((a, b) => a.schedule.at.getTime() - b.schedule.at.getTime());
    const top = list.slice(0, 60);
    if (top.length) await call('LocalNotifications', 'schedule', { notifications: top });
    await setSetting(
      'scheduledIds',
      top.map((n) => n.id),
    );
  } catch (e) {
    console.warn('refreshReminders', e);
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const r = await call<{ display: string }>('LocalNotifications', 'requestPermissions');
    return r.display === 'granted';
  } catch {
    return false;
  }
}

export async function notificationPermission(): Promise<string> {
  if (!isNative()) return 'web';
  try {
    const r = await call<{ display: string }>('LocalNotifications', 'checkPermissions');
    return r.display;
  } catch {
    return 'unknown';
  }
}

export function initNotificationTaps() {
  if (!isNative()) return;
  listen('LocalNotifications', 'localNotificationActionPerformed', (data: any) => {
    const route = data?.notification?.extra?.route;
    if (route) location.hash = route;
  });
}

// --- календарь (.ics) ---
const icsDate = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};
const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

export function buildIcs(deadlines: Deadline[]) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MyAuto//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const d of deadlines) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.key.replace(/[^a-z0-9-]/gi, '')}-${icsDate(d.at)}@myauto`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(d.at)}`,
      `DTEND;VALUE=DATE:${icsDate(d.at + DAY)}`,
      `SUMMARY:${icsEsc(d.title)}`,
      `DESCRIPTION:${icsEsc(d.body)}`,
    );
    for (const off of d.offsets.filter((o) => o > 0).slice(0, 2)) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(d.title)}`, `TRIGGER:-P${off}DT0H`, 'END:VALARM');
    }
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(d.title)}`, 'TRIGGER:PT10H', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export async function exportCalendar(deadlines?: Deadline[]) {
  const list = deadlines || (await collectDeadlines()).filter((d) => d.at > Date.now() - DAY);
  if (!list.length) throw new Error('Нет предстоящих сроков');
  const ics = buildIcs(list);
  if (!isNative() && isIOS()) {
    // Safari на iPhone сам предлагает «Добавить все» в Календарь для text/calendar
    const url = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    const w = window.open(url, '_blank');
    if (!w) location.href = url;
    return list.length;
  }
  const blob = new Blob([ics], { type: 'text/calendar' });
  await exportFile(blob, 'myauto-napominaniya.ics', 'Напоминания My Auto');
  return list.length;
}
