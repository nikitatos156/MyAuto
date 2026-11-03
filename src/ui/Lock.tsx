// Экран блокировки и ввод PIN-кода (установка, смена, проверка).
import React, { useEffect, useRef, useState } from 'react';
import { LuDelete, LuFingerprint, LuScanFace } from 'react-icons/lu';
import { PIN_LENGTH, bioName, bioUnlock, bioVerify, checkPin, lockConfig, setPin, unlock } from '../lib/lock';
import { isNative } from '../lib/native';
import { Sheet, cx, toast } from './kit';

const BioIcon = () => (isNative() ? <LuFingerprint /> : <LuScanFace />);

/** Точки и цифровая клавиатура. */
function PinPad({ value, onChange, onBio, disabled, error }: { value: string; onChange: (v: string) => void; onBio?: () => void; disabled?: boolean; error?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^\d$/.test(e.key) && value.length < PIN_LENGTH) onChange(value + e.key);
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [value, onChange, disabled]);
  const press = (d: string) => !disabled && value.length < PIN_LENGTH && onChange(value + d);
  return (
    <>
      <div className={cx('pin-dots', error && 'is-error')} aria-label={`Введено цифр: ${value.length} из ${PIN_LENGTH}`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={cx('pin-dot', i < value.length && 'is-on')} />
        ))}
      </div>
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="pin-key" onClick={() => press(d)} disabled={disabled}>
            {d}
          </button>
        ))}
        {onBio ? (
          <button type="button" className="pin-key pin-key-icon" onClick={onBio} aria-label={bioName()}>
            <BioIcon />
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="pin-key" onClick={() => press('0')} disabled={disabled}>
          0
        </button>
        <button type="button" className="pin-key pin-key-icon" onClick={() => onChange(value.slice(0, -1))} aria-label="Стереть" disabled={disabled || !value}>
          <LuDelete />
        </button>
      </div>
    </>
  );
}

/** Полноэкранная блокировка. Приложение под ней остаётся открытым (не теряются начатые формы). */
export function LockScreen() {
  const cfg = lockConfig();
  const [pin, setPinValue] = useState('');
  const [error, setError] = useState(false);
  const [msg, setMsg] = useState('Введите PIN-код');
  const fails = useRef(0);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [, tick] = useState(0);
  const bio = cfg.bio ? async () => void (await bioUnlock()) : undefined;

  // на Android отпечаток предлагается сразу; на iPhone Face ID запускается кнопкой (так требует Safari)
  useEffect(() => {
    if (cfg.bio && isNative()) bioUnlock();
  }, []);

  useEffect(() => {
    if (!blockedUntil) return;
    const t = setInterval(() => {
      if (Date.now() >= blockedUntil) {
        setBlockedUntil(0);
        setMsg('Введите PIN-код');
      } else tick((x) => x + 1);
    }, 500);
    return () => clearInterval(t);
  }, [blockedUntil]);

  const onChange = async (v: string) => {
    setError(false);
    setPinValue(v);
    if (v.length < PIN_LENGTH) return;
    if (await checkPin(v)) {
      fails.current = 0;
      unlock();
      return;
    }
    fails.current++;
    setError(true);
    setTimeout(() => setPinValue(''), 350);
    if (fails.current >= 5) {
      fails.current = 0;
      setBlockedUntil(Date.now() + 30000);
    } else setMsg(`Неверный PIN-код · осталось попыток: ${5 - fails.current}`);
  };

  const left = blockedUntil ? Math.ceil((blockedUntil - Date.now()) / 1000) : 0;

  return (
    <div className="lock" role="dialog" aria-modal="true" aria-label="Вход в My Auto">
      <div className="lock-head">
        <img src="icons/icon-192.png" alt="" width={64} height={64} />
        <b>My Auto</b>
        <span className={cx('lock-msg', error && 'text-danger')}>{left ? `Слишком много попыток. Подождите ${left} с` : msg}</span>
      </div>
      <PinPad value={pin} onChange={onChange} onBio={bio} disabled={!!left} error={error} />
      <button
        type="button"
        className="link lock-forgot"
        onClick={() =>
          toast(
            cfg.bio
              ? `Войдите через «${bioName()}» и задайте новый PIN в настройках`
              : 'Без PIN-кода войти нельзя. Можно очистить данные приложения в настройках телефона и восстановить их из резервной копии',
            'info',
            undefined,
            7000,
          )
        }
      >
        Забыли PIN?
      </button>
    </div>
  );
}

/**
 * Окно с PIN-кодом:
 *  set    — придумать и повторить новый PIN;
 *  verify — подтвердить текущий (можно биометрией).
 */
export function PinSheet({ open, mode, title, onClose, onDone }: { open: boolean; mode: 'set' | 'verify'; title?: string; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<'first' | 'repeat'>('first');
  const [first, setFirst] = useState('');
  const [pin, setPinValue] = useState('');
  const [error, setError] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep('first');
    setFirst('');
    setPinValue('');
    setError(false);
    setMsg(mode === 'set' ? 'Придумайте PIN-код из 4 цифр' : 'Введите текущий PIN-код');
  }, [open, mode]);

  const fail = (text: string) => {
    setError(true);
    setMsg(text);
    setTimeout(() => setPinValue(''), 350);
  };

  const onChange = async (v: string) => {
    setError(false);
    setPinValue(v);
    if (v.length < PIN_LENGTH) return;
    if (mode === 'verify') {
      if (await checkPin(v)) onDone();
      else fail('Неверный PIN-код');
      return;
    }
    if (step === 'first') {
      if (/^(\d)\1+$/.test(v) || '0123456789'.includes(v) || '9876543210'.includes(v)) return fail('Слишком простой код — выберите другой');
      setFirst(v);
      setStep('repeat');
      setMsg('Повторите PIN-код');
      setTimeout(() => setPinValue(''), 150);
      return;
    }
    if (v !== first) {
      setStep('first');
      setFirst('');
      return fail('Коды не совпали — придумайте PIN-код ещё раз');
    }
    await setPin(v);
    onDone();
  };

  const bio = mode === 'verify' && lockConfig().bio ? async () => void ((await bioVerify('Подтвердите действие')) && onDone()) : undefined;

  return (
    <Sheet open={open} onClose={onClose} title={title || (mode === 'set' ? 'PIN-код' : 'Подтверждение')}>
      <div className="pin-sheet">
        <span className={cx('lock-msg', error && 'text-danger')}>{msg}</span>
        <PinPad value={pin} onChange={onChange} onBio={bio} error={error} />
      </div>
    </Sheet>
  );
}
