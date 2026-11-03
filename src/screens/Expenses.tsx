// Расходы: стоимость владения по категориям и месяцам, стоимость километра, отчёт за период в PDF и Excel.
import React, { useMemo, useState } from 'react';
import { LuFileDown, LuFileSpreadsheet, LuWallet } from 'react-icons/lu';
import { getAll, useQuery } from '../data/db';
import { CATS, buckets, collectExpenses, periods, summarize, type Bucket, type ExpCat, type ExpenseData } from '../data/expenses';
import type { DocEntry, Fine, FuelEntry, ServiceEntry, TireSet } from '../data/types';
import { dateShort, money, num, plural } from '../lib/format';
import { partsTotal } from '../data/logic';
import { exportFile } from '../lib/native';
import { useApp } from '../state';
import { TopBar } from '../ui/CarSwitch';
import { Button, Card, Chips, Empty, Row, Section, Segmented, Stat, cx, go, toast } from '../ui/kit';

const SWATCH: Record<ExpCat, string> = { fuel: 'var(--exp-1)', service: 'var(--exp-2)', insurance: 'var(--exp-3)', fines: 'var(--exp-4)', tires: 'var(--exp-5)' };
// те же цвета для PDF (светлая тема)
const PDF_RGB: Record<ExpCat, [number, number, number]> = { fuel: [42, 120, 214], service: [235, 104, 52], insurance: [27, 175, 122], fines: [237, 161, 0], tires: [232, 123, 164] };

const short = (v: number) => (v >= 1e6 ? `${num(v / 1e6, 1)} млн` : v >= 1000 ? `${num(Math.round(v / 1000))} тыс.` : num(v));

