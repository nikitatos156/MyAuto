// Шины: комплекты, что стоит сейчас, переобувка с пробегом и стоимостью, советы по сезону и износу.
import React, { useEffect, useState } from 'react';
import { LuArchive, LuArrowLeftRight, LuDisc3, LuPencil, LuPlus, LuSnowflake, LuSun, LuTrash2, LuWarehouse } from 'react-icons/lu';
import { del, get, getAll, put, stamp, uid, useQuery } from '../data/db';
import { currentMileage } from '../data/logic';
import { SEASON_LABEL, isMounted, mountedSet, tireAdvice, tireAge, tireMileage, tireTitle, yearFromDot } from '../data/tires';
import type { FuelEntry, ServiceEntry, TireEvent, TireSeason, TireSet } from '../data/types';
import { removeAttachments } from '../lib/attachments';
import { dateShort, fromDateInput, km, money, num, parseNum, toDateInput } from '../lib/format';
import { refreshReminders } from '../lib/notify';
import { useApp } from '../state';
import { AttachmentPicker, AttachmentStrip } from '../ui/Attachments';
import { TopBar } from '../ui/CarSwitch';
import { Badge, Button, Card, Chips, Empty, Field, IconButton, Input, NumInput, Page, Row, Section, Segmented, Sheet, TextArea, Toggle, confirmDialog, cx, go, toast } from '../ui/kit';

const seasonIcon = (s: TireSeason) => (s === 'winter' ? <LuSnowflake /> : s === 'summer' ? <LuSun /> : <LuDisc3 />);

function useTireData() {
  return useQuery(
    async () => ({
      tires: await getAll<TireSet>('tires'),
      fuel: await getAll<FuelEntry>('fuel'),
      services: await getAll<ServiceEntry>('services'),
    }),
    [],
    ['tires', 'fuel', 'services', 'cars'],
  );
}

