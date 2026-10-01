'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Flower2, LoaderCircle, X } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '@/lib/client';

export function Modal({ open, onOpenChange, title, description, children, wide = false, busy = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string;
  children: ReactNode; wide?: boolean; busy?: boolean;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="studio-overlay" />
      <Dialog.Content className={`studio-dialog${wide ? ' studio-dialog-wide' : ''}`}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement; }}
        onCloseAutoFocus={(event) => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }}
        onInteractOutside={(event) => event.preventDefault()}>
        <div className="studio-dialog-heading"><span className="studio-eyebrow">HEY PRIYA · YOUR CREATIVE SPACE</span>
          <Dialog.Title className="studio-dialog-title">{title}</Dialog.Title>
          <Dialog.Description className="studio-muted">{description}</Dialog.Description>
        </div>
        <Dialog.Close className="studio-icon-button studio-dialog-close" aria-label="Close dialog" disabled={busy}><X size={20} /></Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <div className={`studio-field ${className}`}><label><span>{label}</span>{children}</label>{hint && <p className="studio-field-hint">{hint}</p>}</div>;
}

export function ErrorNotice({ message }: { message: string | null }) {
  return message ? <div className="studio-error" role="alert">{message}</div> : null;
}

export function SubmitButton({ pending, children, disabled = false }: { pending: boolean; children: ReactNode; disabled?: boolean }) {
  return <button type="submit" className="studio-button" disabled={pending || disabled}>{pending && <LoaderCircle size={17} className="studio-spin" />}{pending ? 'Saving…' : children}</button>;
}

export function FormFooter({ pending, onCancel, children, disabled = false }: { pending: boolean; onCancel: () => void; children: ReactNode; disabled?: boolean }) {
  return <div className="studio-form-footer"><button type="button" className="studio-button studio-button-secondary" onClick={onCancel} disabled={pending}>Cancel</button><SubmitButton pending={pending} disabled={disabled}>{children}</SubmitButton></div>;
}

export function useTask() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true); setError(null);
    try { await task(); } catch (error) { setError(errorMessage(error)); }
    finally { inFlight.current = false; setPending(false); }
  }
  return { pending, error, run, setError };
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose }: {
  title: string; description: string; confirmLabel: string; onConfirm: () => Promise<unknown>; onClose: () => void;
}) {
  const task = useTask();
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={title} description={description} busy={task.pending}>
    <form onSubmit={(event) => { event.preventDefault(); void task.run(async () => { await onConfirm(); onClose(); }); }}>
      <ErrorNotice message={task.error} /><FormFooter pending={task.pending} onCancel={onClose}>{confirmLabel}</FormFooter>
    </form>
  </Modal>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="studio-empty"><div className="studio-empty-art"><Flower2 size={38} strokeWidth={1} /><span /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="studio-page-heading"><div><span className="studio-eyebrow">{eyebrow}</span><h1>{title}</h1><p className="studio-muted">{description}</p></div>{action && <div className="studio-heading-action">{action}</div>}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'sage' | 'plum' | 'amber' | 'rose' }) {
  return <span className={`studio-badge studio-badge-${tone}`}><span className="studio-badge-dot" />{children}</span>;
}

export function formText(event: FormEvent<HTMLFormElement>, field: string): string {
  return String(new FormData(event.currentTarget).get(field) ?? '').trim();
}

export function prettyDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  if (!date) return 'Not set';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', ...options, timeZone: 'Asia/Kolkata' }).format(new Date(date.length === 10 ? `${date}T12:00:00+05:30` : date));
}