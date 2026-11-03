import React, { useMemo, useState } from 'react';
import { LuCheck, LuChevronDown, LuCopy, LuCpu, LuPlus, LuSearch, LuTrash2, LuTriangleAlert } from 'react-icons/lu';
import { del, getAll, put, stamp, uid, useQuery } from '../data/db';
import { CODING_CATEGORIES, presetForCar } from '../data/codings';
import type { CodingItem, CodingState, CodingStep } from '../data/types';
import { dateShort, fromDateInput, plural, toDateInput } from '../lib/format';
import { copyText } from '../lib/native';
import { useApp } from '../state';
import { TopBar } from '../ui/CarSwitch';
import { Badge, Button, Card, Empty, Field, Input, Segmented, Sheet, TextArea, confirmDialog, cx, go, toast } from '../ui/kit';

export default function Codings() {
  const { car } = useApp();
  const states = useQuery(() => (car ? getAll<CodingState>('codings').then((l) => l.filter((s) => s.carId === car.id)) : Promise.resolve([])), [car?.id], ['codings']);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'done' | 'todo'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const preset = car ? presetForCar(car) : undefined;

  const items: CodingItem[] = useMemo(() => {
    const custom = (states || []).filter((s) => s.custom).map((s) => s.custom!);
    return [...(preset?.items || []), ...custom];
  }, [preset, states]);
  const stateMap = new Map((states || []).map((s) => [s.key, s]));

  if (!car) return null;
  const ql = q.trim().toLowerCase();
  const filtered = items.filter((it) => {
    const st = stateMap.get(it.key);
    if (filter === 'done' && !st?.done) return false;
    if (filter === 'todo' && st?.done) return false;
    if (!ql) return true;
    return [it.title, it.module, it.path, it.note, it.category, ...(it.steps || []).flatMap((st) => [st.title, st.module, st.path, st.note, ...(st.rows || []).map((r) => r.path)])].some((x) => x?.toLowerCase().includes(ql));
  });
  const doneCount = items.filter((it) => stateMap.get(it.key)?.done).length;
  const cats = [...CODING_CATEGORIES, 'Свои кодировки'];
  const grouped = cats
    .map((c) => ({ c, list: filtered.filter((it) => (it.category || 'Свои кодировки') === c || (c === 'Свои кодировки' && !cats.includes(it.category))) }))
    .filter((g) => g.list.length);

  return (
    <div className="screen">
      <TopBar
        title="Кодировки"
        actions={
          <Button size="sm" icon={<LuPlus />} onClick={() => setAddOpen(true)}>
            Своя
          </Button>
        }
      />
      {preset ? (
        <Card className="coding-intro">
          <div className="eyebrow">
            <LuCpu /> {preset.title}
          </div>
          <div className="muted small">{preset.subtitle}</div>
          <p className="small">{preset.intro}</p>
          <div className="coding-progress">
            <div className="bar">
              <span style={{ width: `${items.length ? (doneCount / items.length) * 100 : 0}%` }} />
            </div>
            <span className="small">
              Выполнено {doneCount} из {items.length}
            </span>
          </div>
        </Card>
      ) : (
        <Card className="muted-card">
          Для этой машины нет готового каталога (библиотека: VW, Audi, Skoda, Seat, BMW с 2010 года). Добавляйте свои кодировки кнопкой «Своя» или выберите каталог в{' '}
          <a href={`#/cars/${car.id}`}>настройках машины</a>.
        </Card>
      )}
      <div className="warn-note">
        <LuTriangleAlert />
        <span>Перед изменением сохраните исходное значение (поле «Было до изменения»). Неправильное кодирование может вызвать ошибки блоков.</span>
      </div>
      <div className="search">
        <LuSearch />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: ДХО, 09, стрелки…" />
      </div>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: `Все · ${items.length}` },
          { value: 'todo', label: 'Не сделаны' },
          { value: 'done', label: `Сделаны · ${doneCount}` },
        ]}
      />
      {grouped.length === 0 ? (
        <Empty icon={<LuCpu />} title="Ничего не найдено" />
      ) : (
        grouped.map((g) => (
          <section className="section" key={g.c}>
            <div className="section-head">
              <h2>{g.c}</h2>
              <span className="muted small">{g.list.length}</span>
            </div>
            <div className="coding-list">
              {g.list.map((it) => (
                <CodingCard key={it.key} item={it} state={stateMap.get(it.key)} carId={car.id} open={open === it.key} onToggle={() => setOpen(open === it.key ? null : it.key)} />
              ))}
            </div>
          </section>
        ))
      )}
      <p className="hint-text">Источники: vag-coding.net, Ross-Tech, сводный список кодировок Audi B9, справочник BMW F30 (E-Sys), шпаргалка BMW G20, drive2; дооснащение TPMS — инструкции для Q7 4M (kaspa.rs) и TT RS (Audizine), комплекты Kufatec и K-Electronic для A4 8W / A5 F5. Каналы могут отличаться в зависимости от прошивки блока.</p>
      <CustomSheet open={addOpen} onClose={() => setAddOpen(false)} carId={car.id} />
    </div>
  );
}

