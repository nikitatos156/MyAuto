// Разбор распознанного текста документов: СТС, ПТС, ВУ, ОСАГО, КАСКО, ГРЗ и чеков АЗС.
// OCR ошибается, поэтому правила терпимы к похожим буквам и пробелам. Всё заполненное можно исправить в форме.
import type { DocType } from './types';
import { Votes, finalVin, latToCyr, cyrToLat, levenshtein, toCyrUpper } from './ocrText';
import { looksLikeSts, parseSts } from './stsParse';
import { fuelFromReceipt } from './fuels';

export interface ParsedDoc {
  fields: Record<string, string>; // ключи полей формы документа
  extra: { vin?: string; plate?: string; region?: string; make?: string; model?: string; year?: string; power?: string };
}

const CYR2LAT: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };
const LAT2CYR: Record<string, string> = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
const PLATE_L = 'АВЕКМНОРСТУХABEKMHOPCTYX';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: number, m: number, y: number) => `${y}-${pad(m)}-${pad(d)}`;

function clean(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/[“”«»]/g, '"')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/[ \t]+/g, ' ')
    .replace(/ /g, ' ');
}

/** Цифровой контекст: буквы, похожие на цифры. */
function digitsFix(s: string) {
  return s.replace(/[OoОо]/g, '0').replace(/[Il|!іІ]/g, '1').replace(/[Зз]/g, '3').replace(/[Бб]/g, '6').replace(/[S]/g, '5');
}

interface DateHit {
  iso: string;
  t: number;
  index: number;
}
function findDates(text: string): DateHit[] {
  const out: DateHit[] = [];
  const re = /(\d{1,2})\s?[.,/-]\s?(\d{1,2})\s?[.,/-]\s?((?:19|20)\d{2}|\d{2})(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const d = +m[1], mo = +m[2];
    let y = +m[3];
    if (y < 100) y += y > 50 ? 1900 : 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 1940 || y > 2060) continue;
    out.push({ iso: iso(d, mo, y), t: new Date(y, mo - 1, d).getTime(), index: m.index });
  }
  return out;
}

function dateNear(text: string, words: RegExp, maxGap = 60): string | undefined {
  const m = words.exec(text);
  if (!m) return undefined;
  const after = findDates(text.slice(m.index, m.index + m[0].length + maxGap));
  return after[0]?.iso;
}

function findPlate(text: string): { plate: string; region: string } | undefined {
  const L = `[${PLATE_L}]`;
  const L8 = `[${PLATE_L}80]`;
  const re = new RegExp(`(?<![${PLATE_L}\\d])(${L8})\\s?([\\dOoОоЗз]{3})\\s?(${L8}${L8})\\s?(?:RUS)?\\s?(\\d{2,3})(?!\\d)`, 'g');
  const up = text.toUpperCase();
  let m: RegExpExecArray | null = null;
  for (const cand of up.matchAll(re)) {
    const letters = cand[1] + cand[3];
    if (/[8 0]/.test(letters) && !new RegExp(L).test(letters)) continue; // одни цифры — это не номер
    m = cand;
    break;
  }
  if (!m) return undefined;
  const toCyr = (s: string) => s.replace(/8/g, 'В').replace(/0/g, 'О').replace(/[ABEKMHOPCTYX]/g, (c) => LAT2CYR[c] || c);
  return { plate: `${toCyr(m[1])}${digitsFix(m[2])}${toCyr(m[3])}`, region: m[4] };
}

