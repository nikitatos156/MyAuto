import React, { useEffect, useState } from 'react';
import { LuCircleCheck, LuClipboardPaste, LuCopy, LuExternalLink, LuIdCard, LuPencil, LuPlus, LuSearch, LuSiren, LuTrash2 } from 'react-icons/lu';
import { del, get, getAll, put, stamp, uid, useQuery } from '../data/db';
import { discountAllowed, fineInfo, normPlate, parseFineText } from '../data/logic';
import type { DocEntry, Fine } from '../data/types';
import { removeAttachments } from '../lib/attachments';
import { dateShort, fromDateInput, money, parseNum, relDays, toDateInput } from '../lib/format';
import { copyText, openExternal, readClipboard } from '../lib/native';
import { refreshReminders } from '../lib/notify';
import { useApp } from '../state';
import { AttachmentPicker, AttachmentStrip } from '../ui/Attachments';
import { ScanFill } from '../ui/ScanFill';
import { TopBar } from '../ui/CarSwitch';
import {
  Badge, Button, Card, Chips, Empty, Field, IconButton, Input, NumInput, Page, Plate, Row, Section, Segmented, Sheet, TextArea, confirmDialog, cx, go, toast,
} from '../ui/kit';

const GIBDD = 'https://xn--90adear.xn--p1ai/check/fines';
const GOSUSLUGI = 'https://www.gosuslugi.ru/pay';

function gibddLink(plate?: string, region?: string, sts?: string) {
  if (!plate || !sts) return GIBDD;
  return `${GIBDD}#${encodeURIComponent(normPlate(plate))}+${encodeURIComponent(region || '')}+${encodeURIComponent(sts.replace(/\s/g, ''))}`;
}

function CheckSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { cars } = useApp();
  const docs = useQuery(() => getAll<DocEntry>('documents'), [], ['documents']);
  const active = (docs || []).filter((d) => d.status === 'active');
  const vus = active.filter((d) => d.type === 'vu');
  const openGibdd = async (plate?: string, region?: string, sts?: string) => {
    if (sts) {
      await copyText(sts.replace(/\s/g, ''));
      toast('Номер СТС скопирован — вставьте его, если поле пустое', 'info');
    }
    await openExternal(gibddLink(plate, region, sts));
  };
  return (
    <Sheet open={open} onClose={onClose} title="Проверка штрафов">
      <p className="muted small">
        Данные берутся из раздела «Документы». На сайте ГИБДД нужно ввести капчу. Найденный штраф добавьте кнопкой ниже или вставьте текст уведомления.
      </p>
      {cars.map((c) => {
        const sts = active.find((d) => d.type === 'sts' && d.carId === c.id);
        const grzDoc = active.find((d) => d.type === 'grz' && d.carId === c.id);
        // госномер берём из «ГРЗ», а если его нет — из СТС
        const grz = grzDoc?.number ? grzDoc : sts?.details?.plate ? { number: sts.details.plate, region: sts.details.region } : undefined;
        return (
          <Card key={c.id} className="check-card" accent={c.color}>
            <div className="check-head">
              <b>{c.make} {c.model}</b>
              {grz?.number && <Plate number={grz.number} region={grz.region} size="sm" />}
            </div>
            {sts?.number && grz?.number ? (
              <>
                <div className="check-line">
                  <span className="muted">СТС</span>
                  <span className="mono">{sts.number}</span>
                  <IconButton label="Копировать СТС" onClick={async () => (await copyText(sts.number!.replace(/\s/g, '')), toast('Скопировано'))}>
                    <LuCopy />
                  </IconButton>
                </div>
                <div className="btn-row">
                  <Button variant="primary" size="sm" icon={<LuExternalLink />} onClick={() => openGibdd(grz.number, grz.region, sts.number)}>
                    гибдд.рф
                  </Button>
                  <Button size="sm" icon={<LuExternalLink />} onClick={() => openExternal(GOSUSLUGI)}>
                    Госуслуги
                  </Button>
                </div>
              </>
            ) : (
              <div className="check-missing">
                <span className="muted">Нужны {!grz?.number && 'госномер'}{!grz?.number && !sts?.number && ' и '}{!sts?.number && 'СТС'}</span>
                <Button size="sm" icon={<LuPlus />} onClick={() => go(`#/docs/new/${!sts?.number ? 'sts' : 'grz'}`)}>
                  Добавить
                </Button>
              </div>
            )}
          </Card>
        );
      })}
      <Section title="По водительскому удостоверению">
        {vus.length === 0 ? (
          <Row icon={<LuIdCard />} title="ВУ не добавлены" subtitle="Добавьте в «Документах»" onClick={() => go('#/docs/new/vu')} />
        ) : (
          vus.map((v) => (
            <Card key={v.id} className="check-card">
              <div className="check-line">
                <span className="muted">{v.holder || 'ВУ'}</span>
                <span className="mono">{v.number}</span>
                <IconButton label="Копировать номер ВУ" onClick={async () => (await copyText((v.number || '').replace(/\s/g, '')), toast('Скопировано'))}>
                  <LuCopy />
                </IconButton>
              </div>
              <div className="btn-row">
                <Button size="sm" icon={<LuExternalLink />} onClick={async () => (await copyText((v.number || '').replace(/\s/g, '')), openExternal(GOSUSLUGI))}>
                  Госуслуги
                </Button>
              </div>
            </Card>
          ))
        )}
        <p className="muted small">Штрафы по ВУ показывают Госуслуги и банковские приложения (Сбер, Т-Банк и др.) — номер ВУ копируется в буфер.</p>
      </Section>
      <div className="btn-stack">
        <Button variant="primary" block icon={<LuClipboardPaste />} onClick={() => go('#/fines/new/paste')}>
          Вставить текст уведомления
        </Button>
        <Button block icon={<LuPlus />} onClick={() => go('#/fines/new')}>
          Добавить штраф вручную
        </Button>
      </div>
    </Sheet>
  );
}