/** Блок / код доступа / канал (с копированием) / значение «было → стало». */
function CodeBlock({ c }: { c: CodingStep }) {
  return (
    <div className="code-block">
      <div className="code-row">
        <span>Блок</span>
        <code>{c.module}</code>
      </div>
      {c.login && (
        <div className="code-row">
          <span>Код доступа</span>
          <code>{c.login}</code>
        </div>
      )}
      {c.rows ? (
        c.rows.map((r, i) => (
          <div key={i} className={cx('code-pair', i > 0 && 'is-next')}>
            <div className="code-row">
              <span>{i === 0 ? c.method : ''}</span>
              <code className="code-path">
                {r.path}
                <button className="copy-mini" aria-label="Копировать" onClick={async () => (await copyText(r.path), toast('Скопировано'))}>
                  <LuCopy />
                </button>
              </code>
            </div>
            <div className="code-row">
              <span />
              <code>
                {r.from && <s>{r.from}</s>} {r.from && r.to && '→'} <b>{r.to}</b>
                {r.hint && <i className="code-hint"> · {r.hint}</i>}
              </code>
            </div>
          </div>
        ))
      ) : (
        <div className="code-row">
          <span>{c.method}</span>
          <code className="code-path">
            {c.path}
            <button className="copy-mini" aria-label="Копировать" onClick={async () => (await copyText(c.path), toast('Скопировано'))}>
              <LuCopy />
            </button>
          </code>
        </div>
      )}
      {!c.rows && (c.from || c.to) && (
        <div className="code-row">
          <span>Значение</span>
          <code>
            {c.from && <s>{c.from}</s>} {c.from && c.to && '→'} <b>{c.to}</b>
          </code>
        </div>
      )}
    </div>
  );
}

