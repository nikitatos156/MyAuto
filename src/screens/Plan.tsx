// План обслуживания: что и когда менять по двигателю, с номерами запчастей; добавление работ в ТО по плану.
import React, { useEffect, useState } from 'react';
import { LuCalendarClock, LuCheck, LuClipboardList, LuCopy, LuListChecks } from 'react-icons/lu';
import { getAll, getSetting, setSetting, useQuery } from '../data/db';
import { currentMileage } from '../data/logic';
import { planFor, planStatus, sortPlan, type PlanItem, type PlanOverrides, type PlanStatus } from '../data/maintenance';
import type { Car, FuelEntry, ServiceEntry } from '../data/types';
import { dateShort, fromDateInput, km, num, parseNum, toDateInput } from '../lib/format';
import { copyText } from '../lib/native';
import { refreshReminders } from '../lib/notify';
import { useApp } from '../state';
import { Badge, Button, Card, Field, IconButton, Input, NumInput, Page, Row, Section, Sheet, Toggle, cx, go, toast } from '../ui/kit';

export const planKey = (carId: string) => `plan:${carId}`;

export function usePlan(car?: Car | null) {
  return useQuery(
    async () => {
      if (!car) return null;
      const [services, fuel, overrides] = await Promise.all([getAll<ServiceEntry>('services'), getAll<FuelEntry>('fuel'), getSetting<PlanOverrides>(planKey(car.id), {})]);
      const mileage = currentMileage(car, fuel, services);
      return { list: sortPlan(planStatus(car, services, mileage, overrides)), overrides, mileage, plan: planFor(car) };
    },
    [car?.id, car?.updatedAt],
    ['services', 'fuel', 'settings', 'cars'],
  );
}

export function statusText(s: PlanStatus) {
  if (s.off) return 'не отслеживается';
  if (!s.lastDate) return `не отмечено · интервал ${interval(s)}`;
  const parts: string[] = [];
  if (s.kmLeft !== undefined) parts.push(s.kmLeft < 0 ? `просрочено на ${km(-s.kmLeft)}` : `через ${km(s.kmLeft)}`);
  if (s.dueDate) parts.push(s.daysLeft !== undefined && s.daysLeft < 0 ? `срок был ${dateShort(s.dueDate)}` : `до ${dateShort(s.dueDate)}`);
  return parts.join(' · ') || `сделано ${dateShort(s.lastDate)}`;
}

const interval = (s: { km?: number; months?: number }) => [s.km ? `${num(s.km)} км` : '', s.months ? `${s.months} мес.` : ''].filter(Boolean).join(' / ') || '—';

const tone = (s: PlanStatus) => (s.off ? undefined : s.state === 'overdue' ? 'danger' : s.state === 'soon' ? 'warn' : undefined);

