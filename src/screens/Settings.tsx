import React, { useEffect, useRef, useState } from 'react';
import {
  LuBell, LuCalendarPlus, LuCodeXml, LuDatabaseBackup, LuDownload, LuInfo, LuMonitor, LuMoon, LuRefreshCw, LuRotateCcw, LuSmartphone, LuSun, LuUpload,
} from 'react-icons/lu';
import { getSetting, setSetting, useQuery } from '../data/db';
import { APP_VERSION, BUILD_DATE, COMMIT, NATIVE_VERSION } from '../env';
import { backupNow, parseBackup, restoreBackup } from '../lib/backup';
import { bytes, dateShort, timeShort } from '../lib/format';
import { isIOS, isNative, isStandalone, listDocuments, nativeInfo, openExternal, platform, readDocument } from '../lib/native';
import { exportCalendar, notificationPermission, refreshReminders, requestNotificationPermission } from '../lib/notify';
import { REPO_PAGE, checkForUpdates, applyUpdate, canAutoUpdate, downloadLatestApk, getUpdateState, onUpdateState, type UpdateState } from '../lib/updates';
import { applyTheme } from '../lib/theme';
import { Badge, Button, Card, Page, Row, Section, Segmented, Toggle, confirmDialog, toast } from '../ui/kit';
import { bioAvailable, bioName, disableBio, disableLock, enrollBio, setLockTimeout, useLockConfig, type BioKind } from '../lib/lock';
import { PinSheet } from '../ui/Lock';
import { LuKeyRound, LuLock } from 'react-icons/lu';