function findVin(text: string): string | undefined {
  const up = text.toUpperCase();
  const tokens = up.match(/[A-ZА-Я0-9]{17}/g) || [];
  const near = /VIN[^A-ZА-Я0-9]{0,15}([A-ZА-Я0-9 ]{17,21})/.exec(up);
  const cands = near ? [near[1].replace(/\s/g, '').slice(0, 17), ...tokens] : tokens;
  for (const c of cands) {
    if (c.length !== 17) continue;
    const v = c.replace(/[А-Я]/g, (ch) => CYR2LAT[ch] || ch).replace(/O/g, '0').replace(/[IQ]/g, (ch) => (ch === 'I' ? '1' : '0'));
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) continue;
    if (!/\d/.test(v) || !/[A-Z]/.test(v)) continue;
    if (/\d{6}$/.test(v) || near) return v; // VIN почти всегда заканчивается цифрами
  }
  return undefined;
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** ФИО: 2–3 слова кириллицей заглавными после ключевого слова. */
function personAfter(text: string, key: RegExp): string | undefined {
  const m = key.exec(text);
  if (!m) return undefined;
  const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 140);
  const p = /([А-ЯЁ]{2,}(?:-[А-ЯЁ]{2,})?)\s+([А-ЯЁ]{2,})(?:\s+([А-ЯЁ]{2,}))?/.exec(tail);
  if (!p) return undefined;
  return titleCase([p[1], p[2], p[3]].filter(Boolean).join(' '));
}

const INSURERS: [RegExp, string][] = [
  [/ингосстрах/i, 'Ингосстрах'],
  [/альфа\s?страх/i, 'АльфаСтрахование'],
  [/ресо/i, 'РЕСО-Гарантия'],
  [/согаз/i, 'СОГАЗ'],
  [/росгосстрах|ргс/i, 'Росгосстрах'],
  [/(?<![а-яё])вск(?![а-яё])|военно-страховая/i, 'ВСК'],
  [/согласие/i, 'Согласие'],
  [/т-?страхование|тинькофф/i, 'Т-Страхование'],
  [/сбербанк\s?страхование|сберстрахование/i, 'Сбербанк страхование'],
  [/ренессанс/i, 'Ренессанс Страхование'],
  [/зетта/i, 'Зетта Страхование'],
  [/югория/i, 'Югория'],
  [/абсолют/i, 'Абсолют Страхование'],
  [/энергогарант/i, 'Энергогарант'],
  [/гайде/i, 'Гайде'],
  [/(?<![а-яё])пари(?![а-яё])/i, 'ПАРИ'],
  [/астро-?волга/i, 'Астро-Волга'],
  [/(?<![а-яё])макс(?![а-яё])/i, 'МАКС'],
  [/совкомбанк\s?страхование/i, 'Совкомбанк страхование'],
];

function insurer(text: string) {
  for (const [re, name] of INSURERS) if (re.test(text)) return name;
  return undefined;
}

function moneyAfter(text: string, key: RegExp): string | undefined {
  const m = key.exec(text);
  if (!m) return undefined;
  const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
  const v = /(\d[\d ]{0,9}(?:[.,]\d{2})?)\s*(?:руб|р\.|₽|RUB)?/i.exec(tail);
  if (!v) return undefined;
  const n = parseFloat(v[1].replace(/\s/g, '').replace(',', '.'));
  return n > 0 ? String(n) : undefined;
}

function phone(text: string) {
  const m = /(?:\+7|8)[\s(-]*(\d{3})[\s)-]*(\d{3})[\s-]*(\d{2})[\s-]*(\d{2})/.exec(text);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : undefined;
}

/** Период «с … по …»: пара дат, где вторая позже первой. */
function period(text: string): { start?: string; end?: string } {
  const key = /(срок\s+(?:страхования|действия)|период\s+(?:использования|страхования)|\bс\s+\d{1,2}\s*ч)/i.exec(text);
  const from = key ? key.index : 0;
  const ds = findDates(text.slice(from));
  for (let i = 0; i + 1 < ds.length; i++) {
    const diff = ds[i + 1].t - ds[i].t;
    if (diff > 20 * 864e5 && diff < 400 * 864e5) return { start: ds[i].iso, end: ds[i + 1].iso };
  }
  const all = findDates(text);
  for (let i = 0; i + 1 < all.length; i++) {
    const diff = all[i + 1].t - all[i].t;
    if (diff > 300 * 864e5 && diff < 370 * 864e5) return { start: all[i].iso, end: all[i + 1].iso };
  }
  return {};
}


