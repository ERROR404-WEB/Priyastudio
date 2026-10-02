'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowRight, Plus, RotateCcw, Wallet } from 'lucide-react';
import { paiseToInput, rupeesToPaise } from '@/lib/client';
import { collaborationBalance, dashboard, formatMoney, invoicePaid, invoiceTotal, todayISO } from '@/lib/domain';
import type { Collaboration, Payment } from '@/lib/types';
import { Badge, ConfirmDialog, EmptyState, ErrorNotice, Field, FormFooter, Modal, PageHeading, formText, prettyDate, useTask } from '@/components/ui/studio-primitives';
import { matchesSearch, useStudio } from './store';

type ReceiptInput = Omit<Payment, 'createdAt' | 'reversedAt'>;

export function PaymentForm({ initialCollaborationId, onClose }: { initialCollaborationId: string; onClose: () => void }) {
  const { state, mutate } = useStudio();
  const task = useTask();
  const [id] = useState(() => crypto.randomUUID());
  const frozenPayload = useRef<ReceiptInput | null>(null);
  const [locked, setLocked] = useState(false);
  const [collaborationId, setCollaborationId] = useState(initialCollaborationId);
  const [chosenInvoiceId, setChosenInvoiceId] = useState('');
  const collaboration = state.collaborations.find((item) => item.id === collaborationId);
  const balance = collaboration ? collaborationBalance(collaboration, state.invoices, state.payments) : null;
  const invoices = state.invoices.filter((invoice) => invoice.collaborationId === collaborationId && invoice.status === 'issued');
  const eligible = invoices.filter((invoice) => invoicePaid(invoice, state.payments) < invoiceTotal(invoice));
  const invoiceId = chosenInvoiceId || (eligible.length === 1 ? eligible[0].id : '');
  const selected = invoices.find((invoice) => invoice.id === invoiceId);
  const remaining = balance?.source === 'invoice'
    ? selected ? invoiceTotal(selected) - invoicePaid(selected, state.payments) : balance.pending
    : balance?.pending ?? null;
  // Preserve the original selection after a lost response, even if a refresh shows it paid.
  const options = selected && !eligible.some((invoice) => invoice.id === selected.id) ? [...eligible, selected] : eligible;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const text = (name: string) => formText(event, name);
    const amountInput = text('amount'); const date = text('date'); const method = text('method'); const reference = text('reference');
    void task.run(async () => {
      let payload = frozenPayload.current;
      if (!payload) {
        if (!collaboration) throw new Error('Choose a collaboration.');
        if (balance?.source === 'invoice' && !selected) throw new Error('Choose an issued invoice with an unpaid balance.');
        const amount = rupeesToPaise(amountInput);
        if (remaining !== null && amount > remaining) throw new Error(`The receipt exceeds the remaining balance of ${formatMoney(remaining)}.`);
        if (!date || date > todayISO()) throw new Error('Use today or a past date for money already received.');
        payload = { id, amount, date, method, reference, ...(balance?.source === 'invoice' ? { invoiceId } : { invoiceId: '', collaborationId }) };
        if (invoiceId) setChosenInvoiceId(invoiceId);
        frozenPayload.current = payload; setLocked(true);
      }
      await mutate({ type: 'payment.create', data: payload });
      onClose();
    });
  }
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Record payment" description="Record money received for a collaboration. No invoice is needed unless you already use one." busy={task.pending}>
    {!state.collaborations.length ? <EmptyState title="Add a collaboration first" description="Payments belong to a collaboration so you can track the right brand." action={<Link href="/studio/collaborations?new=1" className="studio-button" onClick={onClose}>Add collaboration <ArrowRight size={16} /></Link>} /> : <form onSubmit={submit}>
      <fieldset className="studio-fieldset studio-form-grid" disabled={task.pending || locked}>
        <Field label="Collaboration" className="studio-span-2"><select className="studio-input" required value={collaborationId} onChange={(event) => { setCollaborationId(event.target.value); setChosenInvoiceId(''); }}><option value="" disabled>Choose a collaboration</option>{state.collaborations.map((item) => <option key={item.id} value={item.id}>{item.title} · {state.brands.find((brand) => brand.id === item.brandId)?.name}</option>)}</select></Field>
        {balance?.source === 'invoice' && <Field label="Invoice" hint="This collaboration uses issued invoices. Record the receipt against one to keep its accounting unchanged." className="studio-span-2"><select className="studio-input" required value={invoiceId} onChange={(event) => setChosenInvoiceId(event.target.value)}><option value="" disabled>{options.length ? 'Choose an unpaid invoice' : 'All issued invoices are paid'}</option>{options.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number}</option>)}</select></Field>}
        {collaboration && <div className="studio-payment-balance studio-span-2"><span>Still to receive</span><strong>{remaining === null ? 'Not set — you can still record a payment' : formatMoney(remaining)}</strong></div>}
        <Field label="Amount received (₹)"><input className="studio-input" name="amount" required inputMode="decimal" maxLength={16} pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="0.00" /></Field>
        <Field label="Received on"><input className="studio-input" name="date" type="date" required max={todayISO()} defaultValue={todayISO()} /></Field>
        <Field label="Payment method"><select className="studio-input" name="method" required defaultValue="Bank transfer"><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Card</option><option>Other</option></select></Field>
        <details className="studio-span-2"><summary>Optional details</summary><Field label="Reference (optional)"><input className="studio-input" name="reference" maxLength={300} placeholder="UTR, transaction ID or a note" /></Field></details>
      </fieldset>
      {locked && task.error && <div className="studio-info-box"><p>This receipt’s details are locked for a safe retry. The server may have received it even if the response was lost. Retry here with the same receipt ID; don’t create a second receipt.</p></div>}
      <ErrorNotice message={task.error} /><FormFooter pending={task.pending} onCancel={onClose}>{locked ? 'Retry this receipt safely' : 'Record payment'}</FormFooter>
    </form>}
  </Modal>;
}

