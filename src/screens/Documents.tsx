import React, { useEffect, useState } from 'react';
import { LuArchive, LuCopy, LuFileText, LuHistory, LuIdCard, LuPencil, LuPlus, LuRefreshCw, LuShieldCheck, LuSiren, LuTrash2 } from 'react-icons/lu';
import { del, get, getAll, put, stamp, uid, useQuery } from '../data/db';
import { DOC_TYPES, docExpiry, docMeta, normPlate, vuExtendedUntil } from '../data/logic';
import type { Car, DocEntry, DocType } from '../data/types';
import { guessDocType, parseDocument, type ParsedDoc } from '../data/docParse';
import { ScanFill } from '../ui/ScanFill';
import { FORM_PASSES, PAPER_PASSES } from '../lib/ocr';
import { removeAttachments } from '../lib/attachments';
import { addMonths, dateShort, fromDateInput, money, parseNum, relDays, toDateInput, DAY } from '../lib/format';
import { copyText } from '../lib/native';
import { refreshReminders } from '../lib/notify';
import { useApp } from '../state';
import { AttachmentPicker, AttachmentStrip } from '../ui/Attachments';
import { TopBar } from '../ui/CarSwitch';
import { Badge, Button, Card, Chips, Empty, Field, IconButton, Input, NumInput, Page, Plate, Row, Section, TextArea, Toggle, confirmDialog, go, toast } from '../ui/kit';

const FIELD_NAMES: Record<string, string> = {
  number: 'номер',
  region: 'регион',
  holder: 'владелец',
  issuer: 'кем выдан / страховая',
  issueDate: 'дата выдачи',
  startDate: 'начало',
  expiryDate: 'срок действия',
  cost: 'стоимость',
  franchise: 'франшиза',
  phone: 'телефон',
  categories: 'категории',
  drivers: 'водители',
  plate: 'госномер',
  vin: 'VIN',
  make: 'марка',
  model: 'модель',
  vehicleType: 'тип ТС',
  category: 'категория',
  year: 'год выпуска',
  chassis: 'шасси',
  body: 'кузов',
  color: 'цвет',
  approval: 'одобрение типа',
  ecoClass: 'экокласс',
  pts: 'ПТС',
  maxMass: 'макс. масса',
  curbMass: 'масса',
  powerKw: 'мощность, кВт',
  powerHp: 'мощность, л.с.',
  address: 'адрес',
  specialNotes: 'особые отметки',
};

/** Дополнительные поля СТС (хранятся в details). */
const STS_DETAILS: { key: string; label: string; mono?: boolean; num?: boolean }[] = [
  { key: 'plate', label: 'Госномер', mono: true },
  { key: 'region', label: 'Регион', num: true },
  { key: 'vin', label: 'VIN', mono: true },
  { key: 'make', label: 'Марка' },
  { key: 'model', label: 'Модель' },
  { key: 'vehicleType', label: 'Тип ТС' },
  { key: 'category', label: 'Категория ТС' },
  { key: 'year', label: 'Год выпуска', num: true },
  { key: 'color', label: 'Цвет' },
  { key: 'powerHp', label: 'Мощность, л.с.' },
  { key: 'powerKw', label: 'Мощность, кВт' },
  { key: 'ecoClass', label: 'Экологический класс' },
  { key: 'pts', label: 'Паспорт ТС №', mono: true },
  { key: 'chassis', label: 'Шасси (рама) №', mono: true },
  { key: 'body', label: 'Кузов (кабина, прицеп) №', mono: true },
  { key: 'approval', label: 'Одобрение типа ТС №', mono: true },
  { key: 'maxMass', label: 'Тех. допустимая макс. масса, кг', num: true },
  { key: 'curbMass', label: 'Масса в снаряжённом состоянии, кг', num: true },
  { key: 'address', label: 'Адрес собственника' },
  { key: 'specialNotes', label: 'Особые отметки' },
];
const DETAIL_KEYS: Partial<Record<DocType, string[]>> = { sts: STS_DETAILS.map((d) => d.key) };

const ICON: Record<DocType, React.ReactNode> = {
  sts: <LuFileText />,
  pts: <LuFileText />,
  grz: <span className="grz-icon">A</span>,
  vu: <LuIdCard />,
  osago: <LuShieldCheck />,
  kasko: <LuShieldCheck />,
};

function docSummary(d: DocEntry): string {
  switch (d.type) {
    case 'grz':
      return `${d.number || ''} ${d.region || ''}`.trim();
    case 'osago':
    case 'kasko':
      return [d.issuer, d.number].filter(Boolean).join(' · ');
    case 'vu':
      return [d.number, d.categories].filter(Boolean).join(' · ');
    case 'sts':
      return [d.number, d.details?.plate ? `${d.details.plate} ${d.details.region || ''}`.trim() : '', d.issueDate ? `от ${dateShort(d.issueDate)}` : '']
        .filter(Boolean)
        .join(' · ');
    default:
      return [d.number, d.issueDate ? `от ${dateShort(d.issueDate)}` : ''].filter(Boolean).join(' · ');
  }
}