/** Поставить / снять / переобуть: один лист для всех действий. */
function EventSheet({ open, onClose, sets, carId, mileageNow, initial }: {
  open: boolean;
  onClose: () => void;
  sets: TireSet[];
  carId: string;
  mileageNow?: number;
  initial?: { install?: string; remove?: boolean };
}) {
  const mounted = mountedSet(sets, carId);
  const candidates = sets.filter((s) => s.carId === carId && s.status === 'active' && !isMounted(s));
  const [target, setTarget] = useState<string>('');
  const [removeOnly, setRemoveOnly] = useState(false);
  const [date, setDate] = useState(toDateInput(Date.now()));
  const [mileage, setMileage] = useState('');
  const [cost, setCost] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTarget(initial?.install || candidates[0]?.id || '');
    setRemoveOnly(!!initial?.remove);
    setDate(toDateInput(Date.now()));
    setMileage(mileageNow ? String(mileageNow) : '');
    setCost('');
    setPlace('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = async () => {
    const d = fromDateInput(date);
    if (!d) return toast('Укажите дату', 'danger');
    const m = parseNum(mileage);
    const c = parseNum(cost);
    setBusy(true);
    try {
      const ev = (action: TireEvent['action'], withCost: boolean): TireEvent => ({
        id: uid(),
        date: d,
        mileage: m ? Math.round(m) : undefined,
        action,
        cost: withCost && c ? c : undefined,
        place: place.trim() || undefined,
      });
      const tgt = sets.find((s) => s.id === target);
      if (mounted && (removeOnly || tgt)) await put('tires', stamp({ ...mounted, events: [...mounted.events, ev('remove', !tgt || removeOnly)] }));
      if (tgt && !removeOnly) await put('tires', stamp({ ...tgt, events: [...tgt.events, ev('install', true)] }));
      refreshReminders();
      toast(removeOnly ? 'Комплект снят' : mounted ? 'Переобули' : 'Комплект установлен');
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const title = removeOnly ? 'Снять комплект' : mounted ? 'Переобуть' : 'Поставить комплект';
  return (
    <Sheet open={open} onClose={onClose} title={title} footer={<Button variant="primary" block busy={busy} onClick={save} disabled={!removeOnly && !target}>Сохранить</Button>}>
      {!removeOnly && (
        <Field label="Какой комплект ставим">
          {candidates.length ? (
            <div className="list">
              {candidates.map((s) => (
                <Row key={s.id} icon={seasonIcon(s.season)} title={tireTitle(s)} subtitle={[s.size, s.storage].filter(Boolean).join(' · ')} className={cx(target === s.id && 'is-selected')} right={target === s.id ? <Badge tone="accent">выбран</Badge> : undefined} onClick={() => setTarget(s.id)} chevron={false} />
              ))}
            </div>
          ) : (
            <div className="muted small">Других комплектов нет — сначала добавьте его.</div>
          )}
        </Field>
      )}
      {mounted && !removeOnly && <div className="muted small">Снимем: {tireTitle(mounted)}</div>}
      <div className="grid-2">
        <Field label="Дата">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Пробег">
          <NumInput value={mileage} onChange={setMileage} suffix="км" decimals={false} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Стоимость работ">
          <NumInput value={cost} onChange={setCost} suffix="₽" />
        </Field>
        <Field label="Где">
          <Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Шиномонтаж" />
        </Field>
      </div>
    </Sheet>
  );
}

export function TiresList() {
  const { car } = useApp();
  const data = useTireData();
  const [sheet, setSheet] = useState<{ install?: string; remove?: boolean } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (!car) return null;
  if (!data) return <div className="screen"><TopBar title="Шины" /></div>;
  const sets = data.tires.filter((s) => s.carId === car.id);
  const active = sets.filter((s) => s.status === 'active');
  const archived = sets.filter((s) => s.status !== 'active');
  const mileageNow = currentMileage(car, data.fuel, data.services);
  const mounted = mountedSet(sets, car.id);
  const advice = tireAdvice(sets, car.id);
  const others = active.filter((s) => s !== mounted);
  const lastInstall = mounted ? [...mounted.events].filter((e) => e.action === 'install').sort((a, b) => b.date - a.date)[0] : undefined;

  return (
    <div className="screen">
      <TopBar
        title="Шины"
        actions={
          <Button variant="primary" size="sm" icon={<LuPlus />} onClick={() => go('#/tires/new')}>
            Комплект
          </Button>
        }
      />
      {sets.length === 0 ? (
        <Empty
          icon={<LuDisc3 />}
          title="Комплектов пока нет"
          text="Добавьте летние и зимние шины: размер, год, где хранятся. Приложение посчитает пробег каждого комплекта и напомнит о переобувке."
          action={<Button variant="primary" onClick={() => go('#/tires/new')}>Добавить комплект</Button>}
        />
      ) : (
        <>
          <Card className={cx('tire-now', mounted && `is-${mounted.season}`)}>
            <span className="eyebrow">Сейчас на машине</span>
            {mounted ? (
              <>
                <div className="tire-now-title" onClick={() => go(`#/tires/${mounted.id}`)}>
                  {seasonIcon(mounted.season)} {tireTitle(mounted)}
                </div>
                <div className="tire-now-grid">
                  <div><span className="muted">Размер</span><b>{mounted.size || '—'}</b></div>
                  <div><span className="muted">Пробег комплекта</span><b className="num">{km(tireMileage(mounted, mileageNow))}</b></div>
                  <div><span className="muted">Поставили</span><b>{lastInstall ? dateShort(lastInstall.date) : '—'}</b></div>
                </div>
              </>
            ) : (
              <div className="muted">Не отмечено, какой комплект стоит — нажмите «Поставить».</div>
            )}
            <div className="tire-now-actions">
              {others.length > 0 && (
                <Button variant="primary" icon={<LuArrowLeftRight />} onClick={() => setSheet({})}>
                  {mounted ? 'Переобуть' : 'Поставить'}
                </Button>
              )}
              {mounted && <Button onClick={() => setSheet({ remove: true })}>Снять</Button>}
            </div>
          </Card>

          {advice.length > 0 && (
            <div className="list">
              {advice.map((a, i) => (
                <Row key={i} tone={a.level === 'danger' ? 'danger' : a.level === 'warn' ? 'warn' : 'info'} icon={<LuDisc3 />} title={a.title} subtitle={a.text} chevron={false} />
              ))}
            </div>
          )}

          <Section title="Комплекты">
            <div className="list">
              {active.map((s) => (
                <Row
                  key={s.id}
                  icon={seasonIcon(s.season)}
                  title={tireTitle(s)}
                  subtitle={[s.size, s.year ? `${s.year} г.` : '', km(tireMileage(s, mileageNow)), isMounted(s) ? '' : s.storage].filter(Boolean).join(' · ')}
                  right={isMounted(s) ? <Badge tone="ok">стоит</Badge> : s.storage ? <LuWarehouse className="muted" /> : undefined}
                  onClick={() => go(`#/tires/${s.id}`)}
                />
              ))}
            </div>
          </Section>
          {archived.length > 0 && (
            <Section title={<button className="link" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Скрыть списанные' : `Списанные · ${archived.length}`}</button>}>
              {showArchived && (
                <div className="list">
                  {archived.map((s) => (
                    <Row key={s.id} icon={<LuArchive />} title={tireTitle(s)} subtitle={[s.size, km(tireMileage(s))].filter(Boolean).join(' · ')} onClick={() => go(`#/tires/${s.id}`)} />
                  ))}
                </div>
              )}
            </Section>
          )}
        </>
      )}
      <EventSheet open={!!sheet} onClose={() => setSheet(null)} sets={data.tires} carId={car.id} mileageNow={mileageNow} initial={sheet || undefined} />
    </div>
  );
}

export function TireDetail({ id }: { id: string }) {
  const { cars } = useApp();
  const data = useTireData();
  const [sheet, setSheet] = useState<{ install?: string; remove?: boolean } | null>(null);
  const s = data?.tires.find((x) => x.id === id);
  if (!data) return <Page title="Шины" back="#/tires"><div /></Page>;
  if (!s) return <Page title="Не найдено" back="#/tires"><Empty title="Комплект удалён" /></Page>;
  const car = cars.find((c) => c.id === s.carId);
  const mileageNow = car ? currentMileage(car, data.fuel, data.services) : undefined;
  const events = [...s.events].sort((a, b) => b.date - a.date);
  const mounted = isMounted(s);
  const age = tireAge(s);
  const spent = (s.price || 0) + s.events.reduce((a, e) => a + (e.cost || 0), 0);

  const archive = async () => {
    if (!(await confirmDialog(s.status === 'active' ? 'Списать комплект?' : 'Вернуть комплект?', { text: s.status === 'active' ? 'Он уйдёт в «Списанные», история сохранится.' : undefined }))) return;
    await put('tires', stamp({ ...s, status: s.status === 'active' ? 'archived' : 'active' }));
    refreshReminders();
  };
  const remove = async () => {
    if (!(await confirmDialog('Удалить комплект?', { text: 'Вместе с историей и фото.', danger: true, ok: 'Удалить' }))) return;
    await del('tires', s.id);
    await removeAttachments(s.attachments);
    refreshReminders();
    go('#/tires');
  };
  const removeEvent = async (eid: string) => {
    if (!(await confirmDialog('Удалить запись?', { danger: true, ok: 'Удалить' }))) return;
    await put('tires', stamp({ ...s, events: s.events.filter((e) => e.id !== eid) }));
    refreshReminders();
  };

  return (
    <Page
      title={SEASON_LABEL[s.season]}
      back="#/tires"
      actions={
        <IconButton label="Изменить" onClick={() => go(`#/tires/${s.id}/edit`)}>
          <LuPencil />
        </IconButton>
      }
    >
      <Card>
        <div className="tire-now-title">{seasonIcon(s.season)} {tireTitle(s)}</div>
        <div className="kv-grid">
          <div><span>Размер</span><b>{[s.size, s.loadSpeed].filter(Boolean).join(' ') || '—'}</b></div>
          <div><span>Год выпуска</span><b>{s.year ? `${s.year}${age !== undefined ? ` · ${age} ${age === 1 ? 'год' : age < 5 ? 'года' : 'лет'}` : ''}` : '—'}</b></div>
          <div><span>Пробег комплекта</span><b className="num">{km(tireMileage(s, mileageNow))}</b></div>
          <div><span>Протектор</span><b>{s.tread !== undefined ? `${String(s.tread).replace('.', ',')} мм${s.treadDate ? ` (${dateShort(s.treadDate)})` : ''}` : '—'}</b></div>
          <div><span>Диски</span><b>{s.withRims ? s.rims || 'на дисках' : 'без дисков'}</b></div>
          <div><span>Хранение</span><b>{s.storage || '—'}</b></div>
          {s.dot && <div><span>DOT</span><b className="mono">{s.dot}</b></div>}
          {spent > 0 && <div><span>Потрачено</span><b className="num">{money(spent)}</b></div>}
        </div>
      </Card>
      {s.status === 'active' && (
        <div className="btn-row">
          {mounted ? (
            <Button icon={<LuArrowLeftRight />} onClick={() => setSheet({ remove: true })}>Снять с машины</Button>
          ) : (
            <Button variant="primary" icon={<LuArrowLeftRight />} onClick={() => setSheet({ install: s.id })}>Поставить на машину</Button>
          )}
        </div>
      )}
      <Section title="История">
        {events.length === 0 ? (
          <Card className="muted-card">Записей нет — отметьте, когда комплект поставили или сняли.</Card>
        ) : (
          <div className="list">
            {events.map((e) => (
              <Row
                key={e.id}
                title={`${e.action === 'install' ? 'Поставили' : 'Сняли'} · ${dateShort(e.date)}`}
                subtitle={[e.mileage ? km(e.mileage) : '', e.place, e.cost ? money(e.cost) : ''].filter(Boolean).join(' · ')}
                right={
                  <IconButton label="Удалить запись" onClick={() => removeEvent(e.id)}>
                    <LuTrash2 />
                  </IconButton>
                }
                chevron={false}
              />
            ))}
          </div>
        )}
      </Section>
      {s.notes && (
        <Section title="Примечания">
          <Card><p className="pre">{s.notes}</p></Card>
        </Section>
      )}
      {s.attachments.length > 0 && (
        <Section title="Фото и чеки">
          <AttachmentStrip ids={s.attachments} />
        </Section>
      )}
      <div className="form-actions btn-col">
        <Button icon={<LuArchive />} onClick={archive} block>{s.status === 'active' ? 'Списать комплект' : 'Вернуть в работу'}</Button>
        <Button variant="danger" icon={<LuTrash2 />} onClick={remove} block>Удалить</Button>
      </div>
      {car && <EventSheet open={!!sheet} onClose={() => setSheet(null)} sets={data.tires} carId={car.id} mileageNow={mileageNow} initial={sheet || undefined} />}
    </Page>
  );
}

export function TireForm({ id }: { id?: string }) {
  const { car, cars } = useApp();
  const all = useTireData();
  const [orig, setOrig] = useState<TireSet | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [season, setSeason] = useState<TireSeason>('winter');
  const [studded, setStudded] = useState(false);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [size, setSize] = useState('');
  const [loadSpeed, setLoadSpeed] = useState('');
  const [dot, setDot] = useState('');
  const [year, setYear] = useState('');
  const [withRims, setWithRims] = useState(true);
  const [rims, setRims] = useState('');
  const [storage, setStorage] = useState('');
  const [tread, setTread] = useState('');
  const [price, setPrice] = useState('');
  const [purchase, setPurchase] = useState('');
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [mountNow, setMountNow] = useState(false);
  const theCar = cars.find((c) => c.id === (orig?.carId || car?.id)) || car;

  useEffect(() => {
    if (!id) return;
    get<TireSet>('tires', id).then((s) => {
      if (!s) return go('#/tires');
      setOrig(s);
      setSeason(s.season);
      setStudded(!!s.studded);
      setBrand(s.brand || '');
      setModel(s.model || '');
      setSize(s.size || '');
      setLoadSpeed(s.loadSpeed || '');
      setDot(s.dot || '');
      setYear(s.year ? String(s.year) : '');
      setWithRims(s.withRims);
      setRims(s.rims || '');
      setStorage(s.storage || '');
      setTread(s.tread !== undefined ? String(s.tread) : '');
      setPrice(s.price ? String(s.price) : '');
      setPurchase(toDateInput(s.purchaseDate));
      setNotes(s.notes || '');
      setAttachments(s.attachments);
      setLoaded(true);
    });
  }, [id]);

  if (!loaded || !theCar) return <Page title="Шины" back="#/tires"><div /></Page>;
  const hasMounted = !!(all && mountedSet(all.tires, theCar.id));
  const storages = Array.from(new Set((all?.tires || []).map((s) => s.storage).filter(Boolean))) as string[];

  const save = async () => {
    const tr = parseNum(tread);
    const entry: TireSet = stamp<TireSet>(
      {
        ...(orig || { id: uid(), createdAt: Date.now(), updatedAt: Date.now(), events: [], status: 'active' as const }),
        carId: theCar.id,
        season,
        studded: season === 'winter' ? studded : undefined,
        brand: brand.trim() || undefined,
        model: model.trim() || undefined,
        size: size.trim().toUpperCase().replace(/\s*R\s*/, ' R').replace(/^(\d{3})\s*\/\s*(\d{2})/, '$1/$2') || undefined,
        loadSpeed: loadSpeed.trim().toUpperCase() || undefined,
        dot: dot.trim() || undefined,
        year: parseNum(year) || yearFromDot(dot),
        withRims,
        rims: withRims ? rims.trim() || undefined : undefined,
        storage: storage.trim() || undefined,
        tread: tr,
        treadDate: tr !== undefined && tr !== orig?.tread ? Date.now() : orig?.treadDate,
        price: parseNum(price),
        purchaseDate: fromDateInput(purchase),
        notes: notes.trim() || undefined,
        attachments,
      },
      !orig,
    );
    if (!orig && mountNow && all) {
      const m = currentMileage(theCar, all.fuel, all.services);
      entry.events = [{ id: uid(), date: Date.now(), mileage: m, action: 'install' }];
    }
    await put('tires', entry);
    if (orig) await removeAttachments(orig.attachments.filter((a) => !attachments.includes(a)));
    refreshReminders();
    toast('Сохранено');
    go(`#/tires/${entry.id}`);
  };

  return (
    <Page title={orig ? 'Изменить комплект' : 'Новый комплект'} back={orig ? `#/tires/${orig.id}` : '#/tires'}>
      <div className="form">
        <Segmented
          value={season}
          onChange={setSeason}
          options={[
            { value: 'winter', label: 'Зимние' },
            { value: 'summer', label: 'Летние' },
            { value: 'allseason', label: 'Всесезонные' },
          ]}
        />
        {season === 'winter' && <Toggle checked={studded} onChange={setStudded} label="Шипованные" hint="С июня по август шипы запрещены — приложение напомнит" />}
        <div className="grid-2">
          <Field label="Производитель">
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Nokian" list="tire-brands" />
            <datalist id="tire-brands">
              {['Nokian', 'Ikon', 'Michelin', 'Continental', 'Pirelli', 'Bridgestone', 'Goodyear', 'Hankook', 'Yokohama', 'Toyo', 'Kumho', 'Cordiant', 'Gislaved', 'Dunlop', 'Nexen', 'Sailun', 'Triangle', 'Kama'].map((b) => <option key={b} value={b} />)}
            </datalist>
          </Field>
          <Field label="Модель">
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Hakkapeliitta 10" />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Размер" hint="ширина/профиль R диаметр">
            <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="225/45 R17" />
          </Field>
          <Field label="Индекс нагрузки и скорости">
            <Input value={loadSpeed} onChange={(e) => setLoadSpeed(e.target.value)} placeholder="94T" />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="DOT (неделя и год)" hint="4 цифры на боковине, например 3523">
            <Input value={dot} onChange={(e) => { setDot(e.target.value); const y = yearFromDot(e.target.value); if (y) setYear(String(y)); }} inputMode="numeric" placeholder="3523" />
          </Field>
          <Field label="Год выпуска">
            <NumInput value={year} onChange={setYear} decimals={false} placeholder="2023" />
          </Field>
        </div>
        <Toggle checked={withRims} onChange={setWithRims} label="На дисках" />
        {withRims && (
          <Field label="Диски">
            <Input value={rims} onChange={(e) => setRims(e.target.value)} placeholder="литые 17″, оригинал" />
          </Field>
        )}
        <Field label="Где хранятся">
          <Input value={storage} onChange={(e) => setStorage(e.target.value)} placeholder="Гараж / шинный отель" list="tire-storage" />
          <datalist id="tire-storage">{storages.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <div className="grid-2">
          <Field label="Протектор" hint={season === 'summer' ? 'минимум 1,6 мм' : 'для зимних минимум 4 мм'}>
            <NumInput value={tread} onChange={setTread} suffix="мм" />
          </Field>
          <Field label="Стоимость комплекта">
            <NumInput value={price} onChange={setPrice} suffix="₽" />
          </Field>
        </div>
        <Field label="Дата покупки">
          <Input type="date" value={purchase} onChange={(e) => setPurchase(e.target.value)} />
        </Field>
        {!orig && !hasMounted && <Toggle checked={mountNow} onChange={setMountNow} label="Этот комплект сейчас стоит на машине" hint="Пробег комплекта будет считаться с текущего пробега" />}
        <Field label="Примечания">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <AttachmentPicker value={attachments} onChange={setAttachments} label="Фото и чеки" scanTitle="Чек / фото шин" scanMode="color" />
      </div>
      <div className="form-actions">
        <Button variant="primary" size="lg" block onClick={save}>Сохранить</Button>
      </div>
    </Page>
  );
}