function PaymentPlanForm({ collaboration, onClose }: { collaboration: Collaboration; onClose: () => void }) {
  const { state, mutate } = useStudio();
  const task = useTask();
  const balance = collaborationBalance(collaboration, state.invoices, state.payments);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = formText(event, 'pending');
    void task.run(async () => {
      const pending = /^0+(?:\.0{1,2})?$/.test(input) ? 0 : rupeesToPaise(input);
      await mutate({ type: 'collaboration.payment-plan', id: collaboration.id, pending });
      onClose();
    });
  }
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Still to receive" description={`Set the amount still owed for ${collaboration.title}. Money already received stays unchanged.`} busy={task.pending}>
    {balance.source === 'invoice' ? <p>This collaboration now uses issued invoices. Its remaining balance comes from those invoices.</p> : <form onSubmit={submit}>
      <fieldset className="studio-fieldset" disabled={task.pending}><Field label="Still to receive (₹)" hint="Enter 0 only if nothing more is owed. Leaving this unset means the amount is unknown."><input className="studio-input" name="pending" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" maxLength={16} defaultValue={balance.pending === null ? '' : paiseToInput(balance.pending)} placeholder="0.00" /></Field></fieldset>
      <ErrorNotice message={task.error} /><FormFooter pending={task.pending} onCancel={onClose}>Save pending amount</FormFooter>
    </form>}
  </Modal>;
}

