// Разбор заказ-наряда / акта выполненных работ (PDF из почты или фото): работы, запчасти с артикулами,
// пробег, дата, сервис, сумма. Строки таблиц приходят с колонками, разделёнными несколькими пробелами
// (текстовый слой PDF собирается так в pdfImport, Tesseract сохраняет межколоночные пробелы).
import { finalVin, findDates, vinCandidates } from './ocrText';

export interface WorkOrderItem {
  name: string;
  partNumber?: string;
  brand?: string;
  qty: number;
  price: number; // за единицу (для работ — сумма)
  total: number;
}

export interface WorkOrder {
  date?: number;
  mileage?: number;
  station?: string;
  vin?: string;
  number?: string; // номер заказ-наряда
  kind?: 'to' | 'repair';
  toNumber?: number;
  works: WorkOrderItem[];
  parts: WorkOrderItem[];
  total?: number; // «Итого» из документа
}

const UNIT = /^(шт|штук|л|литр|н\/ч|нч|н-ч|час|ч|компл|к-т|кмп|кг|м|уп|ед|пара|усл|ед\.изм)\.?$/i;
const AMOUNT = /^-?\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?$|^-?\d+(?:[.,]\d{1,3})?$/;
const MONEY_IN_LINE = /(?<![\d.,])(?:\d{1,3}(?:[  ]\d{3})+|\d+)[.,]\d{2}(?!\d|[.,]\d)/g;
const DATE_IN_LINE = /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g;
const BRANDS =
  /^(VAG|VW|AUDI|MANN|MANN-FILTER|NGK|BOSCH|MAHLE|KNECHT|FILTRON|BIG|SAKURA|HENGST|UFI|CHAMPION|BERU|DENSO|CASTROL|MOBIL|SHELL|LIQUI MOLY|TOTAL|ELF|MOTUL|RAVENOL|FEBI|LEMFORDER|TRW|ATE|BREMBO|TEXTAR|SACHS|CONTITECH|GATES|DAYCO|INA|SKF|VALEO|MEYLE|KYB|ZIMMERMANN|FERODO|JURID|PIERBURG|ELRING|CORTECO|NISSENS|HELLA|OSRAM|PHILIPS|SWAG|TOPRAN|VEMO|DELPHI|CONTINENTAL|LUK|DOLZ|HEPU|GRAF|STELLOX|PATRON|MASUMA|BLUE PRINT|NIPPARTS|JAPANPARTS|MAXGEAR|MAPCO)$/i;
const HEADER_WORDS = /^(наименование|№|n|кол-?во|количество|цена|сумма|артикул|каталожный|номер|ед\.?\s*изм|ндс|скидка|стоимость|код|норма|н\/ч)(?![а-яёa-z])/i;

const WORK_RE =
  /(замен|сняти|снять|сн\/уст|установ|удалить|поиск|сервис|инспекц|диагност|регулир|провер|ремонт|мойк|осмотр|развал|схожд|шиномонтаж|балансир|кодирован|адаптац|программир|прокачк|чистк|обслуживан|работ|демонтаж|монтаж|компьютерн|тест|контрол|смазк|долив|заправк кондиц|эвакуац|техническ)/i;
const PART_RE =
  /(масло|фильтр|свеч|колодк|диск|жидкост|прокладк|болт|шайб|пробк|антифриз|омыват|лампа|щетк|щётк|ремень|ролик|насос|амортиз|сайлент|втулк|подшипн|датчик|кольцо|уплотн|герметик|присадк|очистит|хладагент|фреон|g\s?\d{3}|adblue|мочевин|шина|аккумулят|предохранит|хомут|гайк|винт|салфетк|расходн|материал)/i;
// Артикулы: 03C115561H, 5Q0 819 653, G 055 167 M2, N 902 153 01, OC 593/4, W 712/95, 1987432097
const ART_TOKEN = /^(?=[A-Z0-9 ./-]*\d)(?=[A-Z0-9 ./-]*[A-Z0-9]{3})[A-Z0-9][A-Z0-9 ./-]{3,22}[A-Z0-9]$/;
const VAG_ART = /\b([0-9][A-Z0-9]{2}|[A-Z][0-9]{2}|[A-Z]{1,3})\s?(\d{3})\s?(\d{3})\s?([A-Z]{0,2}\d{0,2})\b/;

const num = (s: string) => parseFloat(s.replace(/[ \u00a0]/g, '').replace(',', '.'));
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.6, Math.abs(b) * 0.012);