function ExpiryBadge({ d }: { d: DocEntry }) {
  const e = docExpiry(d);
  if (!e) return null;
  if (e.expired) return <Badge tone="danger">истёк</Badge>;
  if (e.soon) return <Badge tone="warn">{e.days === 0 ? 'сегодня' : `${e.days} дн.`}</Badge>;
  return <Badge tone="ok">до {dateShort(e.until)}{e.extended ? ' · продлено' : ''}</Badge>;
}

export function DocList() {
  const { car } = useApp();
  const docs = useQuery(() => getAll<DocEntry>('documents'), [], ['documents']);
  if (!docs) return null;
  const active = docs.filter((d) => d.status === 'active');
  const archived = docs.filter((d) => d.status === 'archived');
  const carDocs = car ? active.filter((d) => d.carId === car.id) : [];
  const vus = active.filter((d) => d.type === 'vu');
  const hasSts = carDocs.some((d) => d.type === 'sts');

  return (
    <div className="screen">
      <TopBar title="Документы" />
      {car && (
        <Section title={`${car.make} ${car.model}`}>
          <div className="list">
            {DOC_TYPES.filter((t) => t.perCar).map((t) => {
              const list = carDocs.filter((d) => d.type === t.type);
              const hist = archived.filter((d) => d.type === t.type && d.carId === car.id).length;
              if (!list.length)
                return (
                  <Row
                    key={t.type}
                    className="row-add"
                    icon={ICON[t.type]}
                    title={t.short}
                    subtitle={`Добавить: ${t.title.toLowerCase()}`}
                    right={hist ? <Badge>история {hist}</Badge> : <LuPlus />}
                    chevron={false}
                    onClick={() => go(`#/docs/new/${t.type}`)}
                  />
                );
              return list.map((d) => (
                <Row
                  key={d.id}
                  icon={ICON[t.type]}
                  title={
                    <>
                      {t.short} {hist > 0 && <small className="muted"> · история {hist}</small>}
                    </>
                  }
                  subtitle={t.type === 'grz' ? undefined : docSummary(d) || 'без номера'}
                  right={t.type === 'grz' ? <Plate number={d.number} region={d.region} size="sm" /> : <ExpiryBadge d={d} />}
                  onClick={() => go(`#/docs/${d.id}`)}
                />
              ));
            })}
          </div>
          {hasSts && (
            <Button variant="secondary" block icon={<LuSiren />} onClick={() => go('#/fines?check=1')}>
              Проверить штрафы по документам
            </Button>
          )}
        </Section>
      )}
      <Section title="Водительские удостоверения" action={<Button size="sm" variant="ghost" icon={<LuPlus />} onClick={() => go('#/docs/new/vu')}>ВУ</Button>}>
        {vus.length === 0 ? (
          <Empty icon={<LuIdCard />} title="ВУ не добавлены" text="Добавьте удостоверения — свои и жены. Номер ВУ используется для проверки штрафов." />
        ) : (
          <div className="list">
            {vus.map((d) => (
              <Row key={d.id} icon={<LuIdCard />} title={d.holder || 'Водитель'} subtitle={docSummary(d)} right={<ExpiryBadge d={d} />} onClick={() => go(`#/docs/${d.id}`)} />
            ))}
          </div>
        )}
      </Section>
      <p className="hint-text">
        При замене документа старый не удаляется, а уходит в историю — её видно в карточке документа.
      </p>
    </div>
  );
}

