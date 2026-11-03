// Разбор свидетельства о регистрации ТС (СТС) — обе стороны, старый и новый бланк.
// На вход — тексты нескольких проходов распознавания (лицевая и оборотная стороны вперемешку).
// Каждое поле собирается голосованием; номера — посимвольно.
import {
  Votes, afterLabel, cyrToLat, digitsFix, findDates, findLabel, findPlates, finalVin, hasLabel, labelNorm, latToCyr, levenshtein, lines,
  titleCase, toCyrUpper, toLatUpper, vinCandidates, fuzzyFind,
} from './ocrText';

export interface StsFields {
  number?: string; // серия и номер
  issueDate?: string; // ISO
  issuer?: string; // код подразделения ГИБДД
  holder?: string;
  plate?: string;
  region?: string;
  vin?: string;
  make?: string;
  model?: string;
  vehicleType?: string;
  category?: string;
  year?: string;
  chassis?: string;
  body?: string;
  color?: string;
  approval?: string;
  ecoClass?: string;
  pts?: string;
  maxMass?: string;
  curbMass?: string;
  powerKw?: string;
  powerHp?: string;
  address?: string;
  specialNotes?: string;
}

const L = {
  plate: ['регистрационный знак', 'регистрационный номер', 'регистрационныи'],
  vin: ['идентификационный', '(vin)'],
  make: ['марка'],
  model: ['модель'],
  type: ['тип тс', 'тип'],
  category: ['категория'],
  year: ['выпуска'],
  chassis: ['шасси', '(рама)'],
  body: ['кузов', 'кабина'],
  color: ['цвет'],
  approval: ['одобрение', 'типа тс'],
  eco: ['экологический'],
  pts: ['паспорт'],
  power: ['мощность'],
  maxMass: ['допустимая', 'разрешенная', 'максимальн', 'max масса'],
  curbMass: ['снаряженном', 'без нагрузки'],
  owner: ['собственник', 'владелец'],
  subject: ['субъект', 'федерации'],
  district: ['район'],
  locality: ['населенный', 'пункт'],
  street: ['улица'],
  building: ['корпус', 'корп'],
  flat: ['квартира'],
  notes: ['особые', 'отметки'],
  code: ['подразделения', 'гибдд'],
  issue: ['выдачи', 'дата выдачи'],
};
const STOP_OWNER = [...L.subject, ...L.locality, ...L.street, 'российской'];

const MAKES: [string, string][] = [
  ['АУДИ', 'AUDI'], ['ФОЛЬКСВАГЕН', 'VOLKSWAGEN'], ['ШКОДА', 'SKODA'], ['СЕАТ', 'SEAT'], ['БМВ', 'BMW'], ['МЕРСЕДЕС-БЕНЦ', 'MERCEDES-BENZ'],
  ['МЕРСЕДЕС', 'MERCEDES'], ['ПОРШЕ', 'PORSCHE'], ['ТОЙОТА', 'TOYOTA'], ['ЛЕКСУС', 'LEXUS'], ['НИССАН', 'NISSAN'], ['ИНФИНИТИ', 'INFINITI'],
  ['МАЗДА', 'MAZDA'], ['ХОНДА', 'HONDA'], ['МИЦУБИСИ', 'MITSUBISHI'], ['СУБАРУ', 'SUBARU'], ['СУЗУКИ', 'SUZUKI'], ['КИА', 'KIA'],
  ['ХЕНДЭ', 'HYUNDAI'], ['ХУНДАЙ', 'HYUNDAI'], ['ГЕНЕЗИС', 'GENESIS'], ['ЛАДА', 'LADA'], ['ВАЗ', 'VAZ'], ['РЕНО', 'RENAULT'],
  ['ПЕЖО', 'PEUGEOT'], ['СИТРОЕН', 'CITROEN'], ['ОПЕЛЬ', 'OPEL'], ['ФОРД', 'FORD'], ['ШЕВРОЛЕ', 'CHEVROLET'], ['ВОЛЬВО', 'VOLVO'],
  ['ЛЕНД РОВЕР', 'LAND ROVER'], ['ЯГУАР', 'JAGUAR'], ['МИНИ', 'MINI'], ['ДЖИЛИ', 'GEELY'], ['ЧЕРИ', 'CHERY'], ['ХАВАЛ', 'HAVAL'],
  ['ДЖЕТУР', 'JETOUR'], ['ЭКСИД', 'EXEED'], ['ОМОДА', 'OMODA'], ['ТАНК', 'TANK'], ['ЧАНГАН', 'CHANGAN'], ['ГАЗ', 'GAZ'], ['УАЗ', 'UAZ'],
  ['КАМАЗ', 'KAMAZ'], ['ДАТСУН', 'DATSUN'], ['ДЭУ', 'DAEWOO'], ['РАВОН', 'RAVON'], ['ДЖИП', 'JEEP'], ['ТЕСЛА', 'TESLA'], ['ФИАТ', 'FIAT'],
];