export function FineList() {
  const { cars } = useApp();
  const fines = useQuery(() => getAll<Fine>('fines'), [], ['fines']);
  const [filter, setFilter] = useState<'unpaid' | 'paid' | 'all'>('unpaid');
  const [carFilter, setCarFilter] = useState('Все');
  const [checkOpen, setCheckOpen] = useState(() => location.hash.includes('check=1'));
  if (!fines) return null;
  const byCar = fines.filter((f) => carFilter === 'Все' || cars.find((c) => c.id === f.carId)?.model === carFilter);
  const list = byCar
    .filter((f) => filter === 'all' || f.status === filter)
    .sort((a, b) => (b.resolutionDate || b.violationDate || b.createdAt) - (a.resolutionDate || a.violationDate || a.createdAt));
  const unpaid = byCar.filter((f) => f.status === 'unpaid');
  const toPay = unpaid.reduce((a, f) => a + fineInfo(f).toPay, 0);
  const paidYear = byCar
    .filter((f) => f.status === 'paid' && (f.paidDate || 0) >= new Date(new Date().getFullYear(), 0, 1).getTime())
    .reduce((a, f) => a + (f.paidAmount ?? f.amount), 0);

  return (
    <div className="screen">
      <TopBar
        title="Штрафы"
        showCars={false}
        actions={
          <Button variant="primary" size="sm" icon={<LuPlus />} onClick={() => go('#/fines/new')}>
            Добавить
          </Button>
        }
      />
      <Card className={cx('fines-hero', unpaid.length > 0 && 'has-debt')}>
        <div>
          <div className="eyebrow">К оплате</div>
          <div className="fines-sum num">{money(toPay)}</div>
          <div className="muted small">
            {unpaid.length ? `${unpaid.length} неоплач.` : 'Неоплаченных нет'} · оплачено в этом году {money(paidYear)}
          </div>
        </div>
        <Button variant={unpaid.length ? 'secondary' : 'primary'} icon={<LuSearch />} onClick={() => setCheckOpen(true)}>
          Проверить
        </Button>
      </Card>
      {cars.length > 1 && <Chips value={carFilter} onChange={setCarFilter} options={['Все', ...cars.map((c) => c.model)]} />}
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'unpaid', label: `Неоплаченные${unpaid.length ? ' · ' + unpaid.length : ''}` },
          { value: 'paid', label: 'Оплаченные' },
          { value: 'all', label: 'Все' },
        ]}
      />
      {list.length === 0 ? (
        <Empty
          icon={<LuSiren />}
          title={filter === 'unpaid' ? 'Неоплаченных штрафов нет' : 'Штрафов нет'}
          text="Нажмите «Проверить» — приложение подставит номера СТС и ВУ из документов."
        />
      ) : (
        <div className="list">
          {list.map((f) => {
            const fi = fineInfo(f);
            const car = cars.find((c) => c.id === f.carId);
            return (
              <Row
                key={f.id}
                tone={f.status === 'unpaid' ? (fi.overdue ? 'danger' : 'warn') : undefined}
                icon={f.status === 'paid' ? <LuCircleCheck /> : <LuSiren />}
                title={f.article || f.description || 'Штраф'}
                subtitle={[dateShort(f.violationDate || f.resolutionDate), car?.model, f.place].filter(Boolean).join(' · ')}
                right={
                  <div className="row-right-stack">
                    <b className="num">{money(f.status === 'paid' ? f.paidAmount ?? f.amount : fi.toPay)}</b>
                    {f.status === 'unpaid' && fi.discountActive && <small className="text-ok">−50% до {dateShort(fi.discountUntil)}</small>}
                    {f.status === 'unpaid' && fi.overdue && <small className="text-danger">просрочен</small>}
                    {f.status === 'paid' && <small className="muted">оплачен</small>}
                  </div>
                }
                onClick={() => go(`#/fines/${f.id}`)}
              />
            );
          })}
        </div>
      )}
      <CheckSheet open={checkOpen} onClose={() => setCheckOpen(false)} />
    </div>
  );
}