function CodingCard({ item, state, carId, open, onToggle }: { item: CodingItem; state?: CodingState; carId: string; open: boolean; onToggle: () => void }) {
  const [orig, setOrig] = useState(state?.originalValue || '');
  const [notes, setNotes] = useState(state?.notes || '');
  const [date, setDate] = useState(toDateInput(state?.doneDate || Date.now()));
  React.useEffect(() => {
    setOrig(state?.originalValue || '');
    setNotes(state?.notes || '');
    setDate(toDateInput(state?.doneDate || Date.now()));
  }, [state?.id, state?.updatedAt]);

  const save = async (patch: Partial<CodingState>) => {
    const base: CodingState = state || ({ id: `${carId}:${item.key}`, carId, key: item.key, done: false, createdAt: Date.now() } as CodingState);
    await put('codings', stamp({ ...base, ...patch }));
  };
  const toggleDone = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const done = !state?.done;
    await save({ done, doneDate: done ? fromDateInput(date) || Date.now() : undefined, originalValue: orig || undefined, notes: notes || undefined });
    toast(done ? 'Отмечено как выполненное' : 'Отметка снята');
  };
  const removeCustom = async () => {
    if (!state?.custom) return;
    if (!(await confirmDialog('Удалить свою кодировку?', { danger: true, ok: 'Удалить' }))) return;
    await del('codings', state.id);
  };
  return (
    <div className={cx('coding', state?.done && 'is-done', open && 'is-open')}>
      <div className="coding-head" onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <button className={cx('check', state?.done && 'is-on')} onClick={toggleDone} aria-label={state?.done ? 'Снять отметку' : 'Отметить выполненным'}>
          <LuCheck />
        </button>
        <div className="coding-title">
          <b>{item.title}</b>
          <span className="muted small">
            {item.steps ? `${item.steps.length} ${plural(item.steps.length, 'шаг', 'шага', 'шагов')} · блоки ${item.module}` : `${item.module} · ${item.method}`}
            {state?.done && state.doneDate ? ` · ${dateShort(state.doneDate)}` : ''}
          </span>
        </div>
        {item.warn && <LuTriangleAlert className="coding-warn" />}
        <LuChevronDown className="coding-chev" />
      </div>
      {open && (
        <div className="coding-body">
          {item.steps ? (
            <>
              <div className="code-block">
                <div className="code-row">
                  <span>Нужно</span>
                  <code>{item.path}</code>
                </div>
              </div>
              {item.note && <p className="small">{item.note}</p>}
              {item.warn && (
                <p className="small text-warn">
                  <LuTriangleAlert /> {item.warn}
                </p>
              )}
              <ol className="coding-steps">
                {item.steps.map((st, i) => (
                  <li key={i} className="coding-step">
                    <div className="coding-step-head">
                      <span className="coding-step-n">{i + 1}</span>
                      <b>{st.title}</b>
                    </div>
                    <CodeBlock c={st} />
                    {st.note && <p className="small muted">{st.note}</p>}
                    {st.warn && (
                      <p className="small text-warn">
                        <LuTriangleAlert /> {st.warn}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <CodeBlock c={item} />
          )}
          {!item.steps && item.note && <p className="small">{item.note}</p>}
          {!item.steps && item.warn && (
            <p className="small text-warn">
              <LuTriangleAlert /> {item.warn}
            </p>
          )}
          <div className="grid-2">
            <Field label="Было до изменения">
              <Input value={orig} onChange={(e) => setOrig(e.target.value)} placeholder="исходное значение / код" className="mono" />
            </Field>
            <Field label="Дата">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Заметка">
            <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="чем кодировал, что заметил" />
          </Field>
          <div className="btn-row">
            <Button size="sm" variant="primary" onClick={async () => (await save({ originalValue: orig || undefined, notes: notes || undefined, doneDate: state?.done ? fromDateInput(date) : state?.doneDate }), toast('Сохранено'))}>
              Сохранить
            </Button>
            {state?.custom && (
              <Button size="sm" variant="danger" icon={<LuTrash2 />} onClick={removeCustom}>
                Удалить
              </Button>
            )}
            {state?.done ? <Badge tone="ok">выполнено</Badge> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function CustomSheet({ open, onClose, carId }: { open: boolean; onClose: () => void; carId: string }) {
  const [f, setF] = useState<Record<string, string>>({});
  const inp = (k: string) => ({ value: f[k] || '', onChange: (e: any) => setF((p) => ({ ...p, [k]: e.target.value })) });
  const save = async () => {
    if (!f.title?.trim()) return toast('Укажите название', 'danger');
    const key = 'custom-' + uid();
    const item: CodingItem = {
      key,
      title: f.title.trim(),
      category: 'Свои кодировки',
      module: f.module?.trim() || '—',
      method: f.method?.trim() || 'Адаптация',
      path: f.path?.trim() || '—',
      from: f.from?.trim() || undefined,
      to: f.to?.trim() || undefined,
      login: f.login?.trim() || undefined,
      note: f.note?.trim() || undefined,
    };
    await put('codings', stamp({ id: `${carId}:${key}`, carId, key, done: false, custom: item } as CodingState, true));
    setF({});
    onClose();
    toast('Кодировка добавлена');
  };
  return (
    <Sheet open={open} onClose={onClose} title="Своя кодировка" footer={<Button variant="primary" block onClick={save}>Добавить</Button>}>
      <div className="form">
        <Field label="Название">
          <Input {...inp('title')} placeholder="Например: ДХО на ПТФ" />
        </Field>
        <div className="grid-2">
          <Field label="Блок">
            <Input {...inp('module')} placeholder="09" />
          </Field>
          <Field label="Способ">
            <Input {...inp('method')} placeholder="Адаптация" />
          </Field>
        </div>
        <Field label="Канал / байт и бит">
          <Input {...inp('path')} className="mono" />
        </Field>
        <div className="grid-2">
          <Field label="Было">
            <Input {...inp('from')} />
          </Field>
          <Field label="Стало">
            <Input {...inp('to')} />
          </Field>
        </div>
        <Field label="Код доступа">
          <Input {...inp('login')} inputMode="numeric" />
        </Field>
        <Field label="Заметка">
          <TextArea {...(inp('note') as any)} rows={2} />
        </Field>
      </div>
    </Sheet>
  );
}