function niceMax(v: number) {
  if (v <= 0) return 1000;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

/** Помесячные столбцы с накоплением по категориям. Нажатие на столбец показывает расшифровку. */
function StackedBars({ data, selected, onSelect }: { data: Bucket[]; selected: number | null; onSelect: (i: number | null) => void }) {
  const W = 340;
  const H = 170;
  const left = 40;
  const bottom = 20;
  const top = 8;
  const plotW = W - left - 4;
  const plotH = H - top - bottom;
  const max = niceMax(Math.max(...data.map((d) => d.total), 0));
  const step = plotW / data.length;
  const barW = Math.max(4, Math.min(22, step - 6));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelEvery = data.length > 12 ? Math.ceil(data.length / 8) : 1;
  return (
    <svg className="exp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Расходы по периодам">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={W - 4} y1={y(t)} y2={y(t)} className={t === 0 ? 'exp-axis' : 'exp-grid'} />
          <text x={left - 6} y={y(t) + 3} className="exp-tick" textAnchor="end">{short(t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx0 = left + step * i + (step - barW) / 2;
        let acc = 0;
        const segs = CATS.filter((c) => d.byCat[c.key] > 0);
        const dim = selected !== null && selected !== i;
        return (
          <g key={d.key} opacity={dim ? 0.4 : 1}>
            {segs.map((c, si) => {
              const v = d.byCat[c.key];
              const y1 = y(acc + v);
              const y0 = y(acc);
              acc += v;
              const isTop = si === segs.length - 1;
              const h = Math.max(0, y0 - y1 - (si > 0 ? 2 : 0)); // 2px зазор между сегментами
              if (h <= 0.2) return null;
              if (!isTop) return <rect key={c.key} x={cx0} y={y1} width={barW} height={h} fill={SWATCH[c.key]} />;
              const r = Math.min(4, h, barW / 2);
              return <path key={c.key} d={`M${cx0},${y1 + h} V${y1 + r} Q${cx0},${y1} ${cx0 + r},${y1} H${cx0 + barW - r} Q${cx0 + barW},${y1} ${cx0 + barW},${y1 + r} V${y1 + h} Z`} fill={SWATCH[c.key]} />;
            })}
            {i % labelEvery === 0 && (
              <text x={cx0 + barW / 2} y={H - 6} className={cx('exp-tick', selected === i && 'is-active')} textAnchor="middle">{d.label}</text>
            )}
            <rect x={left + step * i} y={top} width={step} height={plotH + bottom} fill="transparent" className="exp-hit" onClick={() => onSelect(selected === i ? null : i)}>
              <title>{`${d.title}: ${money(d.total)}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

export function Expenses() {
  const { car, cars } = useApp();
  const data = useQuery<ExpenseData>(
    async () => ({
      fuel: await getAll<FuelEntry>('fuel'),
      services: await getAll<ServiceEntry>('services'),
      docs: await getAll<DocEntry>('documents'),
      fines: await getAll<Fine>('fines'),
      tires: await getAll<TireSet>('tires'),
    }),
    [],
    ['fuel', 'services', 'documents', 'fines', 'tires'],
  );
  const [scope, setScope] = useState<'car' | 'all'>('car');
  const [periodKey, setPeriodKey] = useState('12m');
  const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState<'' | 'pdf' | 'xlsx'>('');

  const all = useMemo(() => (data ? collectExpenses(data) : []), [data]);
  if (!car || !data) return <div className="screen"><TopBar title="Расходы" /></div>;
  const items = scope === 'car' ? all.filter((i) => i.carId === car.id) : all;
  const ps = periods(items);
  const period = ps.find((p) => p.key === periodKey) || ps[0];
  const inPeriod = items.filter((i) => i.date >= period.from && i.date < period.to);
  const sum = summarize(items, period, scope === 'car' ? [car] : cars, data);
  const bk = buckets(items, period);
  const carName = (id?: string) => {
    const c = cars.find((x) => x.id === id);
    return c ? `${c.make} ${c.model}` : '';
  };
  const scopeTitle = scope === 'car' ? `${car.make} ${car.model}` : 'Все машины';
  const periodLabel = period.key === '12m' ? `${dateShort(period.from)} — ${dateShort(Math.min(period.to - 1, Date.now()))}` : period.label;
  const selB = sel !== null ? bk[sel] : null;
  const fileBase = `rashody-${scope === 'car' ? `${car.make}-${car.model}` : 'vse'}-${period.key}`.replace(/\s+/g, '-');

  const exportPdf = async () => {
    setBusy('pdf');
    try {
      const { expensesReportPdf } = await import('../lib/pdf');
      const blob = await expensesReportPdf({
        title: scopeTitle,
        periodLabel,
        summary: sum,
        cats: CATS.map((c) => ({ label: c.label, amount: sum.byCat[c.key], count: sum.count[c.key], color: PDF_RGB[c.key] })),
        months: bk.map((b) => ({ title: b.title, byCat: CATS.map((c) => b.byCat[c.key]), total: b.total })),
        items: [...inPeriod].sort((a, b) => a.date - b.date).map((i) => ({ date: i.date, cat: CATS.find((c) => c.key === i.cat)!.label, car: scope === 'all' ? carName(i.carId) : undefined, title: i.title, amount: i.amount })),
      });
      await exportFile(blob, `${fileBase}.pdf`, 'Отчёт о расходах');
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast('Не удалось создать PDF: ' + (e?.message || e), 'danger');
    } finally {
      setBusy('');
    }
  };

  const exportXlsx = async () => {
    setBusy('xlsx');
    try {
      const { writeXlsx } = await import('../lib/xlsx');
      const inRange = <T extends { date: number; carId?: string }>(l: T[]) => l.filter((x) => x.date >= period.from && x.date < period.to && (scope === 'all' || x.carId === car.id)).sort((a, b) => a.date - b.date);
      const H = (s: string) => ({ v: s, style: 'bold' as const });
      const M = (v: number) => ({ v: Math.round(v * 100) / 100, style: 'money' as const });
      const blob = writeXlsx([
        {
          name: 'Сводка',
          widths: [22, 16, 12, 16],
          rows: [
            [H('Расходы на автомобиль')],
            [scopeTitle],
            [`Период: ${periodLabel}`],
            [],
            [H('Категория'), H('Сумма, ₽'), H('Записей'), H('Доля')],
            ...CATS.map((c) => [c.label, M(sum.byCat[c.key]), sum.count[c.key], sum.total ? `${Math.round((sum.byCat[c.key] / sum.total) * 100)}%` : '—']),
            [H('Итого'), { v: sum.total, style: 'boldMoney' as const }],
            [],
            ['В среднем в месяц, ₽', M(sum.perMonth)],
            ['Пробег за период, км', sum.distance ?? '—'],
            ['Стоимость 1 км, ₽', sum.perKm ? M(sum.perKm) : '—'],
            ['Топливо на 1 км, ₽', sum.fuelPerKm ? M(sum.fuelPerKm) : '—'],
            ['Залито, л', M(sum.liters)],
            [],
            [H('Период'), ...CATS.map((c) => H(c.label)), H('Итого')],
            ...bk.map((b) => [b.title, ...CATS.map((c) => M(b.byCat[c.key])), M(b.total)]),
          ],
        },
        {
          name: 'Все траты',
          freezeHeader: true,
          widths: [12, 18, 16, 50, 14, 12],
          rows: [
            [H('Дата'), H('Машина'), H('Категория'), H('Что'), H('Сумма, ₽'), H('Пробег')],
            ...[...inPeriod].sort((a, b) => a.date - b.date).map((i) => [new Date(i.date), carName(i.carId), CATS.find((c) => c.key === i.cat)!.label, i.title, M(i.amount), i.mileage ?? null]),
          ],
        },
        {
          name: 'Заправки',
          freezeHeader: true,
          widths: [12, 18, 10, 10, 10, 12, 12, 22],
          rows: [
            [H('Дата'), H('Машина'), H('Топливо'), H('Литры'), H('Цена'), H('Сумма, ₽'), H('Пробег'), H('АЗС')],
            ...inRange(data.fuel).map((f) => [new Date(f.date), carName(f.carId), f.fuelType, f.liters, f.price ?? null, M(f.total), f.mileage ?? null, f.station || '']),
          ],
        },
        {
          name: 'ТО и ремонт',
          freezeHeader: true,
          widths: [12, 18, 12, 8, 12, 24, 14, 14, 14],
          rows: [
            [H('Дата'), H('Машина'), H('Вид'), H('ТО №'), H('Пробег'), H('Сервис'), H('Работы, ₽'), H('Запчасти, ₽'), H('Итого, ₽')],
            ...inRange(data.services).map((s) => {
              const wt = s.works.reduce((a, x) => a + (x.price || 0), 0);
              const pt = partsTotal(s);
              return [new Date(s.date), carName(s.carId), s.kind === 'to' ? 'ТО' : s.kind === 'repair' ? 'Ремонт' : 'Прочее', s.number ?? null, s.mileage ?? null, s.station || '', M(wt), M(pt), M(wt + pt)];
            }),
          ],
        },
        {
          name: 'Запчасти',
          freezeHeader: true,
          widths: [12, 18, 36, 18, 14, 8, 12, 12],
          rows: [
            [H('Дата'), H('Машина'), H('Наименование'), H('Артикул'), H('Бренд'), H('Кол-во'), H('Цена, ₽'), H('Сумма, ₽')],
            ...inRange(data.services).flatMap((s) => s.parts.map((p) => [new Date(s.date), carName(s.carId), p.name, p.partNumber || '', p.brand || '', p.qty, M(p.price), M(p.price * p.qty)])),
          ],
        },
      ]);
      await exportFile(blob, `${fileBase}.xlsx`, 'Отчёт о расходах');
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast('Не удалось создать файл: ' + (e?.message || e), 'danger');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="screen">
      <TopBar title="Расходы" showCars={scope === 'car'} />
      <Segmented
        value={scope}
        onChange={(v) => (setScope(v), setSel(null))}
        options={[
          { value: 'car', label: `${car.model}` },
          { value: 'all', label: 'Все машины' },
        ]}
      />
      <Chips value={period.label} onChange={(l) => (setPeriodKey(ps.find((p) => p.label === l)?.key || '12m'), setSel(null))} options={ps.map((p) => p.label)} />

      {items.length === 0 ? (
        <Empty icon={<LuWallet />} title="Трат пока нет" text="Здесь соберутся заправки, ТО, страховки, оплаченные штрафы и шины." />
      ) : (
        <>
          <div className="stat-grid">
            <Card>
              <Stat label="Всего" value={money(sum.total)} sub={`${inPeriod.length} ${plural(inPeriod.length, 'запись', 'записи', 'записей')}`} />
            </Card>
            <Card>
              <Stat label="В среднем в месяц" value={money(Math.round(sum.perMonth))} sub={`за ${sum.months} мес.`} />
            </Card>
            <Card>
              <Stat label="Стоимость 1 км" value={sum.perKm ? num(sum.perKm, 2) : '—'} unit={sum.perKm ? '₽' : undefined} sub={sum.distance ? `пробег ${num(sum.distance)} км` : 'нужны записи с пробегом'} />
            </Card>
            <Card>
              <Stat label="Топливо на 1 км" value={sum.fuelPerKm ? num(sum.fuelPerKm, 2) : '—'} unit={sum.fuelPerKm ? '₽' : undefined} sub={sum.liters ? `залито ${num(sum.liters)} л` : ''} />
            </Card>
          </div>

          <Card className="exp-card">
            <div className="exp-head">
              <b>{period.byYear ? 'По годам' : 'По месяцам'}</b>
              <span className="muted small">нажмите на столбец</span>
            </div>
            <StackedBars data={bk} selected={sel} onSelect={setSel} />
            <div className="exp-legend">
              {CATS.map((c) => (
                <span key={c.key}>
                  <i style={{ background: SWATCH[c.key] }} />
                  {c.label}
                </span>
              ))}
            </div>
            {selB && (
              <div className="exp-detail">
                <div className="exp-detail-head">
                  <b>{selB.title}</b>
                  <b className="num">{money(selB.total)}</b>
                </div>
                {CATS.filter((c) => selB.byCat[c.key] > 0).map((c) => (
                  <div key={c.key} className="exp-detail-row">
                    <span><i style={{ background: SWATCH[c.key] }} />{c.label}</span>
                    <span className="num">{money(selB.byCat[c.key])}</span>
                  </div>
                ))}
                {selB.total === 0 && <div className="muted small">Трат не было</div>}
              </div>
            )}
          </Card>

          <Section title="По категориям">
            <div className="list">
              {CATS.map((c) => {
                const v = sum.byCat[c.key];
                const pct = sum.total ? (v / sum.total) * 100 : 0;
                return (
                  <div key={c.key} className="row exp-cat">
                    <i className="exp-swatch" style={{ background: SWATCH[c.key] }} />
                    <div className="row-body">
                      <div className="row-title">{c.label}</div>
                      <div className="row-sub">
                        {sum.count[c.key] ? `${sum.count[c.key]} ${plural(sum.count[c.key], 'запись', 'записи', 'записей')} · ${Math.round(pct)}%` : 'нет трат'}
                      </div>
                      <div className="exp-share"><span style={{ width: `${pct}%`, background: SWATCH[c.key] }} /></div>
                    </div>
                    <b className="num">{money(v)}</b>
                  </div>
                );
              })}
            </div>
          </Section>

          <div className="btn-row exp-export">
            <Button icon={<LuFileDown />} busy={busy === 'pdf'} onClick={exportPdf}>Отчёт PDF</Button>
            <Button icon={<LuFileSpreadsheet />} busy={busy === 'xlsx'} onClick={exportXlsx}>Excel</Button>
          </div>

          <Section title="Траты за период">
            <div className="list">
              {inPeriod.slice(0, 30).map((i) => (
                <Row
                  key={i.id}
                  icon={<i className="exp-swatch" style={{ background: SWATCH[i.cat] }} />}
                  title={i.title}
                  subtitle={[dateShort(i.date), scope === 'all' ? carName(i.carId) : '', CATS.find((c) => c.key === i.cat)!.label].filter(Boolean).join(' · ')}
                  right={<b className="num">{money(i.amount)}</b>}
                  onClick={() => go(i.route)}
                />
              ))}
              {inPeriod.length > 30 && <div className="muted small list-more">…и ещё {inPeriod.length - 30} — полный список в отчёте</div>}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

