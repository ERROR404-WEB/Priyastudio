'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ArrowRight, FileCheck2, Plus, ReceiptText } from 'lucide-react';
import { collaborationUsesDirectTracking, formatMoney, invoicePaid, invoiceStatus, invoiceTotal, todayISO } from '@/lib/domain';
import { invoiceNotes } from '@/lib/invoice-document';
import type { Invoice, Payment } from '@/lib/types';
import { InvoiceDownload } from '@/components/invoice-pdf';
import { Badge, ConfirmDialog, EmptyState, ErrorNotice, Field, FormFooter, Modal, PageHeading, formText, prettyDate, useTask } from '@/components/ui/studio-primitives';
import { initialItems, LineItemsEditor, parseItems } from './forms';
import { matchesSearch, useStudio } from './store';

/** Keep time-based invoiceStatus available to existing integrations, not in the UI. */
function paymentStatus(invoice: Invoice, payments: Payment[]) {
  const status = invoiceStatus(invoice, payments);
  return status === 'overdue' ? invoicePaid(invoice, payments) > 0 ? 'partial' : 'unpaid' : status;
}

function InvoiceForm({ onClose }: { onClose: () => void }) {
  const { state, mutate } = useStudio();
  const task = useTask();
  const [id] = useState(() => crypto.randomUUID());
  const [items, setItems] = useState(() => initialItems());
  const [collaborationId, setCollaborationId] = useState('');
  const [billTo, setBillTo] = useState('');
  const [issueDate, setIssueDate] = useState(todayISO());
  const ready = !!state.profile.issuerDetails.trim() && !!state.profile.paymentDetails.trim();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const text = (name: string) => formText(event, name);
    const dueDate = text('dueDate'); const notes = text('notes');
    void task.run(async () => {
      const collaboration = state.collaborations.find((item) => item.id === collaborationId);
      if (!collaboration) throw new Error('Choose a collaboration before saving.');
      if (!ready) throw new Error('Complete your issuer and payment details in Settings before billing.');
      if (dueDate < issueDate) throw new Error('The due date cannot be before the issue date.');
      await mutate({ type: 'invoice.create', data: { id, brandId: collaboration.brandId, collaborationId, billTo: billTo.trim(), issuer: state.profile.issuerDetails.trim(), issueDate, dueDate, notes: invoiceNotes(notes, state.profile.paymentDetails), items: parseItems(items) } });
      onClose();
    });
  }
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Good work, thoughtfully billed." description="Start with a draft. Check every detail before issuing an invoice." wide busy={task.pending}>
    {!ready ? <EmptyState title="Make it officially yours." description="Add your legal issuer details and payment instructions in Settings before creating an invoice. We never invent billing information." action={<Link className="studio-button" href="/studio/settings" onClick={onClose}>Complete billing details <ArrowRight size={16} /></Link>} /> : !state.collaborations.length ? <EmptyState title="Give this invoice a story." description="Create a collaboration first so the invoice belongs to the right brand." action={<Link className="studio-button" href="/studio/collaborations?new=1" onClick={onClose}>New collaboration <ArrowRight size={16} /></Link>} /> : <form onSubmit={submit}><fieldset disabled={task.pending} className="studio-fieldset"><div className="studio-form-grid"><Field label="Collaboration" className="studio-span-2"><select className="studio-input" required value={collaborationId} onChange={(event) => {
      setCollaborationId(event.target.value); const collaboration = state.collaborations.find((item) => item.id === event.target.value); const brand = state.brands.find((item) => item.id === collaboration?.brandId);
      setBillTo(brand ? [brand.name, brand.contact, brand.email].filter(Boolean).join('\n') : '');
    }}><option value="" disabled>Choose a collaboration</option>{state.collaborations.map((item) => <option key={item.id} value={item.id}>{item.title} · {state.brands.find((brand) => brand.id === item.brandId)?.name}</option>)}</select></Field><Field label="Bill to" hint="A saved snapshot; include the brand’s legal billing name and address."><textarea className="studio-input" required rows={4} maxLength={5000} value={billTo} onChange={(event) => setBillTo(event.target.value)} /></Field><Field label="Issuer snapshot" hint="Copied from Settings and preserved on this invoice."><textarea className="studio-input" readOnly rows={4} value={state.profile.issuerDetails} /></Field><Field label="Issue date"><input className="studio-input" type="date" required value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></Field><Field label="Due date"><input className="studio-input" type="date" name="dueDate" required min={issueDate} defaultValue={todayISO()} /></Field></div><LineItemsEditor items={items} onChange={setItems} /><Field label="Invoice notes" hint="This is a basic INR invoice, not automatically a GST tax invoice."><textarea className="studio-input" name="notes" rows={3} maxLength={5000} placeholder="Thank you for creating something lovely together." /></Field></fieldset><ErrorNotice message={task.error} /><FormFooter pending={task.pending} onCancel={onClose}>Create draft invoice</FormFooter></form>}
  </Modal>;
}