// ---------- марка и модель из СТС → как пишут в карточке машины ----------
const MAKE_DISPLAY: Record<string, string> = {
  BMW: 'BMW', KIA: 'Kia', MINI: 'MINI', SEAT: 'SEAT', VAZ: 'ВАЗ', GAZ: 'ГАЗ', UAZ: 'УАЗ', KAMAZ: 'КАМАЗ', EXEED: 'EXEED', TANK: 'TANK', LADA: 'Lada',
};
/** «АУДИ» → «Audi», «ФОЛЬКСВАГЕН» → «Volkswagen», «МЕРСЕДЕС-БЕНЦ» → «Mercedes-Benz». */
export function makeDisplayName(make?: string): string | undefined {
  if (!make) return undefined;
  const up = make.toUpperCase().trim();
  const pair = MAKES.find(([ru, en]) => ru === up || en === up);
  if (!pair) return titleCase(make);
  const en = pair[1];
  return MAKE_DISPLAY[en] || en.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
}

const MODELS_RU: Record<string, string> = {
  ПОЛО: 'Polo', ГОЛЬФ: 'Golf', ПАССАТ: 'Passat', ДЖЕТТА: 'Jetta', ТИГУАН: 'Tiguan', ТУАРЕГ: 'Touareg', ТЕРАМОНТ: 'Teramont', ТУРАН: 'Touran',
  КАДДИ: 'Caddy', МУЛЬТИВАН: 'Multivan', КАРАВЕЛЛА: 'Caravelle', АМАРОК: 'Amarok', АРТЕОН: 'Arteon', ТАОС: 'Taos', ОКТАВИЯ: 'Octavia', РАПИД: 'Rapid',
  ФАБИЯ: 'Fabia', КОДИАК: 'Kodiaq', КАРОК: 'Karoq', СУПЕРБ: 'Superb', ЙЕТИ: 'Yeti', ЛЕОН: 'Leon', ИБИЦА: 'Ibiza', АТЕКА: 'Ateca',
  ВЕСТА: 'Vesta', ГРАНТА: 'Granta', ЛАРГУС: 'Largus', НИВА: 'Niva', ПРИОРА: 'Priora', КАЛИНА: 'Kalina', СОЛЯРИС: 'Solaris', КРЕТА: 'Creta',
  ТУКСОН: 'Tucson', САНТА: 'Santa Fe', РИО: 'Rio', СПОРТЕЙДЖ: 'Sportage', СИД: 'Ceed', ОПТИМА: 'Optima', СОРЕНТО: 'Sorento', КАМРИ: 'Camry',
  КОРОЛЛА: 'Corolla', ЛОГАН: 'Logan', ДАСТЕР: 'Duster', САНДЕРО: 'Sandero', КАПТЮР: 'Kaptur', АРКАНА: 'Arkana', ОКТАВИА: 'Octavia',
};
/** «ПОЛО» → «Polo», «ВЕСТА» → «Vesta», «A5» и «X5» остаются как есть. */
export function modelDisplayName(model?: string): string | undefined {
  if (!model) return undefined;
  const up = model.toUpperCase().trim();
  if (MODELS_RU[up]) return MODELS_RU[up];
  if (/[А-ЯЁ]{3}/.test(up) && !/[A-Z]/.test(up)) return titleCase(cyrToLat(up).replace(/'/g, ''));
  return model.trim();
}

const COLORS =
  'белый|черный|чёрный|серый|серебристый|красный|синий|голубой|зеленый|зелёный|коричневый|бежевый|желтый|жёлтый|оранжевый|фиолетовый|' +
  'бордовый|вишневый|вишнёвый|золотистый|бирюзовый|розовый|пурпурный|графитовый|бронзовый|песочный|хаки|мультиколор|сиреневый|темно-синий|' +
  'темно-серый|темно-зеленый|светло-серый|светло-бежевый';
const COLOR_RE = new RegExp(`(?<![а-яё])((?:темно|тёмно|светло|ярко)-?)?(${COLORS})(?![а-яё])`, 'i');

const ECO: [RegExp, number][] = [
  [/перв/i, 1], [/втор/i, 2], [/трет/i, 3], [/четв/i, 4], [/пят/i, 5], [/шест/i, 6],
];
const ECO_NAMES = ['', 'ПЕРВЫЙ', 'ВТОРОЙ', 'ТРЕТИЙ', 'ЧЕТВЕРТЫЙ', 'ПЯТЫЙ', 'ШЕСТОЙ'];


/** Короткие коды моделей: «AS» → «A5», «АЗ» → «A3». */
function fixModelToken(t: string) {
  // модель кириллицей («ПОЛО», «ВЕСТА») оставляем как есть
  const lat = toLatUpper(t.toUpperCase()).replace(/[^A-ZА-ЯЁ0-9-]/g, '');
  if (/[А-ЯЁ]/.test(lat.replace(/[ЗБ]$/, ''))) return toCyrUpper(t.toUpperCase()).replace(/[^А-ЯЁ0-9-]/g, '');
  let s = toLatUpper(t).replace(/[^A-Z0-9-]/g, '');
  if (/^[A-Z]{1,2}[SOIlZBЗБ]$/i.test(s) && s.length <= 3) s = s.slice(0, -1) + ({ S: '5', O: '0', I: '1', L: '1', Z: '2', B: '8', З: '3', Б: '6' } as any)[s.slice(-1).toUpperCase()];
  if (/^[A-Z]{1,2}З$/.test(toLatUpper(t))) s = s.slice(0, -1) + '3';
  return s;
}

function findMake(line: string): { make: string; rest: string } | null {
  const up = line.toUpperCase();
  const cyr = toCyrUpper(up);
  for (const [ru, en] of MAKES) {
    for (const [hay, name] of [
      [cyr, ru],
      [up, en],
    ] as const) {
      const r = fuzzyFind(hay, name, name.length >= 6 ? 1 : 0);
      if (!r) continue;
      // целое слово
      const before = hay[r.start - 1];
      const after = hay[r.end];
      if (before && /[А-ЯA-Z]/.test(before)) continue;
      if (after && /[А-ЯA-Z]/.test(after)) continue;
      return { make: ru, rest: line.slice(r.end).trim() };
    }
  }
  return null;
}

/** Особые отметки: слова из латинских «двойников» кириллицы (YB30C, A123BC777) → кириллица; частые слова. */
function tidyNotes(s: string) {
  return s
    .split(' ')
    .map((w) => (/^[ABEKMHOPCTYX0-9]{3,12}[.,]?$/.test(w) && /[A-Z]/.test(w) && w !== 'ICCID' ? toCyrUpper(w) : w))
    .join(' ')
    .replace(/(?<![А-ЯЁ])[УY][ВB][3ЗЭ0О][0ОO][СC](?![А-ЯЁ])/g, 'УВЭОС')
    .replace(/ИЗМЕ\s+НЕН(?:ИЕ|Е)(?![А-ЯЁ])/g, 'ИЗМЕНЕНИЕ')
    .replace(/(?<![А-ЯЁA-Z])[MМ][OО]\S{0,2}\s?НОСТЬ/g, 'Мощность')
    .replace(/(?<![А-ЯЁ])В\s+(?:[а-яё]\s+)?ЫДАН/g, 'ВЫДАН');
}

export function parseSts(texts: string[]): { fields: StsFields; auto: string[] } {
  const v = new Votes();
  const owners: OwnerBlock[] = [];
  const notesCands: string[] = [];

  for (const text of texts) {
    const ls = lines(text);
    let ownerFrom = -1;
    let notesFrom = -1;
    for (let i = 0; i < ls.length; i++) {
      const line = ls[i];
      const prev = ls[i - 1] || '';
      const next = ls[i + 1] || '';
      const up = line.toUpperCase();

      // госномер (кроме прежнего: «ВЗАМЕН ГРЗ …»)
      for (const p of findPlates(line)) {
        const before = labelNorm(line.slice(Math.max(0, p.index - 16), p.index));
        if (fuzzyFind(before, 'взамен', 2) || /грз\s*$/.test(before)) continue;
        let w = 1;
        if (hasLabel(prev, L.plate) || hasLabel(line, L.plate)) w += 1;
        if (/выдан\s*$|ыдан\s*$/.test(before)) w += 0.5;
        v.add('plateFull', p.plate + '|' + p.region, w);
      }
      // VIN (и номер кузова — он же)
      for (const c of vinCandidates(line)) v.add('vin', c, hasLabel(prev, L.vin) || hasLabel(line, L.vin) ? 1.5 : 1);

      // серия и номер СТС: 99 00 123456 (не путать со старым СТС в особых отметках)
      for (const m of line.matchAll(/(?<![\d.])(\d{2})\s{0,8}(\d{2})\s{0,8}(\d{6})(?![\d.])/g)) {
        const before = labelNorm(line.slice(Math.max(0, (m.index || 0) - 8), m.index));
        if (/(стс|стс|ст|с7)\s*$/.test(before)) continue;
        v.add('number', `${m[1]} ${m[2]} ${m[3]}`, 1);
      }
      // ПТС: 78 УХ 123456 или 15 цифр ЭПТС
      for (const m of up.matchAll(/(?<![\dA-ZА-Я])(\d{2})\s?([А-ЯA-Z]{2})\s?(?:№\s?)?([\dOОЗ]{6})(?!\d)/g)) {
        const letters = toCyrUpper(m[2]);
        if (!/^[А-ЯЁ]{2}$/.test(letters)) continue;
        v.add('pts', `${m[1]} ${letters} ${digitsFix(m[3])}`, hasLabel(line, L.pts) ? 2 : 1);
      }
      if (hasLabel(line, L.pts)) for (const m of line.matchAll(/(?<!\d)(\d{15})(?!\d)/g)) v.add('pts', m[1], 2);

      // марка и модель
      const mk = findMake(line);
      if (mk) {
        const w = hasLabel(line, L.make) || hasLabel(prev, L.make) ? 1.5 : 1;
        v.add('make', mk.make, w);
        const tok = mk.rest.split(/\s+/).filter((t) => /[A-ZА-Яa-zа-я0-9]/.test(t))[0];
        const mt = tok ? fixModelToken(tok) || tok : '';
        if (mt.length >= 2 && mt.length <= 12) v.add('model', mt, w * 0.8);
      } else if (hasLabel(line, L.make) && !hasLabel(line, L.model)) {
        const rest = afterLabel(line, L.make);
        const tok = rest?.split(/\s+/)[0];
        if (tok && /^[А-ЯЁA-Z-]{2,}$/i.test(tok)) v.add('make', toCyrUpper(tok), 0.5);
      }
      if (hasLabel(line, L.model) && !hasLabel(line, L.make)) {
        const rest = afterLabel(line, L.model);
        const tok = rest?.split(/\s+/).filter((t) => /[A-ZА-Яa-zа-я0-9]/.test(t))[0];
        const mt = tok ? fixModelToken(tok) || tok : '';
        if (mt.length >= 2 && mt.length <= 15 && /[A-ZА-Я0-9]/i.test(mt)) v.add('model', mt, 1);
      }

      // тип ТС
      const tm = /(легков|грузов|автобус|мотоцикл|седельн|специальн)[а-яё]*(?:\s+[а-яё]{4,}){0,2}/i.exec(line);
      if (tm) v.add('vehicleType', tm[0].charAt(0).toUpperCase() + tm[0].slice(1).toLowerCase(), 1);

      // категория: B/M1
      const cat = /(?:^|[^A-ZА-Яa-zа-я])([ABCDEВАСЕМ])\s*[/|]\s*([MNOМ])\s?([1-3G])(?![0-9])/i.exec(line);
      if (cat) v.add('category', `${toLatUpper(cat[1])}/${toLatUpper(cat[2])}${cat[3]}`, 1);

      // год выпуска
      const yr = /(?:^|\D)(19[5-9]\d|20[0-4]\d)(?!\d)/.exec(line);
      if (yr) {
        if (hasLabel(line, L.year)) v.add('year', yr[1], 2);
        else if ((line.match(/\d/g) || []).length === 4 && !/знак|москва|\d{2}\.\d{2}/i.test(line)) v.add('year', yr[1], 0.7);
      }

      // шасси
      if (/[0OО]Т[СC]УТ[СC]ТВ/i.test(up)) v.add('chassis', 'ОТСУТСТВУЕТ', hasLabel(line, L.chassis) ? 2 : 1);

      // цвет
      const col = COLOR_RE.exec(line);
      if (col) v.add('color', ((col[1] || '').replace(/-?$/, col[1] ? '-' : '') + col[2]).toLowerCase().replace(/ё/g, 'е'), hasLabel(line, L.color) ? 2 : 1);

      // одобрение типа ТС
      const ap = /([TТ])\s?([CС])\s?(R\s?U|Р\s?У)?\s?([EЕ])?\s?-?\s?([A-ZА-Я]{2})\s?\.\s?([A-ZА-Я0-9]{4})\s?\.\s?([0-9OОБЗ]{5})/.exec(up);
      if (ap) v.add('approval', toLatUpper(`${ap[1]}${ap[2]}${ap[3] ? ap[3].replace(/\s/g, '') : ''}${ap[4] || ''}-${ap[5]}.${ap[6]}.`) + digitsFix(ap[7]), 1);

      // экологический класс
      if (hasLabel(line, L.eco) || /(ПЯТ|ЧЕТВ|ШЕСТ|ТРЕТ)[А-ЯЁ]*\s*\/\s*\d/.test(up)) {
        const rest = afterLabel(line, L.eco) ?? line;
        for (const [re, n] of ECO) if (re.test(rest)) v.add('ecoClass', `${ECO_NAMES[n]}/${n}`, 1);
      }

      // массы
      if (hasLabel(line, L.maxMass)) {
        const m = /(\d{3,5})\D*$/.exec(line);
        if (m) v.add('maxMass', m[1], 1);
      }
      if (hasLabel(line, L.curbMass)) {
        const m = /(\d{3,5})\D*$/.exec(line);
        if (m) v.add('curbMass', m[1], 1);
      }

      // мощность: «139.7 кВт/190 л.с» (особые отметки) или «77/105» после подписи (старый бланк)
      const pw = /(\d{2,3}(?:[.,\s]\d)?)\s*к[ВBвb][тt]\s*[/|]\s*(\d{2,4}(?:[.,]\d)?)/i.exec(line);
      if (pw) {
        v.add('powerKw', pw[1].replace(/[\s,]/, '.'), 1);
        v.add('powerHp', pw[2].replace(',', '.'), 1);
      } else if (hasLabel(line, L.power)) {
        const m = /(\d{2,3}(?:[.,]\d)?)\s*[/|]\s*(\d{2,4}(?:[.,]\d)?)/.exec(line);
        if (m) {
          v.add('powerKw', m[1].replace(',', '.'), 1);
          v.add('powerHp', m[2].replace(',', '.'), 1);
        }
      }

      // код подразделения ГИБДД и дата выдачи
      if (hasLabel(line, L.code) || /ГИБ|ГРИБ|ГИБА/.test(up)) {
        const m = /(?<!\d)(\d{7})(?!\d)/.exec(line);
        if (m) v.add('issuer', m[1], 1);
      }
      for (const d of findDates(line)) v.add('issueDate', d.iso, hasLabel(line, L.issue) ? 2 : 0.5);

      // адрес
      // подпись «Субъект Российской Федерации» (но не заголовок «РОССИЙСКАЯ ФЕДЕРАЦИЯ» на лицевой стороне)
      if (hasLabel(line, L.subject) && !(line === line.toUpperCase() && !/СУБЪ/.test(up))) {
        // «Москва», «Московская область» или заглавными на старом бланке: «МОСКВА»
        const SUBJ = /^[А-ЯЁ][а-яё]+(?:(?:-|\s)(?:[А-ЯЁ][а-яё]+|область|край|республика|автономный|автономная|округ|обл\.?))*/;
        const SUBJ_UP = /^[А-ЯЁ]{3,}(?:(?:-|\s)(?:[А-ЯЁ]{3,}|ОБЛ\.?))*(?![А-ЯЁа-яё])/;
        const isLabel = (x: string) => [L.district, L.locality, L.street, L.owner, L.notes, L.code].some((lab) => hasLabel(x, lab));
        for (const x of [next, ls[i + 2] || '']) {
          if (!x || isLabel(x) || /^(свидетельств|регистрац|российск|федерац|собственн|владел|особые|certif)/i.test(x.trim())) continue;
          const m = x.match(SUBJ) || x.match(SUBJ_UP);
          if (m && m[0].length >= 4) {
            v.add('subject', m[0] === m[0].toUpperCase() ? titleCase(m[0]).replace(/ (Область|Край|Республика|Округ)/g, (z) => z.toLowerCase()) : m[0], 1);
            break;
          }
        }
      }
      if (hasLabel(line, L.district)) {
        const r = afterLabel(line, L.district);
        if (r && /[а-яё]{3}/i.test(r)) v.add('district', r.replace(/\s{2,}.*$/, ''), 1);
      }
      if (hasLabel(line, L.locality)) {
        let r = (afterLabel(line, L.locality) || '').replace(/\s{2,}.*$/, '');
        const w0 = r.split(/\s+/)[0] || '';
        if (fuzzyFind(labelNorm(w0), 'пункт', 1)) r = r.slice(w0.length).trim();
        if (r && /^[А-ЯЁ][А-ЯЁа-яё. -]{2,}$/.test(r)) v.add('locality', r, 1);
      }
      const st = /(?:^|\s)((?:ул|ш|пр-?кт|просп|пер|б-р|наб|пл|шоссе|проезд|туп|мкр)\.?\s+[А-ЯЁ0-9][А-ЯЁа-яё0-9-]+(?:\s+[А-ЯЁа-яё-]{3,})?)/i.exec(
        hasLabel(line, L.street) ? afterLabel(line, L.street) || '' : '',
      );
      if (st) {
        // «ПР-КТ ЛЕНИНСКИЙ» → «пр-кт Ленинский»
        const [, pre, name] = /^(\S+)\s+(.*)$/.exec(st[1])!;
        const nm = name === name.toUpperCase() ? titleCase(name) : name;
        v.add('street', `${pre.toLowerCase().replace(/\.$/, '')} ${nm}`, 1);
      }
      else if (hasLabel(line, L.street)) {
        const r = (afterLabel(line, L.street) || '').replace(/\s{2,}.*$/, '');
        if (/^[А-ЯЁа-яё0-9 .-]{4,}$/.test(r)) v.add('street', r, 0.7);
      }
      const hm = /(?:^|\s)[ДдЛлAaА][оoОO][мmМMwW]\.?\s+(\d{1,4}[А-ЯA-Zа-я]?(?:\/\d+)?)(?![\dА-Яа-я])/.exec(line);
      if (hm) v.add('house', toCyrUpper(hm[1].replace(/\s/g, '')), 1);
      // старый бланк: «Корп. 2», «Кв. 15»
      const km = /(?:^|[\s,])[КK][вВB]\.?\s*(\d{1,4})(?![\dА-Яа-я])/.exec(line);
      if (km && !/[кk][вb][тt]/i.test(line)) v.add('flat', km[1], 1);
      for (const [key, lab] of [
        ['building', L.building],
        ['flat', L.flat],
      ] as const) {
        if (!hasLabel(line, lab)) continue;
        const r = afterLabel(line, lab) || '';
        const m = /^(\d{1,4}[А-ЯA-Z]?)\b/.exec(r) || /(?:^|\s)(\d{1,4})(?:\s|$)/.exec(r);
        if (m) v.add(key, m[1], 1);
        else if (/^\W*\d{1,4}\W*$/.test(prev)) v.add(key, prev.replace(/\D/g, ''), 0.8);
        else if (/^\W*\d{1,4}\W*$/.test(next)) v.add(key, next.replace(/\D/g, ''), 0.8);
      }

      if (ownerFrom < 0 && hasLabel(line, L.owner)) ownerFrom = i;
      if (notesFrom < 0 && hasLabel(line, L.notes)) notesFrom = i;
    }

    // собственник: строки после «Собственник (владелец)» до «Субъект…»;
    // если подпись не распознана — несколько строк над отчеством
    let from = ownerFrom;
    let to = Math.min(ls.length, ownerFrom + 9);
    if (from < 0) {
      const p = ls.findIndex((x) => /[А-ЯЁ]{3,}(ВИЧ|ВНА)(?![А-ЯЁ])/.test(x.toUpperCase()));
      if (p >= 0) {
        from = Math.max(0, p - 5);
        to = p + 1;
      }
    }
    if (from >= 0) owners.push(ownerSlots(ls.slice(from, to), from === ownerFrom));
    if ((globalThis as any).__STS_DEBUG && from >= 0) console.log('owner block', from, to, JSON.stringify(owners[owners.length - 1]));
    // особые отметки
    if (notesFrom >= 0) {
      const out: string[] = [];
      for (let j = notesFrom + 1; j < Math.min(ls.length, notesFrom + 10); j++) {
        if (hasLabel(ls[j], L.code) || hasLabel(ls[j], L.issue)) break;
        out.push(
          ls[j]
            .replace(/^[^А-ЯЁA-Z0-9]+/i, '')
            .replace(/^\S{1,3}\s{2,}/, '') // мусор у левого края
            .replace(/\s{2,}\S{1,3}$/, '') // и у правого
            .replace(/\s+[^\sА-ЯЁA-Za-zа-яё0-9.,/()-]+$/, ''),
        );
      }
      if (out.length) notesCands.push(out.join(' ').replace(/\s+/g, ' ').replace(/(\S)- (\S)/g, '$1$2'));
    }
  }

  // ---------- итог ----------
  const f: StsFields = {};
  const set = (k: keyof StsFields, val?: string) => {
    if (val) f[k] = val;
  };
  const plate = v.chars('plateFull');
  if (plate) {
    const [p, r] = plate.split('|');
    set('plate', p);
    set('region', r);
  }
  set('year', v.best('year'));
  const vin = finalVin(v.list('vin'), f.year ? +f.year : undefined);
  set('vin', vin);
  set('number', v.chars('number'));
  set('pts', v.chars('pts'));
  set('make', v.best('make'));
  set('model', v.best('model'));
  set('vehicleType', v.best('vehicleType'));
  set('category', v.best('category'));
  set('chassis', v.best('chassis'));
  if (vin) set('body', vin);
  set('color', v.best('color'));
  set('approval', v.chars('approval'));
  set('ecoClass', v.best('ecoClass'));
  set('curbMass', v.best('curbMass'));
  set('maxMass', v.best('maxMass'));
  // для легковых (категория B) разрешённая масса ≤ 3500 кг и больше снаряжённой на 250–1200 кг
  if (f.maxMass && f.curbMass) {
    const mx = +f.maxMass, cb = +f.curbMass;
    if ((mx > 3500 && /^B/.test(f.category || 'B')) || mx - cb > 1300 || mx <= cb) {
      // «кг 2080» иногда читается как «52080»: сначала пробуем без первой цифры, затем с заменой первой
      const tail = f.maxMass.slice(1);
      for (const c of [...(f.maxMass.length === 5 ? [tail] : []), '2' + tail, '1' + tail, '3' + tail]) {
        if (+c - cb >= 250 && +c - cb <= 1200) {
          f.maxMass = c;
          break;
        }
      }
    }
  }
  set('powerKw', v.best('powerKw'));
  set('powerHp', v.best('powerHp'));
  set('issuer', v.chars('issuer'));
  set('issueDate', v.best('issueDate'));

  // ФИО
  const holder = pickOwner(owners);
  if (holder) set('holder', holder);

  // адрес
  const addr: string[] = [];
  const subj = v.best('subject');
  if (subj) addr.push(subj);
  const dist = v.best('district');
  if (dist) addr.push(dist);
  const loc = v.best('locality');
  if (loc && loc !== subj) addr.push(loc);
  const street = v.best('street');
  if (street) addr.push(street);
  const house = v.chars('house') || v.best('house');
  if (house) addr.push(`д. ${house}`);
  const bld = v.best('building');
  if (bld) addr.push(`корп. ${bld}`);
  const flat = v.best('flat');
  if (flat) addr.push(`кв. ${flat}`);
  if (addr.length >= 2) set('address', addr.join(', '));

  // особые отметки: самый «чистый» вариант
  if (notesCands.length) {
    const score = (s: string) => {
      const words = s.split(/[\s,.]+/).filter((w) => w.length >= 3);
      const cyr = words.filter((w) => /^[А-ЯЁа-яё-]+$/.test(w)).length;
      const mixed = words.filter((w) => /[А-ЯЁа-яё]/.test(w) && /[A-Za-z]/.test(w)).length;
      const lat = words.filter((w) => /^[A-Za-z-]+$/.test(w) && !/^(ICCID|MOL)$/i.test(w)).length;
      const bad = (s.match(/[^А-ЯЁA-Za-zа-яё0-9\s.,/()-]/g) || []).length;
      return cyr * 3 - mixed * 4 - lat * 2 - bad * 2;
    };
    set('specialNotes', tidyNotes(notesCands.sort((a, b) => score(b) - score(a))[0]));
    // мощность из отметок, если не нашли
    if (!f.powerHp) {
      const m = /(\d{2,3}(?:[.,]\d)?)\s*к[ВB]т\s*[/|]\s*(\d{2,4})/i.exec(f.specialNotes || '');
      if (m) {
        f.powerKw = m[1].replace(',', '.');
        f.powerHp = m[2];
      }
    }
  }
  return { fields: f, auto: Object.keys(f) };
}

interface OwnerBlock {
  slots: { cyr?: string; lat?: string }[];
  patr?: string;
}

/** Разбор блока «Собственник»: кириллическая строка, за ней её латинский дубль; отчество — без дубля. */
function ownerSlots(block: string[], skipFirstLabel: boolean): OwnerBlock {
  const out: OwnerBlock = { slots: [] };
  block.forEach((line, idx) => {
    let seg = line.split(/\s{2,}/)[0];
    if (idx === 0 && skipFirstLabel) seg = (afterLabel(line, L.owner) || '').replace(/^\(?влад\S*\)?/i, '').split(/\s{2,}/)[0];
    if (idx > 0 && STOP_OWNER.some((k) => hasLabel(line, [k]))) return;
    const toks = seg
      .split(/\s+/)
      .map((t) => t.replace(/[^A-ZА-ЯЁa-zа-яё'’-]/g, ''))
      .filter((t) => t.length >= 2);
    const cyr = toks.filter((t) => /^[А-ЯЁ][А-ЯЁ-]{2,}$/.test(t) && !/^(СОБСТВ|ВЛАДЕЛ|СУБЪЕКТ|РОССИЙ|ФЕДЕРАЦ)/.test(t));
    const latT = toks.filter((t) => /^[A-Z][A-Z'’]+$/.test(t));
    let lat = latT.length === 2 && !cyr.length && latT.every((t) => t.length <= 6) ? latT.join("'") : latT.find((t) => t.length >= 3);
    lat = lat?.replace(/’/g, "'");
    for (const c of cyr) {
      if (/(ВИЧ|ВНА|ИЧНА|КЫЗЫ|ОГЛЫ|УГЛИ)$/.test(c)) out.patr = c;
      else out.slots.push({ cyr: c });
    }
    if (lat) {
      const last = out.slots[out.slots.length - 1];
      if (last && last.cyr && !last.lat && levenshtein(cyrToLat(last.cyr), lat.replace(/'/g, '')) <= 3) last.lat = lat;
      else out.slots.push({ lat });
    }
  });
  return out;
}

/**
 * Фамилия, имя, отчество. Опора — латинские дубли фамилии и имени: они распознаются стабильнее
 * и повторяются во всех проходах. К каждому дублю подбираем кириллический вариант.
 */
function pickOwner(blocks: OwnerBlock[]): string | undefined {
  const norm = (l: string) => l.replace(/'/g, '');
  const latVotes = new Map<string, { w: number; pos: number; paired: boolean; raw: Votes }>();
  for (const b of blocks)
    b.slots.forEach((s, i) => {
      if (!s.lat || s.lat.length < 3) return;
      const k = norm(s.lat);
      const e = latVotes.get(k) || { w: 0, pos: 0, paired: false, raw: new Votes() };
      e.w += 1;
      e.pos += i;
      e.paired = e.paired || !!s.cyr;
      e.raw.add('v', s.lat, 1);
      latVotes.set(k, e);
    });
  const lats = Array.from(latVotes.entries())
    .filter(([, e]) => e.w >= 2 || e.paired)
    .sort((a, b) => a[1].pos / a[1].w - b[1].pos / b[1].w)
    .map(([, e]) => e.raw.best('v')!)
    .slice(0, 2);
  const cyrFor = (lat: string | undefined, idx: number) => {
    const cv = new Votes();
    for (const b of blocks)
      for (const s of b.slots) {
        if (!s.cyr) continue;
        if (lat) {
          const d = levenshtein(cyrToLat(s.cyr), norm(lat));
          if (d <= 3) cv.add('v', s.cyr, 1 + Math.max(0, 2 - d));
        }
      }
    if (!lat) {
      for (const b of blocks) {
        const s = b.slots.filter((x) => x.cyr)[idx];
        if (s?.cyr) cv.add('v', s.cyr, 1);
      }
      return cv.best('v');
    }
    return cv.best('v') || latToCyr(lat);
  };
  const sur = cyrFor(lats[0], 0);
  const name = cyrFor(lats[1], 1);
  const patr = new Votes();
  for (const b of blocks) if (b.patr) patr.add('v', b.patr, 1);
  const parts = [sur, name, patr.best('v')].filter(Boolean) as string[];
  return parts.length >= 2 ? titleCase(parts.join(' ')) : undefined;
}

/** Похоже ли на СТС (для автоопределения типа документа). */
export const looksLikeSts = (text: string) =>
  !!findLabel(text, ['свидетельство о регистрации', 'certificat d', 'собственник (владелец)']) || /СВИДЕТЕЛЬСТВО\s+О\s+РЕГИСТРАЦИИ/i.test(text);
