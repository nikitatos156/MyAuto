// Модель данных приложения. Все записи имеют строковый id (uuid) и метки времени,
// чтобы в будущем можно было добавить синхронизацию.

export type ID = string;

export interface Base {
  id: ID;
  createdAt: number;
  updatedAt: number;
}

export type FuelKind = 'petrol' | 'diesel' | 'hybrid' | 'electric' | 'gas';

export interface Car extends Base {
  make: string;
  model: string;
  body?: string;
  year?: number;
  engine?: string; // "1.6 MPI"
  engineCode?: string; // "CFNA"
  power?: number; // л.с.
  drive?: string; // "Передний", "Полный (quattro)"
  gearbox?: string;
  fuelKind: FuelKind;
  fuelTypes: string[]; // варианты топлива для формы заправки
  vin?: string;
  color: string; // цвет метки в интерфейсе
  mileage?: number; // пробег, введённый вручную
  mileageDate?: number;
  serviceIntervalKm: number;
  serviceIntervalMonths: number;
  codingPreset?: string; // ключ каталога кодировок
  order: number;
  notes?: string;
}

export interface FuelEntry extends Base {
  carId: ID;
  date: number;
  mileage?: number;
  station?: string;
  address?: string;
  fuelType: string;
  liters: number;
  price?: number; // за литр
  total: number;
  fullTank: boolean;
  payment?: string;
  notes?: string;
  attachments: ID[];
}

export interface ServiceWork {
  name: string;
  price: number;
}

export interface ServicePart {
  name: string;
  partNumber?: string;
  brand?: string;
  qty: number;
  price: number; // за единицу
}

export type ServiceKind = 'to' | 'repair' | 'other';

export interface ServiceEntry extends Base {
  carId: ID;
  kind: ServiceKind;
  number?: number; // номер ТО
  title?: string;
  date: number;
  mileage?: number;
  station?: string;
  works: ServiceWork[];
  parts: ServicePart[];
  notes?: string;
  attachments: ID[];
  nextMileage?: number;
  nextDate?: number;
}

export type DocType = 'sts' | 'pts' | 'grz' | 'vu' | 'osago' | 'kasko';

export interface DocEntry extends Base {
  type: DocType;
  carId?: ID; // у ВУ нет машины
  status: 'active' | 'archived';
  archivedAt?: number;
  number?: string; // серия и номер
  region?: string; // регион ГРЗ
  holder?: string; // собственник / владелец ВУ / страхователь
  issuer?: string; // кем выдан / страховая компания
  issueDate?: number;
  startDate?: number;
  expiryDate?: number;
  cost?: number;
  phone?: string;
  categories?: string;
  drivers?: string;
  franchise?: number;
  notes?: string;
  attachments: ID[];
  /** Дополнительные поля документа (для СТС: госномер, VIN, марка, массы, адрес собственника и т.д.). */
  details?: Record<string, string>;
}

export interface Fine extends Base {
  carId?: ID;
  uin?: string; // номер постановления / УИН
  violationDate?: number;
  resolutionDate?: number; // дата постановления
  article?: string; // статья КоАП
  description?: string;
  place?: string;
  amount: number;
  status: 'unpaid' | 'paid';
  paidDate?: number;
  paidAmount?: number;
  source?: 'manual' | 'paste' | 'gibdd';
  notes?: string;
  attachments: ID[];
}

export type TireSeason = 'summer' | 'winter' | 'allseason';

export interface TireEvent {
  id: ID;
  date: number;
  mileage?: number;
  action: 'install' | 'remove';
  cost?: number; // шиномонтаж / хранение
  place?: string;
  note?: string;
}

export interface TireSet extends Base {
  carId: ID;
  season: TireSeason;
  studded?: boolean;
  brand?: string;
  model?: string;
  size?: string; // 225/45 R17
  loadSpeed?: string; // 94W
  year?: number; // год выпуска (по DOT)
  dot?: string; // код DOT, например 3523
  withRims: boolean;
  rims?: string;
  storage?: string; // где хранятся
  tread?: number; // остаточная глубина, мм
  treadDate?: number;
  price?: number; // стоимость комплекта
  purchaseDate?: number;
  status: 'active' | 'archived';
  events: TireEvent[];
  notes?: string;
  attachments: ID[];
}

export interface CodingState extends Base {
  carId: ID;
  key: string; // ключ из каталога или custom-<id>
  done: boolean;
  doneDate?: number;
  originalValue?: string;
  notes?: string;
  custom?: CodingItem; // для своих кодировок
}

/** Шаг многошаговой кодировки (например, дооснащения): свой блок, способ и значения. */
export interface CodingStep {
  title: string;
  module: string;
  method: string;
  path: string;
  /** Несколько каналов одного блока в одном шаге (тогда path — общее описание). */
  rows?: { path: string; from?: string; to?: string; hint?: string }[];
  from?: string;
  to?: string;
  login?: string;
  note?: string;
  warn?: string;
}

export interface CodingItem {
  key: string;
  title: string;
  category: string;
  module: string; // "09 — Центральная электроника"
  method: string; // "Адаптация" / "Длинное кодирование" / "Базовые установки"
  path: string; // канал / байт-бит
  from?: string;
  to?: string;
  login?: string; // код доступа
  note?: string;
  warn?: string;
  /** Многошаговая кодировка: шаги показываются внутри одного пункта. */
  steps?: CodingStep[];
}

export interface Attachment {
  id: ID;
  blob: Blob;
  type: string;
  name: string;
  size: number;
  createdAt: number;
}

export interface Setting {
  key: string;
  value: any;
}

export type StoreName =
  | 'cars'
  | 'fuel'
  | 'services'
  | 'documents'
  | 'fines'
  | 'codings'
  | 'tires'
  | 'attachments'
  | 'settings';