export function PaymentsPage() {
  const { state, search, mutate } = useStudio();
  const [creating, setCreating] = useState<string | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<'latest' | 'oldest'>('latest');
  const metrics = dashboard(state);
  const invoiceFor = (payment: Payment) => state.invoices.find((invoice) => invoice.id === payment.invoiceId);
  const collaborationFor = (payment: Payment) => state.collaborations.find((item) => item.id === (payment.collaborationId || invoiceFor(payment)?.collaborationId));
  const brandName = (brandId: string | undefined) => state.brands.find((brand) => brand.id === brandId)?.name;
  const payments = state.payments.filter((payment) => (filter === 'all' || (filter === 'reversed' ? !!payment.reversedAt : !payment.reversedAt)) && matchesSearch(search, collaborationFor(payment)?.title, invoiceFor(payment)?.number, brandName(collaborationFor(payment)?.brandId), payment.reference, payment.method, payment.date, payment.reversedAt ? 'reversed' : 'received'));
  const sortedPayments = [...payments].sort((a, b) => {
    if (sort === 'oldest') return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
    return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
  });
  const collaborations = state.collaborations.filter((item) => matchesSearch(search, item.title, brandName(item.brandId)));
  const planned = state.collaborations.find((item) => item.id === planning);
  const create = <button className="studio-button" onClick={() => setCreating('')}><Plus size={17} /> Record payment</button>;
  return <><PageHeading eyebrow="PAYMENTS" title="Payments" description="Track money received and what is still to come. Invoices are optional for new collaborations." action={create} />
    <div className="studio-finance-strip studio-finance-sage"><div><span>Money received</span><strong>{formatMoney(metrics.received)}</strong></div><div><span>Received this month</span><strong>{formatMoney(metrics.thisMonth)}</strong></div><div><span>Pending payments</span><strong>{formatMoney(metrics.outstanding)}</strong></div><Wallet size={35} strokeWidth={1} /></div>
    <p className="studio-page-footnote">Pending payments includes known balances only. Not set does not mean fully paid.</p>
    {collaborations.length > 0 && <section className="studio-card"><div className="studio-card-heading"><h2>Collaboration payments</h2></div><div className="studio-table-scroll" role="region" aria-label="Collaboration payment balances" tabIndex={0}>
      <table className="studio-table"><thead><tr><th>Collaboration</th><th>Money received</th><th>Still to receive</th><th>Actions</th></tr></thead><tbody>{collaborations.map((item) => {
        const balance = collaborationBalance(item, state.invoices, state.payments);
        return <tr key={item.id}><td><div className="studio-stacked-cell"><strong>{item.title}</strong><small>{brandName(item.brandId)}</small></div></td><td>{formatMoney(balance.received)}</td><td>{balance.pending === null ? 'Not set' : formatMoney(balance.pending)}</td><td>
          {balance.source === 'direct' ? <button className="studio-button studio-button-quiet" onClick={() => setPlanning(item.id)} aria-label={`Set still to receive for ${item.title}`}>Still to receive</button> : <Link className="studio-text-link" href="/studio/invoices">View invoices</Link>}
          {(balance.pending === null || balance.pending > 0) && <button className="studio-button studio-button-quiet" onClick={() => setCreating(item.id)} aria-label={`Record payment for ${item.title}`}>Record payment</button>}
        </td></tr>;
      })}</tbody></table>
    </div></section>}
    <div className="studio-toolbar"><label className="studio-filter"><span className="studio-sr-only">Filter receipts</span><select className="studio-input" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All receipts</option><option value="active">Active receipts</option><option value="reversed">Reversed receipts</option></select></label><label className="studio-filter"><span className="studio-sr-only">Sort receipts</span><select className="studio-input" value={sort} onChange={(event) => setSort(event.target.value as any)}><option value="latest">Sort: Latest first</option><option value="oldest">Sort: Oldest first</option></select></label><span className="studio-results-count" role="status">{sortedPayments.length} ledger entries</span><span className="studio-toolbar-note">Receipts are money received, not profit.</span></div>
    {sortedPayments.length ? <div className="studio-card studio-table-scroll" role="region" aria-label="Receipt ledger" tabIndex={0}><table className="studio-table"><thead><tr><th>Collaboration & brand</th><th>Received on</th><th>Amount</th><th>Method / reference</th><th>Status</th><th>Actions</th></tr></thead><tbody>{sortedPayments.map((payment) => <tr key={payment.id} className={payment.reversedAt ? 'studio-reversed-row' : ''}>
      <td><div className="studio-table-work"><span className="studio-receipt-icon"><ArrowDownLeft size={21} /></span><span><strong>{collaborationFor(payment)?.title}</strong><small>{brandName(collaborationFor(payment)?.brandId)}{payment.invoiceId ? ` · ${invoiceFor(payment)?.number}` : ' · Direct payment'}</small></span></div></td>
      <td>{prettyDate(payment.date, { year: 'numeric' })}</td><td className="studio-money">{formatMoney(payment.amount)}</td><td><div className="studio-stacked-cell"><span>{payment.method}</span><small>{payment.reference || 'No reference added'}</small></div></td>
      <td><Badge tone={payment.reversedAt ? 'rose' : 'sage'}>{payment.reversedAt ? 'Reversed' : 'Received'}</Badge>{payment.reversedAt && <small className="studio-reversal-date">{prettyDate(payment.reversedAt, { year: 'numeric' })}</small>}</td><td>{!payment.reversedAt ? <button className="studio-button studio-button-quiet" onClick={() => setReversing(payment)}><RotateCcw size={15} /> Reverse</button> : <span className="studio-muted">History preserved</span>}</td>
    </tr>)}</tbody></table></div> : <div className="studio-card"><EmptyState title={state.payments.length ? 'No receipts in this view' : 'No payments recorded yet'} description={state.payments.length ? 'Try a different filter or search term.' : 'Record money received for a collaboration, with or without an invoice.'} action={create} /></div>}
    <p className="studio-page-footnote">Reversals preserve the original receipt and restore any known remaining balance. Nothing is deleted.</p>
    {creating !== null && <PaymentForm initialCollaborationId={creating} onClose={() => setCreating(null)} />}
    {planned && <PaymentPlanForm collaboration={planned} onClose={() => setPlanning(null)} />}
    {reversing && <ConfirmDialog title="Reverse this receipt?" description={`${formatMoney(reversing.amount)} for ${collaborationFor(reversing)?.title} will no longer count as received. Any known remaining balance will increase. The original receipt and reversal date stay in the ledger.`} confirmLabel="Confirm reversal" onClose={() => setReversing(null)} onConfirm={() => mutate({ type: 'payment.reverse', id: reversing.id })} />}
  </>;
}