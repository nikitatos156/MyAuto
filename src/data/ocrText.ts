// Общие помощники для разбора распознанного текста: нормализация, нечёткий поиск подписей, голосование.
// Текст приходит из нескольких проходов распознавания с разными ошибками — значения выбираются
// большинством голосов, а номера (VIN, госномер, серии) — посимвольно.

// Латинские буквы, похожие на кириллицу (OCR часто путает), и обратно.
export const LAT2CYR: Record<string, string> = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
export const CYR2LAT: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };

export const toCyrUpper = (s: string) => s.toUpperCase().replace(/[ABEKMHOPCTYX]/g, (c) => LAT2CYR[c] || c);
export const toLatUpper = (s: string) => s.toUpperCase().replace(/[АВЕКМНОРСТУХ]/g, (c) => CYR2LAT[c] || c);

/** Цифровой контекст: буквы, похожие на цифры. */
export function digitsFix(s: string) {
  return s
    .replace(/[OoОоDQ]/g, '0')
    .replace(/[Il|!іІ]/g, '1')
    .replace(/[Зз]/g, '3')
    .replace(/[Бб]/g, '6')
    .replace(/[S$]/g, '5')
    .replace(/[Ч]/g, '4')
    .replace(/[B]/g, '8');
}

export function cleanText(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/[“”«»„]/g, '"')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ');
}

export const lines = (text: string) =>
  cleanText(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

// Для поиска подписей: строчные, ё→е, латинские двойники → кириллица (1:1 по длине).
const LBL: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', n: 'п', o: 'о', p: 'р', r: 'г', t: 'т', u: 'и', x: 'х', y: 'у',
  '3': 'з', '0': 'о', '6': 'б',
};
export const labelNorm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[a-z036]/g, (c) => LBL[c] || c);

/** Нечёткий поиск подстроки (алгоритм Селлерса). Возвращает конец лучшего совпадения. */
export function fuzzyFind(hay: string, needle: string, maxErr: number): { start: number; end: number; err: number } | null {
  const n = needle.length;
  if (!n) return null;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  let prevStart = new Array(n + 1);
  let curStart = new Array(n + 1);
  for (let j = 0; j <= n; j++) {
    prev[j] = j;
    prevStart[j] = 0;
  }
  let best: { start: number; end: number; err: number } | null = null;
  for (let i = 1; i <= hay.length; i++) {
    cur[0] = 0;
    curStart[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = hay[i - 1] === needle[j - 1] ? 0 : 1;
      let v = prev[j - 1] + cost;
      let st = prevStart[j - 1];
      if (prev[j] + 1 < v) {
        v = prev[j] + 1;
        st = prevStart[j];
      }
      if (cur[j - 1] + 1 < v) {
        v = cur[j - 1] + 1;
        st = curStart[j - 1];
      }
      cur[j] = v;
      curStart[j] = st;
    }
    if (cur[n] <= maxErr && (!best || cur[n] < best.err)) best = { start: cur[n] === 0 ? i - n : curStart[n], end: i, err: cur[n] };
    [prev, cur] = [cur, prev];
    [prevStart, curStart] = [curStart, prevStart];
  }
  return best;
}

export const allowedErr = (len: number) => (len <= 3 ? 0 : len <= 5 ? 1 : len <= 8 ? 2 : 3);

/** Найти подпись в строке (любой из вариантов). Возвращает позицию конца подписи в исходной строке. */
export function findLabel(line: string, keys: string[]): { start: number; end: number; err: number } | null {
  const h = labelNorm(line);
  let best: { start: number; end: number; err: number } | null = null;
  for (const k of keys) {
    const len = k.replace(/\s/g, '').length;
    const r = fuzzyFind(h, k, allowedErr(len));
    if (!r) continue;
    // короткие подписи — только с начала слова (иначе «строение» находится в «состоянии»)
    if (len <= 8 && r.start > 0 && /[а-яa-z]/.test(h[r.start - 1]) && r.err > 0) continue;
    if (!best || r.err < best.err || (r.err === best.err && r.end > best.end)) best = r;
  }
  return best;
}

export const hasLabel = (line: string, keys: string[]) => !!findLabel(line, keys);

