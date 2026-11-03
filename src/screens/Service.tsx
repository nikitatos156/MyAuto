import React, { useEffect, useState } from 'react';
import { LuFileDown, LuFileSpreadsheet, LuHammer, LuListChecks, LuPackage, LuPaperclip, LuPencil, LuPlus, LuTrash2, LuWrench, LuX } from 'react-icons/lu';
import { del, get, getAll, put, stamp, uid, useQuery } from '../data/db';
import { currentMileage, nextService, nextServiceNumber, partsTotal, serviceTotal, worksTotal } from '../data/logic';
import type { DocEntry, FuelEntry, ServiceEntry, ServiceKind, ServicePart, ServiceWork } from '../data/types';
import { removeAttachments } from '../lib/attachments';
import { addMonths, dateShort, fromDateInput, km, money, num, parseNum, relDays, toDateInput } from '../lib/format';
import { exportFile } from '../lib/native';
import { refreshReminders } from '../lib/notify';
import { useApp } from '../state';
import { AttachmentPicker, AttachmentStrip } from '../ui/Attachments';
import { TopBar } from '../ui/CarSwitch';
import { ScanFill } from '../ui/ScanFill';
import { PlanCard, PlanPickSheet } from './Plan';
import type { PlanItem } from '../data/maintenance';
import { parseWorkOrder, workOrderSum, type WorkOrder } from '../data/workOrder';
import {
  Badge, Button, Card, Empty, Field, IconButton, Input, NumInput, Page, Row, Section, Segmented, Sheet, TextArea, Toggle, confirmDialog, cx, go, toast,
} from '../ui/kit';

const KIND_LABEL: Record<ServiceKind, string> = { to: 'Плановое ТО', repair: 'Ремонт', other: 'Прочее' };

async function exportPdf(args: { carId: string; entries: ServiceEntry[]; single?: boolean; withReceipts: boolean }) {
  const [{ serviceReportPdf }, car, docs] = await Promise.all([
    import('../lib/pdf'),
    get<any>('cars', args.carId),
    getAll<DocEntry>('documents'),
  ]);
  const blob = await serviceReportPdf({ car, entries: args.entries, docs, withReceipts: args.withReceipts, single: args.single });
  const base = `${car.make}-${car.model}`.replace(/\s+/g, '-');
  const name = args.single && args.entries[0]
    ? `${base}-${args.entries[0].kind === 'to' ? 'TO-' + (args.entries[0].number ?? '') : 'remont'}-${toDateInput(args.entries[0].date)}.pdf`
    : `${base}-istoriya-TO-${toDateInput(Date.now())}.pdf`;
  await exportFile(blob, name, 'Отчёт по ТО');
}

