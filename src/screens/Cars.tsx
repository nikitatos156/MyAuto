import React, { useEffect, useRef, useState } from 'react';
import { LuCar, LuPlus, LuTrash2 } from 'react-icons/lu';
import { del, get, getAll, put, setSetting, stamp, uid } from '../data/db';
import { CODING_PRESETS, detectCodingPreset, presetOptions } from '../data/codings';
import { DIESEL_TYPES, PETROL_TYPES } from '../data/seed';
import type { Car, DocEntry, FuelKind } from '../data/types';
import { parseDocument } from '../data/docParse';
import { makeDisplayName, modelDisplayName } from '../data/stsParse';
import { normPlate } from '../data/logic';
import { FORM_PASSES } from '../lib/ocr';
import { ScanFill } from '../ui/ScanFill';
import { detailsFrom } from './Documents';
import { removeAttachments } from '../lib/attachments';
import { fromDateInput, num, parseNum } from '../lib/format';
import { refreshReminders } from '../lib/notify';
import { useApp } from '../state';
import { Button, Chips, Field, IconButton, Input, NumInput, Page, Row, Section, Select, TextArea, confirmDialog, go, toast } from '../ui/kit';

const COLORS = ['#2F6FED', '#C92A2A', '#2F9E44', '#E8590C', '#7048E8', '#0C8599', '#495057', '#E64980', '#F59F00', '#111111'];

// цвет из СТС → цвет метки машины в приложении
const STS_COLOR: [RegExp, string][] = [
  [/син|голуб/i, '#2F6FED'], [/красн|бордо|вишн/i, '#C92A2A'], [/зел/i, '#2F9E44'], [/оранж/i, '#E8590C'], [/фиолет|сирен|пурпур/i, '#7048E8'],
  [/бирюз/i, '#0C8599'], [/сер|графит|серебр/i, '#495057'], [/розов/i, '#E64980'], [/желт|жёлт|золот|беж|песоч/i, '#F59F00'], [/черн|чёрн/i, '#111111'],
];

export function CarList() {
  const { cars, carId, setCarId } = useApp();
  return (
    <Page
      title="Автомобили"
      back="#/more"
      actions={
        <Button variant="primary" size="sm" icon={<LuPlus />} onClick={() => go('#/cars/new')}>
          Добавить
        </Button>
      }
    >
      <div className="list">
        {cars.map((c) => (
          <Row
            key={c.id}
            icon={<span className="car-swatch" style={{ background: c.color }} />}
            title={
              <>
                {c.make} {c.model} {c.id === carId && <small className="muted">· выбрана</small>}
              </>
            }
            subtitle={[c.year, [c.engine, c.engineCode].filter(Boolean).join(' '), c.power ? `${c.power} л.с.` : '', c.drive].filter(Boolean).join(' · ')}
            onClick={() => go(`#/cars/${c.id}`)}
          />
        ))}
      </div>
      <p className="hint-text">
        Приложение подходит для любых машин: друзья могут добавить свои, а ваши две можно удалить у них в этом разделе.
      </p>
      {cars.length > 1 && (
        <Section title="Выбрать по умолчанию">
          <Chips value={cars.find((c) => c.id === carId)?.model || ''} onChange={(m) => setCarId(cars.find((c) => c.model === m)!.id)} options={cars.map((c) => c.model)} />
        </Section>
      )}
    </Page>
  );
}

