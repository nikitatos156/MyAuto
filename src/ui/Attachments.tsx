// Чеки и фото: добавление (камера/галерея/файл), миниатюры и просмотр.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuCamera, LuFileText, LuImage, LuPaperclip, LuShare2, LuTrash2, LuX } from 'react-icons/lu';
import { addAttachment, attachmentUrl, getAttachment } from '../lib/attachments';
import { exportFile } from '../lib/native';
import { bytes } from '../lib/format';
import { IconButton, toast } from './kit';
import { Scanner, type ScanPage } from './Scanner';
import type { ScanMode } from '../lib/scan';
import type { Attachment } from '../data/types';

export interface PickerProps {
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  scanMode?: ScanMode; // режим сканера по умолчанию
  withOcr?: boolean;
  onScanned?: (pages: ScanPage[]) => void; // для распознавания текста
  onPdf?: (file: File) => void; // PDF из почты (электронный чек и т.п.)
  scanTitle?: string;
}

/**
 * Добавление вложений: камера, галерея (несколько фото сразу) или файл (PDF).
 * Фото проходят через сканер: края, перспектива, тени, сжатие.
 */
export function AttachmentPicker({ value, onChange, label = 'Чеки и фото', scanMode = 'bw', withOcr, onScanned, onPdf, scanTitle }: PickerProps) {
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<{ file: File; gallery: boolean }[]>([]);
  const valueRef = useRef(value);
  valueRef.current = value;

  const onFiles = async (files: FileList | null, gallery: boolean) => {
    if (!files?.length) return;
    const list = Array.from(files);
    for (const r of [camRef, galRef, fileRef]) if (r.current) r.current.value = '';
    const images = list.filter((f) => f.type.startsWith('image/') && f.type !== 'image/gif');
    const others = list.filter((f) => !images.includes(f));
    if (others.length) {
      setBusy(true);
      try {
        const ids: string[] = [];
        for (const f of others) ids.push((await addAttachment(f)).id);
        onChange([...valueRef.current, ...ids]);
        for (const f of others) if (onPdf && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) onPdf(f);
      } catch (e: any) {
        toast(e?.message || 'Не удалось добавить файл', 'danger');
      } finally {
        setBusy(false);
      }
    }
    if (images.length) setQueue((q) => [...q, ...images.map((file) => ({ file, gallery }))]);
  };

  const onScanDone = async (pages: ScanPage[]) => {
    setQueue((q) => q.slice(1));
    if (!pages.length) return;
    setBusy(true);
    try {
      const ids: string[] = [];
      const stamp = new Date().toLocaleDateString('ru-RU');
      for (let i = 0; i < pages.length; i++) {
        const name = `Скан ${stamp}${pages.length > 1 ? ` стр.${i + 1}` : ''}.jpg`;
        ids.push((await addAttachment(new File([pages[i].blob], name, { type: 'image/jpeg' }))).id);
      }
      onChange([...valueRef.current, ...ids]);
      onScanned?.(pages);
    } catch (e: any) {
      toast(e?.message || 'Не удалось сохранить скан', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="att-picker">
      <div className="field-label">{label}</div>
      <div className="att-grid">
        {value.map((id) => (
          <Thumb key={id} id={id} onRemove={() => onChange(value.filter((x) => x !== id))} />
        ))}
        <button type="button" className="att-add" onClick={() => camRef.current?.click()} disabled={busy}>
          <LuCamera />
          <span>Камера</span>
        </button>
        <button type="button" className="att-add" onClick={() => galRef.current?.click()} disabled={busy}>
          <LuImage />
          <span>Галерея</span>
        </button>
        <button type="button" className="att-add" onClick={() => fileRef.current?.click()} disabled={busy}>
          <LuPaperclip />
          <span>PDF / файл</span>
        </button>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target.files, false)} />
      <input ref={galRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files, true)} />
      <input ref={fileRef} type="file" accept="application/pdf,.pdf,image/*" multiple hidden onChange={(e) => onFiles(e.target.files, true)} />
      {queue[0] && (
        <Scanner
          key={queue.length + ':' + queue[0].file.name + queue[0].file.size}
          file={queue[0].file}
          title={(scanTitle || label) + (queue.length > 1 ? ` · ещё фото: ${queue.length - 1}` : '')}
          defaultMode={scanMode}
          withOcr={withOcr}
          fromGallery={queue[0].gallery}
          multi={!queue[0].gallery}
          onDone={onScanDone}
          onCancel={() => setQueue((q) => q.slice(1))}
        />
      )}
    </div>
  );
}

function useAtt(id: string) {
  const [att, setAtt] = useState<Attachment | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getAttachment(id).then((a) => alive && setAtt(a || null));
    attachmentUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return { att, url };
}

export function Thumb({ id, onRemove, onOpen }: { id: string; onRemove?: () => void; onOpen?: () => void }) {
  const { att, url } = useAtt(id);
  const [open, setOpen] = useState(false);
  if (!att) return <div className="att-thumb is-loading" />;
  const img = att.type.startsWith('image/');
  return (
    <>
      <div className="att-thumb" onClick={() => (onOpen ? onOpen() : setOpen(true))} role="button" tabIndex={0}>
        {img && url ? <img src={url} alt={att.name} loading="lazy" /> : <div className="att-file"><LuFileText /><span>{att.name}</span></div>}
        {onRemove && (
          <button
            type="button"
            className="att-remove"
            aria-label="Удалить вложение"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <LuX />
          </button>
        )}
      </div>
      {open && <Viewer att={att} url={url} onClose={() => setOpen(false)} onRemove={onRemove} />}
    </>
  );
}

export function AttachmentStrip({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className="att-grid">
      {ids.map((id) => (
        <Thumb key={id} id={id} />
      ))}
    </div>
  );
}

function Viewer({ att, url, onClose, onRemove }: { att: Attachment; url: string | null; onClose: () => void; onRemove?: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const share = async () => {
    try {
      await exportFile(att.blob, att.name.includes('.') ? att.name : `${att.name}.${att.type.split('/')[1] || 'bin'}`);
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast('Не удалось поделиться файлом', 'danger');
    }
  };
  return createPortal(
    <div className="viewer" onClick={onClose}>
      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="viewer-name">
          {att.name} · {bytes(att.size)}
        </span>
        <IconButton label="Поделиться" onClick={share}>
          <LuShare2 />
        </IconButton>
        {onRemove && (
          <IconButton
            label="Удалить"
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            <LuTrash2 />
          </IconButton>
        )}
        <IconButton label="Закрыть" onClick={onClose}>
          <LuX />
        </IconButton>
      </div>
      <div className="viewer-body" onClick={(e) => e.stopPropagation()}>
        {att.type.startsWith('image/') && url ? (
          <img src={url} alt={att.name} />
        ) : att.type === 'application/pdf' && url ? (
          <div className="viewer-file">
            <LuFileText size={48} />
            <p>{att.name}</p>
            <a className="btn btn-primary btn-md" href={url} target="_blank" rel="noopener">
              Открыть PDF
            </a>
          </div>
        ) : (
          <div className="viewer-file">
            <LuFileText size={48} />
            <p>{att.name}</p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