/** Текст после подписи (без хвостов вида «ТС», «№», «кг», двоеточий). */
export function afterLabel(line: string, keys: string[]): string | null {
  const r = findLabel(line, keys);
  if (!r) return null;
  return line
    .slice(r.end)
    .replace(/^[\s.,:;№N"'`’)(\]|-]+/, '')
    .trim();
}

// ---------- голосование ----------
export class Votes {
  private m = new Map<string, Map<string, number>>();
  add(field: string, value: string | undefined | null, w = 1) {
    if (value == null) return;
    const v = String(value).trim();
    if (!v || w <= 0) return;
    let f = this.m.get(field);
    if (!f) this.m.set(field, (f = new Map()));
    f.set(v, (f.get(v) || 0) + w);
  }
  list(field: string): [string, number][] {
    return Array.from(this.m.get(field)?.entries() || []).sort((a, b) => b[1] - a[1]);
  }
  best(field: string): string | undefined {
    return this.list(field)[0]?.[0];
  }
  /** Посимвольное голосование среди кандидатов одной длины (для номеров фиксированного формата). */
  chars(field: string): string | undefined {
    return voteChars(this.list(field));
  }
  has(field: string) {
    return !!this.m.get(field)?.size;
  }
}

export function voteChars(cands: [string, number][]): string | undefined {
  if (!cands.length) return undefined;
  const byLen = new Map<number, [string, number][]>();
  for (const c of cands) {
    const l = c[0].length;
    if (!byLen.has(l)) byLen.set(l, []);
    byLen.get(l)!.push(c);
  }
  const group = Array.from(byLen.values()).sort((a, b) => b.reduce((s, x) => s + x[1], 0) - a.reduce((s, x) => s + x[1], 0))[0];
  const len = group[0][0].length;
  let out = '';
  for (let i = 0; i < len; i++) {
    const score = new Map<string, number>();
    for (const [s, w] of group) score.set(s[i], (score.get(s[i]) || 0) + w);
    out += Array.from(score.entries()).sort((a, b) => b[1] - a[1])[0][0];
  }
  return out;
}

export function levenshtein(a: string, b: string) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: number, m: number, y: number) => `${y}-${pad(m)}-${pad(d)}`;

export interface DateHit {
  iso: string;
  t: number;
  index: number;
}
export function findDates(text: string): DateHit[] {
  const out: DateHit[] = [];
  const re = /(\d{1,2})\s?[.,/-]\s?(\d{1,2})\s?[.,/-]\s?((?:19|20)\d{2}|\d{2})(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const d = +m[1], mo = +m[2];
    let y = +m[3];
    if (y < 100) y += y > 50 ? 1900 : 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 1940 || y > 2060) continue;
    out.push({ iso: isoDate(d, mo, y), t: new Date(y, mo - 1, d).getTime(), index: m.index });
  }
  return out;
}

export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => (/^[\s-]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');

// ---------- госномер ----------
const PLATE_L = 'АВЕКМНОРСТУХABEKMHOPCTYX';
export interface PlateHit {
  plate: string;
  region: string;
  index: number;
}
export function findPlates(line: string): PlateHit[] {
  const L8 = `[${PLATE_L}80]`;
  const re = new RegExp(`(?<![${PLATE_L}\\d])(${L8})\\s?([\\dOoОоЗз]{3})\\s?(${L8}${L8})\\s?(?:RUS)?\\s?(\\d{2,3})(?![\\d])`, 'g');
  const up = line.toUpperCase();
  const out: PlateHit[] = [];
  for (const m of up.matchAll(re)) {
    const letters = m[1] + m[3];
    if (!new RegExp(`[${PLATE_L}]`).test(letters)) continue; // одни цифры — это не номер
    const toCyr = (s: string) => toCyrUpper(s.replace(/8/g, 'В').replace(/0/g, 'О'));
    out.push({ plate: `${toCyr(m[1])}${digitsFix(m[2])}${toCyr(m[3])}`, region: m[4], index: m.index || 0 });
  }
  return out;
}

// ---------- VIN ----------
const VIN_OK = /^[A-HJ-NPR-Z0-9]{17}$/;
const WMI_START = /^[1-9A-HJ-NPR-Z]/;
/**
 * VIN-кандидаты строки. Берём отдельные «слова» длиной 16–19 знаков (и пары соседних слов —
 * OCR иногда вставляет пробел внутрь VIN). Строки с длинными цифровыми кодами (ICCID) пропускаем.
 */
export function vinCandidates(line: string): string[] {
  if (/ICCID/i.test(line) || /\d{12,}/.test(line)) return [];
  // одобрение типа ТС (TCRUE-DE.MT02.00843) и прочие коды с точками — не VIN
  const toks = toLatUpper(line)
    .split(/[\s|]+/)
    .filter((t) => !/[A-Z0-9][.\/][A-Z0-9]/.test(t))
    .map((t) => t.replace(/[^A-ZА-ЯЁ0-9]/g, ''))
    .filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    chunks.push(toks[i]);
    if (i + 1 < toks.length && toks[i].length >= 6 && toks[i + 1].length >= 6) chunks.push(toks[i] + toks[i + 1]);
  }
  const out: { v: string; score: number }[] = [];
  for (const raw of chunks) {
    if (raw.length < 17 || raw.length > 18 || /[А-ЯЁ]/.test(raw)) continue;
    // 18 знаков — вероятно, лишний символ: оставляем как есть, выравнивание — в finalVin
    let v = raw.replace(/[OQ]/g, '0').replace(/I/g, '1');
    if (!/^[A-HJ-NPR-Z0-9]+$/.test(v)) continue;
    const digits = (v.match(/\d/g) || []).length;
    if (digits < 5 || digits > 14) continue;
    const tail = v.slice(-6).replace(/[SZBGDT]/g, (c) => ({ S: '5', Z: '2', B: '8', G: '6', D: '0', T: '7' } as any)[c]);
    v = v.slice(0, -6) + tail;
    let score = raw.length === 17 ? 1 : 0;
    if (/^\d{6}$/.test(v.slice(-6))) score += 2;
    if (WMI_START.test(v) && /[A-Z]/.test(v.slice(0, 3))) score += 1;
    if (/^(W|X|Z|T|V|S|J|K|L|Y|1|2|3|4|5)/.test(v)) score += 1;
    out.push({ v, score });
  }
  if (!out.length) return [];
  const max = Math.max(...out.map((o) => o.score));
  return Array.from(new Set(out.filter((o) => o.score >= max - 1).map((o) => o.v)));
}

