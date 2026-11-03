// Карточка «Сканировать — поля заполнятся сами»: камера, галерея или PDF → распознавание на устройстве.
import React, { useRef, useState } from 'react';
import { LuCamera, LuCircleCheck, LuFileText, LuImage, LuScanText, LuTriangleAlert } from 'react-icons/lu';
import { addAttachment } from '../lib/attachments';
import { ocrSupported, recognizePages, type OcrPass, PAPER_PASSES } from '../lib/ocr';
import { isPdf, readPdf } from '../lib/pdfImport';
import type { ScanMode } from '../lib/scan';
import { Button, Card } from './kit';
import { Scanner, type ScanPage } from './Scanner';

interface Props {
  title: string;
  subtitle: string;
  scanMode?: ScanMode;
  fileName?: string;
  passes?: OcrPass[];
  /** Подсказка в сканере после первой страницы (например, про оборотную сторону). */
  nextHint?: string;
  /** Сколько страниц PDF читать (заказ-наряды бывают длинными). */
  pdfMaxPages?: number;
  onAttachments: (ids: string[]) => void;
  /** Тексты всех проходов распознавания → возвращает названия заполненных полей. */
  onText: (texts: string[]) => string[];
}

export function ScanFill({ title, subtitle, scanMode = 'color', fileName = 'Документ', passes = PAPER_PASSES, nextHint, pdfMaxPages = 3, onAttachments, onText }: Props) {
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<{ files: File[]; gallery: boolean } | null>(null);
  const collected = useRef<ScanPage[]>([]);
  const [progress, setProgress] = useState<{ p: number; label: string } | null>(null);
  const [result, setResult] = useState<{ found: string[]; text: string } | null>(null);
  const [error, setError] = useState('');
  // распознавание страницы начинается сразу после сканера, пока пользователь выравнивает следующее фото
  const early = useRef(new Map<HTMLCanvasElement, { p: Promise<string[]>; prog: number; init: boolean }>());
  const waiting = useRef<HTMLCanvasElement[] | null>(null);

  const showProgress = () => {
    const list = waiting.current;
    if (!list) return;
    const es = list.map((c) => early.current.get(c)!).filter(Boolean);
    const p = es.reduce((a, e) => a + e.prog, 0) / Math.max(1, es.length);
    const init = es.every((e) => e.init);
    setProgress({ p, label: init ? 'Загружаю модель распознавания' : `Распознаю${list.length > 1 ? ` ${list.length} стр.` : ''}` });
  };

  const startOcr = (c: HTMLCanvasElement) => {
    if (early.current.has(c) || !ocrSupported()) return;
    const e = { prog: 0, init: true, p: Promise.resolve([] as string[]) };
    e.p = recognizePages([c], passes, (p, label) => {
      e.prog = p;
      e.init = /модел/i.test(label);
      showProgress();
    });
    e.p.catch(() => {});
    early.current.set(c, e);
  };

  const stamp = () => new Date().toLocaleDateString('ru-RU');

  const finish = async (pages: ScanPage[]) => {
    if (!pages.length) return;
    setError('');
    setResult(null);
    const ids: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const a = await addAttachment(new File([pages[i].blob], `${fileName} ${stamp()}${pages.length > 1 ? ` стр.${i + 1}` : ''}.jpg`, { type: 'image/jpeg' }));
      ids.push(a.id);
    }
    onAttachments(ids);
    const canvases = pages.map((p) => p.canvas).filter(Boolean) as HTMLCanvasElement[];
    await runOcr(canvases);
  };

  const runOcr = async (canvases: HTMLCanvasElement[], ready?: string[]) => {
    if (!ready && !ocrSupported()) {
      setError('Это устройство не поддерживает распознавание — фото сохранено, заполните поля вручную.');
      return;
    }
    try {
      setProgress({ p: 0, label: 'Загружаю модель распознавания' });
      let texts = ready;
      if (!texts) {
        canvases.forEach(startOcr);
        waiting.current = canvases;
        showProgress();
        texts = (await Promise.all(canvases.map((c) => early.current.get(c)!.p))).flat();
      }
      const found = onText(texts);
      setResult({ found, text: texts.join('\n\n— — —\n\n') });
    } catch (e: any) {
      setError('Не удалось распознать: ' + (e?.message || e));
    } finally {
      waiting.current = null;
      early.current.clear();
      setProgress(null);
    }
  };

  // сканер обрабатывает выбранные фото по очереди, страницы копятся
  const onScanDone = async (pages: ScanPage[]) => {
    collected.current.push(...pages);
    pages.forEach((pg) => pg.canvas && startOcr(pg.canvas));
    const rest = queue ? queue.files.slice(1) : [];
    if (rest.length && queue) {
      setQueue({ files: rest, gallery: queue.gallery });
      return;
    }
    setQueue(null);
    const all = collected.current;
    collected.current = [];
    await finish(all);
  };

  const onPick = (files: FileList | null, gallery: boolean) => {
    if (!files?.length) return;
    collected.current = [];
    setQueue({ files: Array.from(files), gallery });
  };

  const onPdf = async (file?: File) => {
    if (!file) return;
    setError('');
    setResult(null);
    try {
      setProgress({ p: 0.02, label: 'Открываю PDF' });
      const a = await addAttachment(file);
      onAttachments([a.id]);
      const pdf = await readPdf(file, { maxPages: pdfMaxPages });
      if (pdf.text.replace(/\s/g, '').length >= 40) await runOcr([], [pdf.text]);
      else await runOcr(pdf.pages);
    } catch (e: any) {
      setError('Не удалось открыть PDF: ' + (e?.message || e));
      setProgress(null);
    }
  };

  return (
    <Card className="ocr-card">
      <div className="ocr-card-head">
        <LuScanText />
        <div>
          <b>{title}</b>
          <span>{subtitle}</span>
        </div>
      </div>
      {progress ? (
        <>
          <div className="small muted">
            {progress.label}… {Math.round(progress.p * 100)}%
          </div>
          <div className="ocr-progress">
            <span style={{ width: `${Math.max(4, progress.p * 100)}%` }} />
          </div>
        </>
      ) : (
        <div className="scan-src">
          <Button variant="primary" icon={<LuCamera />} onClick={() => camRef.current?.click()}>
            Камера
          </Button>
          <Button icon={<LuImage />} onClick={() => galRef.current?.click()}>
            Галерея
          </Button>
          <Button icon={<LuFileText />} onClick={() => pdfRef.current?.click()}>
            PDF
          </Button>
        </div>
      )}
      {result && (
        <>
          {result.found.length ? (
            <div className="ocr-summary">
              <LuCircleCheck />{' '}
              <span>
                {result.found.length > 6 ? `Заполнено полей: ${result.found.length}.` : `Заполнено: ${result.found.join(', ')}.`} Проверьте поля с отметкой «скан» — их можно
                исправить.
              </span>
            </div>
          ) : (
            <div className="ocr-summary text-warn">
              <LuTriangleAlert /> <span>Текст не распознан. Попробуйте снять ровнее и при хорошем свете или заполните вручную.</span>
            </div>
          )}
          <details className="ocr-details">
            <summary>Распознанный текст</summary>
            <div className="ocr-raw">{result.text.trim() || '—'}</div>
          </details>
        </>
      )}
      {error && (
        <div className="small text-warn">
          <LuTriangleAlert /> {error}
        </div>
      )}
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (onPick(e.target.files, false), (e.target.value = ''))} />
      <input ref={galRef} type="file" accept="image/*" multiple hidden onChange={(e) => (onPick(e.target.files, true), (e.target.value = ''))} />
      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => (onPdf(e.target.files?.[0]), (e.target.value = ''))} />
      {queue?.files[0] && (
        <Scanner
          key={queue.files.length + ':' + queue.files[0].name + queue.files[0].size}
          file={queue.files[0]}
          title={title + (queue.files.length > 1 ? ` · ещё фото: ${queue.files.length - 1}` : '')}
          defaultMode={scanMode}
          withOcr
          fromGallery={queue.gallery}
          multi={!queue.gallery || queue.files.length === 1}
          nextHint={queue.files.length === 1 ? nextHint : undefined}
          onDone={onScanDone}
          onCancel={() => {
            const rest = queue.files.slice(1);
            if (rest.length) setQueue({ files: rest, gallery: queue.gallery });
            else {
              setQueue(null);
              const all = collected.current;
              collected.current = [];
              if (all.length) finish(all);
            }
          }}
        />
      )}
    </Card>
  );
}