function cellsOf(line: string) {
  return line
    .split(/\s{2,}|\t|\s*\|\s*/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function isArticle(cell: string) {
  const c = cell.toUpperCase();
  if (/[А-ЯЁ]/.test(c.replace(/[АВЕКМНОРСТХ]/g, ''))) return false; // кириллические слова — не артикул
  if (!ART_TOKEN.test(c.replace(/[АВЕКМНОРСТХ]/g, 'X'))) return false;
  if (/^\d{1,3}([.,]\d+)?$/.test(c)) return false;
  if (c.split(/[\s./-]+/).some((w) => /^[A-Z]{4,}$/.test(w))) return false; // слова (CASTROL, LONGLIFE) — это название
  if (!/\d{3}/.test(c.replace(/\s/g, ''))) return false;
  if (AMOUNT.test(cell) && /[.,]\d{2}$/.test(cell)) return false; // это сумма
  return true;
}

/** Числа в конце строки: [кол-во?, цена?, …, сумма]. Возвращает и «хвост» без чисел. */
function tailNumbers(line0: string): { head: string[]; nums: number[] } | null {
  const line = line0.replace(DATE_IN_LINE, ' ');
  const cells = cellsOf(line);
  if (cells.length >= 2) {
    const nums: number[] = [];
    let i = cells.length - 1;
    for (; i >= 0; i--) {
      const c = cells[i].replace(/\s*(руб\.?|₽|р\.)$/i, '').replace(/%$/, '');
      if (UNIT.test(c)) continue;
      if (AMOUNT.test(c)) nums.unshift(num(c));
      else if ((c.match(MONEY_IN_LINE) || []).join('').replace(/\s/g, '') === c.replace(/\s/g, '') && /\d/.test(c)) {
        // несколько сумм в одной «ячейке»: «1200,00 1200,00»
        nums.unshift(...(c.match(MONEY_IN_LINE) || []).map(num));
      } else {
        // «2 шт», «1,5 л»
        const m = /^(\d+(?:[.,]\d+)?)\s*(шт|л|н\/ч|нч|ч|компл|кг)\.?$/i.exec(c);
        if (m) nums.unshift(num(m[1]));
        else break;
      }
    }
    if (nums.length && i >= 0) return { head: cells.slice(0, i + 1), nums };
  }
  // колонки не разделились — берём суммы с копейками в конце строки
  const money = Array.from(line.matchAll(MONEY_IN_LINE));
  if (!money.length) return null;
  const firstIdx = money[0].index!;
  let headText = line.slice(0, firstIdx).trim();
  const nums = money.map((m) => num(m[0]));
  const q = /(\d+(?:[.,]\d{1,3})?)\s*(?:шт|л|н\/ч|нч|ч|компл)?\.?\s*$/i.exec(headText);
  if (q && headText.length - q[0].length > 2 && num(q[1]) > 0 && num(q[1]) < 1000) {
    nums.unshift(num(q[1]));
    headText = headText.slice(0, q.index).trim();
  }
  return { head: [headText], nums };
}

function splitNums(nums: number[]): { qty: number; price: number; total: number } {
  const total = nums[nums.length - 1];
  if (nums.length === 1) return { qty: 1, price: total, total };
  if (nums.length === 2) {
    const [a, b] = nums;
    if (near(a, b)) return { qty: 1, price: b, total: b };
    if (a > 0 && a <= 50 && b > a) return { qty: a, price: Math.round((b / a) * 100) / 100, total: b };
    return { qty: 1, price: b, total: b };
  }
  // ищем кол-во × цена ≈ одна из следующих сумм (дальше могут быть скидка и итог со скидкой)
  for (let i = 0; i < nums.length - 1; i++)
    for (let j = i + 1; j < nums.length; j++)
      for (let k = j + 1; k < nums.length; k++)
        if (nums[i] > 0 && nums[i] <= 1000 && near(nums[i] * nums[j], nums[k])) {
          const qty = nums[i];
          // «расходные материалы: 650 × 1,00 ₽» — это сумма в рублях, а не 650 штук
          if (nums[j] <= 1 && qty >= 50) return { qty: 1, price: total, total };
          // цена за единицу — со скидкой (последняя сумма в строке), чтобы итог совпал с документом
          return { qty, price: Math.round((total / qty) * 100) / 100, total };
        }
  return { qty: 1, price: total, total };
}

function cleanName(s: string) {
  return s
    .replace(/^\s*\d{1,3}\s*[.)]?\s+/, '') // номер строки
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-–:;,.\s]+|[-–:;,\s]+$/g, '')
    .trim();
}

type Section = 'works' | 'parts' | null;