function PdfSheet({ open, onClose, run }: { open: boolean; onClose: () => void; run: (withReceipts: boolean) => Promise<void> }) {
  const [withReceipts, setWith] = useState(true);
  const [busy, setBusy] = useState(false);
  const go_ = async () => {
    setBusy(true);
    try {
      await run(withReceipts);
      onClose();
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast('Не удалось создать PDF: ' + (e?.message || e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Выгрузка в PDF" footer={<Button variant="primary" block busy={busy} icon={<LuFileDown />} onClick={go_}>Создать PDF</Button>}>
      <Toggle checked={withReceipts} onChange={setWith} label="Приложить фото чеков" hint="Файл будет больше, зато всё в одном документе" />
    </Sheet>
  );
}

export function ServiceList() {
  const { car } = useApp();
  const data = useQuery(async () => ({
    services: await getAll<ServiceEntry>('services'),
    fuel: await getAll<FuelEntry>('fuel'),
  }), [], ['services', 'fuel', 'cars']);
  const [filter, setFilter] = useState<'all' | 'to' | 'repair'>('all');
  const [pdfOpen, setPdfOpen] = useState(false);
  if (!car || !data) return null;
  const all = data.services.filter((s) => s.carId === car.id).sort((a, b) => b.date - a.date || (b.mileage || 0) - (a.mileage || 0));
  const list = all.filter((s) => filter === 'all' || (filter === 'to' ? s.kind === 'to' : s.kind !== 'to'));
  const mileage = currentMileage(car, data.fuel, data.services);
  const ns = nextService(car, data.services, mileage);
  const total = all.reduce((a, s) => a + serviceTotal(s), 0);

  return (
    <div className="screen">
      <TopBar
        title="ТО и ремонт"
        actions={
          <>
            <IconButton label="Импорт из Excel" onClick={() => go('#/service/import')}>
              <LuFileSpreadsheet />
            </IconButton>
            {all.length > 0 && (
              <IconButton label="PDF по всем ТО" onClick={() => setPdfOpen(true)}>
                <LuFileDown />
              </IconButton>
            )}
            <Button variant="primary" size="sm" icon={<LuPlus />} aria-label="Добавить ТО или ремонт" onClick={() => go('#/service/new')}>
              Добавить
            </Button>
          </>
        }
      />

      <Card className={cx('next-to', ns?.overdue && 'is-danger', ns?.soon && 'is-warn')}>
        <div className="next-to-head">
          <span className="eyebrow">Следующее обслуживание</span>
          {ns?.overdue ? <Badge tone="danger">Просрочено</Badge> : ns?.soon ? <Badge tone="warn">Скоро</Badge> : ns ? <Badge tone="ok">По плану</Badge> : null}
        </div>
        {ns ? (
          <>
            <div className="next-to-title">ТО-{ns.number}</div>
            <div className="next-to-grid">
              <div>
                <span className="muted">Пробег</span>
                <b className="num">{ns.mileage ? km(ns.mileage) : '—'}</b>
                {ns.kmLeft !== undefined && <small className={ns.kmLeft < 0 ? 'text-danger' : ''}>{ns.kmLeft < 0 ? `перепробег ${km(-ns.kmLeft)}` : `осталось ${km(ns.kmLeft)}`}</small>}
              </div>
              <div>
                <span className="muted">Дата</span>
                <b className="num">{ns.date ? dateShort(ns.date) : '—'}</b>
                {ns.date && <small>{relDays(ns.date)}</small>}
              </div>
            </div>
            <div className="muted small">
              Интервал: {num(car.serviceIntervalKm)} км или {car.serviceIntervalMonths} мес. — что наступит раньше
            </div>
          </>
        ) : (
          <div className="muted">Добавьте последнее пройденное ТО — приложение рассчитает следующее по интервалу {num(car.serviceIntervalKm)} км / {car.serviceIntervalMonths} мес.</div>
        )}
      </Card>

      <PlanCard car={car} />

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: `Все${all.length ? ' · ' + all.length : ''}` },
          { value: 'to', label: 'Плановые ТО' },
          { value: 'repair', label: 'Ремонт' },
        ]}
      />

      {list.length === 0 ? (
        <Empty
          icon={<LuWrench />}
          title="Записей нет"
          text="Добавьте ТО: номер, пробег, работы, запчасти с артикулами и фото чека. Потом всё выгружается в PDF."
          action={
            <div className="empty-actions">
              <Button variant="primary" onClick={() => go('#/service/new')}>Добавить ТО</Button>
              <Button icon={<LuFileSpreadsheet />} onClick={() => go('#/service/import')}>Загрузить историю из Excel</Button>
            </div>
          }
        />
      ) : (
        <div className="list timeline">
          {list.map((s) => (
            <Row
              key={s.id}
              icon={<span className={cx('to-badge', s.kind !== 'to' && 'is-repair')}>{s.kind === 'to' ? s.number ?? '—' : <LuHammer />}</span>}
              title={
                <>
                  {s.kind === 'to' ? `ТО-${s.number ?? ''}` : s.title || KIND_LABEL[s.kind]}
                  {s.attachments.length > 0 && <LuPaperclip className="inline-icon" />}
                </>
              }
              subtitle={[dateShort(s.date), s.mileage ? km(s.mileage) : '', s.station].filter(Boolean).join(' · ')}
              right={
                <div className="row-right-stack">
                  <b className="num">{money(serviceTotal(s))}</b>
                  <small className="muted">
                    {s.works.length ? `${s.works.length} раб.` : ''} {s.parts.length ? `${s.parts.length} зап.` : ''}
                  </small>
                </div>
              }
              onClick={() => go(`#/service/${s.id}`)}
            />
          ))}
          <div className="list-total">
            <span>Всего на обслуживание</span>
            <b className="num">{money(total)}</b>
          </div>
        </div>
      )}
      <PdfSheet open={pdfOpen} onClose={() => setPdfOpen(false)} run={(w) => exportPdf({ carId: car.id, entries: all, withReceipts: w })} />
    </div>
  );
}