export function DocDetail({ id }: { id: string }) {
  const d = useQuery(() => get<DocEntry>('documents', id), [id], ['documents']);
  const history = useQuery(
    async () => {
      if (!d) return [];
      const all = await getAll<DocEntry>('documents');
      return all
        .filter((x) => x.type === d.type && x.status === 'archived' && x.id !== d.id && (d.type === 'vu' ? x.holder === d.holder : x.carId === d.carId))
        .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
    },
    [d?.id, d?.status],
    ['documents'],
  );
  const { cars } = useApp();
  if (d === undefined) return <Page title="Документ" back="#/docs"><div /></Page>;
  if (!d) return <Page title="Не найдено" back="#/docs"><Empty title="Документ удалён" /></Page>;
  const meta = docMeta(d.type);
  const car = cars.find((c) => c.id === d.carId);
  const copy = async (v?: string) => {
    if (!v) return;
    await copyText(v.replace(/\s/g, ''));
    toast('Скопировано');
  };
  const remove = async () => {
    if (!(await confirmDialog(`Удалить ${meta.short}?`, { text: 'Документ и его фото будут удалены без возможности восстановления. Для замены используйте «Заменить новым».', danger: true, ok: 'Удалить' }))) return;
    await del('documents', d.id);
    await removeAttachments(d.attachments);
    refreshReminders();
    toast('Удалено');
    go('#/docs');
  };
  const archive = async () => {
    if (!(await confirmDialog('Перенести в историю?', { ok: 'В историю' }))) return;
    await put('documents', stamp({ ...d, status: 'archived', archivedAt: Date.now() }));
    refreshReminders();
    go('#/docs');
  };
  const restore = async () => {
    const all = await getAll<DocEntry>('documents');
    const cur = all.filter((x) => x.type === d.type && x.status === 'active' && (d.type === 'vu' ? x.holder === d.holder : x.carId === d.carId));
    for (const c of cur) await put('documents', stamp({ ...c, status: 'archived', archivedAt: Date.now() }));
    await put('documents', stamp({ ...d, status: 'active', archivedAt: undefined }));
    toast('Документ снова действующий');
  };

  const fields: [string, React.ReactNode, string?][] = [];
  if (d.type === 'grz') fields.push(['Госномер', <Plate number={d.number} region={d.region} size="lg" />, `${d.number || ''}${d.region || ''}`]);
  else if (d.number) fields.push([d.type === 'osago' || d.type === 'kasko' ? 'Номер полиса' : 'Серия и номер', <span className="mono big">{d.number}</span>, d.number]);
  if (d.holder) fields.push([d.type === 'vu' ? 'Владелец' : d.type === 'osago' || d.type === 'kasko' ? 'Страхователь' : 'Собственник', d.holder]);
  if (d.issuer) fields.push([d.type === 'osago' || d.type === 'kasko' ? 'Страховая' : 'Кем выдан', d.issuer]);
  if (d.issueDate) fields.push([d.type === 'grz' ? 'Дата регистрации' : 'Дата выдачи', dateShort(d.issueDate)]);
  if (d.startDate) fields.push(['Начало действия', dateShort(d.startDate)]);
  const ext = vuExtendedUntil(d);
  if (ext) {
    fields.push(['Действует до (с продлением)', <>{dateShort(ext)} <small className="muted">({relDays(ext)})</small></>]);
    fields.push(['Срок в удостоверении (4b)', <>{dateShort(d.expiryDate)} <small className="muted">· продлено на 3 года, менять не нужно (пост. Правительства № 353)</small></>]);
  } else if (d.expiryDate) fields.push(['Действует до', <>{dateShort(d.expiryDate)} <small className="muted">({relDays(d.expiryDate)})</small></>]);
  if (d.categories) fields.push(['Категории', d.categories]);
  if (d.drivers) fields.push(['Допущенные водители', d.drivers]);
  if (d.cost) fields.push(['Стоимость', money(d.cost)]);
  if (d.franchise) fields.push(['Франшиза', money(d.franchise)]);
  if (d.phone) fields.push(['Телефон', <a href={`tel:${d.phone}`}>{d.phone}</a>]);
  if (d.type === 'sts') {
    const det = d.details || {};
    const i = fields.findIndex((x) => x[0] === 'Кем выдан');
    if (i >= 0) fields[i][0] = 'Код подразделения ГИБДД';
    if (det.plate) fields.splice(1, 0, ['Госномер', <Plate number={det.plate} region={det.region} size="md" />, `${det.plate}${det.region || ''}`]);
    for (const it of STS_DETAILS) {
      if (it.key === 'plate' || it.key === 'region' || !det[it.key]) continue;
      if (it.key === 'body' && det.body === det.vin) continue;
      fields.push([it.label, it.mono ? <span className="mono">{det[it.key]}</span> : det[it.key], it.mono || it.key === 'address' ? det[it.key] : undefined]);
    }
  }

  return (
    <Page
      title={meta.short}
      back="#/docs"
      actions={
        <IconButton label="Изменить" onClick={() => go(`#/docs/${d.id}/edit`)}>
          <LuPencil />
        </IconButton>
      }
    >
      {d.status === 'archived' && (
        <Card className="muted-card">
          <LuArchive /> В истории с {dateShort(d.archivedAt)}.{' '}
          <button className="link" onClick={restore}>Сделать действующим</button>
        </Card>
      )}
      <Card>
        <div className="doc-head">
          <div className="eyebrow">{meta.title}</div>
          {car && <div className="muted">{car.make} {car.model}</div>}
          <ExpiryBadge d={d} />
        </div>
        <div className="kv-list">
          {fields.map(([k, v, c], i) => (
            <div className="kv" key={i}>
              <span>{k}</span>
              <b>{v}</b>
              {c && (
                <IconButton label="Копировать" onClick={() => copy(c)} className="kv-copy">
                  <LuCopy />
                </IconButton>
              )}
            </div>
          ))}
        </div>
        {d.notes && <p className="pre muted">{d.notes}</p>}
      </Card>
      {d.attachments.length > 0 && (
        <Section title="Фото / сканы">
          <AttachmentStrip ids={d.attachments} />
        </Section>
      )}
      {d.status === 'active' && (
        <div className="btn-stack">
          <Button variant="primary" icon={<LuRefreshCw />} block onClick={() => go(`#/docs/new/${d.type}/${d.id}`)}>
            Заменить новым
          </Button>
          <Button variant="ghost" icon={<LuArchive />} block onClick={archive}>
            Перенести в историю
          </Button>
        </div>
      )}
      {history && history.length > 0 && (
        <Section title={<><LuHistory /> История · {history.length}</>}>
          <div className="list">
            {history.map((h) => (
              <Row key={h.id} icon={<LuArchive />} title={docSummary(h) || meta.short} subtitle={`${h.issueDate || h.startDate ? 'с ' + dateShort(h.startDate || h.issueDate) : ''}${h.archivedAt ? ' · заменён ' + dateShort(h.archivedAt) : ''}`} onClick={() => go(`#/docs/${h.id}`)} />
            ))}
          </div>
        </Section>
      )}
      <div className="form-actions">
        <Button variant="danger" icon={<LuTrash2 />} block onClick={remove}>
          Удалить
        </Button>
      </div>
    </Page>
  );
}

