import { getSetting, setSetting } from './db';

export const PETROL_TYPES = ['АИ-95', 'АИ-92', 'АИ-98', 'АИ-100'];
export const DIESEL_TYPES = ['ДТ', 'ДТ зимнее', 'ДТ арктическое', 'AdBlue'];

// Первый запуск: гараж пустой — машину добавляют сами (вручную или по скану СТС).
export async function ensureSeed() {
  if (await getSetting<boolean>('seeded', false)) return;
  await setSetting('seeded', true);
  await setSetting('installedAt', Date.now());
}
