import React from 'react';
import { LuPlus } from 'react-icons/lu';
import { useApp } from '../state';
import { cx } from './kit';

/** Заголовок раздела с переключателем машин. */
export function TopBar({ title, actions, showCars = true }: { title: string; actions?: React.ReactNode; showCars?: boolean }) {
  const { cars, carId, setCarId } = useApp();
  return (
    <header className="topbar">
      <div className="topbar-row">
        <h1>{title}</h1>
        <div className="page-actions">{actions}</div>
      </div>
      {showCars && cars.length > 0 && (
        <div className="car-switch" role="tablist" aria-label="Машина">
          {cars.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={c.id === carId}
              className={cx('car-pill', c.id === carId && 'is-active')}
              style={{ '--car': c.color } as any}
              onClick={() => setCarId(c.id)}
            >
              <span className="car-dot" />
              {c.model}
            </button>
          ))}
          <a className="car-pill car-pill-add" href="#/cars/new" aria-label="Добавить машину">
            <LuPlus />
          </a>
        </div>
      )}
    </header>
  );
}