export function FineDetail({ id }: { id: string }) {
  const f = useQuery(() => get<Fine>('fines', id), [id], ['fines']);
  const { cars } = useApp();
  const [payOpen, setPayOpen] = useState(false);
  const [paidDate, setPaidDate] = useState(toDateInput(Date.now()));
  const [paidAmount, setPaidAmount] = useState('');
  if (f === undefined) return <Page title="Штраф" back="#/fines"><div /></Page>;
  if (!f) return <Page title="Не найдено" back="#/fines"><Empty title="Штраф удалён" /></Page>;
  const fi = fineInfo(f);
  const car = cars.find((c) => c.id === f.carId);
  const markPaid = async () => {
    await put('fines', stamp({ ...f, status: 'paid', paidDate: fromDateInput(paidDate) || Date.now(), paidAmount: parseNum(paidAmount) ?? fi.toPay }));
    setPayOpen(false);
    refreshReminders();
    toast('Отмечен как оплаченный');
  };
  const unpay = async () => {
    await put('fines', stamp({ ...f, status: 'unpaid', paidDate: undefined, paidAmount: undefined }));
    refreshReminders();
  };
  const remove = async () => {
    if (!(await confirmDialog('Удалить штраф?', { danger: true, ok: 'Удалить' }))) return;
    await del('fines', f.id);
    await removeAttachments(f.attachments);
    refreshReminders();
    go('#/fines');
  };
  const pay = async () => {
    if (f.uin) {
      await copyText(f.uin);
      toast('УИН скопирован', 'info');
    }
    await openExternal(GOSUSLUGI);
  };
  return (
    <Page
      title="Штраф"
      back="#/fines"
      actions={
        <IconButton label="Изменить" onClick={() => go(`#/fines/${f.id}/edit`)}>
          <LuPencil />
        </IconButton>
      }
    >
      <Card className={cx('fine-card', f.status === 'unpaid' && (fi.overdue ? 'is-danger' : 'is-warn'))}>
        <div className="fine-top">
          {f.status === 'paid' ? <Badge tone="ok">Оплачен {dateShort(f.paidDate)}</Badge> : fi.overdue ? <Badge tone="danger">Срок оплаты истёк</Badge> : <Badge tone="warn">Не оплачен</Badge>}
          {car && <span className="muted">{car.make} {car.model}</span>}
        </div>
        <div className="fine-amount num">
          {money(f.status === 'paid' ? f.paidAmount ?? f.amount : fi.toPay)}
          {f.status === 'unpaid' && fi.discountActive && <s className="muted">{money(f.amount)}</s>}
        </div>
        {f.status === 'unpaid' && fi.discountActive && (
          <div className="text-ok small">Скидка 50% действует до {dateShort(fi.discountUntil)} ({relDays(fi.discountUntil!)})</div>
        )}
        {f.status === 'unpaid' && !fi.discountActive && fi.dueDate && <div className="small muted">Оплатить до ~{dateShort(fi.dueDate)}</div>}
        {!discountAllowed(f.article) && <div className="small muted">По этой статье скидка 50% не предусмотрена</div>}
      </Card>
      <Card>
        <div className="kv-list">
          {f.uin && (
            <div className="kv">
              <span>УИН / постановление</span>
              <b className="mono">{f.uin}</b>
              <IconButton label="Копировать" className="kv-copy" onClick={async () => (await copyText(f.uin!), toast('Скопировано'))}>
                <LuCopy />
              </IconButton>
            </div>
          )}
          {f.article && <div className="kv"><span>Статья</span><b>{f.article}</b></div>}
          {f.description && <div className="kv"><span>Нарушение</span><b>{f.description}</b></div>}
          {f.violationDate && <div className="kv"><span>Дата нарушения</span><b>{dateShort(f.violationDate)}</b></div>}
          {f.resolutionDate && <div className="kv"><span>Дата постановления</span><b>{dateShort(f.resolutionDate)}</b></div>}
          {f.place && <div className="kv"><span>Место</span><b>{f.place}</b></div>}
          <div className="kv"><span>Сумма штрафа</span><b>{money(f.amount)}</b></div>
        </div>
        {f.notes && <p className="pre muted">{f.notes}</p>}
      </Card>
      {f.attachments.length > 0 && (
        <Section title="Фото / постановление">
          <AttachmentStrip ids={f.attachments} />
        </Section>
      )}
      <div className="btn-stack">
        {f.status === 'unpaid' ? (
          <>
            <Button variant="primary" block icon={<LuExternalLink />} onClick={pay}>
              Оплатить на Госуслугах
            </Button>
            <Button block icon={<LuCircleCheck />} onClick={() => (setPaidAmount(String(fi.toPay)), setPayOpen(true))}>
              Отметить оплаченным
            </Button>
          </>
        ) : (
          <Button variant="ghost" block onClick={unpay}>
            Вернуть в неоплаченные
          </Button>
        )}
        <Button variant="danger" block icon={<LuTrash2 />} onClick={remove}>
          Удалить
        </Button>
      </div>
      <Sheet open={payOpen} onClose={() => setPayOpen(false)} title="Оплата штрафа" footer={<Button variant="primary" block onClick={markPaid}>Сохранить</Button>}>
        <div className="grid-2">
          <Field label="Дата оплаты">
            <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </Field>
          <Field label="Сумма">
            <NumInput value={paidAmount} onChange={setPaidAmount} suffix="₽" />
          </Field>
        </div>
      </Sheet>
    </Page>
  );
}