/** Серия и номер, даже если OCR разбил цифры пробелами: ищем по «колонкам» строки без пробелов. */
function seriesNumber(up: string, re: RegExp): string | undefined {
  const full = new RegExp(`^(?:№|N)?${re.source}$`);
  for (const line of up.split('\n')) {
    for (const chunk of line.split(/\s{3,}|\t/)) {
      const words = chunk.trim().split(/\s+/);
      // перебираем подпоследовательности слов с конца строки (номер обычно отдельной группой)
      for (let i = 0; i < words.length; i++) {
        const cand = words.slice(i).join('').replace(/^№/, '');
        const m = full.exec(cand);
        if (m) return `${m[1]} ${m[2].replace(/[ABEKMHOPCTYX]/g, (c) => LAT2CYR[c] || c)} ${digitsFix(m[3])}`;
      }
    }
  }
  const m = new RegExp(`(?<![\\d.])${re.source.replace(/\)\(/g, ')\\s?(')}(?![\\d.])`).exec(up);
  return m ? `${m[1]} ${m[2].replace(/[ABEKMHOPCTYX]/g, (c) => LAT2CYR[c] || c)} ${digitsFix(m[3])}` : undefined;
}

// ---------- документы ----------
function parseStsLegacy(t: string): ParsedDoc {
  const fields: Record<string, string> = {};
  const up = t.toUpperCase();
  // серия и номер: «99 99 123456» (новые) или «77 УК 123456» (старые); не путаем с датами и VIN
  const sn = seriesNumber(up, /(\d{2})(\d{2}|[А-ЯA-Z]{2})([\dOОЗ]{6})/);
  if (sn) fields.number = sn;
  const owner = personAfter(up, /СОБСТВЕННИК(?:\s*\(ВЛАДЕЛЕЦ\))?/);
  if (owner) fields.holder = owner;
  const issued = dateNear(t, /дата\s+выдачи/i, 40);
  if (issued) fields.issueDate = issued;
  const extra: ParsedDoc['extra'] = {};
  const p = findPlate(t);
  if (p) Object.assign(extra, p);
  const vin = findVin(t);
  if (vin) extra.vin = vin;
  const year = /год\s+выпуска[^\d]{0,15}((?:19|20)\d{2})/i.exec(t);
  if (year) extra.year = year[1];
  const power = /(\d{2,3}[.,]?\d?)\s*\/\s*(\d{2,3}[.,]?\d?)/.exec(/мощност[^\n]{0,60}/i.exec(t)?.[0] || '');
  if (power) extra.power = power[2].replace(',', '.');
  const mm = /марка,?\s*модель\s*[:\-]?\s*([A-ZА-Я0-9 \-]{3,40})/i.exec(t);
  if (mm) {
    const parts = mm[1].trim().split(/\s+/);
    extra.make = parts[0];
    extra.model = parts.slice(1, 3).join(' ');
  }
  return { fields, extra };
}

function parsePts(t: string): ParsedDoc {
  const fields: Record<string, string> = {};
  const up = t.toUpperCase();
  const epts = /(?<!\d)([13]\d{14})(?!\d)/.exec(up.replace(/\s/g, ''));
  const pts = seriesNumber(up, /(\d{2})([А-ЯA-Z]{2})([\dOОЗ]{6})/);
  if (pts) fields.number = pts;
  else if (epts) fields.number = epts[1];
  const issued = dateNear(t, /дата\s+выдачи(?:\s+паспорта)?/i, 40);
  if (issued) fields.issueDate = issued;
  const org = /(?:выдавш[а-яёА-ЯЁa-zA-Z]+\s+паспорт|организаци[а-яёА-ЯЁa-zA-Z]+,?\s+выдавш[а-яёА-ЯЁa-zA-Z]+)[^\n]*\n?\s*([^\n]{4,80})/i.exec(t);
  if (org) fields.issuer = org[1].replace(/^[\s:.-]+/, '').trim();
  const owner = personAfter(up, /СОБСТВЕННИК[а-яёА-ЯЁa-zA-Z]*/);
  if (owner) fields.holder = owner;
  const extra: ParsedDoc['extra'] = {};
  const vin = findVin(t);
  if (vin) extra.vin = vin;
  return { fields, extra };
}

