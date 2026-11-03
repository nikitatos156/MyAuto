// Библиотека кодировок VW / Audi / BMW (и Skoda / Seat на тех же платформах) с 2010 года.
// Каталог для машины подбирается автоматически по марке, модели, кузову и году (detectCodingPreset).
import type { CodingItem } from './types';
import { POLO_PQ25 } from './codings/vw-pq25';
import { PQ35 } from './codings/vw-pq35';
import { MQB } from './codings/vag-mqb';
import { AUDI_MLB } from './codings/audi-mlb';
import { AUDI_MLBEVO } from './codings/audi-mlbevo';
import { BMW_F } from './codings/bmw-f';
import { BMW_G } from './codings/bmw-g';

export interface CodingPreset {
  key: string;
  title: string;
  subtitle: string;
  intro: string;
  items: CodingItem[];
}

export const CODING_CATEGORIES = [
  'Освещение',
  'Замки и комфорт',
  'Приборная панель',
  'Ассистенты и безопасность',
  'Климат и сиденья',
  'Мультимедиа',
  'Сервисные функции',
  'Дооснащение',
];

const VAG_INTRO =
  'VCDS / OBDeleven / Vag-Com. Перед изменением сохраните исходное длинное кодирование блока. Код доступа для блока 09 — 31347, для 5F — 20103, для 03/44 — 40168.';
const BMW_INTRO =
  'E-Sys или BimmerCode. В E-Sys: блок → группа → параметр FDL, затем «Code FDL». Перед изменением сохраните CAFD (бэкап), кодируйте при зарядном устройстве.';

export const CODING_PRESETS: Record<string, CodingPreset> = {
  'polo-sedan': {
    key: 'polo-sedan',
    title: 'VW Polo / Polo Sedan (PQ25)',
    subtitle: 'Polo 6R/6C, Polo Sedan 2010–2020, Polo лифтбек, Skoda Rapid/Fabia, Audi A1 8X',
    intro:
      'VCDS / OBDeleven / Vag-Com. Код доступа для блока 09 — 31347. Каналы адаптации есть у блоков с 2012 года; на более старых используйте длинное кодирование.',
    items: POLO_PQ25,
  },
  'vw-pq35': {
    key: 'vw-pq35',
    title: 'VW PQ35 / PQ46',
    subtitle: 'Golf 6, Jetta 6, Passat B7/CC, Tiguan I, Touran, Skoda Octavia A5/Yeti/Superb B6',
    intro: VAG_INTRO + ' Большинство пунктов — в «помощнике длинного кодирования» VCDS.',
    items: PQ35,
  },
  'audi-pq35': {
    key: 'audi-pq35',
    title: 'Audi A3 8P / Q3 8U (PQ35)',
    subtitle: 'Те же блоки, что у VW Golf 6 и Tiguan I',
    intro: VAG_INTRO,
    items: PQ35,
  },
  'vw-mqb': {
    key: 'vw-mqb',
    title: 'VW / Skoda / Seat MQB',
    subtitle: 'Golf 7/8, Passat B8, Tiguan II, Jetta 7, Polo VI, T-Roc, Teramont, Arteon; Octavia A7/A8, Kodiaq, Karoq, Superb B8',
    intro: VAG_INTRO,
    items: MQB,
  },
  'audi-mqb': {
    key: 'audi-mqb',
    title: 'Audi MQB',
    subtitle: 'A3 8V/8Y, Q2, Q3 F3, TT 8S — блоки и каналы как у VW MQB',
    intro: VAG_INTRO,
    items: MQB,
  },
  'audi-b8': {
    key: 'audi-b8',
    title: 'Audi MLB (B8 / C7 / D4)',
    subtitle: 'A4/A5 B8 и B8.5, Q5 8R, A6/A7 C7, A8 D4; похожие блоки у Q7 4L и VW Touareg II',
    intro: VAG_INTRO + ' На B8 функции комфорта — в блоке 46, приборка — 17, MMI 3G — 5F.',
    items: AUDI_MLB,
  },
  'audi-b9': {
    key: 'audi-b9',
    title: 'Audi MLBevo (B9 / C8 / Q5 FY / Q7 4M)',
    subtitle: 'A4/A5 B9 2016–2024, Q5 FY, Q7 4M, Q8, A6/A7 C8, A8 D5, VW Touareg III',
    intro:
      'Названия каналов совпадают в VCDS и OBDeleven (режим «Длинное кодирование» или «Адаптация»). На B9 и B9.5 некоторые каналы называются по-разному — ищите по ключевому слову.',
    items: AUDI_MLBEVO,
  },
  'bmw-f': {
    key: 'bmw-f',
    title: 'BMW F-серия (2010–2019)',
    subtitle: 'F10/F11, F30/F31/F34, F32/F33/F36, F20/F21/F22, F15/F16, F25/F26, F01',
    intro: BMW_INTRO + ' Названия групп (3000, 3060…) могут отличаться по I-step — ищите по имени параметра.',
    items: BMW_F,
  },
  'bmw-g': {
    key: 'bmw-g',
    title: 'BMW G-серия и UKL (2017+)',
    subtitle: 'G20/G21, G30/G31, G01/G02, G05/G06/G07, G11/G12, G29, G42; F39/F40/F44/F45/F48',
    intro: BMW_INTRO + ' Значения указаны для I-step S18A — сверяйте со своим CAFD.',
    items: BMW_G,
  },
};