export default function Settings() {
  const settings = useQuery(async () => ({
    lastBackupAt: await getSetting<number>('lastBackupAt', 0),
    autoBackup: await getSetting<boolean>('autoBackup', true),
    notifications: await getSetting<boolean>('notifications', true),
    theme: await getSetting<string>('theme', 'system'),
  }), [], ['settings']);
  const [upd, setUpd] = useState<UpdateState>(getUpdateState());
  const [perm, setPerm] = useState('');
  const [native, setNative] = useState<{ version: string; build: string } | null>(null);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [autoFiles, setAutoFiles] = useState<{ name: string; dir: string; size?: number }[]>([]);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => onUpdateState(setUpd), []);
  useEffect(() => {
    notificationPermission().then(setPerm);
    nativeInfo().then(setNative);
    listDocuments().then(setAutoFiles).catch(() => {});
    (async () => {
      const est = await navigator.storage?.estimate?.().catch(() => undefined);
      const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
      setStorage({ usage: est?.usage, quota: est?.quota, persisted });
    })();
  }, []);

  if (!settings) return <Page title="Настройки" back="#/more"><div /></Page>;

  const doBackup = async () => {
    setBusy('backup');
    try {
      const r = await backupNow();
      toast(`Копия создана · ${bytes(r.size)}${r.saved ? ' · сохранена в Документы/MyAuto' : ''}`);
      listDocuments().then(setAutoFiles).catch(() => {});
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast('Ошибка: ' + (e?.message || e), 'danger');
      else await setSetting('lastBackupAt', Date.now());
    } finally {
      setBusy('');
    }
  };

  const doRestoreText = async (text: string) => {
    try {
      const file = parseBackup(text);
      const ok = await confirmDialog('Восстановить из копии?', {
        text: `Копия от ${dateShort(file.createdAt)} ${timeShort(file.createdAt)}. Текущие данные будут заменены данными из копии.`,
        ok: 'Восстановить',
        danger: true,
      });
      if (!ok) return;
      setBusy('restore');
      await restoreBackup(file, 'replace');
      await refreshReminders();
      toast('Данные восстановлены');
      setTimeout(() => location.reload(), 600);
    } catch (e: any) {
      toast(e?.message || 'Не удалось восстановить', 'danger');
    } finally {
      setBusy('');
    }
  };

  const onFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    await doRestoreText(await f.text());
  };

  const toggleNotifications = async (v: boolean) => {
    if (v && isNative() && perm !== 'granted') {
      const ok = await requestNotificationPermission();
      setPerm(ok ? 'granted' : 'denied');
      if (!ok) toast('Разрешите уведомления в настройках Android', 'danger');
    }
    await setSetting('notifications', v);
    await refreshReminders();
  };

  const setTheme = async (t: string) => {
    await setSetting('theme', t);
    applyTheme(t);
  };

  const plat = platform();
  const updText =
    upd.kind === 'checking' ? 'Проверяю…'
    : upd.kind === 'downloading' ? `Загружаю ${upd.version}…`
    : upd.kind === 'latest' ? 'Установлена последняя версия'
    : upd.kind === 'web-ready' ? `Готово обновление${upd.version ? ' ' + upd.version : ''}`
    : upd.kind === 'apk' ? `Новая версия APK ${upd.version}`
    : upd.kind === 'error' ? `Не удалось проверить: ${upd.message}`
    : '';

  return (
    <Page title="Настройки" back="#/more">
      <Section title="Приложение">
        <Card className="about-card">
          <div className="about-logo" aria-hidden>
            <img src="icons/icon-192.png" alt="" width={56} height={56} />
          </div>
          <div>
            <b>My Auto</b>
            <div className="muted small">
              Версия {APP_VERSION}
              {BUILD_DATE && ` · сборка ${BUILD_DATE}`}
              {COMMIT && ` · ${COMMIT}`}
            </div>
            <div className="muted small">
              {plat === 'android'
                ? `Android · APK ${native?.version || ''} (натив. ${native ? Math.floor(parseInt(native.build) / 100000) || NATIVE_VERSION : NATIVE_VERSION})`
                : isStandalone() ? (isIOS() ? 'iPhone · приложение на экране «Домой»' : 'Веб-приложение') : 'Браузер'}
            </div>
          </div>
        </Card>
        <div className="list">
          <Row
            icon={<LuRefreshCw />}
            title="Проверить обновления"
            subtitle={updText || (canAutoUpdate() ? 'Обновления приходят автоматически' : 'В этой сборке автообновление выключено')}
            right={upd.kind === 'web-ready' || upd.kind === 'apk' ? <Badge tone="accent">новое</Badge> : undefined}
            onClick={() => (upd.kind === 'web-ready' || upd.kind === 'apk' ? applyUpdate() : checkForUpdates(true))}
          />
          {plat !== 'android' && !isIOS() && (
            <Row icon={<LuDownload />} title="Скачать APK для Android" subtitle="Последняя версия на GitHub" onClick={() => downloadLatestApk()} />
          )}
          <Row icon={<LuCodeXml />} title="Исходный код" subtitle="Открытый проект на GitHub · лицензия MIT" onClick={() => openExternal(REPO_PAGE)} />
        </div>
        {isIOS() && !isStandalone() && (
          <Card className="muted-card">
            <LuSmartphone /> Чтобы получить приложение на iPhone: нажмите «Поделиться» в Safari → «На экран „Домой“». Обновления будут приходить сами.
          </Card>
        )}
      </Section>

      <Section title="Резервные копии">
        <div className="list">
          <Row
            icon={<LuDatabaseBackup />}
            title="Создать копию сейчас"
            subtitle={settings.lastBackupAt ? `Последняя: ${dateShort(settings.lastBackupAt)} ${timeShort(settings.lastBackupAt)}` : 'Копий ещё не было'}
            right={busy === 'backup' ? <span className="spinner" /> : undefined}
            onClick={doBackup}
          />
          <div className="row">
            <Toggle
              checked={settings.autoBackup}
              onChange={(v) => setSetting('autoBackup', v)}
              label="Автоматически раз в месяц"
              hint={isNative() ? 'Тихо сохраняется в «Документы/MyAuto», хранятся 6 последних' : 'iPhone не разрешает сохранять файлы без вас — раз в месяц появится напоминание, копия делается в одно касание'}
            />
          </div>
          <Row icon={<LuUpload />} title="Восстановить из файла" subtitle="Файл myauto-backup-….json" onClick={() => fileRef.current?.click()} />
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files)} />
        {autoFiles.length > 0 && (
          <>
            <div className="sub-head">Копии на телефоне</div>
            <div className="list">
              {autoFiles.slice(0, 6).map((f) => (
                <Row
                  key={f.name + f.dir}
                  icon={<LuRotateCcw />}
                  title={f.name.replace('myauto-backup-', '').replace('.json', '').replace('_', ' ')}
                  subtitle={f.size ? bytes(f.size) : f.dir}
                  onClick={async () => doRestoreText(await readDocument(f.name, f.dir))}
                />
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title="Напоминания">
        <div className="list">
          <div className="row">
            <Toggle
              checked={settings.notifications}
              onChange={toggleNotifications}
              label={<><LuBell /> Неоплаченные штрафы, ТО и документы</>}
              hint={
                isNative()
                  ? perm === 'granted' ? 'Уведомления включены: за 5 и 2 дня до конца скидки на штраф, за 30/14/3 дня до ТО, за 30/7 дней до окончания полисов'
                  : 'Нужно разрешение на уведомления'
                  : 'В веб-версии напоминания показываются на главном экране и значком на иконке. Для уведомлений на iPhone добавьте сроки в Календарь.'
              }
            />
          </div>
          <Row
            icon={<LuCalendarPlus />}
            title="Добавить сроки в Календарь"
            subtitle="ТО, скидки по штрафам, окончание ОСАГО/КАСКО/ВУ — с напоминаниями"
            onClick={async () => {
              try {
                const n = await exportCalendar();
                toast(`Событий: ${n}`);
              } catch (e: any) {
                if (e?.name !== 'AbortError') toast(e?.message || 'Ошибка', 'danger');
              }
            }}
          />
        </div>
      </Section>

      <SecuritySection />

      <Section title="Оформление">
        <Segmented
          value={settings.theme as any}
          onChange={setTheme}
          options={[
            { value: 'system', label: <><LuMonitor /> Авто</> },
            { value: 'light', label: <><LuSun /> Светлая</> },
            { value: 'dark', label: <><LuMoon /> Тёмная</> },
          ]}
        />
      </Section>

      <Section title="Хранилище">
        <Card className="muted-card">
          <LuInfo /> Данные хранятся только на этом устройстве
          {storage.usage !== undefined && ` · занято ${bytes(storage.usage)}`}
          {storage.persisted === false && !isNative() && (
            <>
              {' · '}
              <button
                className="link"
                onClick={async () => {
                  const ok = await navigator.storage?.persist?.();
                  setStorage((s) => ({ ...s, persisted: ok }));
                  toast(ok ? 'Хранилище защищено от очистки' : 'Браузер не разрешил', ok ? 'ok' : 'danger');
                }}
              >
                защитить от очистки
              </button>
            </>
          )}
          . Делайте резервные копии, чтобы перенести данные на другой телефон.
        </Card>
      </Section>
    </Page>
  );
}

/** Защита: PIN-код, отпечаток / Face ID, через сколько снова спрашивать. */
function SecuritySection() {
  const cfg = useLockConfig();
  const [bio, setBio] = useState<BioKind>(null);
  const [sheet, setSheet] = useState<null | 'set' | 'change' | 'off' | 'bio-off'>(null);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    bioAvailable().then(setBio);
  }, []);

  const close = () => {
    setSheet(null);
    setVerified(false);
  };
  const done = async () => {
    if (sheet === 'set') {
      toast('PIN-код установлен');
      close();
      if (bio && (await confirmDialog(`Входить через «${bioName()}»?`, { text: 'PIN-код останется запасным способом входа.', ok: 'Включить' }))) toggleBio(true);
    } else if (sheet === 'change') {
      if (!verified) return setVerified(true); // текущий подтверждён → придумываем новый
      toast('PIN-код изменён');
      close();
    } else if (sheet === 'off') {
      await disableLock();
      toast('Защита выключена');
      close();
    } else if (sheet === 'bio-off') {
      await disableBio();
      close();
    }
  };

  const toggleBio = async (v: boolean) => {
    if (!v) return setSheet('bio-off');
    try {
      if (await enrollBio()) toast(`Вход через «${bioName()}» включён`);
      else toast('Не удалось подтвердить личность', 'danger');
    } catch (e: any) {
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') toast('Не получилось: ' + (e?.message || e), 'danger');
    }
  };

  const mode = sheet === 'set' || (sheet === 'change' && verified) ? 'set' : 'verify';
  return (
    <Section title="Защита">
      <div className="list">
        <div className="row">
          <Toggle
            checked={cfg.enabled}
            onChange={(v) => setSheet(v ? 'set' : 'off')}
            label={<><LuLock /> Вход по PIN-коду</>}
            hint="Приложение спрашивает код при запуске и после паузы. Защищает документы и фото от посторонних глаз"
          />
        </div>
        {cfg.enabled && bio && (
          <div className="row">
            <Toggle checked={!!cfg.bio} onChange={toggleBio} label={bioName()} hint="Вместо ввода PIN-кода" />
          </div>
        )}
        {cfg.enabled && <Row icon={<LuKeyRound />} title="Сменить PIN-код" onClick={() => setSheet('change')} />}
      </div>
      {cfg.enabled && (
        <>
          <div className="sub-head">Спрашивать снова, если приложение было свёрнуто</div>
          <Segmented
            value={String(cfg.timeout)}
            onChange={(v) => setLockTimeout(+v)}
            options={[
              { value: '0', label: 'Сразу' },
              { value: '60000', label: '1 мин' },
              { value: '300000', label: '5 мин' },
              { value: '900000', label: '15 мин' },
            ]}
          />
          <p className="muted small">Камера, галерея и «Поделиться» блокировку не вызывают. Если забыть PIN-код без включённой биометрии, войти можно только очистив данные приложения и восстановив их из резервной копии.</p>
        </>
      )}
      <PinSheet
        open={!!sheet}
        mode={mode}
        title={sheet === 'off' ? 'Выключить защиту' : sheet === 'bio-off' ? `Выключить «${bioName()}»` : sheet === 'change' ? (verified ? 'Новый PIN-код' : 'Текущий PIN-код') : 'Новый PIN-код'}
        onClose={close}
        onDone={done}
      />
    </Section>
  );
}