function parseVu(t: string): ParsedDoc {
  const fields: Record<string, string> = {};
  const up = t.toUpperCase();
  const fixed = up.replace(/(\d)\s*[OО]\s*(\d)/g, '$10$2');
  const num =
    /(?:^|\n|\s)5\s*[.,)]\s*(\d{2})\s?(\d{2})\s?(\d{6})(?!\d)/.exec(fixed) ||
    /(?<![\d.])(\d{2})\s(\d{2})\s(\d{6})(?!\d)/.exec(fixed) ||
    /(?<![\d.])(\d{2})(\d{2})(\d{6})(?![\d.])/.exec(fixed);
  if (num) fields.number = `${num[1]} ${num[2]} ${num[3]}`;
  // ФИО: строки «1.» (фамилия) и «2.» (имя, отчество); под каждой — латиница. Собираются в parseDocument.
  const ls = t.split('\n').map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < ls.length; i++) {
    const m = /^([12])\s*[.,]\s*(.+)$/.exec(ls[i]);
    if (!m || /\d/.test(m[2])) continue;
    const key = m[1] === '1' ? '_sur' : '_name';
    if (fields[key] || fields[key + 'Lat']) continue;
    const [cyrPart, latPart] = m[2].split(/\s*\/\s*|\s{2,}/);
    const cyr = toCyrUpper(cyrPart.toUpperCase()).replace(/[^А-ЯЁA-Z0-9 -]/g, '').trim();
    if (/^[А-ЯЁ-]{2,}(?:\s+[А-ЯЁ-]{2,}){0,2}$/.test(cyr)) fields[key] = cyr;
    const lat = (latPart || ls[i + 1] || '').toUpperCase();
    if (/^[A-Z' -]{2,}$/.test(lat) && !/^[12]\s*[.,]/.test(lat)) fields[key + 'Lat'] = lat.replace(/\s+/g, ' ');
  }
  const ds = findDates(t).sort((a, b) => a.t - b.t);
  let issue: DateHit | undefined, exp: DateHit | undefined;
  for (let i = 0; i < ds.length && !issue; i++)
    for (let j = i + 1; j < ds.length; j++) {
      const years = (ds[j].t - ds[i].t) / (365.25 * 864e5);
      if (years > 9.9 && years < 10.1) {
        issue = ds[i];
        exp = ds[j];
        break;
      }
    }
  if (!issue && ds.length >= 2) {
    issue = ds.length >= 3 ? ds[1] : ds[0];
    exp = ds[ds.length - 1];
  }
  if (issue) fields.issueDate = issue.iso;
  if (exp && exp !== issue) fields.expiryDate = exp.iso;
  const cats = /(?:^|\n)\s*9\s*[.,]\s*([ABCDEMTБВСДЕМАТ1IL| ,]{1,40})/i.exec(up);
  if (cats) {
    cats[1] = cats[1].replace(/([ABCDВСДА])\s?[IL|]/g, '$11'); // «BI», «Bl» → «B1»
    const list = Array.from(new Set((cats[1].replace(/[АВСЕМТ]/g, (c) => CYR2LAT[c] || c).match(/\b(?:C1E|D1E|BE|CE|DE|A1|B1|C1|D1|A|B|C|D|M|TM|TB)\b/g) || [])));
    if (list.length) fields.categories = list.join(', ');
  }
  return { fields, extra: {} };
}

function parseOsago(t: string): ParsedDoc {
  const fields: Record<string, string> = {};
  const up = t.toUpperCase();
  const n = /(?<![А-ЯA-Z])([А-ЯA-Z]{3})\s?(?:№|N)?\s?([\dOОЗ]{10})(?!\d)/.exec(up);
  if (n) fields.number = `${n[1].replace(/[A-Z]/g, (c) => LAT2CYR[c] || c)} ${digitsFix(n[2])}`;
  const ins = insurer(t);
  if (ins) fields.issuer = ins;
  const p = period(t);
  if (p.start) fields.startDate = p.start;
  if (p.end) fields.expiryDate = p.end;
  const prem = moneyAfter(t, /страхов[а-яёА-ЯЁa-zA-Z]+\s+преми[а-яёА-ЯЁa-zA-Z]*/i);
  if (prem) fields.cost = prem;
  const holder = personAfter(up, /СТРАХОВАТЕЛ[а-яёА-ЯЁa-zA-Z]*/);
  if (holder) fields.holder = holder;
  if (/без\s+ограничени|неограниченн/i.test(t)) fields.drivers = 'Без ограничений';
  const ph = phone(t);
  if (ph) fields.phone = ph;
  const extra: ParsedDoc['extra'] = {};
  const pl = findPlate(t);
  if (pl) Object.assign(extra, pl);
  const vin = findVin(t);
  if (vin) extra.vin = vin;
  return { fields, extra };
}

function parseKasko(t: string): ParsedDoc {
  const r = parseOsago(t);
  const fields = { ...r.fields };
  delete fields.number;
  const n = /полис[а-яёА-ЯЁa-zA-Z]*[^\n\d№N]{0,40}(?:№|N|номер)\s*[:]?\s*([A-ZА-Я0-9][A-ZА-Я0-9\-\/ ]{4,30})/i.exec(t);
  if (n) fields.number = n[1].trim().split(/\s{2,}/)[0];
  const fr = moneyAfter(t, /франшиз[а-яёА-ЯЁa-zA-Z]*/i);
  if (fr) fields.franchise = fr;
  delete fields.drivers;
  if (/без\s+ограничени|неограниченн/i.test(t)) fields.drivers = 'Без ограничений';
  return { fields, extra: r.extra };
}

function parseGrz(t: string): ParsedDoc {
  const p = findPlate(t);
  return { fields: p ? { number: p.plate, region: p.region } : {}, extra: {} };
}

function parseOne(type: DocType, t: string): ParsedDoc {
  switch (type) {
    case 'sts':
      return parseStsLegacy(t);
    case 'pts':
      return parsePts(t);
    case 'vu':
      return parseVu(t);
    case 'osago':
      return parseOsago(t);
    case 'kasko':
      return parseKasko(t);
    case 'grz':
      return parseGrz(t);
  }
}

/** Фамилия или «имя отчество» из ВУ: кириллица, сверенная с латиницей; если кириллица не прочиталась — из латиницы. */
function vuName(v: Votes, key: string): string | undefined {
  const lat = v.best(key + 'Lat');
  const cands = v.list(key).map(([c, w]) => {
    const d = lat ? levenshtein(cyrToLat(c).replace(/'/g, ''), lat.replace(/'/g, '')) : 0;
    return [c, w - d * 0.6] as [string, number];
  });
  cands.sort((a, b) => b[1] - a[1]);
  if (cands.length && (!lat || cands[0][1] > 0)) return cands[0][0];
  return lat ? latToCyr(lat) : undefined;
}

// Поля, где ошибка в одном знаке типична — голосуем посимвольно.
const CHAR_VOTE = new Set(['number', 'region']);

/**
 * Разбор документа по текстам нескольких проходов распознавания (или по одному тексту).
 * Значения полей выбираются голосованием между проходами.
 */
export function parseDocument(type: DocType, raw: string | string[]): ParsedDoc {
  const texts = (Array.isArray(raw) ? raw : [raw]).map(clean).filter((t) => t.trim());
  if (type === 'sts') {
    const { fields } = parseSts(texts);
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(fields)) if (val) out[k] = val;
    return {
      fields: out,
      extra: { vin: fields.vin, plate: fields.plate, region: fields.region, make: fields.make, model: fields.model, year: fields.year, power: fields.powerHp },
    };
  }
  const v = new Votes();
  const ev = new Votes();
  for (const t of texts) {
    const r = parseOne(type, t);
    for (const [k, val] of Object.entries(r.fields)) v.add(k, val, 1);
    for (const [k, val] of Object.entries(r.extra)) ev.add(k, val as string, 1);
  }
  const fields: Record<string, string> = {};
  for (const k of new Set(texts.flatMap((t) => Object.keys(parseOne(type, t).fields)))) {
    if (k.startsWith('_')) continue;
    const val = CHAR_VOTE.has(k) ? v.chars(k) : v.best(k);
    if (val) fields[k] = val;
  }
  if (type === 'vu') {
    const holder = [vuName(v, '_sur'), vuName(v, '_name')].filter(Boolean).join(' ');
    if (holder) fields.holder = titleCase(holder);
    // категории: голосуем по каждой отдельно
    const cat = new Map<string, number>();
    let n = 0;
    for (const [s, w] of v.list('categories')) {
      n += w;
      for (const c of s.split(/,\s*/)) cat.set(c, (cat.get(c) || 0) + w);
    }
    const order = ['A', 'A1', 'B', 'B1', 'BE', 'C', 'C1', 'CE', 'C1E', 'D', 'D1', 'DE', 'D1E', 'M', 'TM', 'TB'];
    const list = Array.from(cat.entries()).filter(([, w]) => w >= n / 2).map(([c]) => c).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (list.length) fields.categories = list.join(', ');
  }
  const extra: ParsedDoc['extra'] = {};
  for (const k of ['vin', 'plate', 'region', 'make', 'model', 'year', 'power'] as const) {
    const val = k === 'vin' ? finalVin(ev.list('vin')) : ev.best(k);
    if (val) extra[k] = val;
  }
  return { fields, extra };
}

