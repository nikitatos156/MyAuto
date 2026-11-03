import { TireDetail, TireForm, TiresList } from './screens/Tires';
import { Expenses } from './screens/Expenses';
import { ServiceImport } from './screens/ServiceImport';
import { PlanScreen } from './screens/Plan';
import ShowDocs from './screens/ShowDocs';
import { LockScreen } from './ui/Lock';
import { useLocked } from './lib/lock';
import React, { useEffect, useState } from 'react';
import { LuEllipsis, LuFuel, LuGauge, LuSiren, LuWrench, LuDownload, LuRefreshCw, LuX } from 'react-icons/lu';
import { AppProvider, useApp } from './state';
import { Button, ConfirmHost, Empty, Toaster, cx, go, useHashRoute } from './ui/kit';
import { getAll, getSetting, useQuery } from './data/db';
import type { Fine } from './data/types';
import { applyUpdate, getUpdateState, onUpdateState, type UpdateState } from './lib/updates';
import { applyTheme } from './lib/theme';
import Overview from './screens/Overview';
import { FuelForm, FuelList } from './screens/Fuel';
import { ServiceDetail, ServiceForm, ServiceList } from './screens/Service';
import { FineDetail, FineForm, FineList } from './screens/Fines';
import { DocDetail, DocForm, DocHistory, DocList } from './screens/Documents';
import Codings from './screens/Codings';
import { CarForm, CarList } from './screens/Cars';
import Settings from './screens/Settings';
import More from './screens/More';

function matchRoute(hash: string) {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  return parts;
}

/** Разделы, где без машины показывать нечего (пустой гараж при первом запуске). */
const NEEDS_CAR = ['fuel', 'service', 'plan', 'tires', 'expenses', 'codings', 'show'];

function NoCar() {
  return (
    <div className="screen">
      <Empty
        icon={<LuGauge />}
        title="Сначала добавьте машину"
        text="Заправки, ТО, шины, расходы и кодировки ведутся по машинам."
        action={<Button variant="primary" onClick={() => go('#/cars/new')}>Добавить машину</Button>}
      />
    </div>
  );
}

function Screen({ parts }: { parts: string[] }) {
  const [a, b, c, d] = parts;
  const { car } = useApp();
  if (!car && NEEDS_CAR.includes(a)) return <NoCar />;
  switch (a) {
    case undefined:
    case 'overview':
      return <Overview />;
    case 'fuel':
      if (b === 'new') return <FuelForm />;
      if (b) return <FuelForm id={b} />;
      return <FuelList />;
    case 'service':
      if (b === 'new') return <ServiceForm kind={(c as any) || 'to'} />;
      if (b === 'import') return <ServiceImport />;
      if (b === 'plan') return <PlanScreen />;
      if (b && c === 'edit') return <ServiceForm id={b} />;
      if (b) return <ServiceDetail id={b} />;
      return <ServiceList />;
    case 'fines':
      if (b === 'new') return <FineForm paste={c === 'paste'} />;
      if (b && c === 'edit') return <FineForm id={b} />;
      if (b) return <FineDetail id={b} />;
      return <FineList />;
    case 'docs':
      if (b === 'new') return <DocForm type={c as any} replaceId={d} />;
      if (b === 'history') return <DocHistory type={c as any} scope={d} />;
      if (b && c === 'edit') return <DocForm id={b} />;
      if (b) return <DocDetail id={b} />;
      return <DocList />;
    case 'codings':
      return <Codings />;
    case 'expenses':
      return <Expenses />;
    case 'tires':
      if (b === 'new') return <TireForm />;
      if (b && c === 'edit') return <TireForm id={b} />;
      if (b) return <TireDetail id={b} />;
      return <TiresList />;
    case 'cars':
      if (b === 'new') return <CarForm />;
      if (b) return <CarForm id={b} />;
      return <CarList />;
    case 'settings':
      return <Settings />;
    case 'show':
      return <ShowDocs />;
    case 'more':
      return <More />;
    default:
      return <Overview />;
  }
}