export function ServiceDetail({ id }: { id: string }) {
  const s = useQuery(() => get<ServiceEntry>('services', id), [id], ['services']);
  const [pdfOpen, setPdfOpen] = useState(false);
  if (s === undefined) return <Page title="ТО" back="#/service"><div /></Page>;
  if (!s) return <Page title="Не найдено" back="#/service"><Empty title="Запись удалена" /></Page>;
  const remove = async () => {
    if (!(await confirmDialog('Удалить запись?', { text: 'Вместе с ней удалятся фото чеков.', danger: true, ok: 'Удалить' }))) return;
    await del('services', s.id);
    await removeAttachments(s.attachments);
    refreshReminders();
    toast('Удалено');
    go('#/service');
  };
  return (
    <Page
      title={s.kind === 'to' ? `ТО-${s.number ?? ''}` : s.title || KIND_LABEL[s.kind]}
      back="#/service"
      actions={
        <>
          <IconButton label="PDF" onClick={() => setPdfOpen(true)}>
            <LuFileDown />
          </IconButton>
          <IconButton label="Изменить" onClick={() => go(`#/service/${s.id}/edit`)}>
            <LuPencil />
          </IconButton>
        </>
      }
    >
      <Card>
        <div className="kv-grid">
          <div><span>Вид</span><b>{KIND_LABEL[s.kind]}{s.title && s.kind === 'to' ? ` · ${s.title}` : ''}</b></div>
          <div><span>Дата</span><b>{dateShort(s.date)}</b></div>
          <div><span>Пробег</span><b className="num">{s.mileage ? km(s.mileage) : '—'}</b></div>
          <div><span>Сервис</span><b>{s.station || '—'}</b></div>
        </div>
      </Card>

      {s.works.length > 0 && (
        <Section title="Работы" action={<span className="muted num">{money(worksTotal(s), true)}</span>}>
          <div className="lines">
            {s.works.map((w, i) => (
              <div className="line" key={i}>
                <span className="line-name">{w.name}</span>
                <span className="num">{money(w.price, true)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {s.parts.length > 0 && (
        <Section title="Запчасти и материалы" action={<span className="muted num">{money(partsTotal(s), true)}</span>}>
          <div className="lines">
            {s.parts.map((p, i) => (
              <div className="line" key={i}>
                <span className="line-name">
                  {p.name}
                  {(p.partNumber || p.brand) && <small className="mono">{[p.partNumber, p.brand].filter(Boolean).join(' · ')}</small>}
                </span>
                <span className="num line-qty">{num(p.qty, 2).replace(/,00$/, '')} × {money(p.price, true)}</span>
                <span className="num">{money(p.price * p.qty, true)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      <div className="grand-total">
        <span>Итого</span>
        <b className="num">{money(serviceTotal(s), true)}</b>
      </div>
      {(s.nextMileage || s.nextDate) && (
        <Card className="muted-card">
          Следующее ТО: {[s.nextMileage ? km(s.nextMileage) : '', s.nextDate ? `до ${dateShort(s.nextDate)}` : ''].filter(Boolean).join(', ')}
        </Card>
      )}
      {s.notes && (
        <Section title="Примечания">
          <Card><p className="pre">{s.notes}</p></Card>
        </Section>
      )}
      {s.attachments.length > 0 && (
        <Section title="Чеки и документы">
          <AttachmentStrip ids={s.attachments} />
        </Section>
      )}
      <div className="form-actions">
        <Button variant="danger" icon={<LuTrash2 />} onClick={remove} block>
          Удалить запись
        </Button>
      </div>
      <PdfSheet open={pdfOpen} onClose={() => setPdfOpen(false)} run={(w) => exportPdf({ carId: s.carId, entries: [s], single: true, withReceipts: w })} />
    </Page>
  );
}

type WorkRow = { name: string; price: string };
type PartRow = { name: string; partNumber: string; brand: string; qty: string; price: string };

export function ServiceForm({ id, kind: initialKind = 'to' }: { id?: string; kind?: ServiceKind }) {
  const { car, cars } = useApp();
  const [loaded, setLoaded] = useState(!id);
  const [orig, setOrig] = useState<ServiceEntry | null>(null);
  const [carId] = useState(car?.id || '');
  const [kind, setKind] = useState<ServiceKind>(initialKind);
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(toDateInput(Date.now()));
  const [mileage, setMileage] = useState('');
  const [station, setStation] = useState('');
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [parts, setParts] = useState<PartRow[]>([]);
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [nextMileage, setNextMileage] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [customNext, setCustomNext] = useState(false);
  const [auto, setAuto] = useState<Set<string>>(new Set());
  const [planOpen, setPlanOpen] = useState(false);
  const all = useQuery(() => getAll<ServiceEntry>('services'), [], ['services']);

  const theCar = cars.find((c) => c.id === (orig?.carId || carId)) || car;

  useEffect(() => {
    if (!id) return;
    get<ServiceEntry>('services', id).then((s) => {
      if (!s) return go('#/service');
      setOrig(s);
      setKind(s.kind);
      setNumber(s.number ? String(s.number) : '');
      setTitle(s.title || '');
      setDate(toDateInput(s.date));
      setMileage(s.mileage ? String(s.mileage) : '');
      setStation(s.station || '');
      setWorks(s.works.map((w) => ({ name: w.name, price: String(w.price || '') })));
      setParts(s.parts.map((p) => ({ name: p.name, partNumber: p.partNumber || '', brand: p.brand || '', qty: String(p.qty), price: String(p.price || '') })));
      setNotes(s.notes || '');
      setAttachments(s.attachments);
      setNextMileage(s.nextMileage ? String(s.nextMileage) : '');
      setNextDate(toDateInput(s.nextDate));
      setCustomNext(!!(s.nextMileage || s.nextDate));
      setLoaded(true);
    });
  }, [id]);

  useEffect(() => {
    if (!id && all && theCar && kind === 'to' && !number) setNumber(String(nextServiceNumber(theCar.id, all)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, kind]);

  const stations = Array.from(new Set((all || []).map((s) => s.station).filter(Boolean))) as string[];

  if (!loaded || !theCar) return <Page title="ТО" back="#/service"><div /></Page>;

  const wTotal = works.reduce((a, w) => a + (parseNum(w.price) || 0), 0);
  const pTotal = parts.reduce((a, p) => a + (parseNum(p.price) || 0) * (parseNum(p.qty) || 1), 0);
  const m = parseNum(mileage);
  const autoNextKm = m ? m + theCar.serviceIntervalKm : undefined;
  const autoNextDate = addMonths(fromDateInput(date) || Date.now(), theCar.serviceIntervalMonths);

  // заказ-наряд: дата, пробег, сервис, работы и запчасти
  const applyWorkOrder = (wo: WorkOrder): string[] => {
    const found: string[] = [];
    const a = new Set(auto);
    if (wo.date) {
      setDate(toDateInput(wo.date));
      a.add('date');
      found.push('дата');
    }
    if (wo.mileage) {
      setMileage(String(wo.mileage));
      a.add('mileage');
      found.push('пробег');
    }
    if (wo.station && !station.trim()) {
      setStation(wo.station);
      a.add('station');
      found.push('сервис');
    }
    if (!orig && wo.kind === 'to') setKind('to');
    if (!orig && wo.toNumber && (kind === 'to' || wo.kind === 'to')) setNumber(String(wo.toNumber));
    if (wo.works.length) {
      setWorks((prev) => [...prev.filter((w) => w.name.trim()), ...wo.works.map((w) => ({ name: w.name, price: String(w.total) }))]);
      found.push(`работ: ${wo.works.filter((w) => w.total > 0).length}`);
    }
    if (wo.parts.length) {
      setParts((prev) => [
        ...prev.filter((p) => p.name.trim()),
        ...wo.parts.map((p) => ({ name: p.name, partNumber: p.partNumber || '', brand: p.brand || '', qty: String(p.qty), price: String(p.price) })),
      ]);
      found.push(`запчастей: ${wo.parts.length}`);
    }
    setAuto(a);
    const sum = workOrderSum(wo);
    if (wo.total && Math.abs(sum - wo.total) > 1 && (wo.works.length || wo.parts.length))
      toast(`Сумма строк ${money(sum)}, итог в документе ${money(wo.total)} — проверьте позиции`, 'danger', undefined, 6000);
    return found;
  };

  const addFromPlan = (items: PlanItem[]) => {
    setWorks((prev) => [...prev.filter((w) => w.name.trim()), ...items.filter((i) => i.work).map((i) => ({ name: i.work!, price: '' }))]);
    setParts((prev) => [
      ...prev.filter((p) => p.name.trim()),
      ...items.flatMap((i) => (i.parts || []).map((p) => ({ name: p.name, partNumber: p.partNumber || '', brand: '', qty: p.qty ? String(p.qty) : '1', price: '' }))),
    ]);
    toast(`Добавлено по плану: ${items.length}`);
  };

  const save = async () => {
    const d = fromDateInput(date);
    if (!d) return toast('Укажите дату', 'danger');
    const entry: ServiceEntry = stamp(
      {
        ...(orig || { id: uid(), createdAt: Date.now() }),
        carId: theCar.id,
        kind,
        number: kind === 'to' ? parseNum(number) : undefined,
        title: title.trim() || undefined,
        date: d,
        mileage: m ? Math.round(m) : undefined,
        station: station.trim() || undefined,
        works: works.filter((w) => w.name.trim()).map<ServiceWork>((w) => ({ name: w.name.trim(), price: parseNum(w.price) || 0 })),
        parts: parts
          .filter((p) => p.name.trim())
          .map<ServicePart>((p) => ({
            name: p.name.trim(),
            partNumber: p.partNumber.trim() || undefined,
            brand: p.brand.trim() || undefined,
            qty: parseNum(p.qty) || 1,
            price: parseNum(p.price) || 0,
          })),
        notes: notes.trim() || undefined,
        attachments,
        nextMileage: kind === 'to' && customNext ? parseNum(nextMileage) : undefined,
        nextDate: kind === 'to' && customNext ? fromDateInput(nextDate) : undefined,
      } as ServiceEntry,
      !orig,
    );
    await put('services', entry);
    if (orig) await removeAttachments(orig.attachments.filter((a) => !attachments.includes(a)));
    refreshReminders();
    toast('Сохранено');
    go(`#/service/${entry.id}`);
  };

  return (
    <Page title={orig ? 'Изменить запись' : kind === 'to' ? 'Новое ТО' : 'Новая запись'} back={orig ? `#/service/${orig.id}` : '#/service'}>
      <div className="form">
        <ScanFill
          title="Заполнить из заказ-наряда"
          subtitle="Фото, скриншот или PDF из почты — работы, запчасти с артикулами, пробег и дата заполнятся сами"
          scanMode="bw"
          fileName="Заказ-наряд"
          pdfMaxPages={6}
          nextHint="Если в заказ-наряде несколько страниц — добавьте их кнопкой «Ещё страница»"
          onAttachments={(ids) => setAttachments((a) => [...a, ...ids])}
          onText={(texts) => applyWorkOrder(parseWorkOrder(texts))}
        />
        <Button icon={<LuListChecks />} onClick={() => setPlanOpen(true)}>
          Работы и запчасти по плану обслуживания
        </Button>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'to', label: 'Плановое ТО' },
            { value: 'repair', label: 'Ремонт' },
            { value: 'other', label: 'Прочее' },
          ]}
        />
        <div className="grid-2">
          {kind === 'to' ? (
            <Field label="Номер ТО">
              <NumInput value={number} onChange={setNumber} decimals={false} placeholder="1" />
            </Field>
          ) : (
            <Field label="Что делали">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Замена колодок" />
            </Field>
          )}
          <Field label="Пробег" auto={auto.has('mileage')}>
            <NumInput value={mileage} onChange={setMileage} suffix="км" decimals={false} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Дата" auto={auto.has('date')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Сервис" auto={auto.has('station')}>
            <Input value={station} onChange={(e) => setStation(e.target.value)} placeholder="Дилер, СТО" list="svc-stations" />
            <datalist id="svc-stations">{stations.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
        </div>
        {kind === 'to' && (
          <Field label="Комментарий к ТО">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="например: замена масла и фильтров" />
          </Field>
        )}

        <Section title={<><LuHammer /> Работы</>} action={<span className="muted num">{money(wTotal)}</span>}>
          <div className="editor-list">
            {works.map((w, i) => (
              <div className="editor-row" key={i}>
                <Input value={w.name} placeholder="Наименование работы" onChange={(e) => setWorks(works.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <NumInput value={w.price} placeholder="₽" onChange={(v) => setWorks(works.map((x, j) => (j === i ? { ...x, price: v } : x)))} className="w-price" />
                <IconButton label="Убрать" onClick={() => setWorks(works.filter((_, j) => j !== i))}><LuX /></IconButton>
              </div>
            ))}
            <Button variant="ghost" icon={<LuPlus />} onClick={() => setWorks([...works, { name: '', price: '' }])}>Работа</Button>
          </div>
        </Section>

        <Section title={<><LuPackage /> Запчасти и материалы</>} action={<span className="muted num">{money(pTotal)}</span>}>
          <div className="editor-list">
            {parts.map((p, i) => {
              const upd = (patch: Partial<PartRow>) => setParts(parts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div className="part-card" key={i}>
                  <div className="editor-row">
                    <Input value={p.name} placeholder="Наименование (масло 5W-30, фильтр…)" onChange={(e) => upd({ name: e.target.value })} />
                    <IconButton label="Убрать" onClick={() => setParts(parts.filter((_, j) => j !== i))}><LuX /></IconButton>
                  </div>
                  <div className="grid-2">
                    <Input value={p.partNumber} placeholder="Артикул" onChange={(e) => upd({ partNumber: e.target.value })} className="mono" />
                    <Input value={p.brand} placeholder="Бренд" onChange={(e) => upd({ brand: e.target.value })} />
                  </div>
                  <div className="grid-3">
                    <NumInput value={p.qty} placeholder="Кол-во" onChange={(v) => upd({ qty: v })} suffix="шт" />
                    <NumInput value={p.price} placeholder="Цена" onChange={(v) => upd({ price: v })} suffix="₽" />
                    <div className="part-sum num">{money((parseNum(p.price) || 0) * (parseNum(p.qty) || 1))}</div>
                  </div>
                </div>
              );
            })}
            <Button variant="ghost" icon={<LuPlus />} onClick={() => setParts([...parts, { name: '', partNumber: '', brand: '', qty: '1', price: '' }])}>Запчасть</Button>
          </div>
        </Section>

        <div className="grand-total">
          <span>Итого</span>
          <b className="num">{money(wTotal + pTotal)}</b>
        </div>

        {kind === 'to' && (
          <>
            <Toggle
              checked={customNext}
              onChange={setCustomNext}
              label="Свой срок следующего ТО"
              hint={`По умолчанию: ${autoNextKm ? km(autoNextKm) + ' или ' : ''}${dateShort(autoNextDate)}`}
            />
            {customNext && (
              <div className="grid-2">
                <Field label="Следующее ТО, км">
                  <NumInput value={nextMileage} onChange={setNextMileage} decimals={false} placeholder={autoNextKm ? String(autoNextKm) : ''} />
                </Field>
                <Field label="Следующее ТО, дата">
                  <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
                </Field>
              </div>
            )}
          </>
        )}
        <Field label="Примечания">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <AttachmentPicker value={attachments} onChange={setAttachments} label="Чек / заказ-наряд" scanTitle="Чек / заказ-наряд" scanMode="bw" />
      </div>
      <div className="form-actions">
        <Button variant="primary" size="lg" block onClick={save}>Сохранить</Button>
      </div>
      <PlanPickSheet car={theCar} open={planOpen} onClose={() => setPlanOpen(false)} onAdd={addFromPlan} />
    </Page>
  );
}