export function parseWorkOrder(raw: string | string[]): WorkOrder {
  const texts = (Array.isArray(raw) ? raw : [raw]).map((t) => t.replace(/\r/g, '').replace(/[“”«»„]/g, '"').replace(/[‐‑‒–—]/g, '-'));
  const all = texts.join('\n');
  const out: WorkOrder = { works: [], parts: [] };

  // --- шапка ---
  const head = all.split('\n').slice(0, 40).join('\n');
  const dn = /(заказ-?\s?наряд|акт[а-я]*\s+(?:выполненных|приема|сдачи)|счет|счёт)[^\n]{0,40}?(?:№|N|#)\s*([A-ZА-Я0-9-/]{2,20})/i.exec(all);
  if (dn) out.number = dn[2];
  let dHit = findDates(head).find((d) => {
    const before = head.slice(Math.max(0, d.index - 40), d.index).toLowerCase();
    return /(от|дата|заказ|наряд|закрыт|выполн|оконч)/.test(before) && !/(рожд|выдан|регистрац|продаж)/.test(before);
  });
  if (!dHit) dHit = findDates(head).find((d) => d.t <= Date.now() + 864e5 && d.t > Date.UTC(2000, 0, 1));
  if (dHit) out.date = dHit.t;
  const ml = /(пробег|одометр|показани[ея]\s+одометра|км\s+пробега)[^\d\n]{0,30}(\d{1,3}(?:[ \u00a0]?\d{3})+|\d{3,7})(?!\d|[.,]\d)/i.exec(all);
  if (ml) {
    const m = parseInt(ml[2].replace(/\D/g, ''), 10);
    if (m >= 10 && m < 2_000_000) out.mileage = m;
  }
  const ex = /(исполнитель|подрядчик|сервисный центр|дилерский центр|автосервис|станция)\s*[:\-]?\s*([^\n]{3,80})/i.exec(all);
  const org = ex ? ex[2] : /((?:ООО|АО|ПАО|ЗАО|ИП)\s*"?[^"\n,]{2,60}"?)/.exec(head)?.[1];
  if (org) out.station = org.replace(/\s*(ИНН|КПП|ОГРН|адрес|тел)(?![а-яёa-z]).*$/i, '').replace(/\s{2,}.*$/, '').replace(/[,;]\s*$/, '').trim();
  const vins: [string, number][] = [];
  for (const line of all.split('\n')) for (const v of vinCandidates(line)) vins.push([v, /vin|кузов|идентиф/i.test(line) ? 2 : 1]);
  out.vin = finalVin(vins);
  if (/(техническ[а-я]*\s+обслуживан|сервисн[а-я]*\s+обслуживан|регламентн|плановое\s+то|инспекционн[а-я]*\s+сервис|тип[:\s]+то(?![а-яё])|(?<![а-яё])то[-\s]?\d{1,2}(?!\d))/i.test(all)) out.kind = 'to';
  const toN = /(?<![а-яё])ТО[-\s]?(\d{1,2})(?![\d\s]*000)/.exec(all);
  if (toN) out.toNumber = parseInt(toN[1], 10);
  // итог документа: «Всего» / «К оплате» важнее промежуточных «Итого за работы / за запчасти»
  let best = -1;
  const subtotals: number[] = [];
  for (const m of all.matchAll(/(итого\s+к\s+оплате|всего\s+к\s+оплате|к\s+оплате|всего\s+по\s+заказ[а-я-]*|всего|итого(?:\s+за\s+[а-яё ,]+)?)[^\d\n]{0,40}(\d{1,3}(?:[ \u00a0]\d{3})*[.,]\d{2})/gi)) {
    const key = m[1].toLowerCase();
    const v = num(m[2]);
    const pr = /оплат|всего/.test(key) ? 2 : /итого\s+за/.test(key) ? 0 : 1;
    if (pr === 0) subtotals.push(v);
    if (pr >= best) {
      best = pr;
      out.total = v;
    }
  }
  if (best === 0 && subtotals.length > 1) out.total = Math.round(subtotals.reduce((a, b) => a + b, 0) * 100) / 100;

  // --- таблицы ---
  const WORKS_TITLE = /^(работы|выполненные работы|перечень (выполненных )?работ|наименование работ|услуги|работы и услуги|оказанные услуги)(?![а-яё])/;
  const PARTS_TITLE = /^(запасные части|запчасти|запасные части и материалы|материалы|детали|товары|расходные материалы|запчасти и материалы|использованные (запасные части|материалы))(?![а-яё])/;
  const hasMoney = (low: string) => /\d{2,}[.,]\d{2}/.test(low);
  const wordsOf = (low: string) => low.replace(/[^а-яёa-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  // есть явные заголовки разделов — позиции берём только внутри них (шапка с адресом и пробегом не попадёт в работы)
  const titled = texts.some((t) => t.split('\n').some((l) => { const low = l.trim().toLowerCase(); return !hasMoney(low) && (WORKS_TITLE.test(wordsOf(low)) || PARTS_TITLE.test(wordsOf(low))); }));
  let section: Section = null;
  let explicit = false; // раздел задан заголовком, а не догадкой по колонкам
  let last: WorkOrderItem | null = null; // для переноса длинного наименования на следующую строку
  for (const t of texts) {
    for (const rawLine of t.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const low = line.toLowerCase();
      const words = wordsOf(low);
      // заголовки разделов
      if (!hasMoney(low) && WORKS_TITLE.test(words)) {
        section = 'works';
        explicit = true;
        last = null;
        continue;
      }
      if (!hasMoney(low) && PARTS_TITLE.test(words)) {
        section = 'parts';
        explicit = true;
        last = null;
        continue;
      }
      // строка с названиями колонок: раздел по ней угадываем, только если заголовка не было
      // (у некоторых сервисов в таблице запчастей колонка называется «Наименование работ»)
      if (!hasMoney(low) && /(наименование|№\s*операции|артикул|каталожн)/.test(low) && /(кол-?во|цена|сумма|н\/ч|н\/час|норм|ки\b)/.test(low)) {
        if (!explicit) {
          // «Наименование · Кол-во · Цена · Сумма» без подсказки — раздел не меняем, позиции разберём по названиям
          if (/(н\/ч|н\/час|норм|нормо)/.test(low) || (/работ/.test(low) && !/(кол-?во|артикул|каталожн)/.test(low))) section = 'works';
          else if (/(запасн|запчаст|материал|детал|товар|артикул|каталожн)/.test(low)) section = 'parts';
        }
        last = null;
        continue;
      }
      if (titled && !section) continue;
      // «Год выпуска: 2019», «Пробег: 118 821» — поля шапки, а не позиции
      if (/^[А-ЯЁа-яё][А-Яа-яЁё .()/№-]{1,30}:\s/.test(line) && !/^(скидка|итого|всего)/.test(low)) {
        last = null;
        continue;
      }
      // скидка суммой — отдельной строкой, чтобы итог совпал с документом
      const disc = /^скидка.*?(-?\s?\d{1,3}(?:[ \u00a0]\d{3})*[.,]\d{2})\s*(?:руб\.?|₽)?\s*$/i.exec(line);
      if (disc) {
        const v = Math.abs(num(disc[1].replace(/\s/g, '')));
        if (v > 0) out.works.push({ name: 'Скидка', qty: 1, price: -v, total: -v });
        continue;
      }
      if (/^(итого|всего|в т\.?\s?ч|в том числе|ндс|сумма ндс|к оплате|скидка|подпись|исполнитель|заказчик|мастер)/.test(low)) {
        if (/^(итого|всего)/.test(low)) {
          if (/работ|ремонт|услуг|запчаст|запасн|материал/.test(low) || /^всего/.test(low)) section = null;
          explicit = false;
        }
        last = null;
        continue;
      }
      if (HEADER_WORDS.test(low) && !/[.,]\d{2}\b/.test(low)) {
        last = null;
        continue;
      }
      const tn = tailNumbers(line);
      if (!tn) {
        // продолжение наименования с предыдущей строки: «ИНСПЕКЦИОННЫЙ СЕРВИС С СЕРВИСОМ» + «ПО ЗАМЕНЕ МАСЛА»
        if (last && !/\d{2,}/.test(line) && /[А-ЯЁA-Z]{2}/i.test(line) && line.length <= 80 && !/[.!?]$/.test(line)) last.name = cleanName(`${last.name} ${line}`);
        else last = null;
        continue;
      }
      // имя и артикул
      let article: string | undefined;
      const nameCells: string[] = [];
      const longest = Math.max(0, ...tn.head.map((c) => (/[А-Яа-яЁёA-Za-z]{3}/.test(c) ? c.length : 0)));
      for (const c of tn.head) {
        if (/^\d{1,3}[.)]?$/.test(c)) continue; // № п/п
        if (/^\d+[.,]\d+$/.test(c)) continue; // нормо-часы «1,6» отдельной колонкой
        if (!article && isArticle(c)) article = c.toUpperCase().replace(/\s{2,}/g, ' ');
        else if (/^[A-ZА-ЯЁ0-9]{2,5}$/.test(c) && longest >= 6) continue; // короткий код операции: «RM», «АУС»
        else nameCells.push(c);
      }
      let name = cleanName(nameCells.join(' '));
      if (!article) {
        // артикул внутри наименования: «04E115561H Фильтр масляный» или «Фильтр масляный (04E115561H)»
        const m = /(?:^|\s|\()([0-9][A-Z0-9]{2}\s?\d{3}\s?\d{3}\s?[A-Z]{0,2}|[A-Z]\s?\d{3}\s?\d{3}\s?[A-Z]{0,2}\d{0,2}|[A-Z0-9]{2,5}[- ]?\d{3,}[A-Z0-9/-]*)(?:\)|\s|$)/.exec(name);
        if (m && (VAG_ART.test(m[1]) || /^(?=.*\d{3})[A-Z0-9-]{6,}$/.test(m[1])) && !m[1].split(/\s+/).some((w) => /^[A-Z]{4,}$/.test(w))) {
          article = m[1].trim();
          name = cleanName(name.replace(m[0], ' ').replace(/\(\s*\)/, ''));
        }
      }
      // артикул бренда в конце наименования: «Фильтр масляный MANN W 712/95», «Свеча NGK BKUR6ET-10»
      let brand: string | undefined;
      if (!article) {
        const m = /\s(?:([A-Z][A-Za-z-]{1,14}(?: MOLY| PRINT)?)\s)?([A-Z]{1,4}\s?\d{2,4}\/\d{1,3}[A-Za-z]?|(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z]{2})[A-Z0-9][A-Z0-9-]{4,18})\s*$/.exec(name);
        if (m && !/^\d{1,2}W-?\d{2}$/i.test(m[2])) {
          article = m[2];
          if (m[1] && BRANDS.test(m[1])) brand = m[1].toUpperCase();
          name = cleanName(name.slice(0, m.index) + (m[1] && !BRANDS.test(m[1]) ? ' ' + m[1] : ''));
        }
      } else {
        const b = /\s([A-Z][A-Za-z-]{1,14})\s*$/.exec(name);
        if (b && BRANDS.test(b[1])) {
          brand = b[1].toUpperCase();
          name = cleanName(name.slice(0, b.index));
        }
      }
      if (!/[А-Яа-яЁёA-Za-z]{3}/.test(name)) continue;
      if (/^(итого|всего|ндс|скидка)/i.test(name)) continue;
      const { qty, price, total } = splitNums(tn.nums);
      if (!(total > 0) || total > 5_000_000) continue;
      const item: WorkOrderItem = { name, partNumber: article, brand, qty, price, total };
      let sec = section;
      // раздел из заголовка документа — главнее догадок по названию (код операции работы похож на артикул)
      if (!sec || (!explicit && sec === 'works' && article && PART_RE.test(name) && !WORK_RE.test(name)))
        sec = article || (PART_RE.test(name) && !WORK_RE.test(name)) ? 'parts' : WORK_RE.test(name) ? 'works' : 'parts';
      if (sec === 'works') {
        last = { ...item, partNumber: undefined, qty: 1, price: total };
        out.works.push(last);
      } else {
        last = item;
        out.parts.push(item);
      }
    }
  }
  for (const x of [...out.works, ...out.parts]) x.name = tidyName(x.name);
  return out;
}

// «ИНСПЕКЦИОННЫЙ СЕРВИС ПО ЗАМЕНЕ МАСЛА» → «Инспекционный сервис по замене масла»; сокращения (ДВС, ГРМ, АКПП) и коды остаются
const ABBR = new Set(['ДВС', 'ГРМ', 'АКПП', 'МКПП', 'КПП', 'ДТ', 'ТО', 'АБС', 'ГУР', 'ЭБУ', 'ПТФ', 'СТО', 'ДХО', 'АКБ', 'ШРУС', 'ОЖ', 'ТНВД', 'ЕГР', 'ВАЗ', 'РФ', 'ПТК', 'ПТД', 'ЗТК', 'ЗТД']);
export function tidyName(name: string): string {
  const letters = name.replace(/[^А-ЯЁа-яё]/g, '');
  if (letters.length < 4 || letters !== letters.toUpperCase()) return name;
  let first = true;
  return name.replace(/[А-ЯЁ]+(?:-[А-ЯЁ]+)*/g, (w) => {
    const out = ABBR.has(w) ? w : first ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase();
    first = false;
    return out;
  });
}

export const workOrderSum = (w: WorkOrder) => [...w.works, ...w.parts].reduce((a, x) => a + x.total, 0);
