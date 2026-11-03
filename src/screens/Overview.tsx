import React, { useState } from 'react';
import {
  LuBell, LuChevronRight, LuCopy, LuDisc3, LuIdCard, LuDatabaseBackup, LuFileText, LuFuel, LuGauge, LuPencil, LuPlus, LuSettings, LuSiren, LuTriangleAlert, LuWrench,
} from 'react-icons/lu';
import { getAll, getSetting, put, stamp, useQuery } from '../data/db';
import { buildReminders, consumption, currentMileage, isAdBlue, nextService, serviceTotal } from '../data/logic';
import type { Car, DocEntry, Fine, FuelEntry, ServiceEntry, TireSet } from '../data/types';
import { dateHuman, dateShort, km, money, num, parseNum, relDays } from '../lib/format';
import { useApp } from '../state';
import { copyText } from '../lib/native';
import { loadPlanOverrides } from '../lib/notify';
import { TopBar } from '../ui/CarSwitch';
import { Button, Card, Empty, Field, IconButton, NumInput, Plate, Row, Section, Sheet, Stat, go, toast, cx } from '../ui/kit';

export default function Overview() {
  const { car, cars } = useApp();
  const data = useQuery(async () => {
    const [fuel, services, docs, fines, lastBackup, tires] = await Promise.all([
      getAll<FuelEntry>('fuel'),
      getAll<ServiceEntry>('services'),
      getAll<DocEntry>('documents'),
      getAll<Fine>('fines'),
      getSetting<number>('lastBackupAt', 0),
      getAll<TireSet>('tires'),
    ]);
    const planOverrides = await loadPlanOverrides();
    return { fuel, services, docs, fines, lastBackup, tires, planOverrides };
  }, []);
  const [mileageOpen, setMileageOpen] = useState(false);

  if (!car) {
    return (
      <div className="screen">
        <TopBar title="My Auto" />
        <Empty
          icon={<LuGauge />}
          title="Добавьте свою машину"
          text="Марка, модель, год и двигатель — по ним сами подберутся кодировки, план обслуживания и виды топлива. Документы, заправки и ТО появятся после этого."
          action={<Button variant="primary" onClick={() => go('#/cars/new')}>Добавить машину</Button>}
        />
      </div>
    );
  }
  if (!data) return <div className="screen"><TopBar title="My Auto" /></div>;

  const fuel = data.fuel.filter((f) => f.carId === car.id);
  const services = data.services.filter((s) => s.carId === car.id);
  const mileage = currentMileage(car, data.fuel, data.services);
  const ns = nextService(car, data.services, mileage);
  const cons = consumption(fuel);
  const grz = data.docs.find((d) => d.type === 'grz' && d.status === 'active' && d.carId === car.id);
  const vin = car.vin || data.docs.find((d) => d.type === 'sts' && d.status === 'active' && d.carId === car.id)?.details?.vin;
  const reminders = buildReminders({ cars, fuel: data.fuel, services: data.services, docs: data.docs, fines: data.fines, tires: data.tires, planOverrides: data.planOverrides, lastBackup: data.lastBackup });
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const mFuel = fuel.filter((f) => f.date >= monthStart.getTime()).reduce((a, f) => a + f.total, 0);
  const mService = services.filter((s) => s.date >= monthStart.getTime()).reduce((a, s) => a + serviceTotal(s), 0);
  const lastFuel = [...fuel].sort((a, b) => b.date - a.date).find((f) => !isAdBlue(f.fuelType));
  const recent = [
    ...fuel.map((f) => ({ t: f.date, kind: 'fuel' as const, item: f })),
    ...services.map((s) => ({ t: s.date, kind: 'service' as const, item: s })),
  ]
    .sort((a, b) => b.t - a.t)
    .slice(0, 5);

  const spec = [car.year, [car.engine, car.engineCode].filter(Boolean).join(' '), car.power ? `${car.power} л.с.` : '', car.drive].filter(Boolean).join(' · ');

  return (
    <div className="screen">
      <TopBar
        title="My Auto"
        actions={
          <IconButton label="Настройки" onClick={() => go('#/settings')}>
            <LuSettings />
          </IconButton>
        }
      />

      <Card className="hero" accent={car.color}>
        <div className="hero-top">
          <div>
            <div className="hero-make">{car.make}</div>
            <div className="hero-model">
              {car.model} {car.body && <span>{car.body}</span>}
            </div>
            <div className="hero-spec">{spec}</div>
          </div>
          {grz?.number ? (
            <a href={`#/docs/${grz.id}`} className="hero-plate">
              <Plate number={grz.number} region={grz.region} />
            </a>
          ) : (
            <a href="#/docs/new/grz" className="hero-plate-add">+ Госномер</a>
          )}
        </div>
        {vin && (
          <button
            type="button"
            className="hero-vin"
            aria-label="Копировать VIN"
            onClick={async () => {
              await copyText(vin.replace(/\s/g, ''));
              toast('VIN скопирован');
            }}
          >
            <span>VIN</span>
            <b>{vin}</b>
            <LuCopy />
          </button>
        )}
        <button className="odo" onClick={() => setMileageOpen(true)} aria-label="Обновить пробег">
          <span className="odo-label">Пробег</span>
          <span className="odo-value">{mileage ? num(mileage) : '— — —'}</span>
          <span className="odo-unit">км</span>
          <LuPencil className="odo-edit" />
        </button>
      </Card>

      <Button className="show-entry" icon={<LuIdCard />} onClick={() => go('#/show')}>
        Показать документы
      </Button>

      {reminders.length > 0 && (
        <Section title="Требует внимания">
          <div className="list">
            {reminders.slice(0, 6).map((r) => (
              <Row
                key={r.id}
                tone={r.level === 'danger' ? 'danger' : r.level === 'warn' ? 'warn' : 'info'}
                icon={r.kind === 'fine' ? <LuSiren /> : r.kind === 'service' ? <LuWrench /> : r.kind === 'doc' ? <LuFileText /> : r.kind === 'tires' ? <LuDisc3 /> : <LuDatabaseBackup />}
                title={r.title}
                subtitle={r.text}
                onClick={() => go(r.route)}
              />
            ))}
          </div>
        </Section>
      )}

      <div className="stat-grid">
        <Card onClick={() => go('#/fuel')}>
          <Stat label="Средний расход" value={cons.avg ? num(cons.avg, 1) : '—'} unit="л/100" sub={cons.last ? `последний ${num(cons.last, 1)}` : 'нужно 2 полных бака'} />
        </Card>
        <Card onClick={() => go('#/expenses')}>
          <Stat label="Расходы за месяц" value={money(mFuel + mService)} sub={`топливо ${money(mFuel)}`} />
        </Card>
        <Card onClick={() => go('#/service')} className={cx(ns?.overdue && 'is-danger', ns?.soon && 'is-warn')}>
          <Stat
            label={ns ? `Следующее ТО-${ns.number}` : 'Следующее ТО'}
            value={ns?.kmLeft !== undefined ? (ns.kmLeft < 0 ? `−${num(-ns.kmLeft)}` : num(ns.kmLeft)) : ns?.date ? relDays(ns.date) : '—'}
            unit={ns?.kmLeft !== undefined ? 'км' : undefined}
            sub={ns ? (ns.date ? `до ${dateShort(ns.date)}` : '') : 'добавьте первое ТО'}
          />
        </Card>
        <Card onClick={() => go('#/fuel')}>
          <Stat label="Последняя заправка" value={lastFuel ? money(lastFuel.total) : '—'} sub={lastFuel ? `${dateHuman(lastFuel.date)} · ${lastFuel.fuelType}` : 'пока нет'} />
        </Card>
      </div>

      <div className="quick">
        <button className="quick-btn" onClick={() => go('#/fuel/new')}>
          <LuFuel />
          <span>Заправка</span>
        </button>
        <button className="quick-btn" onClick={() => go('#/service/new')}>
          <LuWrench />
          <span>ТО</span>
        </button>
        <button className="quick-btn" onClick={() => go('#/fines/new')}>
          <LuSiren />
          <span>Штраф</span>
        </button>
        <button className="quick-btn" onClick={() => go('#/docs')}>
          <LuFileText />
          <span>Документы</span>
        </button>
      </div>

      <Section title="Недавнее" action={recent.length ? <a className="link" href="#/fuel">Все</a> : undefined}>
        {recent.length === 0 ? (
          <Empty icon={<LuPlus />} title="Записей пока нет" text="Добавьте заправку или ТО — здесь появится история." />
        ) : (
          <div className="list">
            {recent.map((r) =>
              r.kind === 'fuel' ? (
                <Row
                  key={r.item.id}
                  icon={<LuFuel />}
                  title={`${(r.item as FuelEntry).fuelType} · ${num((r.item as FuelEntry).liters, 2)} л`}
                  subtitle={`${dateHuman(r.t)}${(r.item as FuelEntry).station ? ' · ' + (r.item as FuelEntry).station : ''}`}
                  right={<b className="num">{money((r.item as FuelEntry).total)}</b>}
                  onClick={() => go(`#/fuel/${r.item.id}`)}
                />
              ) : (
                <Row
                  key={r.item.id}
                  icon={<LuWrench />}
                  title={(r.item as ServiceEntry).kind === 'to' ? `ТО-${(r.item as ServiceEntry).number ?? ''}` : (r.item as ServiceEntry).title || 'Ремонт'}
                  subtitle={`${dateHuman(r.t)}${(r.item as ServiceEntry).mileage ? ' · ' + km((r.item as ServiceEntry).mileage) : ''}`}
                  right={<b className="num">{money(serviceTotal(r.item as ServiceEntry))}</b>}
                  onClick={() => go(`#/service/${r.item.id}`)}
                />
              ),
            )}
          </div>
        )}
      </Section>

      <MileageSheet open={mileageOpen} onClose={() => setMileageOpen(false)} car={car} current={mileage} />
    </div>
  );
}

function MileageSheet({ open, onClose, car, current }: { open: boolean; onClose: () => void; car: Car; current?: number }) {
  const [v, setV] = useState('');
  React.useEffect(() => {
    if (open) setV(current ? String(current) : '');
  }, [open, current]);
  const save = async () => {
    const n = parseNum(v);
    if (!n) return toast('Введите пробег', 'danger');
    if (current && n < current - 5) {
      toast('Пробег меньше последнего записанного — проверьте значение', 'danger');
      return;
    }
    await put('cars', stamp({ ...car, mileage: Math.round(n), mileageDate: Date.now() }));
    toast('Пробег обновлён');
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Текущий пробег" footer={<Button variant="primary" block onClick={save}>Сохранить</Button>}>
      <Field label={`${car.make} ${car.model}`} hint="Пробег также берётся из заправок и ТО — используется для расчёта следующего ТО.">
        <NumInput value={v} onChange={setV} suffix="км" decimals={false} autoFocus />
      </Field>
    </Sheet>
  );
}
