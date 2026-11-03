import React from 'react';
import { LuDisc3, LuWallet, LuCar, LuCpu, LuFileText, LuSettings, LuSiren } from 'react-icons/lu';
import { getAll, useQuery } from '../data/db';
import { docExpiry } from '../data/logic';
import type { DocEntry, Fine } from '../data/types';
import { APP_VERSION } from '../env';
import { money } from '../lib/format';
import { fineInfo } from '../data/logic';
import { useApp } from '../state';
import { Badge, Row, Section, go } from '../ui/kit';

export default function More() {
  const { cars } = useApp();
  const data = useQuery(async () => ({ fines: await getAll<Fine>('fines'), docs: await getAll<DocEntry>('documents') }), []);
  const unpaid = (data?.fines || []).filter((f) => f.status === 'unpaid');
  const sum = unpaid.reduce((a, f) => a + fineInfo(f).toPay, 0);
  const docAlerts = (data?.docs || []).filter((d) => d.status === 'active' && (docExpiry(d)?.expired || docExpiry(d)?.soon)).length;
  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar-row">
          <h1>Ещё</h1>
        </div>
      </header>
      <Section>
        <div className="list">
          <Row
            icon={<LuFileText />}
            title="Документы"
            subtitle="СТС, ПТС, госномер, ВУ, ОСАГО, КАСКО — с историей"
            right={docAlerts ? <Badge tone="warn">{docAlerts}</Badge> : undefined}
            onClick={() => go('#/docs')}
          />
          <Row
            icon={<LuSiren />}
            title="Штрафы"
            subtitle={unpaid.length ? `Не оплачено: ${unpaid.length} на ${money(sum)}` : 'Неоплаченных нет'}
            right={unpaid.length ? <Badge tone="danger">{unpaid.length}</Badge> : undefined}
            onClick={() => go('#/fines')}
          />
          <Row icon={<LuWallet />} title="Расходы" subtitle="Стоимость владения, графики, отчёт за год" onClick={() => go('#/expenses')} />
          <Row icon={<LuDisc3 />} title="Шины" subtitle="Комплекты, переобувка, пробег и износ" onClick={() => go('#/tires')} />
          <Row icon={<LuCpu />} title="Кодировки" subtitle="Скрытые функции и сервисные процедуры по блокам" onClick={() => go('#/codings')} />
          <Row icon={<LuCar />} title="Автомобили" subtitle={`${cars.length} · добавить или изменить`} onClick={() => go('#/cars')} />
          <Row icon={<LuSettings />} title="Настройки" subtitle={`Версия ${APP_VERSION} · бэкапы · напоминания · обновления`} onClick={() => go('#/settings')} />
        </div>
      </Section>
    </div>
  );
}