export const presetOptions = [
  { value: '', label: 'Автоматически' },
  ...Object.values(CODING_PRESETS).map((p) => ({ value: p.key, label: p.title })),
  { value: 'none', label: 'Нет каталога' },
];

// ---------- автоподбор ----------
const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

/** Подобрать каталог кодировок по марке, модели, кузову и году. */
export function detectCodingPreset(make?: string, model?: string, year?: number, body?: string): string | undefined {
  const mk = (make || '').toLowerCase().replace(/ё/g, 'е');
  const md = ` ${(model || '').toLowerCase()} ${(body || '').toLowerCase()} `;
  const y = year || 0;
  const isVW = has(mk, 'volkswagen', 'vw', 'фольксваген');
  const isSkoda = has(mk, 'skoda', 'шкода');
  const isSeat = has(mk, 'seat', 'cupra', 'сеат');
  const isAudi = has(mk, 'audi', 'ауди');
  const isBmw = has(mk, 'bmw', 'бмв');

  if (isVW || isSkoda || isSeat) {
    // PQ25
    if (has(md, 'polo', 'поло')) {
      if (y && y >= 2018 && !has(md, 'седан', 'sedan', 'лифтбек', 'liftback')) return 'vw-mqb';
      return 'polo-sedan';
    }
    if (has(md, 'rapid', 'рапид', 'fabia', 'фабия', 'ibiza', 'ибица')) return y >= 2022 && has(md, 'fabia', 'фабия', 'ibiza') ? 'vw-mqb' : 'polo-sedan';
    // однозначно MQB
    if (has(md, 't-roc', 'troc', 'т-рок', 'teramont', 'терамонт', 'atlas', 'arteon', 'артеон', 'taos', 'таос', 't-cross', 'tcross', 'kodiaq', 'кодиак', 'karoq', 'карок', 'kamiq', 'scala', 'ateca', 'атека', 'tarraco', 'formentor')) return 'vw-mqb';
    if (has(md, 'golf', 'гольф')) return y && y <= 2012 ? 'vw-pq35' : 'vw-mqb';
    if (has(md, 'jetta', 'джетта')) return y && y <= 2018 ? 'vw-pq35' : 'vw-mqb';
    if (has(md, ' cc', 'passat cc', 'пассат сс')) return 'vw-pq35';
    if (has(md, 'passat', 'пассат')) return y && y <= 2014 ? 'vw-pq35' : 'vw-mqb';
    if (has(md, 'tiguan', 'тигуан')) return y && y <= 2016 ? 'vw-pq35' : 'vw-mqb';
    if (has(md, 'touran', 'туран')) return y && y <= 2015 ? 'vw-pq35' : 'vw-mqb';
    if (has(md, 'octavia', 'октавия')) return y && y <= 2012 ? 'vw-pq35' : 'vw-mqb';
    if (has(md, 'superb', 'суперб')) return y && y <= 2015 ? 'vw-pq35' : 'vw-mqb';
    if (has(md, 'leon', 'леон')) return y && y <= 2012 ? 'vw-pq35' : 'vw-mqb';
    if (has(md, 'yeti', 'йети', 'scirocco', 'сирокко', 'eos', 'beetle', 'жук', 'altea', 'altea')) return 'vw-pq35';
    if (has(md, 'touareg', 'туарег')) return y && y >= 2018 ? 'audi-b9' : 'audi-b8';
    return undefined;
  }

  if (isAudi) {
    if (/\bb9\b|\bb9\.5\b/.test(md)) return 'audi-b9';
    if (/\bb8\b|\bb8\.5\b|\b8k\b|\b8t\b|\b8r\b|\bc7\b|\b4g\b|\bd4\b/.test(md)) return 'audi-b8';
    if (/\bc8\b|\b4k\b|\bfy\b|\b4m\b|\bd5\b/.test(md)) return 'audi-b9';
    if (/\b8v\b|\b8y\b|\bf3\b|\b8s\b/.test(md)) return 'audi-mqb';
    if (/\ba1\b/.test(md)) return y && y >= 2019 ? 'audi-mqb' : 'polo-sedan';
    if (/\b(a3|s3|rs3)\b/.test(md)) return y && y <= 2012 ? 'audi-pq35' : 'audi-mqb';
    if (/\bq2\b|\btt\b/.test(md)) return y && y < 2014 ? 'audi-pq35' : 'audi-mqb';
    if (/\b(q3|rsq3)\b/.test(md)) return y && y <= 2018 ? 'audi-pq35' : 'audi-mqb';
    if (/\b(a4|s4|rs4|a5|s5|rs5)\b/.test(md)) return y && y <= 2015 ? 'audi-b8' : 'audi-b9';
    if (/\b(q5|sq5)\b/.test(md)) return y && y <= 2016 ? 'audi-b8' : 'audi-b9';
    if (/\b(a6|s6|rs6|a7|s7|rs7)\b/.test(md)) return y && y <= 2018 ? 'audi-b8' : 'audi-b9';
    if (/\b(a8|s8)\b/.test(md)) return y && y <= 2017 ? 'audi-b8' : 'audi-b9';
    if (/\b(q7|sq7)\b/.test(md)) return y && y <= 2015 ? 'audi-b8' : 'audi-b9';
    if (/\b(q8|sq8|rsq8)\b|e-tron|етрон/.test(md)) return 'audi-b9';
    return undefined;
  }

  if (isBmw) {
    const ch = md.match(/\b([fgeu])\s?(\d{2})\b/i);
    if (ch) {
      const code = ch[1].toUpperCase() + ch[2];
      if (code.startsWith('G') || code.startsWith('U')) return 'bmw-g';
      if (['F39', 'F40', 'F44', 'F45', 'F46', 'F48', 'F52', 'F54', 'F55', 'F56', 'F57', 'F60', 'F95', 'F96', 'F97', 'F98'].includes(code)) return 'bmw-g';
      if (code.startsWith('F')) return 'bmw-f';
      return undefined; // E-серия
    }
    if (!y) return 'bmw-f';
    if (y >= 2019) return 'bmw-g';
    if (y >= 2010) return 'bmw-f';
    return undefined;
  }
  return undefined;
}

/** Каталог для машины: выбранный вручную или подобранный автоматически. */
export function presetForCar(car: { codingPreset?: string; make: string; model: string; year?: number; body?: string }) {
  if (car.codingPreset === 'none') return undefined;
  const key = car.codingPreset || detectCodingPreset(car.make, car.model, car.year, car.body);
  return key ? CODING_PRESETS[key] : undefined;
}
