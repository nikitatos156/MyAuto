// Виды топлива крупных сетей АЗС: при выборе сети в форме заправки показываются её названия
// (ЭКТО у Лукойла, G-Drive у Газпромнефти, Танеко у Татнефти, Pulsar у Роснефти).
// Для остальных АЗС — прежние варианты из карточки машины.
// В чеках ЭКТО часто распознаётся латиницей («3KTO») — шаблоны это учитывают.
// Названия: сайт Лукойла (Экто-92, ЭКТО PLUS (95), ЭКТО 100, Экто diesel), сайт Роснефти (Pulsar-95, Pulsar-ДТ),
// новости Роснефти (Pulsar-100) и ТАНЕКО (TANECO-100), канал АЗС «Татнефть» (ДТ Танеко, ДТ «Арктика»).
import type { Car } from './types';

export type FuelBase = 'АИ-92' | 'АИ-95' | 'АИ-98' | 'АИ-100' | 'ДТ' | 'AdBlue' | 'Газ';

export interface FuelGrade {
  name: string;
  base: FuelBase;
  premium?: boolean;
  /** Как это топливо пишется в чеке. */
  re?: RegExp;
}

export interface FuelChain {
  id: string;
  name: string;
  match: RegExp;
  grades: FuelGrade[];
}

