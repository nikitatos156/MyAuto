// Форматирование чисел, денег и дат на русском.

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (v?: number | null, digits = 0) =>
  v == null || isNaN(v) ? '—' : digits === 0 ? nf0.format(v) : digits === 1 ? nf1.format(v) : nf2.format(v);

export const money = (v?: number | null, cents = false) => {
  if (v == null || isNaN(v)) return '—';
  const rounded = Math.round(v * 100) / 100;
  const hasCents = cents && Math.abs(rounded % 1) > 0.001;
  return (hasCents ? nf2.format(rounded) : nf0.format(Math.round(rounded))) + ' ₽';
};

export const km = (v?: number | null) => (v == null ? '—' : nf0.format(v) + ' км');

export const liters = (v?: number | null) => (v == null ? '—' : nf2.format(v).replace(/,00$/, '') + ' л');

const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const monthsFull = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

export const pad = (n: number) => String(n).padStart(2, '0');

export const dateShort = (t?: number) => {
  if (!t) return '—';
  const d = new Date(t);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

export const dateHuman = (t?: number) => {
  if (!t) return '—';
  const d = new Date(t);
  const now = new Date();
  const s = `${d.getDate()} ${months[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? s : `${s} ${d.getFullYear()}`;
};

export const monthTitle = (t: number) => {
  const d = new Date(t);
  return `${monthsFull[d.getMonth()]} ${d.getFullYear()}`;
};

export const timeShort = (t?: number) => {
  if (!t) return '';
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// значения для <input type="date"> / datetime-local
export const toDateInput = (t?: number) => {
  if (!t) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const fromDateInput = (s: string): number | undefined => {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
};
export const toDateTimeInput = (t?: number) => {
  if (!t) return '';
  const d = new Date(t);
  return `${toDateInput(t)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromDateTimeInput = (s: string): number | undefined => {
  if (!s) return undefined;
  const t = new Date(s).getTime();
  return isNaN(t) ? undefined : t;
};

export const DAY = 24 * 3600 * 1000;

export const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const daysUntil = (t: number) => Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY);

export const addMonths = (t: number, m: number) => {
  const d = new Date(t);
  const day = d.getDate();
  d.setMonth(d.getMonth() + m);
  if (d.getDate() < day) d.setDate(0);
  return d.getTime();
};

export const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

export const daysWord = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

export const relDays = (t: number) => {
  const n = daysUntil(t);
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n === -1) return 'вчера';
  if (n < 0) return `${daysWord(-n)} назад`;
  return `через ${daysWord(n)}`;
};

export const parseNum = (s: string | number | undefined | null): number | undefined => {
  if (s == null) return undefined;
  if (typeof s === 'number') return isNaN(s) ? undefined : s;
  const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  return isNaN(v) ? undefined : v;
};

export const bytes = (n: number) => {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${num(n / 1024, 0)} КБ`;
  if (n < 1024 * 1024 * 1024) return `${num(n / 1024 / 1024, 1)} МБ`;
  return `${num(n / 1024 / 1024 / 1024, 2)} ГБ`;
};

export const carTitle = (c?: { make: string; model: string } | null) => (c ? `${c.make} ${c.model}` : '');