/** Угадать тип документа по тексту. */
export function guessDocType(raw: string | string[]): DocType | undefined {
  const all = Array.isArray(raw) ? raw.join('\n') : raw;
  if (looksLikeSts(all)) return 'sts';
  const t = all.toLowerCase();
  if (/свидетельство\s+о\s+регистрации/.test(t)) return 'sts';
  if (/паспорт\s+транспортного|электронн[а-яёА-ЯЁa-zA-Z]+\s+паспорт/.test(t)) return 'pts';
  if (/водительское\s+удостоверение|permis de conduire|driving licence/.test(t)) return 'vu';
  if (/осаго|обязательного\s+страхования|гражданской\s+ответственности|владельцев\s+транспортных|(?<![а-яё])(ххх|ттт|ааа|аас|ааа|ааb|ааk|ааm|ааn|ааs|ааt|ааu|ааv|ааz|ааc|аак|аам|аан|аар|аат|ааx|ааы|ааи|ааf|ввв|еее|ккк|ммм|ннн|ррр|ссс|ууу)\s?№?\s?\d{10}/.test(t)) return 'osago';
  if (/каско|добровольного\s+страхования/.test(t)) return 'kasko';
  return undefined;
}

// ---------- чек АЗС ----------
export interface ParsedReceipt {
  total?: number;
  liters?: number;
  price?: number;
  fuelType?: string;
  station?: string;
  date?: number;
}

