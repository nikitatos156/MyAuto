// Базовые компоненты интерфейса.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuChevronLeft, LuChevronRight, LuX } from 'react-icons/lu';

export const cx = (...a: any[]) => a.filter(Boolean).join(' ');

// ---------- кнопки ----------
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  block?: boolean;
  busy?: boolean;
};
export function Button({ variant = 'secondary', size = 'md', icon, block, busy, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      className={cx('btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', busy && 'is-busy', className)}
      disabled={disabled || busy}
      {...rest}
    >
      {icon && <span className="btn-icon">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={cx('icon-btn', className)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

// ---------- поля ----------
export function Field({ label, hint, children, className, auto }: { label?: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string; auto?: boolean }) {
  return (
    <label className={cx('field', auto && 'is-auto', className)}>
      {label && (
        <span className="field-label">
          {label}
          {auto && <span className="auto-tag">скан</span>}
        </span>
      )}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('input', props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx('input textarea', props.className)} />;
}

export function NumInput({
  value,
  onChange,
  suffix,
  decimals = true,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  decimals?: boolean;
}) {
  return (
    <div className="input-wrap">
      <input
        {...rest}
        className={cx('input', suffix && 'has-suffix', rest.className)}
        inputMode={decimals ? 'decimal' : 'numeric'}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(decimals ? /[^\d.,\s]/g : /[^\d\s]/g, ''))}
      />
      {suffix && <span className="input-suffix">{suffix}</span>}
    </div>
  );
}

export function Select({ value, onChange, options, ...rest }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return (
    <select {...rest} className={cx('input select', rest.className)} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cx('segmented', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={cx('seg', value === o.value && 'is-active')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o} type="button" className={cx('chip', value === o && 'is-active')} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

// ---------- карточки и списки ----------
export function Card({ children, className, onClick, accent }: { children: React.ReactNode; className?: string; onClick?: () => void; accent?: string }) {
  return (
    <div
      className={cx('card', onClick && 'is-clickable', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={accent ? ({ '--card-accent': accent } as any) : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      {children}
    </div>
  );
}

export function Row({ icon, title, subtitle, right, onClick, chevron = !!onClick, className, tone }: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
  tone?: 'danger' | 'warn' | 'ok' | 'info';
}) {
  return (
    <div
      className={cx('row', onClick && 'is-clickable', tone && `tone-${tone}`, className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {icon && <div className="row-icon">{icon}</div>}
      <div className="row-body">
        <div className="row-title">{title}</div>
        {subtitle && <div className="row-sub">{subtitle}</div>}
      </div>
      {right && <div className="row-right">{right}</div>}
      {chevron && <LuChevronRight className="row-chev" />}
    </div>
  );
}

export function Section({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('section', className)}>
      {(title || action) && (
        <div className="section-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'danger' | 'warn' | 'ok' | 'accent' | 'info' }) {
  return <span className={cx('badge', `badge-${tone}`)}>{children}</span>;
}

export function Stat({ label, value, unit, sub }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// Российский госномер
export function Plate({ number, region, size = 'md' }: { number?: string; region?: string; size?: 'sm' | 'md' | 'lg' }) {
  if (!number) return null;
  const m = number.match(/^([А-ЯA-Z])(\d{3})([А-ЯA-Z]{2})$/i);
  return (
    <span className={cx('plate', `plate-${size}`)} aria-label={`Госномер ${number} ${region || ''}`}>
      <span className="plate-main">
        {m ? (
          <>
            <span className="plate-l">{m[1]}</span>
            <span className="plate-d">{m[2]}</span>
            <span className="plate-l">{m[3]}</span>
          </>
        ) : (
          number
        )}
      </span>
      {region && (
        <span className="plate-reg">
          <span className="plate-reg-n">{region}</span>
          <span className="plate-rus">
            RUS <i className="flag" />
          </span>
        </span>
      )}
    </span>
  );
}

// ---------- экран с заголовком (вложенные страницы) ----------
export function Page({ title, back, actions, children, className }: {
  title: React.ReactNode;
  back?: boolean | string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('page', className)}>
      <header className="page-head">
        {back && (
          <IconButton
            label="Назад"
            className="back-btn"
            onClick={() => (typeof back === 'string' ? (location.hash = back) : history.length > 1 ? history.back() : (location.hash = '#/'))}
          >
            <LuChevronLeft />
          </IconButton>
        )}
        <h1>{title}</h1>
        <div className="page-actions">{actions}</div>
      </header>
      <div className="page-body">{children}</div>
    </div>
  );
}

// ---------- модальное окно снизу ----------
export function Sheet({ open, onClose, title, children, footer, wide }: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', key);
    document.body.classList.add('no-scroll');
    // кнопка «назад» на Android закрывает окно
    const marker = { sheet: Math.random() };
    history.pushState(marker, '');
    let closedByPop = false;
    const pop = () => {
      closedByPop = true;
      closeRef.current();
    };
    window.addEventListener('popstate', pop);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.classList.remove('no-scroll');
      window.removeEventListener('popstate', pop);
      if (!closedByPop && history.state === marker) history.back();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('sheet', wide && 'sheet-wide')} role="dialog" aria-modal="true">
        <div className="sheet-head">
          <div className="sheet-grip" />
          {title && <h3>{title}</h3>}
          <IconButton label="Закрыть" onClick={onClose} className="sheet-close">
            <LuX />
          </IconButton>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- тосты ----------
type ToastItem = { id: number; text: string; tone?: 'ok' | 'danger' | 'info'; action?: { label: string; onClick: () => void } };
let toastSeq = 0;
const toastSubs = new Set<(t: ToastItem[]) => void>();
let toasts: ToastItem[] = [];
export function toast(text: string, tone: ToastItem['tone'] = 'ok', action?: ToastItem['action'], ms = 3200) {
  const t = { id: ++toastSeq, text, tone, action };
  toasts = [...toasts, t];
  toastSubs.forEach((f) => f(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastSubs.forEach((f) => f(toasts));
  }, action ? ms * 2 : ms);
}
export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    toastSubs.add(setList);
    return () => {
      toastSubs.delete(setList);
    };
  }, []);
  return (
    <div className="toaster" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx('toast', `toast-${t.tone}`)}>
          <span>{t.text}</span>
          {t.action && (
            <button className="toast-action" onClick={t.action.onClick}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- подтверждение ----------
type ConfirmReq = { title: string; text?: string; ok?: string; danger?: boolean; resolve: (v: boolean) => void };
let confirmSub: ((r: ConfirmReq | null) => void) | null = null;
export function confirmDialog(title: string, opts: { text?: string; ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!confirmSub) return resolve(window.confirm(title));
    confirmSub({ title, ...opts, resolve });
  });
}
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  useEffect(() => {
    confirmSub = setReq;
    return () => {
      confirmSub = null;
    };
  }, []);
  if (!req) return null;
  const done = (v: boolean) => {
    req.resolve(v);
    setReq(null);
  };
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true">
        <h3>{req.title}</h3>
        {req.text && <p>{req.text}</p>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => done(false)}>
            Отмена
          </Button>
          <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => done(true)} autoFocus>
            {req.ok || 'OK'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function useHashRoute() {
  const [hash, setHash] = useState(() => location.hash || '#/');
  useEffect(() => {
    const f = () => setHash(location.hash || '#/');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return hash;
}

export const go = (h: string) => {
  location.hash = h;
};
