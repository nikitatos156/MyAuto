// «Показать документы»: ВУ, СТС, ОСАГО и КАСКО выбранной машины на одном экране — крупно и без интернета.
import React from 'react';
import { LuCar, LuCopy, LuFileText, LuIdCard, LuPhone, LuShieldCheck, LuTriangleAlert } from 'react-icons/lu';
import { getAll, useQuery } from '../data/db';
import { docExpiry } from '../data/logic';
import type { DocEntry, DocType } from '../data/types';
import { dateShort } from '../lib/format';
import { copyText } from '../lib/native';
import { useApp } from '../state';
import { Thumb } from '../ui/Attachments';
import { Badge, Button, Card, Page, Plate, cx, go, toast } from '../ui/kit';

const ORDER: { type: DocType; title: string; icon: React.ReactNode; perCar: boolean }[] = [
  { type: 'vu', title: 'Водительское удостоверение', icon: <LuIdCard />, perCar: false },
  { type: 'sts', title: 'Свидетельство о регистрации ТС', icon: <LuCar />, perCar: true },
  { type: 'osago', title: 'Полис ОСАГО', icon: <LuShieldCheck />, perCar: true },
  { type: 'kasko', title: 'Полис КАСКО', icon: <LuShieldCheck />, perCar: true },
];

/** Копирование без пробелов — так номера принимают формы на Госуслугах и в страховых. */
export async function copyValue(v: string, what = 'Скопировано') {
  await copyText(v.replace(/\s/g, ''));
  toast(what);
}

function CopyBtn({ value, label }: { value: string; label: string }) {
  return (
    <button type="button" className="show-copy" aria-label={`Копировать: ${label}`} onClick={() => copyValue(value, `${label} скопирован`)}>
      <LuCopy />
    </button>
  );
}

function Info({ label, value, mono, copy, tel }: { label: string; value?: string; mono?: boolean; copy?: string; tel?: boolean }) {
  if (!value) return null;
  return (
    <div className={cx('show-info', (copy || mono) && 'is-wide')}>
      <span>{label}</span>
      <div className="show-info-v">
        {tel ? (
          <a className="show-tel" href={`tel:${value.replace(/[^\d+]/g, '')}`}>
            <LuPhone /> {value}
          </a>
        ) : (
          <b className={cx(mono && 'mono')}>{value}</b>
        )}
        {copy && <CopyBtn value={value} label={copy} />}
      </div>
    </div>
  );
}