const STATIONS: [RegExp, string][] = [
  [/лукойл|lukoil/i, 'Лукойл'],
  [/газпром\s?нефть|gazprom/i, 'Газпромнефть'],
  [/роснефть|rosneft/i, 'Роснефть'],
  [/татнефть|tatneft/i, 'Татнефть'],
  [/shell|шелл/i, 'Shell'],
  [/teboil|тебойл/i, 'Teboil'],
  [/башнефть/i, 'Башнефть'],
  [/(?<![а-яё])тнк(?![а-яё])|\bbp\b/i, 'BP'],
  [/нефтьмагистраль/i, 'Нефтьмагистраль'],
  [/трасса/i, 'Трасса'],
  [/neste|несте/i, 'Neste'],
  [/eka|ека/i, 'ЕКА'],
  [/птк/i, 'ПТК'],
];

const num = (s: string) => parseFloat(s.replace(/\s/g, '').replace(',', '.'));

export function parseFuelReceipt(raw: string): ParsedReceipt {
  const t = clean(raw);
  const out: ParsedReceipt = {};
  const tot =
    /(?:итог[оа]?|к\s+оплате|сумма\s+(?:по\s+чеку|к\s+оплате))[^\d\n]{0,20}=?\s*(\d[\d ]{0,7}[.,]\d{2})/i.exec(t) ||
    /(?:безналичными|картой|наличными)[^\d\n]{0,20}=?\s*(\d[\d ]{0,7}[.,]\d{2})/i.exec(t);
  if (tot) out.total = num(tot[1]);
  const ft = /(аи|ai|a[иi])\s?-?\s?(92|95|98|100)|(дт|диз[а-яёА-ЯЁa-zA-Z]*|дизель[а-яёА-ЯЁa-zA-Z]*|евро\s?дизел[а-яёА-ЯЁa-zA-Z]*)|(adblue|адблю)/i.exec(t);
  if (ft) out.fuelType = ft[2] ? `АИ-${ft[2]}` : ft[3] ? 'ДТ' : 'AdBlue';
  // фирменные марки сетей: ЭКТО, G-Drive, Танеко, Pulsar
  const branded = fuelFromReceipt(t, STATIONS.find(([re]) => re.test(t))?.[1]);
  if (branded) out.fuelType = branded;
  const lx = /(\d{1,3}[.,]\d{1,3})\s*(?:л|l|литр[а-яёА-ЯЁa-zA-Z]*)?\s*[xх*×]\s*(\d{2,3}[.,]\d{2})/i.exec(t);
  if (lx) {
    const a = num(lx[1]), b = num(lx[2]);
    out.liters = a;
    out.price = b;
  }
  if (!out.liters) {
    const l = /(\d{1,3}[.,]\d{1,3})\s*(?:л(?![а-яё])|l\b|литр)/i.exec(t) || /(?:кол-?во|количество|объ[её]м)[^\d\n]{0,12}(\d{1,3}[.,]\d{1,3})/i.exec(t);
    if (l) out.liters = num(l[1]);
  }
  if (!out.price) {
    const p = /(?:цена|стоимость\s+литра)[^\d\n]{0,12}(\d{2,3}[.,]\d{2})/i.exec(t) || /(\d{2,3}[.,]\d{2})\s*(?:руб|₽|р)\.?\s*\/\s*л/i.exec(t);
    if (p) out.price = num(p[1]);
  }
  if (out.total && out.price && !out.liters) out.liters = Math.round((out.total / out.price) * 100) / 100;
  if (out.total && out.liters && !out.price) out.price = Math.round((out.total / out.liters) * 100) / 100;
  for (const [re, name] of STATIONS)
    if (re.test(t)) {
      out.station = name;
      break;
    }
  const dt = /(\d{2})[.\/](\d{2})[.\/](\d{2,4})\s+(\d{1,2}):(\d{2})/.exec(t);
  if (dt) {
    let y = +dt[3];
    if (y < 100) y += 2000;
    const d = new Date(y, +dt[2] - 1, +dt[1], +dt[4], +dt[5]).getTime();
    if (!isNaN(d) && d <= Date.now() + 864e5 && y > 2015) out.date = d;
  }
  return out;
}
