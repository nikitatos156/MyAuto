import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LuFuel, LuPaperclip, LuPlus, LuTrash2 } from 'react-icons/lu';
import { del, get, getAll, put, stamp, uid, useQuery } from '../data/db';
import { consumption, currentMileage, isAdBlue } from '../data/logic';
import type { FuelEntry, ServiceEntry } from '../data/types';
import { removeAttachments } from '../lib/attachments';
import { dateHuman, fromDateTimeInput, money, monthTitle, num, parseNum, timeShort, toDateTimeInput } from '../lib/format';
import { refreshReminders } from '../lib/notify';
import { useApp } from '../state';
import { AttachmentPicker } from '../ui/Attachments';
import { PAPER_PASSES, ocrSupported, recognizePages } from '../lib/ocr';
import { readPdf } from '../lib/pdfImport';
import { findReceiptQr, type FiscalQr } from '../lib/qr';
import { parseFuelReceipt } from '../data/docParse';
import { FUEL_CHAINS, chainOf, fuelBase, fuelOptions, fuelTag, sameFuelIn } from '../data/fuels';
import { TopBar } from '../ui/CarSwitch';
import { Button, Card, Chips, Empty, Field, IconButton, Input, NumInput, Page, Row, Section, Segmented, Stat, TextArea, Toggle, confirmDialog, go, toast } from '../ui/kit';

export function FuelList() {
  const { car } = useApp();
  const list = useQuery(() => (car ? getAll<FuelEntry>('fuel').then((l) => l.filter((f) => f.carId === car.id)) : Promise.resolve([])), [car?.id], ['fuel']);
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('month');
  if (!car) return null;
  const entries = (list || []).sort((a, b) => b.date - a.date);
  const cons = consumption(entries);
  const from = period === 'month' ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() : period === 'year' ? new Date(new Date().getFullYear(), 0, 1).getTime() : 0;
  const inPeriod = entries.filter((e) => e.date >= from);
  const spent = inPeriod.reduce((a, e) => a + e.total, 0);
  const lit = inPeriod.filter((e) => !isAdBlue(e.fuelType)).reduce((a, e) => a + e.liters, 0);
  const priced = inPeriod.filter((e) => !isAdBlue(e.fuelType) && e.liters > 0);
  const avgPrice = priced.length ? priced.reduce((a, e) => a + e.total, 0) / priced.reduce((a, e) => a + e.liters, 0) : undefined;
  const allPriced = entries.filter((e) => !isAdBlue(e.fuelType) && e.liters > 0).slice(0, 10);
  const recentPrice = allPriced.length ? allPriced.reduce((a, e) => a + e.total, 0) / allPriced.reduce((a, e) => a + e.liters, 0) : undefined;

  const groups = new Map<string, FuelEntry[]>();
  for (const e of entries) {
    const k = monthTitle(e.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }

  return (
    <div className="screen">
      <TopBar
        title="Заправки"
        actions={
          <Button variant="primary" size="sm" icon={<LuPlus />} onClick={() => go('#/fuel/new')}>
            Добавить
          </Button>
        }
      />
      <Segmented
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'month', label: 'Месяц' },
          { value: 'year', label: 'Год' },
          { value: 'all', label: 'Всё время' },
        ]}
      />
      <div className="stat-grid">
        <Card>
          <Stat label="Потрачено" value={money(spent)} sub={`${inPeriod.length} заправ.`} />
        </Card>
        <Card>
          <Stat label="Залито" value={num(lit, 0)} unit="л" sub={avgPrice ? `ср. цена ${num(avgPrice, 2)} ₽/л` : '—'} />
        </Card>
        <Card>
          <Stat label="Средний расход" value={cons.avg ? num(cons.avg, 1) : '—'} unit="л/100" sub={cons.distance ? `по ${num(cons.distance)} км` : 'отмечайте полный бак'} />
        </Card>
        <Card>
          <Stat label="Стоимость 1 км" value={cons.avg && recentPrice ? num((cons.avg / 100) * recentPrice, 2) : '—'} unit="₽" sub="только топливо" />
        </Card>
      </div>

      {entries.length === 0 ? (
        <Empty
          icon={<LuFuel />}
          title="Заправок пока нет"
          text="Записывайте дату, АЗС, литры и сумму. Отмечайте «полный бак» — так считается реальный расход."
          action={<Button variant="primary" onClick={() => go('#/fuel/new')}>Добавить заправку</Button>}
        />
      ) : (
        Array.from(groups.entries()).map(([title, items]) => (
          <Section key={title} title={title} action={<span className="muted num">{money(items.reduce((a, e) => a + e.total, 0))}</span>}>
            <div className="list">
              {items.map((e) => (
                <Row
                  key={e.id}
                  icon={<span className={isAdBlue(e.fuelType) ? 'fuel-tag adblue' : 'fuel-tag'} title={e.fuelType}>{fuelTag(e.fuelType)}</span>}
                  title={
                    <>
                      {num(e.liters, 2)} л{e.price ? <span className="muted"> × {num(e.price, 2)} ₽</span> : null}
                      {e.attachments.length > 0 && <LuPaperclip className="inline-icon" />}
                    </>
                  }
                  subtitle={[dateHuman(e.date) + ' ' + timeShort(e.date), e.station, /^(АИ-\d+|ДТ|AdBlue)$/.test(e.fuelType) ? '' : e.fuelType, e.mileage ? `${num(e.mileage)} км` : ''].filter(Boolean).join(' · ')}
                  right={
                    <div className="row-right-stack">
                      <b className="num">{money(e.total)}</b>
                      {cons.perEntry.has(e.id) && <small className="muted">{num(cons.perEntry.get(e.id)!, 1)} л/100</small>}
                      {!e.fullTank && !isAdBlue(e.fuelType) && <small className="muted">не полный</small>}
                    </div>
                  }
                  onClick={() => go(`#/fuel/${e.id}`)}
                />
              ))}
            </div>
          </Section>
        ))
      )}
    </div>
  );
}