export function FineForm({ id, paste }: { id?: string; paste?: boolean }) {
  const { cars, car } = useApp();
  const [orig, setOrig] = useState<Fine | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [carId, setCarId] = useState(car?.id || '');
  const [f, setF] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<string[]>([]);
  const [text, setText] = useState('');
  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const inp = (k: string) => ({ value: f[k] || '', onChange: (e: any) => set(k)(e.target.value) });
  const docs = useQuery(() => getAll<DocEntry>('documents'), [], ['documents']);

  useEffect(() => {
    if (!id) return;
    get<Fine>('fines', id).then((x) => {
      if (!x) return go('#/fines');
      setOrig(x);
      setCarId(x.carId || '');
      setF({
        uin: x.uin || '',
        article: x.article || '',
        description: x.description || '',
        place: x.place || '',
        amount: String(x.amount || ''),
        violationDate: toDateInput(x.violationDate),
        resolutionDate: toDateInput(x.resolutionDate),
        notes: x.notes || '',
      });
      setAttachments(x.attachments);
      setLoaded(true);
    });
  }, [id]);

  useEffect(() => {
    if (paste && !id) readClipboard().then((t) => t && /\d/.test(t) && setText(t));
  }, [paste, id]);

  const applyParse = () => {
    const p: any = parseFineText(text);
    const found = Object.keys(p).filter((k) => !k.startsWith('_')).length;
    if (!found) return toast('Не удалось распознать — заполните поля вручную', 'danger');
    setF((prev) => ({
      ...prev,
      uin: p.uin || prev.uin || '',
      amount: p.amount ? String(p.amount) : prev.amount || '',
      article: p.article || prev.article || '',
      place: p.place || prev.place || '',
      violationDate: p.violationDate ? toDateInput(p.violationDate) : prev.violationDate || '',
      resolutionDate: p.resolutionDate ? toDateInput(p.resolutionDate) : prev.resolutionDate || '',
      notes: prev.notes || text.slice(0, 500),
    }));
    if (p._plate && docs) {
      const grz = docs.find((d) => d.type === 'grz' && `${d.number}${d.region || ''}` === normPlate(p._plate));
      if (grz?.carId) setCarId(grz.carId);
    }
    toast(`Распознано полей: ${found}`);
  };

  if (!loaded) return <Page title="Штраф" back="#/fines"><div /></Page>;

  const save = async () => {
    const amount = parseNum(f.amount);
    if (!amount) return toast('Укажите сумму штрафа', 'danger');
    // без даты не посчитать ни скидку 50%, ни срок оплаты
    if (!f.resolutionDate && !f.violationDate && (orig?.status ?? 'unpaid') === 'unpaid')
      return toast('Укажите дату постановления — от неё считаются скидка 50% и срок оплаты', 'danger');
    const fine: Fine = stamp(
      {
        ...(orig || { id: uid(), createdAt: Date.now(), status: 'unpaid' as const, source: paste ? 'paste' : 'manual' }),
        carId: carId || undefined,
        uin: f.uin?.replace(/\s/g, '') || undefined,
        article: f.article?.trim() || undefined,
        description: f.description?.trim() || undefined,
        place: f.place?.trim() || undefined,
        amount,
        violationDate: fromDateInput(f.violationDate),
        resolutionDate: fromDateInput(f.resolutionDate),
        notes: f.notes?.trim() || undefined,
        attachments,
      } as Fine,
      !orig,
    );
    if (!orig && fine.uin) {
      const dup = (await getAll<Fine>('fines')).find((x) => x.uin === fine.uin);
      if (dup) {
        toast('Штраф с таким УИН уже есть', 'danger');
        return go(`#/fines/${dup.id}`);
      }
    }
    await put('fines', fine);
    if (orig) await removeAttachments(orig.attachments.filter((a) => !attachments.includes(a)));
    refreshReminders();
    toast('Сохранено');
    go(`#/fines/${fine.id}`);
  };

  return (
    <Page title={orig ? 'Изменить штраф' : 'Новый штраф'} back={orig ? `#/fines/${orig.id}` : '#/fines'}>
      <div className="form">
        <ScanFill
          title="Сканировать постановление"
          subtitle="УИН, сумма, статья и даты заполнятся сами — их можно исправить"
          scanMode="bw"
          fileName="Постановление"
          onAttachments={(ids) => setAttachments((a) => [...a, ...ids])}
          onText={(texts) => {
            const p: any = parseFineText(texts.join('\n'));
            const names: Record<string, string> = { uin: 'УИН', amount: 'сумма', article: 'статья', place: 'место', violationDate: 'дата нарушения', resolutionDate: 'дата постановления' };
            const found = Object.keys(names).filter((k) => p[k]);
            setF((prev) => ({
              ...prev,
              uin: p.uin || prev.uin || '',
              amount: p.amount ? String(p.amount) : prev.amount || '',
              article: p.article || prev.article || '',
              place: p.place || prev.place || '',
              violationDate: p.violationDate ? toDateInput(p.violationDate) : prev.violationDate || '',
              resolutionDate: p.resolutionDate ? toDateInput(p.resolutionDate) : prev.resolutionDate || '',
            }));
            if (p._plate && docs) {
              const grz = docs.find((d) => d.type === 'grz' && `${d.number}${d.region || ''}` === normPlate(p._plate));
              if (grz?.carId) setCarId(grz.carId);
            }
            return found.map((k) => names[k]);
          }}
        />
        {!orig && (
          <Card className="paste-card">
            <Field label="Текст уведомления" hint="Скопируйте СМС, push от Госуслуг или банка — УИН, сумма, статья и даты заполнятся сами.">
              <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Постановление № 18810177… от 12.10.2026, ст. 12.9 ч.2, 500 руб." />
            </Field>
            <div className="btn-row">
              <Button size="sm" icon={<LuClipboardPaste />} onClick={async () => setText(await readClipboard())}>
                Вставить
              </Button>
              <Button size="sm" variant="primary" onClick={applyParse} disabled={!text.trim()}>
                Распознать
              </Button>
            </div>
          </Card>
        )}
        {cars.length > 0 && (
          <Field label="Машина">
            <Chips value={cars.find((c) => c.id === carId)?.model || 'Не указана'} onChange={(m) => setCarId(cars.find((c) => c.model === m)?.id || '')} options={[...cars.map((c) => c.model), 'Не указана']} />
          </Field>
        )}
        <div className="grid-2">
          <Field label="Сумма штрафа">
            <NumInput value={f.amount || ''} onChange={set('amount')} suffix="₽" />
          </Field>
          <Field label="Статья КоАП">
            <Input {...inp('article')} placeholder="ст. 12.9 ч.2" />
          </Field>
        </div>
        <Field label="УИН / номер постановления">
          <Input {...inp('uin')} className="mono" inputMode="numeric" placeholder="18810…" />
        </Field>
        <div className="grid-2">
          <Field label="Дата нарушения">
            <Input type="date" {...inp('violationDate')} />
          </Field>
          <Field label="Дата постановления" hint="от неё считаются 20 дней скидки">
            <Input type="date" {...inp('resolutionDate')} />
          </Field>
        </div>
        <Field label="Нарушение">
          <Input {...inp('description')} placeholder="Превышение скорости на 20–40 км/ч" />
        </Field>
        <Field label="Место">
          <Input {...inp('place')} />
        </Field>
        <Field label="Заметки">
          <TextArea {...(inp('notes') as any)} rows={2} />
        </Field>
        <AttachmentPicker value={attachments} onChange={setAttachments} label="Фото постановления" scanMode="bw" />
      </div>
      <div className="form-actions">
        <Button variant="primary" size="lg" block onClick={save}>
          Сохранить
        </Button>
      </div>
    </Page>
  );
}