export function CarForm({ id }: { id?: string }) {
  const { cars } = useApp();
  const [orig, setOrig] = useState<Car | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [f, setF] = useState<Record<string, string>>({ fuelKind: 'petrol', serviceIntervalKm: '15000', serviceIntervalMonths: '12', color: COLORS[cars.length % COLORS.length], codingPreset: '' });
  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  // скан СТС при добавлении машины: поля машины + после сохранения документы «СТС» и «ГРЗ»
  const sts = useRef<{ fields: Record<string, string>; attachments: string[] }>({ fields: {}, attachments: [] });
  const [stsFound, setStsFound] = useState(false);

  const applySts = (texts: string[]): string[] => {
    const r = parseDocument('sts', texts);
    const x = r.fields;
    sts.current.fields = x;
    setStsFound(!!(x.number || x.plate || x.vin));
    const filled: string[] = [];
    const next: Record<string, string> = {};
    const put1 = (k: string, v: string | undefined, label: string) => {
      if (!v || f[k]?.trim()) return;
      next[k] = v;
      filled.push(label);
    };
    put1('make', makeDisplayName(x.make), 'марка');
    put1('model', modelDisplayName(x.model), 'модель');
    put1('year', x.year, 'год');
    put1('vin', x.vin, 'VIN');
    put1('power', x.powerHp ? String(Math.round(parseFloat(x.powerHp))) : undefined, 'мощность');
    const body = (x.vehicleType || '').replace(/^легков[а-яё]*\s*/i, '').trim();
    put1('body', body ? body.charAt(0).toUpperCase() + body.slice(1) : undefined, 'кузов');
    const col = STS_COLOR.find(([re]) => re.test(x.color || ''))?.[1];
    if (col) next.color = col;
    setF((p) => ({ ...p, ...next }));
    if (x.plate) filled.push(`госномер ${x.plate} ${x.region || ''}`.trim());
    return filled;
  };
  const inp = (k: string) => ({ value: f[k] || '', onChange: (e: any) => set(k)(e.target.value) });

  useEffect(() => {
    if (!id) return;
    get<Car>('cars', id).then((c) => {
      if (!c) return go('#/cars');
      setOrig(c);
      setF({
        make: c.make,
        model: c.model,
        body: c.body || '',
        year: c.year ? String(c.year) : '',
        engine: c.engine || '',
        engineCode: c.engineCode || '',
        power: c.power ? String(c.power) : '',
        drive: c.drive || '',
        gearbox: c.gearbox || '',
        fuelKind: c.fuelKind,
        fuelTypes: c.fuelTypes.join(', '),
        vin: c.vin || '',
        color: c.color,
        serviceIntervalKm: String(c.serviceIntervalKm),
        serviceIntervalMonths: String(c.serviceIntervalMonths),
        codingPreset: c.codingPreset || '',
        mileage: c.mileage ? String(c.mileage) : '',
        notes: c.notes || '',
      });
      setLoaded(true);
    });
  }, [id]);

  if (!loaded) return <Page title="Машина" back="#/cars"><div /></Page>;

  const defaultTypes = (k: string) => (k === 'diesel' ? DIESEL_TYPES : k === 'petrol' ? PETROL_TYPES : k === 'gas' ? ['Пропан', 'Метан', 'АИ-95'] : k === 'electric' ? ['кВт·ч'] : PETROL_TYPES);

  const save = async () => {
    if (!f.make?.trim() || !f.model?.trim()) return toast('Укажите марку и модель', 'danger');
    const types = (f.fuelTypes || '').split(',').map((s) => s.trim()).filter(Boolean);
    const car: Car = stamp(
      {
        ...(orig || { id: uid(), createdAt: Date.now(), order: cars.length }),
        make: f.make.trim(),
        model: f.model.trim(),
        body: f.body?.trim() || undefined,
        year: parseNum(f.year),
        engine: f.engine?.trim() || undefined,
        engineCode: f.engineCode?.trim().toUpperCase() || undefined,
        power: parseNum(f.power),
        drive: f.drive?.trim() || undefined,
        gearbox: f.gearbox?.trim() || undefined,
        fuelKind: (f.fuelKind as FuelKind) || 'petrol',
        fuelTypes: types.length ? types : defaultTypes(f.fuelKind),
        vin: f.vin?.trim().toUpperCase() || undefined,
        color: f.color || COLORS[0],
        serviceIntervalKm: parseNum(f.serviceIntervalKm) || 15000,
        serviceIntervalMonths: parseNum(f.serviceIntervalMonths) || 12,
        codingPreset: f.codingPreset || undefined,
        mileage: parseNum(f.mileage),
        notes: f.notes?.trim() || undefined,
      } as Car,
      !orig,
    );
    await put('cars', car);
    if (!orig) await setSetting('currentCarId', car.id);
    // СТС отсканирован — сохраняем его и госномер в документы новой машины
    const x = sts.current.fields;
    if (!orig && (x.number || x.plate || sts.current.attachments.length)) {
      const now = Date.now();
      await put('documents', stamp<DocEntry>({
        id: uid(), createdAt: now, updatedAt: now, type: 'sts', carId: car.id, status: 'active',
        number: x.number, issueDate: fromDateInput(x.issueDate || ''), issuer: x.issuer, holder: x.holder,
        details: detailsFrom('sts', x), attachments: sts.current.attachments,
      }, true));
      const plate = normPlate(x.plate);
      if (plate) {
        await put('documents', stamp<DocEntry>({ id: uid(), createdAt: now, updatedAt: now, type: 'grz', carId: car.id, status: 'active', number: plate, region: x.region || undefined, issueDate: fromDateInput(x.issueDate || ''), attachments: [] }, true));
      }
      toast(plate ? 'Машина добавлена, СТС и госномер — в документах' : 'Машина добавлена, СТС — в документах', 'info');
    }
    refreshReminders();
    toast('Сохранено');
    go(orig ? '#/cars' : '#/');
  };

  const remove = async () => {
    if (!orig) return;
    if (!(await confirmDialog(`Удалить ${orig.make} ${orig.model}?`, { text: 'Будут удалены все заправки, ТО, документы, штрафы и кодировки этой машины. Сначала можно сделать резервную копию в настройках.', danger: true, ok: 'Удалить всё' }))) return;
    for (const store of ['fuel', 'services', 'documents', 'fines', 'codings'] as const) {
      const rows = await getAll<any>(store);
      for (const r of rows.filter((x) => x.carId === orig.id)) {
        if (r.attachments?.length) await removeAttachments(r.attachments);
        await del(store, r.id);
      }
    }
    await del('cars', orig.id);
    const rest = cars.filter((c) => c.id !== orig.id);
    if (rest[0]) await setSetting('currentCarId', rest[0].id);
    refreshReminders();
    toast('Машина удалена');
    go('#/cars');
  };

  return (
    <Page
      title={orig ? `${orig.make} ${orig.model}` : 'Новая машина'}
      back="#/cars"
      actions={
        orig && (
          <IconButton label="Удалить" onClick={remove}>
            <LuTrash2 />
          </IconButton>
        )
      }
    >
      <div className="form">
        {!orig && (
          <ScanFill
            title="Сканировать СТС"
            subtitle="Обе стороны с камеры или из галереи — марка, модель, год, VIN, мощность и госномер заполнятся сами. СТС и госномер сохранятся в документы машины"
            scanMode="color"
            passes={FORM_PASSES}
            nextHint="добавьте оборотную сторону кнопкой «Ещё страница»"
            fileName="СТС"
            onAttachments={(ids) => (sts.current.attachments = [...sts.current.attachments, ...ids])}
            onText={applySts}
          />
        )}
        {stsFound && sts.current.fields.plate && (
          <p className="hint-text">Госномер {normPlate(sts.current.fields.plate)} {sts.current.fields.region} и СТС № {sts.current.fields.number || '—'} сохранятся в документы машины.</p>
        )}
        <div className="grid-2">
          <Field label="Марка">
            <Input {...inp('make')} placeholder="Volkswagen" list="makes" />
            <datalist id="makes">
              {['Volkswagen', 'Audi', 'Skoda', 'Toyota', 'Kia', 'Hyundai', 'Lada', 'BMW', 'Mercedes-Benz', 'Renault', 'Haval', 'Chery', 'Geely', 'Nissan', 'Mazda'].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Модель">
            <Input {...inp('model')} placeholder="Polo" />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Кузов">
            <Input {...inp('body')} placeholder="Седан" />
          </Field>
          <Field label="Год">
            <NumInput value={f.year || ''} onChange={set('year')} decimals={false} maxLength={4} />
          </Field>
        </div>
        <div className="grid-3">
          <Field label="Двигатель">
            <Input {...inp('engine')} placeholder="1.6 MPI" />
          </Field>
          <Field label="Код ДВС">
            <Input {...inp('engineCode')} placeholder="CFNA" className="mono upper" />
          </Field>
          <Field label="Мощность">
            <NumInput value={f.power || ''} onChange={set('power')} decimals={false} suffix="л.с." />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Привод">
            <Input {...inp('drive')} placeholder="Передний" />
          </Field>
          <Field label="КПП">
            <Input {...inp('gearbox')} placeholder="МКПП / АКПП / DSG" />
          </Field>
        </div>
        <Field label="Топливо" hint={stsFound && !orig ? 'В СТС вид топлива не указан — выберите сами' : undefined}>
          <Select
            value={f.fuelKind}
            onChange={(v) => setF((p) => ({ ...p, fuelKind: v, fuelTypes: defaultTypes(v).join(', ') }))}
            options={[
              { value: 'petrol', label: 'Бензин' },
              { value: 'diesel', label: 'Дизель' },
              { value: 'gas', label: 'Газ / бензин' },
              { value: 'hybrid', label: 'Гибрид' },
              { value: 'electric', label: 'Электро' },
            ]}
          />
        </Field>
        <Field label="Варианты топлива в форме заправки" hint="через запятую">
          <Input {...inp('fuelTypes')} placeholder={defaultTypes(f.fuelKind).join(', ')} />
        </Field>
        <Field label="VIN">
          <Input {...inp('vin')} className="mono upper" maxLength={17} placeholder="17 символов" />
        </Field>
        <div className="grid-2">
          <Field label="Интервал ТО, км">
            <NumInput value={f.serviceIntervalKm || ''} onChange={set('serviceIntervalKm')} decimals={false} />
          </Field>
          <Field label="Интервал ТО, мес.">
            <NumInput value={f.serviceIntervalMonths || ''} onChange={set('serviceIntervalMonths')} decimals={false} />
          </Field>
        </div>
        <Field label="Текущий пробег">
          <NumInput value={f.mileage || ''} onChange={set('mileage')} decimals={false} suffix="км" />
        </Field>
        <Field
          label="Каталог кодировок"
          hint={(() => {
            if (f.codingPreset === 'none') return 'Кодировки можно добавлять вручную';
            const auto = detectCodingPreset(f.make, f.model, parseNum(f.year), f.body);
            if (!f.codingPreset) return auto ? `Подобран автоматически: ${CODING_PRESETS[auto].title}` : 'Для этой марки/модели каталога нет — можно добавлять свои кодировки';
            return auto && auto !== f.codingPreset ? `По марке и году подходит: ${CODING_PRESETS[auto].title}` : undefined;
          })()}
        >
          <Select value={f.codingPreset || ''} onChange={set('codingPreset')} options={presetOptions} />
        </Field>
        <Field label="Цвет метки">
          <div className="swatches">
            {COLORS.map((c) => (
              <button key={c} type="button" className={'swatch' + (f.color === c ? ' is-active' : '')} style={{ background: c }} onClick={() => set('color')(c)} aria-label={c} />
            ))}
          </div>
        </Field>
        <Field label="Заметки">
          <TextArea {...(inp('notes') as any)} rows={2} />
        </Field>
      </div>
      <div className="form-actions">
        <Button variant="primary" size="lg" block onClick={save}>
          Сохранить
        </Button>
      </div>
    </Page>
  );
}