function DocCard({ d, title, icon }: { d: DocEntry; title: string; icon: React.ReactNode }) {
  const exp = docExpiry(d);
  const x = d.details || {};
  return (
    <Card className={cx('show-card', exp?.expired && 'is-danger')}>
      <div className="show-head">
        <span className="show-icon">{icon}</span>
        <div>
          <div className="show-title">{title}</div>
          {exp ? (
            <Badge tone={exp.expired ? 'danger' : exp.soon ? 'warn' : 'ok'}>
              {exp.expired ? `истёк ${dateShort(exp.until)}` : `до ${dateShort(exp.until)}`}
              {exp.extended ? ' · продлено' : ''}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="show-number-row">
        <div className="show-number mono">{d.number || '—'}</div>
        {d.number && <CopyBtn value={d.number} label={d.type === 'vu' ? 'Номер ВУ' : d.type === 'sts' ? 'Номер СТС' : 'Номер полиса'} />}
      </div>
      {exp?.extended && (
        <p className="small muted show-ext">В удостоверении — до {dateShort(d.expiryDate)}. Продлено на 3 года автоматически (постановление Правительства № 353), менять не нужно.</p>
      )}
      <div className="show-grid">
        <Info label={d.type === 'vu' ? 'Владелец' : d.type === 'sts' ? 'Собственник' : 'Страхователь'} value={d.holder} />
        {d.type === 'vu' && <Info label="Категории" value={d.categories} />}
        {d.type === 'vu' && <Info label="Выдано" value={d.issueDate ? dateShort(d.issueDate) : undefined} />}
        {d.type === 'sts' && <Info label="VIN" value={x.vin} mono copy="VIN" />}
        {d.type === 'sts' && <Info label="Паспорт ТС" value={x.pts} mono copy="Номер ПТС" />}
        {d.type === 'sts' && <Info label="Марка, модель" value={[x.make, x.model].filter(Boolean).join(' ')} />}
        {d.type === 'sts' && <Info label="Год" value={x.year} />}
        {d.type === 'sts' && <Info label="Цвет" value={x.color} />}
        {d.type === 'sts' && <Info label="Дата выдачи" value={d.issueDate ? dateShort(d.issueDate) : undefined} />}
        {(d.type === 'osago' || d.type === 'kasko') && <Info label="Страховая" value={d.issuer} />}
        {(d.type === 'osago' || d.type === 'kasko') && <Info label="Действует" value={d.startDate ? `с ${dateShort(d.startDate)}` : undefined} />}
        {(d.type === 'osago' || d.type === 'kasko') && <Info label="Водители" value={d.drivers} />}
        {(d.type === 'osago' || d.type === 'kasko') && <Info label="Телефон страховой" value={d.phone} tel />}
      </div>
      {d.attachments.length > 0 && (
        <div className="show-photos">
          {d.attachments.map((id) => (
            <Thumb key={id} id={id} />
          ))}
        </div>
      )}
    </Card>
  );
}

export default function ShowDocs() {
  const { car, cars, carId, setCarId } = useApp();
  const docs = useQuery(() => getAll<DocEntry>('documents'), [], ['documents']);
  if (!docs) return <Page title="Документы" back="#/"><div /></Page>;
  const active = docs.filter((d) => d.status === 'active');
  const grz = active.find((d) => d.type === 'grz' && d.carId === carId);
  const sts = active.find((d) => d.type === 'sts' && d.carId === carId);
  const plate = grz?.number ? { number: grz.number, region: grz.region } : sts?.details?.plate ? { number: sts.details.plate, region: sts.details.region } : null;

  return (
    <Page title="Документы" back="#/" className="show-page">
      {cars.length > 1 && (
        <div className="car-switch" role="tablist" aria-label="Машина">
          {cars.map((c) => (
            <button key={c.id} role="tab" aria-selected={c.id === carId} className={cx('car-pill', c.id === carId && 'is-active')} style={{ '--car': c.color } as any} onClick={() => setCarId(c.id)}>
              <span className="car-dot" />
              {c.model}
            </button>
          ))}
        </div>
      )}
      {car && plate && (
        <div className="show-plate show-plate-top">
          <button type="button" className="show-plate-btn" aria-label="Копировать госномер" onClick={() => copyValue(`${plate.number}${plate.region || ''}`, 'Госномер скопирован')}>
            <Plate number={plate.number} region={plate.region} size="lg" />
            <LuCopy className="show-plate-copy" />
          </button>
        </div>
      )}
      {ORDER.map(({ type, title, icon, perCar }) => {
        const list = active.filter((d) => d.type === type && (!perCar || d.carId === carId));
        if (!list.length) {
          if (type === 'kasko') return null; // КАСКО бывает не у всех
          return (
            <Card key={type} className="show-card show-missing">
              <div className="show-head">
                <span className="show-icon">{type === 'osago' ? <LuTriangleAlert /> : <LuFileText />}</span>
                <div className="show-title">{title} не добавлен{type === 'osago' ? '' : 'о'}</div>
              </div>
              <Button size="sm" onClick={() => go(`#/docs/new/${type}`)}>
                Добавить
              </Button>
            </Card>
          );
        }
        return list.map((d) => <DocCard key={d.id} d={d} title={title} icon={icon} />);
      })}
      <p className="muted small show-note">Данные и фото хранятся на телефоне — экран работает без интернета. Нажмите на фото, чтобы открыть его на весь экран.</p>
    </Page>
  );
}