export function FuelForm({ id }: { id?: string }) {
  const { car, cars } = useApp();
  const [loaded, setLoaded] = useState(!id);
  const [orig, setOrig] = useState<FuelEntry | null>(null);
  const [carId, setCarId] = useState(car?.id || '');
  const [date, setDate] = useState(toDateTimeInput(Date.now()));
  const [mileage, setMileage] = useState('');
  const [station, setStation] = useState('');
  const [address, setAddress] = useState('');
  const [fuelType, setFuelType] = useState('');
  const [litersV, setLiters] = useState('');
  const [price, setPrice] = useState('');
  const [total, setTotal] = useState('');
  const [fullTank, setFullTank] = useState(true);
  const [payment, setPayment] = useState('');
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [lastEdited, setLastEdited] = useState<'liters' | 'price' | 'total' | null>(null);

  const all = useQuery(async () => ({ fuel: await getAll<FuelEntry>('fuel'), services: await getAll<ServiceEntry>('services') }), []);
  const theCar = cars.find((c) => c.id === carId) || car;
  const stations = useMemo(() => {
    const m = new Map<string, number>();
    (all?.fuel || []).forEach((f) => f.station && m.set(f.station, (m.get(f.station) || 0) + 1));
    const used = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    // крупные сети — всегда под рукой, даже если там ещё не заправлялись
    const chains = FUEL_CHAINS.map((c) => c.name).filter((n) => !used.some((u) => chainOf(u)?.name === n));
    return [...used.slice(0, 6), ...chains].slice(0, 8);
  }, [all]);

  useEffect(() => {
    if (!id) return;
    get<FuelEntry>('fuel', id).then((e) => {
      if (!e) return go('#/fuel');
      setOrig(e);
      setCarId(e.carId);
      setDate(toDateTimeInput(e.date));
      setMileage(e.mileage ? String(e.mileage) : '');
      setStation(e.station || '');
      setAddress(e.address || '');
      setFuelType(e.fuelType);
      setLiters(String(e.liters));
      setPrice(e.price ? String(e.price) : '');
      setTotal(String(e.total));
      setFullTank(e.fullTank);
      setPayment(e.payment || '');
      setNotes(e.notes || '');
      setAttachments(e.attachments || []);
      setLoaded(true);
    });
  }, [id]);

  useEffect(() => {
    if (!id && theCar && !fuelType) {
      const last = (all?.fuel || []).filter((f) => f.carId === theCar.id && !isAdBlue(f.fuelType)).sort((a, b) => b.date - a.date)[0];
      setFuelType(last?.fuelType || theCar.fuelTypes[0] || 'АИ-95');
      if (last?.price && !price) setPrice(String(last.price));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theCar?.id, all]);

  // АЗС сменили → виды топлива этой сети: то, что обычно заливаете здесь, или тот же вид топлива
  const prevStation = useRef<string | null>(null);
  const fromReceipt = useRef(false);
  useEffect(() => {
    if (!loaded || !theCar) return;
    if (prevStation.current === null || prevStation.current === station) {
      prevStation.current = station;
      return;
    }
    prevStation.current = station;
    if (fromReceipt.current) {
      fromReceipt.current = false;
      return;
    }
    const opts = fuelOptions(theCar, station);
    const chain = chainOf(station);
    if (chain && !isAdBlue(fuelType)) {
      const usual = (all?.fuel || [])
        .filter((f) => f.carId === theCar.id && f.id !== id && chainOf(f.station)?.id === chain.id && !isAdBlue(f.fuelType))
        .sort((a, b) => b.date - a.date)[0]?.fuelType;
      if (usual && opts.includes(usual) && fuelBase(usual) === fuelBase(fuelType)) return setFuelType(usual);
    }
    if (fuelType && !opts.includes(fuelType)) setFuelType(sameFuelIn(opts, fuelType) || opts[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station, loaded, theCar?.id]);

  // авто-расчёт третьего значения из двух
  useEffect(() => {
    const l = parseNum(litersV);
    const p = parseNum(price);
    const t = parseNum(total);
    if (lastEdited === 'total' && t && p) setLiters(String(Math.round((t / p) * 100) / 100));
    else if (lastEdited === 'total' && t && l) setPrice(String(Math.round((t / l) * 100) / 100));
    else if ((lastEdited === 'liters' || lastEdited === 'price') && l && p) setTotal(String(Math.round(l * p * 100) / 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [litersV, price, total]);

  if (!loaded || !theCar) return <Page title="Заправка" back="#/fuel"><div /></Page>;

  const lastMileage = all ? currentMileage(theCar, all.fuel.filter((f) => f.id !== id), all.services) : undefined;

  const applyReceipt = (text: string, qr?: FiscalQr | null) => {
    const r = parseFuelReceipt(text);
    const got: string[] = [];
    // QR-код чека точнее текста: сумма и время из него
    if (qr?.total) {
      r.total = qr.total;
      if (r.price && (!r.liters || Math.abs(r.liters * r.price - qr.total) > qr.total * 0.01)) r.liters = Math.round((qr.total / r.price) * 100) / 100;
      else if (r.liters && !r.price) r.price = Math.round((qr.total / r.liters) * 100) / 100;
    }
    if (qr?.date) r.date = qr.date;
    if (qr) got.push('QR-код');
    if (r.liters && !parseNum(litersV)) {
      setLiters(String(r.liters));
      got.push(`${r.liters} л`);
    }
    if (r.price && !parseNum(price)) {
      setPrice(String(r.price));
      got.push(`${r.price} ₽/л`);
    }
    if (r.total && !parseNum(total)) {
      setTotal(String(r.total));
      got.push(`${r.total} ₽`);
    }
    const st = station || r.station;
    if (r.fuelType) {
      const opts = fuelOptions(theCar, st);
      const ft = opts.includes(r.fuelType) ? r.fuelType : sameFuelIn(opts, r.fuelType);
      if (ft) {
        setFuelType(ft);
        got.push(ft);
      }
    }
    if (r.station && !station) {
      fromReceipt.current = true; // топливо уже взято из чека — не подменять «привычным»
      setStation(r.station);
      got.push(r.station);
    }
    if (r.date && !orig) {
      setDate(toDateTimeInput(r.date));
      got.push('дата');
    }
    setLastEdited(null);
    toast(got.length ? `Из чека: ${got.join(', ')}` : 'Не удалось прочитать чек — заполните вручную', got.length ? 'ok' : 'danger');
  };

  const save = async () => {
    const l = parseNum(litersV);
    const t = parseNum(total);
    if (!l || !t) return toast('Укажите литры и сумму', 'danger');
    const m = parseNum(mileage);
    const entry: FuelEntry = stamp(
      {
        ...(orig || { id: uid(), createdAt: Date.now() }),
        carId: theCar.id,
        date: fromDateTimeInput(date) || Date.now(),
        mileage: m ? Math.round(m) : undefined,
        station: station.trim() || undefined,
        address: address.trim() || undefined,
        fuelType,
        liters: l,
        price: parseNum(price),
        total: t,
        fullTank: isAdBlue(fuelType) ? false : fullTank,
        payment: payment || undefined,
        notes: notes.trim() || undefined,
        attachments,
      } as FuelEntry,
      !orig,
    );
    await put('fuel', entry);
    if (orig) await removeAttachments(orig.attachments.filter((a) => !attachments.includes(a)));
    refreshReminders();
    toast(orig ? 'Заправка сохранена' : 'Заправка добавлена');
    go('#/fuel');
  };

  const remove = async () => {
    if (!orig) return;
    if (!(await confirmDialog('Удалить заправку?', { danger: true, ok: 'Удалить' }))) return;
    await del('fuel', orig.id);
    await removeAttachments(orig.attachments);
    toast('Удалено');
    go('#/fuel');
  };

  return (
    <Page
      title={orig ? 'Заправка' : 'Новая заправка'}
      back="#/fuel"
      actions={
        orig && (
          <IconButton label="Удалить" onClick={remove}>
            <LuTrash2 />
          </IconButton>
        )
      }
    >
      <div className="form">
        {cars.length > 1 && (
          <Field label="Машина">
            <Chips value={theCar.model} onChange={(m) => setCarId(cars.find((c) => c.model === m)?.id || carId)} options={cars.map((c) => c.model)} />
          </Field>
        )}
        <Field label="Топливо" hint={chainOf(station) ? `Названия топлива сети «${chainOf(station)!.name}»` : undefined}>
          <Chips value={fuelType} onChange={setFuelType} options={fuelOptions(theCar, station, fuelType)} />
        </Field>
        <div className="grid-3">
          <Field label="Литры">
            <NumInput value={litersV} onChange={(v) => (setLiters(v), setLastEdited('liters'))} placeholder="0" />
          </Field>
          <Field label="Цена ₽/л">
            <NumInput value={price} onChange={(v) => (setPrice(v), setLastEdited('price'))} placeholder="0" />
          </Field>
          <Field label="Сумма ₽">
            <NumInput value={total} onChange={(v) => (setTotal(v), setLastEdited('total'))} placeholder="0" />
          </Field>
        </div>
        {!isAdBlue(fuelType) && <Toggle checked={fullTank} onChange={setFullTank} label="Полный бак" hint="Нужен для точного расчёта расхода" />}
        <div className="grid-2">
          <Field label="Дата и время">
            <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Пробег" hint={lastMileage ? `последний: ${num(lastMileage)} км` : undefined}>
            <NumInput value={mileage} onChange={setMileage} suffix="км" decimals={false} placeholder={lastMileage ? String(lastMileage) : ''} />
          </Field>
        </div>
        <Field label="АЗС">
          <Input value={station} onChange={(e) => setStation(e.target.value)} placeholder="Лукойл, Газпромнефть…" list="stations" />
          <datalist id="stations">
            {stations.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        {stations.length > 0 && !station && <Chips value="" onChange={setStation} options={stations} />}
        <Field label="Адрес / место">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="необязательно" />
        </Field>
        <Field label="Оплата">
          <Chips value={payment} onChange={(v) => setPayment(v === payment ? '' : v)} options={['Карта', 'Наличные', 'Топливная карта', 'Баллы']} />
        </Field>
        <Field label="Заметка">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        <AttachmentPicker
          value={attachments}
          onChange={setAttachments}
          label="Чек"
          scanTitle="Чек АЗС"
          scanMode="bw"
          withOcr
          onScanned={async (pages) => {
            if (!ocrSupported()) {
              const canvases = pages.map((p) => p.canvas).filter(Boolean) as HTMLCanvasElement[];
              const qr = await findReceiptQr(canvases).catch(() => null);
              if (qr) applyReceipt('', qr);
              return;
            }
            try {
              toast('Распознаю чек…', 'info');
              const canvases = pages.map((p) => p.canvas).filter(Boolean) as HTMLCanvasElement[];
              const qr = await findReceiptQr(canvases);
              const texts = await recognizePages(canvases, PAPER_PASSES);
              applyReceipt(texts.join('\n'), qr);
            } catch (e: any) {
              toast('Чек сохранён, но распознать не вышло', 'danger');
            }
          }}
          onPdf={async (file) => {
            try {
              toast('Читаю PDF-чек…', 'info');
              const pdf = await readPdf(file);
              let text = pdf.text;
              const qr = pdf.pages.length ? await findReceiptQr(pdf.pages) : null;
              if (text.replace(/\s/g, '').length < 40 && pdf.pages.length && ocrSupported()) text = (await recognizePages(pdf.pages, PAPER_PASSES)).join('\n');
              applyReceipt(text, qr);
            } catch (e: any) {
              toast('PDF сохранён, но прочитать чек не вышло', 'danger');
            }
          }}
        />
      </div>
      <div className="form-actions">
        <Button variant="primary" size="lg" block onClick={save}>
          Сохранить
        </Button>
      </div>
    </Page>
  );
}
