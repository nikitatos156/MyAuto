// Экран сканирования: автопоиск краёв, ручная правка углов, выравнивание, режимы, поворот, несколько страниц.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuCheck, LuChevronLeft, LuMaximize, LuPlus, LuRotateCcw, LuRotateCw, LuScanLine, LuX } from 'react-icons/lu';
import { detectQuad, downscale, encode, enhance, fullQuad, loadImageCanvas, orderQuad, rotate, warp, type Pt, type ScanMode } from '../lib/scan';
import { bytes } from '../lib/format';
import { cx } from './kit';

export interface ScanPage {
  blob: Blob; // итоговый файл (JPEG)
  canvas?: HTMLCanvasElement; // выровненный кадр в полном разрешении — для распознавания
}

interface Props {
  file: Blob;
  title?: string;
  defaultMode?: ScanMode;
  withOcr?: boolean;
  multi?: boolean;
  /** Фото из галереи: если края не найдены — берём весь кадр (скриншоты, электронные чеки). */
  fromGallery?: boolean;
  /** Подсказка, что снимать дальше (например, «оборотную сторону»). */
  nextHint?: string;
  onDone: (pages: ScanPage[]) => void;
  onCancel: () => void;
}

export function Scanner({ file, title = 'Сканирование', defaultMode = 'bw', withOcr = false, multi = true, fromGallery, nextHint, onDone, onCancel }: Props) {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [stage, setStage] = useState<'loading' | 'crop' | 'preview'>('loading');
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [quad, setQuad] = useState<Pt[]>([]);
  const [detected, setDetected] = useState(false);
  const [warped, setWarped] = useState<HTMLCanvasElement | null>(null); // для показа (≤2000 px)
  const [warpedFull, setWarpedFull] = useState<HTMLCanvasElement | null>(null); // для распознавания
  const [mode, setMode] = useState<ScanMode>(defaultMode);
  const [rot, setRot] = useState(0);
  const [preview, setPreview] = useState<{ url: string; size: number; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const moreRef = useRef<HTMLInputElement>(null);

  const load = async (f: Blob) => {
    setStage('loading');
    setError('');
    try {
      const c = await loadImageCanvas(f);
      const q = detectQuad(c);
      setSrc(c);
      setQuad(q || fullQuad(c, fromGallery ? 0 : 0.04));
      setDetected(!!q);
      setRot(0);
      setStage('crop');
    } catch (e: any) {
      setError('Не удалось открыть изображение');
    }
  };

  useEffect(() => {
    load(file);
    document.body.classList.add('no-scroll');
    return () => document.body.classList.remove('no-scroll');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // пересчёт превью при смене режима/поворота
  useEffect(() => {
    if (stage !== 'preview' || !warped) return;
    let alive = true;
    setBusy(true);
    const t = setTimeout(async () => {
      let base = warped;
      const turns = ((rot % 4) + 4) % 4;
      for (let i = 0; i < turns; i++) base = rotate(base, 1);
      const out = enhance(base, mode);
      const blob = await encode(out, mode);
      if (!alive) return;
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { url: URL.createObjectURL(blob), size: blob.size, blob };
      });
      setBusy(false);
    }, 30);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [stage, warped, mode, rot]);

  const toPreview = () => {
    if (!src) return;
    setBusy(true);
    setTimeout(() => {
      const full = warp(src, quad, withOcr ? 3200 : 2200, withOcr ? 2600 : 1500);
      setWarpedFull(withOcr ? full : null);
      setWarped(withOcr ? downscale(full, 2000) : full);
      setStage('preview');
    }, 20);
  };

  const finishPage = async (): Promise<ScanPage | null> => {
    if (!preview || !warped) return null;
    let canvas: HTMLCanvasElement | undefined;
    if (withOcr && warpedFull) {
      canvas = warpedFull;
      const turns = ((rot % 4) + 4) % 4;
      for (let i = 0; i < turns; i++) canvas = rotate(canvas, 1);
    }
    return { blob: preview.blob, canvas };
  };

  const done = async () => {
    setBusy(true);
    const p = await finishPage();
    const all = p ? [...pages, p] : pages;
    if (preview) URL.revokeObjectURL(preview.url);
    onDone(all);
  };

  const addMore = async (f?: File) => {
    if (!f) return;
    const p = await finishPage();
    if (p) setPages((x) => [...x, p]);
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setWarped(null);
    setWarpedFull(null);
    load(f);
  };

  return createPortal(
    <div className="scanner" role="dialog" aria-modal="true">
      <div className="scanner-bar">
        {stage === 'preview' ? (
          <button className="icon-btn" aria-label="Назад к углам" onClick={() => setStage('crop')}>
            <LuChevronLeft />
          </button>
        ) : (
          <button className="icon-btn" aria-label="Отмена" onClick={onCancel}>
            <LuX />
          </button>
        )}
        <div className="scanner-title">
          <b>{title}</b>
          <span>
            {stage === 'crop' ? (detected ? 'Края найдены — поправьте углы при необходимости' : 'Перетащите углы к краям листа') : stage === 'preview' ? 'Проверьте результат' : 'Обработка…'}
            {pages.length > 0 && ` · страниц: ${pages.length + 1}`}
            {stage === 'preview' && nextHint && pages.length === 0 && ` · ${nextHint}`}
          </span>
        </div>
      </div>

      <div className="scanner-stage">
        {error && <div className="scanner-msg">{error}</div>}
        {stage === 'loading' && !error && <div className="scanner-msg"><span className="spinner" /> Ищу края документа…</div>}
        {stage === 'crop' && src && <CropView src={src} quad={quad} onChange={setQuad} />}
        {stage === 'preview' && preview && <img className="scanner-preview" src={preview.url} alt="Результат сканирования" />}
        {busy && stage !== 'loading' && <div className="scanner-busy"><span className="spinner" /></div>}
      </div>

      <div className="scanner-controls">
        {stage === 'crop' && (
          <>
            <div className="scanner-row">
              <button className="scan-chip" onClick={() => src && (setQuad(fullQuad(src)), setDetected(false))}>
                <LuMaximize /> Весь кадр
              </button>
              {src && (
                <button className="scan-chip" onClick={() => { const q = detectQuad(src); if (q) { setQuad(q); setDetected(true); } }}>
                  <LuScanLine /> Найти края
                </button>
              )}
            </div>
            <button className="btn btn-primary btn-lg btn-block" onClick={toPreview} disabled={busy}>
              Выровнять
            </button>
          </>
        )}
        {stage === 'preview' && (
          <>
            <div className="scanner-row">
              <div className="segmented scan-seg">
                {([
                  ['bw', 'Документ'],
                  ['color', 'Цвет'],
                  ['original', 'Оригинал'],
                ] as [ScanMode, string][]).map(([m, l]) => (
                  <button key={m} className={cx('seg', mode === m && 'is-active')} onClick={() => setMode(m)}>
                    {l}
                  </button>
                ))}
              </div>
              <button className="icon-btn" aria-label="Повернуть влево" onClick={() => setRot((r) => r - 1)}>
                <LuRotateCcw />
              </button>
              <button className="icon-btn" aria-label="Повернуть вправо" onClick={() => setRot((r) => r + 1)}>
                <LuRotateCw />
              </button>
            </div>
            <div className="scanner-row">
              {preview && <span className="scan-size">{bytes(preview.size)}</span>}
              {multi && (
                <button className="btn btn-secondary btn-md" onClick={() => moreRef.current?.click()} disabled={busy}>
                  <LuPlus /> <span>Ещё страница</span>
                </button>
              )}
              <button className="btn btn-primary btn-md scan-done" onClick={done} disabled={busy || !preview}>
                <LuCheck /> <span>Готово</span>
              </button>
            </div>
          </>
        )}
      </div>
      <input ref={moreRef} type="file" accept="image/*" capture={fromGallery ? undefined : "environment"} hidden onChange={(e) => addMore(e.target.files?.[0])} />
    </div>,
    document.body,
  );
}

function CropView({ src, quad, onChange }: { src: HTMLCanvasElement; quad: Pt[]; onChange: (q: Pt[]) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<number | null>(null);

  useLayoutEffect(() => {
    const fit = () => {
      const box = boxRef.current;
      if (!box) return;
      const bw = box.clientWidth - 24, bh = box.clientHeight - 24;
      const k = Math.min(bw / src.width, bh / src.height);
      setSize({ w: Math.round(src.width * k), h: Math.round(src.height * k) });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [src]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  }, [src, size]);

  const toSrc = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(src.width, Math.max(0, ((e.clientX - r.left) / r.width) * src.width)),
      y: Math.min(src.height, Math.max(0, ((e.clientY - r.top) / r.height) * src.height)),
    };
  };
  const onDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = i;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current === null) return;
    const p = toSrc(e);
    onChange(quad.map((q, i) => (i === drag.current ? p : q)));
  };
  const onUp = () => {
    if (drag.current !== null) onChange(orderQuad(quad));
    drag.current = null;
  };
  const k = size.w ? src.width / size.w : 1;
  const r = 16 * k;
  const pts = quad.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <div className="crop-box" ref={boxRef}>
      {size.w > 0 && (
        <div className="crop-inner" style={{ width: size.w, height: size.h }}>
          <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${src.width} ${src.height}`}
            width={size.w}
            height={size.h}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <defs>
              <mask id="crop-mask">
                <rect width={src.width} height={src.height} fill="white" />
                <polygon points={pts} fill="black" />
              </mask>
            </defs>
            <rect width={src.width} height={src.height} fill="rgba(0,0,0,0.45)" mask="url(#crop-mask)" />
            <polygon points={pts} fill="rgba(255,122,26,0.08)" stroke="#FF7A1A" strokeWidth={3 * k} strokeLinejoin="round" />
            {quad.map((p, i) => (
              <g key={i} onPointerDown={onDown(i)} style={{ cursor: 'grab', touchAction: 'none' }}>
                <circle cx={p.x} cy={p.y} r={r * 2.2} fill="transparent" />
                <circle cx={p.x} cy={p.y} r={r} fill="rgba(255,122,26,0.25)" stroke="#fff" strokeWidth={3 * k} />
                <circle cx={p.x} cy={p.y} r={r * 0.3} fill="#fff" />
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