const VAG_WMI = /^(WAU|WA1|WVW|WV1|WV2|WVG|TMB|VSS|XW8|XW0|TRU|WUA)/;
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';
/** Код модельного года VIN (10-й знак) для года выпуска: 2010 → A, 2019 → K… */
export const vinYearCode = (y: number) => (y >= 2010 ? YEAR_CODES[(y - 2010) % 30] : y >= 2001 ? String(y - 2000) : '');

/** Итоговый VIN: посимвольное голосование + проверки по WMI и году. */
export function finalVin(cands: [string, number][], year?: number): string | undefined {
  const base = cands.filter((c) => c[0].length === 17);
  if (!base.length) return undefined;
  // центр — кандидат, рядом с которым (≤5 отличий) больше всего голосов; остальное — шум
  const ham = (a: string, b: string) => {
    let d = 0;
    for (let i = 0; i < 17; i++) if (a[i] !== b[i]) d++;
    return d;
  };
  let center = base[0][0];
  let centerW = -1;
  for (const [a] of base) {
    const w = base.reduce((s, [b, wb]) => s + (ham(a, b) <= 5 ? wb : 0), 0);
    if (w > centerW) {
      centerW = w;
      center = a;
    }
  }
  // 18-значные кандидаты: убираем один «лишний» знак так, чтобы было ближе всего к центру
  const c17: [string, number][] = [...base];
  for (const [s18, w] of cands.filter((c) => c[0].length === 18)) {
    let best = '';
    let bd = 99;
    for (let i = 0; i < 18; i++) {
      const t = s18.slice(0, i) + s18.slice(i + 1);
      const d = ham(t, center);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (bd <= 5) c17.push([best, w]);
  }
  const near = c17.filter(([b]) => ham(center, b) <= 6);
  let v = voteChars(near);
  if (!v) return undefined;
  if (VAG_WMI.test(v) && /^[Z72]{3}$/.test(v.slice(3, 6))) v = v.slice(0, 3) + 'ZZZ' + v.slice(6);
  if (year) {
    const ok = [vinYearCode(year), vinYearCode(year + 1)].filter(Boolean);
    if (!ok.includes(v[9])) {
      // если среди кандидатов есть подходящий 10-й знак — берём его
      const alt = near.map((c) => c[0][9]).find((c) => ok.includes(c));
      if (alt) v = v.slice(0, 9) + alt + v.slice(10);
    }
  }
  return v;
}

// ---------- транслитерация (СТС, ВУ: фамилия и имя дублируются латиницей) ----------
const TR: [string, string][] = [
  ['SHCH', 'Щ'], ['KH', 'Х'], ['ZH', 'Ж'], ['TS', 'Ц'], ['CH', 'Ч'], ['SH', 'Ш'], ['IU', 'Ю'], ['YU', 'Ю'], ['IA', 'Я'], ['YA', 'Я'],
  ['IE', 'ЬЕ'], ['A', 'А'], ['B', 'Б'], ['V', 'В'], ['G', 'Г'], ['D', 'Д'], ['E', 'Е'], ['Z', 'З'], ['I', 'И'], ['K', 'К'], ['L', 'Л'],
  ['M', 'М'], ['N', 'Н'], ['O', 'О'], ['P', 'П'], ['R', 'Р'], ['S', 'С'], ['T', 'Т'], ['U', 'У'], ['F', 'Ф'], ['Y', 'Ы'], ["'", 'Ь'],
];
export function latToCyr(s: string) {
  let out = '';
  const u = s.toUpperCase().replace(/[’`]/g, "'");
  for (let i = 0; i < u.length; ) {
    const hit = TR.find(([l]) => u.startsWith(l, i));
    if (hit) {
      out += hit[1];
      i += hit[0].length;
    } else i++;
  }
  // типичные окончания: ИЙ/ЫЙ (I → Й в конце после гласной)
  return out.replace(/([АЕИОУЫ])И$/, '$1Й').replace(/ИИ$/, 'ИЙ');
}
const CT: Record<string, string> = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'ZH', З: 'Z', И: 'I', Й: 'I', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R',
  С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'KH', Ц: 'TS', Ч: 'CH', Ш: 'SH', Щ: 'SHCH', Ъ: 'IE', Ы: 'Y', Ь: '', Э: 'E', Ю: 'IU', Я: 'IA',
};
export const cyrToLat = (s: string) =>
  s
    .toUpperCase()
    .split('')
    .map((c) => (c in CT ? CT[c] : c))
    .join('');
