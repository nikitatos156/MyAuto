// Общее состояние: список машин и выбранная машина.
import React, { createContext, useContext, useMemo } from 'react';
import { getAll, getSetting, setSetting, useQuery } from './data/db';
import type { Car } from './data/types';

interface Ctx {
  cars: Car[];
  car?: Car;
  carId?: string;
  setCarId: (id: string) => void;
  ready: boolean;
}

const AppCtx = createContext<Ctx>({ cars: [], setCarId: () => {}, ready: false });

export function AppProvider({ children }: { children: React.ReactNode }) {
  const cars = useQuery(() => getAll<Car>('cars').then((l) => l.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)), [], ['cars']);
  const savedId = useQuery(() => getSetting<string>('currentCarId', ''), [], ['settings']);
  const value = useMemo<Ctx>(() => {
    const list = cars || [];
    const car = list.find((c) => c.id === savedId) || list[0];
    return {
      cars: list,
      car,
      carId: car?.id,
      setCarId: (id: string) => setSetting('currentCarId', id),
      ready: cars !== undefined && savedId !== undefined,
    };
  }, [cars, savedId]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);