function ItemSheet({ car, status, overrides, mileage, onClose }: { car: Car; status: PlanStatus | null; overrides: PlanOverrides; mileage?: number; onClose: () => void }) {
  const [kmV, setKm] = useState('');
  const [months, setMonths] = useState('');
  const [doneDate, setDoneDate] = useState('');
  const [doneKm, setDoneKm] = useState('');
  const [off, setOff] = useState(false);
  useEffect(() => {
    if (!status) return;
    setKm(status.km ? String(status.km) : '');
    setMonths(status.months ? String(status.months) : '');
    setDoneDate(toDateInput(Date.now()));
    setDoneKm(mileage ? String(mileage) : '');
    setOff(status.off);
  }, [status?.item.key]);
  if (!status) return null;
  const it = status.item;
  const save = async (markDone: boolean) => {
    const o = { ...(overrides[it.key] || {}) };
    const k = parseNum(kmV);
    const m = parseNum(months);
    o.km = k ? Math.round(k) : kmV.trim() === '' ? null : o.km;
    o.months = m ? Math.round(m) : months.trim() === '' ? null : o.months;
    if (o.km === it.km) delete o.km;
    if (o.months === it.months) delete o.months;
    o.off = off || undefined;
    if (markDone) {
      o.doneDate = fromDateInput(doneDate) || Date.now();
      const dk = parseNum(doneKm);
      o.doneKm = dk ? Math.round(dk) : undefined;
    }
    await setSetting(planKey(car.id), { ...overrides, [it.key]: o });
    refreshReminders();
    toast(markDone ? 'Отмечено' : 'Сохранено');
    onClose();
  };
  return (
    <Sheet open={!!status} onClose={onClose} title={it.title} footer={<Button variant="primary" block onClick={() => save(false)}>Сохранить</Button>}>
      <div className="plan-sheet">
        <div className="muted small">
          {status.lastDate
            ? `Последний раз: ${dateShort(status.lastDate)}${status.lastKm ? ', ' + km(status.lastKm) : ''}${status.lastSource === 'history' ? ' (из истории ТО)' : ' (отмечено вручную)'}`
            : 'В истории ТО нет записи об этой работе — отметьте, когда делали в последний раз.'}
        </div>
        {it.parts && it.parts.length > 0 && (
          <div className="lines">
            {it.parts.map((p, i) => (
              <div className="line" key={i}>
                <span className="line-name">
                  {p.name}
                  {(p.partNumber || p.note) && <small className={p.partNumber ? 'mono' : ''}>{[p.partNumber, p.note].filter(Boolean).join(' · ')}</small>}
                </span>
                {p.qty && <span className="num muted">{String(p.qty).replace('.', ',')}{p.qty % 1 ? ' л' : ' шт'}</span>}
                {p.partNumber && (
                  <IconButton label="Скопировать номер" onClick={async () => (await copyText(p.partNumber!.replace(/\s/g, ''))) && toast('Номер скопирован')}>
                    <LuCopy />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
        )}
        {it.note && <div className="small muted">{it.note}</div>}
        <div className="grid-2">
          <Field label="Интервал, км">
            <NumInput value={kmV} onChange={setKm} decimals={false} placeholder="—" />
          </Field>
          <Field label="Интервал, месяцев">
            <NumInput value={months} onChange={setMonths} decimals={false} placeholder="—" />
          </Field>
        </div>
        <Card className="muted-card">
          <b className="small">Сделано без записи ТО</b>
          <div className="grid-2">
            <Field label="Дата">
              <Input type="date" value={doneDate} onChange={(e) => setDoneDate(e.target.value)} />
            </Field>
            <Field label="Пробег">
              <NumInput value={doneKm} onChange={setDoneKm} decimals={false} suffix="км" />
            </Field>
          </div>
          <Button icon={<LuCheck />} onClick={() => save(true)}>Отметить выполненным</Button>
        </Card>
        <Toggle checked={off} onChange={setOff} label="Не отслеживать" hint="Пункт не будет напоминать о себе" />
      </div>
    </Sheet>
  );
}

/** Карточка на экране ТО: ближайшие пункты плана. */
export function PlanCard({ car }: { car: Car }) {
  const data = usePlan(car);
  if (!data) return null;
  const list = data.list.filter((s) => !s.off).slice(0, 4);
  return (
    <Section title={<><LuListChecks /> План обслуживания</>} action={<a className="link" href="#/service/plan">Весь план</a>}>
      <div className="list">
        {list.map((s) => (
          <Row key={s.item.key} tone={tone(s)} title={s.item.title} subtitle={statusText(s)} onClick={() => go('#/service/plan?item=' + s.item.key)} />
        ))}
      </div>
    </Section>
  );
}

export function PlanScreen() {
  const { car } = useApp();
  const data = usePlan(car);
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.hash.split('?')[1] || '').get('item'));
  if (!car || !data) return <Page title="План обслуживания" back="#/service"><div /></Page>;
  const st = data.list.find((s) => s.item.key === open) || null;
  return (
    <Page title="План обслуживания" back="#/service">
      <Card className="muted-card">
        <b>{data.plan.title}</b>
        <div className="small muted">{data.plan.source}</div>
        <div className="small muted">Последнее выполнение берётся из истории ТО по названиям работ и запчастей. Нажмите на пункт, чтобы изменить интервал или отметить работу.</div>
      </Card>
      <div className="list">
        {data.list.map((s) => (
          <Row
            key={s.item.key}
            tone={tone(s)}
            className={cx(s.off && 'is-muted')}
            icon={s.item.months && !s.item.km ? <LuCalendarClock /> : <LuClipboardList />}
            title={s.item.title}
            subtitle={statusText(s)}
            right={s.state === 'overdue' && !s.off ? <Badge tone="danger">пора</Badge> : s.state === 'soon' && !s.off ? <Badge tone="warn">скоро</Badge> : undefined}
            onClick={() => setOpen(s.item.key)}
          />
        ))}
      </div>
      <ItemSheet car={car} status={st} overrides={data.overrides} mileage={data.mileage} onClose={() => setOpen(null)} />
    </Page>
  );
}

/** Выбор работ по плану для формы ТО. */
export function PlanPickSheet({ car, open, onClose, onAdd }: { car: Car; open: boolean; onClose: () => void; onAdd: (items: PlanItem[]) => void }) {
  const data = usePlan(car);
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!open || !data) return;
    const due = data.list.filter((s) => !s.off && (s.state === 'overdue' || s.state === 'soon')).map((s) => s.item.key);
    setSel(new Set(due.length ? due : ['oil']));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, !!data]);
  if (!data) return null;
  const toggle = (k: string) => {
    const n = new Set(sel);
    n.has(k) ? n.delete(k) : n.add(k);
    setSel(n);
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Работы по плану"
      footer={
        <Button variant="primary" block disabled={!sel.size} onClick={() => (onAdd(data.list.filter((s) => sel.has(s.item.key)).map((s) => s.item)), onClose())}>
          Добавить {sel.size ? `(${sel.size})` : ''}
        </Button>
      }
    >
      <div className="muted small">Работы и запчасти с номерами добавятся в запись — цены впишите из чека.</div>
      <div className="list">
        {data.list
          .filter((s) => !s.off)
          .map((s) => (
            <label key={s.item.key} className={cx('row check-row', sel.has(s.item.key) && 'is-selected')}>
              <input type="checkbox" checked={sel.has(s.item.key)} onChange={() => toggle(s.item.key)} />
              <div className="row-body">
                <div className="row-title">{s.item.title}</div>
                <div className="row-sub">{statusText(s)}</div>
              </div>
            </label>
          ))}
      </div>
    </Sheet>
  );
}