function InvoiceDetails({ invoice, onClose, onIssue, onVoid }: { invoice: Invoice; onClose: () => void; onIssue: () => void; onVoid: () => void }) {
  const { state, demo } = useStudio();
  const paid = invoicePaid(invoice, state.payments); const total = invoiceTotal(invoice);
  const status = paymentStatus(invoice, state.payments);
  const collaboration = state.collaborations.find((item) => item.id === invoice.collaborationId);
  const usesDirectTracking = collaboration && collaborationUsesDirectTracking(collaboration, state.payments);
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={invoice.number || 'Your draft invoice.'} description={`${state.brands.find((brand) => brand.id === invoice.brandId)?.name} · ${state.collaborations.find((item) => item.id === invoice.collaborationId)?.title}`} wide>
    <div className="studio-document-meta"><Badge tone={status === 'paid' ? 'sage' : 'plum'}>{status === 'partial' ? 'Partially paid' : status}</Badge><span>Issued {prettyDate(invoice.issueDate)} · Due {prettyDate(invoice.dueDate, { year: 'numeric' })}</span></div>
    <div className="studio-snapshot-grid"><section><span className="studio-eyebrow">FROM</span><p className="studio-preline">{invoice.issuer || 'Issuer not added'}</p></section><section><span className="studio-eyebrow">BILL TO</span><p className="studio-preline">{invoice.billTo || 'Billing details not added'}</p></section></div>
    <div className="studio-table-scroll" role="region" aria-label="Invoice line items" tabIndex={0}><table className="studio-table studio-document-table"><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>{invoice.items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{item.quantity}</td><td>{formatMoney(item.unitPrice)}</td><td>{formatMoney(item.quantity * item.unitPrice)}</td></tr>)}</tbody></table></div>
    <div className="studio-invoice-totals"><div><span>Invoice total</span><strong>{formatMoney(total)}</strong></div><div><span>Receipts received</span><strong>{formatMoney(paid)}</strong></div><div><span>{invoice.status === 'issued' ? 'Still to receive' : 'Not a receivable'}</span><strong>{formatMoney(invoice.status === 'issued' ? total - paid : 0)}</strong></div></div>
    {invoice.notes && <p className="studio-preline studio-invoice-notes">{invoice.notes}</p>}<p className="studio-page-footnote">{demo ? 'SYNTHETIC DEMO · Not an actual bill or payment request. ' : ''}INR only. Not automatically a GST tax invoice. Issued items and billing snapshots cannot be edited.</p>
    <div className="studio-document-actions"><InvoiceDownload invoice={invoice} payments={state.payments} profile={state.profile} demo={demo} />{invoice.status === 'draft' && <button className="studio-button" disabled={usesDirectTracking} onClick={onIssue}><FileCheck2 size={16} /> Issue invoice</button>}{invoice.status !== 'void' && <button className="studio-button studio-button-secondary" disabled={paid > 0} onClick={onVoid}>Void invoice</button>}{invoice.status === 'issued' && total > paid && <Link href="/studio/payments" className="studio-button">Record receipt <ArrowRight size={16} /></Link>}</div>
    {usesDirectTracking && <p className="studio-field-hint">This collaboration uses direct payment tracking. Its draft cannot be issued because that would count the same work twice.</p>}
    {paid > 0 && <p className="studio-field-hint">Reverse active receipts before voiding this invoice.</p>}
  </Modal>;
}