export const FUEL_CHAINS: FuelChain[] = [
  {
    id: 'lukoil',
    name: 'Лукойл',
    match: /лукойл|lukoil/i,
    grades: [
      { name: 'АИ-92', base: 'АИ-92' },
      { name: 'АИ-95', base: 'АИ-95' },
      { name: 'ЭКТО-92', base: 'АИ-92', premium: true, re: /[э3][кk][тt][оo0][\s-]*92|92[\s-]*[э3][кk][тt][оo0]/i },
      { name: 'ЭКТО Plus 95', base: 'АИ-95', premium: true, re: /[э3][кk][тt][оo0]\s*(plus|плюс)|[э3][кk][тt][оo0][\s-]*95|95[\s-]*[э3][кk][тt][оo0]/i },
      { name: 'ЭКТО 100', base: 'АИ-100', premium: true, re: /[э3][кk][тt][оo0][\s-]*100|100[\s-]*[э3][кk][тt][оo0]/i },
      { name: 'ДТ', base: 'ДТ' },
      { name: 'ЭКТО Diesel', base: 'ДТ', premium: true, re: /[э3][кk][тt][оo0]\s*(diesel|дизел)|(дт|диз[а-яё]*)\s*[э3][кk][тt][оo0]/i },
    ],
  },
  {
    id: 'gazpromneft',
    name: 'Газпромнефть',
    match: /газпром\s?нефть|gazprom/i,
    grades: [
      { name: 'АИ-92', base: 'АИ-92' },
      { name: 'АИ-95', base: 'АИ-95' },
      { name: 'G-Drive 95', base: 'АИ-95', premium: true, re: /g[\s-]?drive\s*(аи[\s-]*)?95|аи[\s-]*95\s*g[\s-]?drive/i },
      { name: 'G-Drive 100', base: 'АИ-100', premium: true, re: /g[\s-]?drive\s*(аи[\s-]*)?100|аи[\s-]*100\s*g[\s-]?drive/i },
      { name: 'ДТ', base: 'ДТ' },
      { name: 'G-Drive Diesel', base: 'ДТ', premium: true, re: /g[\s-]?drive\s*(diesel|дизел|дт)/i },
    ],
  },
  {
    id: 'tatneft',
    name: 'Татнефть',
    match: /татнефть|tatneft/i,
    grades: [
      { name: 'АИ-92', base: 'АИ-92' },
      { name: 'АИ-95', base: 'АИ-95' },
      { name: 'Танеко-100', base: 'АИ-100', premium: true, re: /(танеко|taneco)[\s-]*100|аи[\s-]*100\s*(танеко|taneco)/i },
      { name: 'ДТ', base: 'ДТ' },
      { name: 'ДТ Танеко', base: 'ДТ', premium: true, re: /(дт|диз[а-яё]*)\s*(танеко|taneco)|(танеко|taneco)\s*(дт|диз|euro)/i },
      { name: 'ДТ Арктика', base: 'ДТ', re: /(дт|диз[а-яё]*)\s*[«"]?арктик/i },
    ],
  },
  {
    id: 'rosneft',
    name: 'Роснефть',
    match: /роснефть|rosneft/i,
    grades: [
      { name: 'АИ-92', base: 'АИ-92' },
      { name: 'АИ-95', base: 'АИ-95' },
      { name: 'Pulsar-95', base: 'АИ-95', premium: true, re: /(pulsar|пульсар)[\s-]*95|аи[\s-]*95\s*(pulsar|пульсар)/i },
      { name: 'Pulsar-100', base: 'АИ-100', premium: true, re: /(pulsar|пульсар)[\s-]*100|аи[\s-]*100\s*(pulsar|пульсар)/i },
      { name: 'ДТ', base: 'ДТ' },
      { name: 'Pulsar-ДТ', base: 'ДТ', premium: true, re: /(pulsar|пульсар)[\s-]*(дт|diesel|дизел)|(дт|диз[а-яё]*)\s*(pulsar|пульсар)/i },
    ],
  },
];

export function chainOf(station?: string): FuelChain | undefined {
  if (!station) return undefined;
  return FUEL_CHAINS.find((c) => c.match.test(station));
}

const ALL_GRADES = FUEL_CHAINS.flatMap((c) => c.grades);

/** Базовый вид топлива по названию: «ЭКТО 100» → АИ-100, «ДТ Танеко» → ДТ. */
export function fuelBase(name?: string): FuelBase | undefined {
  if (!name) return undefined;
  const g = ALL_GRADES.find((x) => x.name === name);
  if (g) return g.base;
  if (/adblue|адблю|мочевин/i.test(name)) return 'AdBlue';
  if (/(^|[^а-яa-z])(дт|диз|diesel)/i.test(name)) return 'ДТ';
  if (/газ|суг|кпг|lpg|cng|метан|пропан/i.test(name)) return 'Газ';
  const n = /(92|95|98|100)/.exec(name);
  return n ? (`АИ-${n[1]}` as FuelBase) : undefined;
}

export const isPremiumFuel = (name?: string) => !!ALL_GRADES.find((x) => x.name === name)?.premium;

/**
 * Варианты топлива в форме заправки: у сетевой АЗС — её названия (только подходящие машине по видам топлива),
 * у остальных — варианты из карточки машины. Текущее значение (например, у старой записи) всегда остаётся в списке.
 */
export function fuelOptions(car: Pick<Car, 'fuelTypes'>, station?: string, current?: string): string[] {
  const own = car.fuelTypes.length ? car.fuelTypes : ['АИ-95'];
  const chain = chainOf(station);
  let list = own;
  if (chain) {
    const bases = new Set(own.map(fuelBase).filter(Boolean));
    list = chain.grades.filter((g) => bases.has(g.base)).map((g) => g.name);
    // из карточки машины добавляем то, чего у сети нет: AdBlue, АИ-98, сезонные «ДТ зимнее» / «ДТ арктическое»
    // (если у сети есть похожее — например, «ДТ Арктика» у Татнефти — своё не дублируем)
    const stem = (x: string) => x.toLowerCase().replace(/^(дт|аи-\d+)\s*/, '').slice(0, 5);
    for (const t of own) {
      const b = fuelBase(t);
      const baseInChain = chain.grades.some((g) => g.base === b);
      const plain = /^(АИ-\d+|ДТ)$/.test(t);
      const similar = chain.grades.some((g) => g.base === b && stem(g.name) && stem(g.name) === stem(t));
      if (!list.includes(t) && (!baseInChain || (!plain && !similar))) list.push(t);
    }
    if (!list.length) list = own;
  }
  if (current && !list.includes(current)) list = [...list, current];
  return list;
}

/** Подобрать вариант в новом списке, когда сменили АЗС: тот же вид топлива, обычный, а не премиальный. */
export function sameFuelIn(options: string[], current: string): string | undefined {
  if (options.includes(current)) return current;
  const base = fuelBase(current);
  const same = options.filter((o) => fuelBase(o) === base);
  return same.find((o) => !isPremiumFuel(o)) || same[0];
}

/** Название топлива из текста чека: сначала фирменные марки сетей, потом обычные АИ/ДТ. */
export function fuelFromReceipt(text: string, station?: string): string | undefined {
  const chains = chainOf(station) ? [chainOf(station)!, ...FUEL_CHAINS.filter((c) => c !== chainOf(station))] : FUEL_CHAINS;
  for (const c of chains) for (const g of c.grades) if (g.re?.test(text)) return g.name;
  return undefined;
}

/** Короткая метка для списка заправок: «95», «100», «ДТ», у фирменного топлива — со звёздочкой. */
export function fuelTag(name: string): string {
  const base = fuelBase(name);
  const short = base === 'AdBlue' ? 'AdBlue' : base === 'ДТ' ? 'ДТ' : base === 'Газ' ? 'Газ' : base ? base.replace('АИ-', '') : name.slice(0, 4);
  return isPremiumFuel(name) ? short + '★' : short;
}