const TABS = [
  { key: 'overview', label: 'Обзор', icon: <LuGauge />, match: (a?: string) => !a || a === 'overview' },
  { key: 'fuel', label: 'Заправки', icon: <LuFuel />, match: (a?: string) => a === 'fuel' },
  { key: 'service', label: 'ТО', icon: <LuWrench />, match: (a?: string) => a === 'service' },
  { key: 'fines', label: 'Штрафы', icon: <LuSiren />, match: (a?: string) => a === 'fines' },
  { key: 'more', label: 'Ещё', icon: <LuEllipsis />, match: (a?: string) => ['more', 'docs', 'codings', 'cars', 'settings'].includes(a || '') },
];

function TabBar({ parts }: { parts: string[] }) {
  const unpaid = useQuery(() => getAll<Fine>('fines').then((l) => l.filter((f) => f.status === 'unpaid').length), [], ['fines']);
  return (
    <nav className="tabbar" aria-label="Разделы">
      <a className="tabbar-brand" href="#/" aria-hidden="true" tabIndex={-1}>
        <img src="icons/icon-192.png" alt="" width={32} height={32} />
        My Auto
      </a>
      {TABS.map((t) => (
        <a key={t.key} href={`#/${t.key}`} className={cx('tab', t.match(parts[0]) && 'is-active')}>
          <span className="tab-icon">
            {t.icon}
            {t.key === 'fines' && !!unpaid && <span className="tab-badge">{unpaid}</span>}
          </span>
          <span className="tab-label">{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

function UpdateBanner() {
  const [s, setS] = useState<UpdateState>(getUpdateState());
  const [hidden, setHidden] = useState(false);
  useEffect(() => onUpdateState((x) => (setS(x), setHidden(false))), []);
  if (hidden || (s.kind !== 'web-ready' && s.kind !== 'apk')) return null;
  return (
    <div className="update-banner" role="status">
      <div className="update-text">
        <b>{s.kind === 'apk' ? 'Новая версия приложения' : 'Доступно обновление'}</b>
        <span>{s.version ? `Версия ${s.version}` : 'Новая версия загружена'}{s.notes ? ` · ${s.notes}` : ''}</span>
      </div>
      <button className="btn btn-primary btn-sm" onClick={() => applyUpdate()}>
        {s.kind === 'apk' ? <LuDownload /> : <LuRefreshCw />}
        <span>{s.kind === 'apk' ? 'Скачать' : 'Обновить'}</span>
      </button>
      <button className="icon-btn" aria-label="Позже" onClick={() => setHidden(true)}>
        <LuX />
      </button>
    </div>
  );
}

function Shell() {
  const hash = useHashRoute();
  const parts = matchRoute(hash);
  const { ready } = useApp();
  const locked = useLocked();
  const isForm =
    parts.includes('new') || parts.includes('edit') || parts.includes('import') || (parts[0] === 'fuel' && !!parts[1]) || (parts[0] === 'cars' && !!parts[1]) || parts[0] === 'show';
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [hash.split('?')[0]]);
  useEffect(() => {
    getSetting('theme', 'system').then((t) => applyTheme(t));
  }, []);
  if (!ready) return locked ? <LockScreen /> : <div className="boot" />;
  return (
    <>
    {locked && <LockScreen />}
    {/* под блокировкой приложение остаётся открытым (начатые формы не теряются), но скрыто */}
    <div className={cx('app', isForm && 'is-form', locked && 'is-locked')} aria-hidden={locked || undefined}>
      <UpdateBanner />
      <main className="main">
        {/* key: при переходе между формами (например, ОСАГО → ВУ) форма создаётся заново, без чужих полей */}
        <Screen key={parts.join('/')} parts={parts} />
      </main>
      {!isForm && <TabBar parts={parts} />}
      <ConfirmHost />
    </div>
    <Toaster />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