export function InvoicesPage() {
  const { state, search, mutate } = useStudio();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ id: string; action: 'issue' | 'void' } | null>(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<'latest' | 'oldest' | 'dueDate'>('latest');
  const invoices = state.invoices.filter((invoice) => (filter === 'all' || filter === paymentStatus(invoice, state.payments)) && matchesSearch(search, invoice.number || 'Draft invoice', invoice.billTo, paymentStatus(invoice, state.payments), state.collaborations.find((item) => item.id === invoice.collaborationId)?.title));
  const sortedInvoices = [...invoices].sort((a, b) => {
    if (sort === 'oldest') return (a.createdAt || '').localeCompare(b.createdAt || '');
    if (sort === 'dueDate') return (a.dueDate || '').localeCompare(b.dueDate || '');
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  const document = state.invoices.find((item) => item.id === selected);
  const create = <button className="studio-button" onClick={() => setCreating(true)}><Plus size={17} /> Create invoice</button>;
  return <><PageHeading eyebrow="INVOICES" title="Invoices" description="Optional billing documents. Existing invoices and receipts keep their original history." action={create} /><div className="studio-toolbar"><label className="studio-filter"><span className="studio-sr-only">Filter invoices by status</span><select className="studio-input" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All invoices</option>{['draft', 'unpaid', 'partial', 'paid', 'void'].map((status) => <option key={status} value={status}>{status === 'partial' ? 'Partially paid' : status[0].toUpperCase() + status.slice(1)}</option>)}</select></label><label className="studio-filter"><span className="studio-sr-only">Sort invoices</span><select className="studio-input" value={sort} onChange={(event) => setSort(event.target.value as any)}><option value="latest">Sort: Latest first</option><option value="oldest">Sort: Oldest first</option><option value="dueDate">Sort: Due date</option></select></label><p className="studio-results-count" role="status">{sortedInvoices.length} invoices</p><span className="studio-toolbar-note">Drafts are not included in balances.</span></div>
    {sortedInvoices.length ? <div className="studio-card studio-table-scroll" role="region" aria-label="Invoices" tabIndex={0}><table className="studio-table"><thead><tr><th>Invoice & brand</th><th>Due date</th><th>Total</th><th>Received</th><th>Status</th><th>Details</th></tr></thead><tbody>{sortedInvoices.map((invoice) => { const status = paymentStatus(invoice, state.payments); return <tr key={invoice.id}><td><button className="studio-table-work" onClick={() => setSelected(invoice.id)}><span className="studio-document-icon"><ReceiptText size={22} strokeWidth={1.3} /></span><span><strong>{invoice.number || 'Draft invoice'}</strong><small>{state.brands.find((brand) => brand.id === invoice.brandId)?.name}</small></span></button></td><td>{prettyDate(invoice.dueDate)}</td><td className="studio-money">{formatMoney(invoiceTotal(invoice))}</td><td>{formatMoney(invoicePaid(invoice, state.payments))}</td><td><Badge tone={status === 'paid' ? 'sage' : status === 'partial' ? 'amber' : 'neutral'}>{status === 'partial' ? 'Partially paid' : status}</Badge></td><td><button className="studio-icon-button" onClick={() => setSelected(invoice.id)} aria-label={`View ${invoice.number || 'draft invoice'} for ${state.brands.find((brand) => brand.id === invoice.brandId)?.name}`}><ArrowRight size={18} /></button></td></tr>; })}</tbody></table></div> : <div className="studio-card"><EmptyState title={state.invoices.length ? 'No invoices in this view' : 'No invoices yet'} description={state.invoices.length ? 'Try another status or search term to find an invoice.' : 'Create an invoice only when you need a billing document. You can record direct payments from Payments.'} action={create} /></div>}
    {creating && <InvoiceForm onClose={() => setCreating(false)} />}{document && <InvoiceDetails invoice={document} onClose={() => setSelected(null)} onIssue={() => setConfirmation({ id: document.id, action: 'issue' })} onVoid={() => setConfirmation({ id: document.id, action: 'void' })} />}{confirmation && <ConfirmDialog title={confirmation.action === 'issue' ? 'Ready to make it official?' : 'Void this invoice?'} description={confirmation.action === 'issue' ? 'The server will assign an invoice number. Line items and billing snapshots will be preserved and this amount will enter receivables.' : 'This invoice will no longer count toward receivables. Its history stays in your studio; no document or receipt is deleted.'} confirmLabel={confirmation.action === 'issue' ? 'Issue invoice' : 'Void invoice'} onClose={() => setConfirmation(null)} onConfirm={async () => {
      if (confirmation.action === 'issue' && (!state.profile.issuerDetails.trim() || !state.profile.paymentDetails.trim())) throw new Error('Complete issuer and payment details in Settings before issuing invoices.');
      await mutate({ type: confirmation.action === 'issue' ? 'invoice.issue' : 'invoice.void', id: confirmation.id });
    }} />}
  </>;
}