export function DocHistory({ type, scope }: { type: DocType; scope?: string }) {
  const docs = useQuery(() => getAll<DocEntry>('documents'), [], ['documents']);
  const meta = docMeta(type);
  const list = (docs || []).filter((d) => d.type === type && d.status === 'archived' && (type === 'vu' || d.carId === scope));
  return (
    <Page title={`История: ${meta.short}`} back="#/docs">
      {list.length === 0 ? (
        <Empty icon={<LuHistory />} title="История пуста" />
      ) : (
        <div className="list">
          {list.map((h) => (
            <Row key={h.id} title={docSummary(h)} subtitle={`заменён ${dateShort(h.archivedAt)}`} onClick={() => go(`#/docs/${h.id}`)} />
          ))}
        </div>
      )}
    </Page>
  );
}

export function detailsFrom(type: DocType, f: Record<string, string>): Record<string, string> | undefined {
  const keys = DETAIL_KEYS[type];
  if (!keys) return undefined;
  const out: Record<string, string> = {};
  for (const k of keys) {
    let v = (f[k] || '').trim();
    if (!v) continue;
    if (k === 'plate') v = normPlate(v);
    if (k === 'vin' || k === 'body' || k === 'chassis' || k === 'approval' || k === 'pts') v = v.toUpperCase();
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function DocForm({ id, type: typeProp, replaceId }: { id?: string; type?: DocType; replaceId?: string }) {
  const { car, cars } = useApp();
  const [orig, setOrig] = useState<DocEntry | null>(null);
  const [replacing, setReplacing] = useState<DocEntry | null>(null);
  const [loaded, setLoaded] = useState(!id && !replaceId);
  const [type, setType] = useState<DocType>(typeProp || 'sts');
  const [carId, setCarId] = useState(car?.id || '');
  const [f, setF] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<string[]>([]);
  const [auto, setAuto] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<ParsedDoc['extra']>({});
  const [addPlate, setAddPlate] = useState(true);
  const [saveVin, setSaveVin] = useState(true);
  const set = (k: string) => (v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    setAuto((a) => {
      if (!a.has(k)) return a;
      const n = new Set(a);
      n.delete(k);
      return n;
    });
  };
  const inp = (k: string) => ({ value: f[k] || '', onChange: (e: any) => set(k)(e.target.value) });
  const A = (k: string) => auto.has(k);

  // распознанный текст → поля формы (при редактировании заполняем только пустые)
  const applyOcr = (texts: string[]): string[] => {
    let t = type;
    if (!typeProp && !orig && !replacing) {
      const g = guessDocType(texts);
      if (g) {
        t = g;
        setType(g);
      }
    }
    const r = parseDocument(t, texts);
    const filled: string[] = [];
    const next = { ...f };
    const nextAuto = new Set(auto);
    for (const [k, v] of Object.entries(r.fields)) {
      if (!v) continue;
      if (orig && f[k]) continue;
      next[k] = v;
      nextAuto.add(k);
      filled.push(FIELD_NAMES[k] || k);
    }
    setF(next);
    setAuto(nextAuto);
    setExtra(r.extra);
    if (t !== 'sts') {
      if (r.extra.plate) filled.push('госномер');
      if (r.extra.vin) filled.push('VIN');
    }
    return filled;
  };

  const fill = (d: DocEntry, copyAll: boolean) => {
    setType(d.type);
    if (d.carId) setCarId(d.carId);
    const base: Record<string, string> = {
      holder: d.holder || '',
      issuer: d.issuer || '',
      phone: d.phone || '',
      categories: d.categories || '',
      drivers: d.drivers || '',
    };
    if (d.type === 'grz') base.region = d.region || '';
    // доп. поля (для СТС — сведения об автомобиле и собственнике) переносим и при замене документа
    for (const [k, val] of Object.entries(d.details || {})) if (val) base[k] = val;
    if (!copyAll) {
      delete base.specialNotes;
    }
    if (copyAll) {
      Object.assign(base, {
        number: d.number || '',
        region: d.region || '',
        issueDate: toDateInput(d.issueDate),
        startDate: toDateInput(d.startDate),
        expiryDate: toDateInput(d.expiryDate),
        cost: d.cost ? String(d.cost) : '',
        franchise: d.franchise ? String(d.franchise) : '',
        notes: d.notes || '',
      });
    } else if ((d.type === 'osago' || d.type === 'kasko') && d.expiryDate) {
      base.startDate = toDateInput(d.expiryDate + DAY);
      base.expiryDate = toDateInput(addMonths(d.expiryDate, 12));
    }
    setF(base);
  };

  useEffect(() => {
    if (id)
      get<DocEntry>('documents', id).then((d) => {
        if (!d) return go('#/docs');
        setOrig(d);
        fill(d, true);
        setAttachments(d.attachments);
        setLoaded(true);
      });
    else if (replaceId)
      get<DocEntry>('documents', replaceId).then((d) => {
        if (d) {
          setReplacing(d);
          fill(d, false);
        }
        setLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, replaceId]);

  // автозаполнение сроков
  useEffect(() => {
    if (orig) return;
    if ((type === 'osago' || type === 'kasko') && f.startDate && !f.expiryDate) {
      const s = fromDateInput(f.startDate)!;
      set('expiryDate')(toDateInput(addMonths(s, 12) - DAY));
    }
    if (type === 'vu' && f.issueDate && !f.expiryDate) {
      set('expiryDate')(toDateInput(addMonths(fromDateInput(f.issueDate)!, 120)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.issueDate, type]);

  if (!loaded) return <Page title="Документ" back="#/docs"><div /></Page>;
  const meta = docMeta(type);

  const save = async () => {
    const number = type === 'grz' ? normPlate(f.number) : (f.number || '').trim();
    if (type === 'vu' && !f.holder?.trim()) return toast('Укажите владельца ВУ', 'danger');
    const doc: DocEntry = stamp(
      {
        ...(orig || { id: uid(), createdAt: Date.now(), status: 'active' as const }),
        type,
        carId: meta.perCar ? carId : undefined,
        number: number || undefined,
        region: type === 'grz' ? (f.region || '').trim() || undefined : undefined,
        holder: f.holder?.trim() || undefined,
        issuer: f.issuer?.trim() || undefined,
        issueDate: fromDateInput(f.issueDate),
        startDate: fromDateInput(f.startDate),
        expiryDate: fromDateInput(f.expiryDate),
        cost: parseNum(f.cost),
        franchise: parseNum(f.franchise),
        phone: f.phone?.trim() || undefined,
        categories: f.categories?.trim() || undefined,
        drivers: f.drivers?.trim() || undefined,
        notes: f.notes?.trim() || undefined,
        attachments,
        details: detailsFrom(type, f),
      } as DocEntry,
      !orig,
    );
    // при добавлении нового — предыдущие действующие того же типа уходят в историю
    if (!orig) {
      const all = await getAll<DocEntry>('documents');
      const prev = all.filter(
        (x) => x.type === type && x.status === 'active' && x.id !== doc.id && (type === 'vu' ? (replacing ? x.id === replacing.id : x.holder === doc.holder) : x.carId === doc.carId),
      );
      for (const p of prev) await put('documents', stamp({ ...p, status: 'archived', archivedAt: Date.now() }));
      if (prev.length) toast(`Предыдущий ${meta.short} перенесён в историю`, 'info');
    }
    await put('documents', doc);
    if (orig) await removeAttachments(orig.attachments.filter((a) => !attachments.includes(a)));
    // госномер → документ «ГРЗ» (новый номер — старый уходит в историю), сведения → карточка машины
    const plate = type === 'sts' ? normPlate(f.plate) : extra.plate;
    const region = type === 'sts' ? (f.region || '').trim() : extra.region;
    if (doc.carId && plate && addPlate && type !== 'grz') {
      const all = await getAll<DocEntry>('documents');
      const cur = all.find((x) => x.type === 'grz' && x.status === 'active' && x.carId === doc.carId);
      if (!cur || normPlate(cur.number) !== plate || (region && cur.region !== region)) {
        if (cur) await put('documents', stamp({ ...cur, status: 'archived', archivedAt: Date.now() }));
        await put('documents', stamp<DocEntry>({ id: uid(), createdAt: Date.now(), updatedAt: Date.now(), type: 'grz', carId: doc.carId, status: 'active', number: plate, region: region || undefined, issueDate: doc.issueDate, attachments: [] }, true));
        toast(cur ? 'Госномер обновлён, прежний — в истории' : 'Госномер добавлен в документы', 'info');
      }
    }
    const vin = type === 'sts' ? (f.vin || '').trim().toUpperCase() : extra.vin;
    if (doc.carId && saveVin) {
      const c = await get<Car>('cars', doc.carId);
      if (c) {
        const upd: Partial<Car> = {};
        if (vin && !c.vin) upd.vin = vin;
        if (type === 'sts') {
          if (!c.year && parseNum(f.year)) upd.year = parseNum(f.year);
          if (!c.power && parseNum(f.powerHp)) upd.power = Math.round(parseNum(f.powerHp)!);
        }
        if (Object.keys(upd).length) await put('cars', stamp({ ...c, ...upd }));
      }
    }
    refreshReminders();
    toast('Сохранено');
    go(`#/docs/${doc.id}`);
  };

  const isPolicy = type === 'osago' || type === 'kasko';

  return (
    <Page title={orig ? `Изменить ${meta.short}` : replacing ? `Новый ${meta.short}` : meta.title} back={orig ? `#/docs/${orig.id}` : '#/docs'}>
      <div className="form">
        <ScanFill
          title={`Сканировать ${meta.short}`}
          subtitle={
            orig
              ? 'Пустые поля заполнятся с фото'
              : type === 'sts' || type === 'vu'
                ? 'Снимите или выберите в галерее обе стороны — поля заполнятся сами, их можно исправить'
                : 'Сфотографируйте документ, выберите фото или PDF — поля заполнятся сами'
          }
          scanMode="color"
          passes={type === 'sts' || type === 'pts' || type === 'vu' ? FORM_PASSES : PAPER_PASSES}
          nextHint={type === 'sts' || type === 'vu' ? 'добавьте оборотную сторону кнопкой «Ещё страница»' : undefined}
          fileName={meta.short}
          onAttachments={(ids) => setAttachments((a) => [...a, ...ids])}
          onText={applyOcr}
        />
        {replacing && <Card className="muted-card">Текущий документ ({docSummary(replacing)}) после сохранения уйдёт в историю.</Card>}
        {!orig && !replacing && !typeProp && (
          <Field label="Тип документа">
            <Chips value={meta.short} onChange={(s) => setType(DOC_TYPES.find((t) => t.short === s)!.type)} options={DOC_TYPES.map((t) => t.short)} />
          </Field>
        )}
        {meta.perCar && cars.length > 1 && (
          <Field label="Машина">
            <Chips value={cars.find((c) => c.id === carId)?.model || ''} onChange={(m) => setCarId(cars.find((c) => c.model === m)!.id)} options={cars.map((c) => c.model)} />
          </Field>
        )}

        {type === 'grz' && (
          <>
            <div className="grid-plate">
              <Field auto={A('number')} label="Номер">
                <Input {...inp('number')} placeholder="А123ВС" className="mono upper" autoCapitalize="characters" maxLength={9} />
              </Field>
              <Field auto={A('region')} label="Регион">
                <NumInput value={f.region || ''} onChange={set('region')} decimals={false} placeholder="77" maxLength={3} />
              </Field>
            </div>
            {f.number && (
              <div className="plate-preview">
                <Plate number={normPlate(f.number)} region={f.region} size="lg" />
              </div>
            )}
            <Field auto={A('issueDate')} label="Дата регистрации">
              <Input type="date" {...inp('issueDate')} />
            </Field>
          </>
        )}

        {type === 'sts' && (
          <>
            <div className="form-group-title">Документ</div>
            <Field auto={A('number')} label="Серия и номер" hint="10 символов, например 99 99 123456 — используется для проверки штрафов">
              <Input {...inp('number')} placeholder="99 99 123456" className="mono upper" />
            </Field>
            <div className="grid-2">
              <Field auto={A('issueDate')} label="Дата выдачи">
                <Input type="date" {...inp('issueDate')} />
              </Field>
              <Field auto={A('issuer')} label="Код подразделения ГИБДД">
                <Input {...inp('issuer')} placeholder="7 цифр" className="mono" inputMode="numeric" />
              </Field>
            </div>

            <div className="form-group-title">Автомобиль</div>
            <div className="grid-plate">
              <Field auto={A('plate')} label="Госномер">
                <Input {...inp('plate')} placeholder="А123ВС" className="mono upper" autoCapitalize="characters" maxLength={9} />
              </Field>
              <Field auto={A('region')} label="Регион">
                <NumInput value={f.region || ''} onChange={set('region')} decimals={false} placeholder="77" maxLength={3} />
              </Field>
            </div>
            {f.plate && (
              <div className="plate-preview">
                <Plate number={normPlate(f.plate)} region={f.region} size="md" />
              </div>
            )}
            <Field auto={A('vin')} label="VIN">
              <Input {...inp('vin')} placeholder="17 символов" className="mono upper" maxLength={17} autoCapitalize="characters" />
            </Field>
            <div className="grid-2">
              <Field auto={A('make')} label="Марка">
                <Input {...inp('make')} placeholder="АУДИ" />
              </Field>
              <Field auto={A('model')} label="Модель">
                <Input {...inp('model')} placeholder="A5" />
              </Field>
            </div>
            <div className="grid-2">
              <Field auto={A('vehicleType')} label="Тип ТС">
                <Input {...inp('vehicleType')} placeholder="Легковой седан" />
              </Field>
              <Field auto={A('category')} label="Категория">
                <Input {...inp('category')} placeholder="B/M1" className="upper" />
              </Field>
            </div>
            <div className="grid-2">
              <Field auto={A('year')} label="Год выпуска">
                <NumInput value={f.year || ''} onChange={set('year')} decimals={false} maxLength={4} />
              </Field>
              <Field auto={A('color')} label="Цвет">
                <Input {...inp('color')} placeholder="белый" />
              </Field>
            </div>
            <div className="grid-2">
              <Field auto={A('powerHp')} label="Мощность, л.с.">
                <NumInput value={f.powerHp || ''} onChange={set('powerHp')} />
              </Field>
              <Field auto={A('powerKw')} label="Мощность, кВт">
                <NumInput value={f.powerKw || ''} onChange={set('powerKw')} />
              </Field>
            </div>
            <div className="grid-2">
              <Field auto={A('ecoClass')} label="Экологический класс">
                <Input {...inp('ecoClass')} placeholder="ПЯТЫЙ/5" />
              </Field>
              <Field auto={A('pts')} label="Паспорт ТС №">
                <Input {...inp('pts')} placeholder="78 УХ 123456" className="mono upper" />
              </Field>
            </div>
            <Field auto={A('chassis')} label="Шасси (рама) №">
              <Input {...inp('chassis')} placeholder="ОТСУТСТВУЕТ" className="mono upper" />
            </Field>
            <Field auto={A('body')} label="Кузов (кабина, прицеп) №">
              <Input {...inp('body')} className="mono upper" />
            </Field>
            <Field auto={A('approval')} label="Одобрение типа ТС №">
              <Input {...inp('approval')} className="mono upper" />
            </Field>
            <div className="grid-2">
              <Field auto={A('maxMass')} label="Макс. масса, кг">
                <NumInput value={f.maxMass || ''} onChange={set('maxMass')} decimals={false} />
              </Field>
              <Field auto={A('curbMass')} label="Масса в снаряж., кг">
                <NumInput value={f.curbMass || ''} onChange={set('curbMass')} decimals={false} />
              </Field>
            </div>

            <div className="form-group-title">Собственник</div>
            <Field auto={A('holder')} label="ФИО">
              <Input {...inp('holder')} placeholder="Фамилия Имя Отчество" />
            </Field>
            <Field auto={A('address')} label="Адрес">
              <TextArea {...(inp('address') as any)} rows={2} placeholder="Субъект, город, улица, дом, корпус, квартира" />
            </Field>
            <Field auto={A('specialNotes')} label="Особые отметки">
              <TextArea {...(inp('specialNotes') as any)} rows={3} />
            </Field>
          </>
        )}

        {type === 'pts' && (
          <>
            <Field auto={A('number')} label="Серия и номер" hint="ПТС: 77 ОХ 123456, ЭПТС: 15 цифр">
              <Input {...inp('number')} placeholder="77 ОХ 123456" className="mono upper" />
            </Field>
            <div className="grid-2">
              <Field auto={A('issueDate')} label="Дата выдачи">
                <Input type="date" {...inp('issueDate')} />
              </Field>
              <Field auto={A('holder')} label="Собственник">
                <Input {...inp('holder')} placeholder="ФИО" />
              </Field>
            </div>
            <Field auto={A('issuer')} label="Кем выдан">
              <Input {...inp('issuer')} placeholder="подразделение / организация" />
            </Field>
          </>
        )}

        {type === 'vu' && (
          <>
            <Field auto={A('holder')} label="Владелец">
              <Input {...inp('holder')} placeholder="Фамилия Имя" />
            </Field>
            <Field auto={A('number')} label="Серия и номер" hint="10 цифр, например 99 12 345678">
              <Input {...inp('number')} placeholder="99 12 345678" className="mono" inputMode="numeric" />
            </Field>
            <div className="grid-2">
              <Field auto={A('issueDate')} label="Дата выдачи">
                <Input type="date" {...inp('issueDate')} />
              </Field>
              <Field auto={A('expiryDate')} label="Действует до">
                <Input type="date" {...inp('expiryDate')} />
              </Field>
            </div>
            <Field auto={A('categories')} label="Категории">
              <Input {...inp('categories')} placeholder="B, B1, M" />
            </Field>
          </>
        )}

        {isPolicy && (
          <>
            <Field auto={A('issuer')} label="Страховая компания">
              <Input {...inp('issuer')} placeholder="Ингосстрах, Альфа…" list="insurers" />
              <datalist id="insurers">
                {['Ингосстрах', 'АльфаСтрахование', 'РЕСО-Гарантия', 'СОГАЗ', 'Росгосстрах', 'ВСК', 'Согласие', 'Т-Страхование', 'Сбербанк страхование', 'Ренессанс'].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field auto={A('number')} label="Номер полиса">
              <Input {...inp('number')} placeholder={type === 'osago' ? 'ХХХ 0123456789' : ''} className="mono upper" />
            </Field>
            <div className="grid-2">
              <Field auto={A('startDate')} label="Начало">
                <Input type="date" {...inp('startDate')} />
              </Field>
              <Field auto={A('expiryDate')} label="Окончание">
                <Input type="date" {...inp('expiryDate')} />
              </Field>
            </div>
            <div className="grid-2">
              <Field auto={A('cost')} label="Стоимость">
                <NumInput value={f.cost || ''} onChange={set('cost')} suffix="₽" />
              </Field>
              {type === 'kasko' ? (
                <Field auto={A('franchise')} label="Франшиза">
                  <NumInput value={f.franchise || ''} onChange={set('franchise')} suffix="₽" />
                </Field>
              ) : (
                <Field auto={A('phone')} label="Телефон страховой">
                  <Input {...inp('phone')} type="tel" />
                </Field>
              )}
            </div>
            {type === 'kasko' && (
              <Field auto={A('phone')} label="Телефон страховой">
                <Input {...inp('phone')} type="tel" />
              </Field>
            )}
            <Field auto={A('holder')} label="Страхователь">
              <Input {...inp('holder')} placeholder="ФИО" />
            </Field>
            <Field auto={A('drivers')} label="Допущенные водители">
              <Input {...inp('drivers')} placeholder="Без ограничений / ФИО через запятую" />
            </Field>
          </>
        )}

        {meta.perCar && type === 'sts' && (f.plate || f.vin || f.year || f.powerHp) && (
          <Card className="muted-card">
            {f.plate && (
              <Toggle
                checked={addPlate}
                onChange={setAddPlate}
                label={`Госномер ${normPlate(f.plate)} ${f.region || ''} → в документы`}
                hint="Создаст или обновит документ «ГРЗ» этой машины (прежний номер уйдёт в историю)"
              />
            )}
            {(f.vin || f.year || f.powerHp) && (
              <Toggle checked={saveVin} onChange={setSaveVin} label="Дополнить карточку машины" hint="VIN, год выпуска и мощность — только незаполненные поля" />
            )}
          </Card>
        )}
        {meta.perCar && type !== 'sts' && type !== 'grz' && (extra.plate || extra.vin) && (
          <Card className="muted-card">
            {extra.plate && (
              <Toggle checked={addPlate} onChange={setAddPlate} label={`Госномер ${extra.plate} ${extra.region || ''} → в документы`} hint="Если госномера ещё нет или он другой" />
            )}
            {extra.vin && <Toggle checked={saveVin} onChange={setSaveVin} label={`VIN ${extra.vin} в карточку машины`} hint="Если VIN ещё не указан" />}
          </Card>
        )}
        <Field label="Заметки">
          <TextArea {...(inp('notes') as any)} rows={2} />
        </Field>
        <AttachmentPicker value={attachments} onChange={setAttachments} label="Фото / скан документа" scanMode="color" />
      </div>
      <div className="form-actions">
        <Button variant="primary" size="lg" block onClick={save}>
          Сохранить
        </Button>
      </div>
    </Page>
  );
}
