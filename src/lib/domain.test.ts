import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCommand, collaborationBalance, commandSchema, dashboard, formatMoney, invoicePaid,
  invoiceStatus, invoiceTotal, publicPortfolio, todayISO,
} from './domain';
import { createDemoState, createEmptyState } from './seed';
import { stages } from './types';
import type { Command, StudioState } from './types';

const NOW = '2026-10-01T09:00:00.000Z';
const ACTOR = 'admin-priya';
const brand: Extract<Command, { type: 'brand.create' }> = {
  type: 'brand.create',
  data: { id: 'brand-1', name: 'Example café', contact: 'Private contact', email: 'private@example.com', category: 'Cafés', notes: 'Private notes' },
};
const collaboration: Extract<Command, { type: 'collaboration.create' }> = {
  type: 'collaboration.create',
  data: { id: 'work-1', brandId: 'brand-1', title: 'Café reel', category: 'Cafés', stage: 'yet_to_record', dueDate: '2026-10-15', image: '/images/cafe.jpg', reelUrl: 'https://www.instagram.com/reel/DYR6geRzS8X/', description: 'Morning coffee' },
};
const invoice: Extract<Command, { type: 'invoice.create' }> = {
  type: 'invoice.create',
  data: { id: 'invoice-1', brandId: 'brand-1', collaborationId: 'work-1', billTo: 'Example café billing address', issuer: 'Test issuer supplied by owner', items: [{ description: 'One reel', quantity: 2, unitPrice: 50000 }], issueDate: '2026-09-01', dueDate: '2026-09-30', notes: '' },
};
const payment: Extract<Command, { type: 'payment.create' }> = {
  type: 'payment.create',
  data: { id: 'receipt-1', invoiceId: 'invoice-1', amount: 25000, date: '2026-09-20', method: 'UPI', reference: 'TEST-001' },
};
const proposal: Extract<Command, { type: 'proposal.create' }> = {
  type: 'proposal.create',
  data: { id: 'proposal-1', brandId: 'brand-1', title: 'October collaboration', items: [{ description: 'Reel', quantity: 1, unitPrice: 100000 }], rights: 'Organic use only', timeline: 'October', validUntil: '2026-10-31' },
};
const share: Extract<Command, { type: 'share.create' }> = {
  type: 'share.create',
  data: { id: 'share-1', targetId: 'proposal-1', scope: 'proposal', tokenHash: 'a'.repeat(64), expiresAt: '2026-10-10T12:00:00.000Z' },
};
const comment: Extract<Command, { type: 'proposal.comment' }> = {
  type: 'proposal.comment', id: 'proposal-1',
  data: { id: 'comment-1', name: 'Brand reviewer', text: 'Could we post on this date?', expectedDate: '2026-10-20', counterOffer: 80000 },
};
const testimonial: Extract<Command, { type: 'testimonial.create' }> = {
  type: 'testimonial.create',
  data: { id: 'testimonial-1', collaborationId: 'work-1', name: 'Example reviewer', role: 'Marketing', text: 'Test-only feedback', consent: true },
};
function run(state: StudioState, command: Command, now = NOW) {
  return applyCommand(state, command, ACTOR, now);
}
function base() {
  return run(run(createEmptyState(), brand), collaboration);
}
function invoiced(issue = true) {
  const state = run(base(), invoice);
  return issue ? run(state, { type: 'invoice.issue', id: 'invoice-1' }) : state;
}
function proposed(sent = true) {
  const state = run(base(), proposal);
  return sent ? run(state, share) : state;
}
function freezeDeep(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
}
afterEach(() => vi.useRealTimers());

describe('direct collaboration payments and visit workflow', () => {
  const receipt = {
    type: 'payment.create' as const,
    data: { ...payment.data, invoiceId: '', collaborationId: 'work-1', date: '2026-10-01' },
  };
  const plan = (pending: number): Command => ({ type: 'collaboration.payment-plan', id: 'work-1', pending });
  const balance = (state: StudioState) => collaborationBalance(state.collaborations[0], state.invoices, state.payments);

  it('receives money without an invoice or known target, without falsely marking it fully paid', () => {
    const state = run(base(), receipt);
    expect(state.invoices).toEqual([]);
    expect(state.payments[0]).toMatchObject({ invoiceId: '', collaborationId: 'work-1', amount: 25000 });
    expect(balance(state)).toEqual({ source: 'direct', received: 25000, expected: null, pending: null });
    expect(dashboard(state, NOW)).toMatchObject({ received: 25000, invoiced: 0, outstanding: 0, overdue: 0, thisMonth: 25000 });
    expect(state.audit.at(-1)).toMatchObject({ action: 'payment.create', targetId: 'receipt-1' });
  });

  it('sets a target from received plus pending and rejects overpayment once known', () => {
    const original = run(base(), receipt);
    const state = run(original, plan(75000));
    expect(state.collaborations[0].expectedPayment).toBe(100000);
    expect(balance(state)).toEqual({ source: 'direct', received: 25000, expected: 100000, pending: 75000 });
    expect(dashboard(state, NOW).outstanding).toBe(75000);
    expect(state.audit.at(-1)).toMatchObject({ action: 'collaboration.payment-plan', targetId: 'work-1' });
    expect(original.collaborations[0]).not.toHaveProperty('expectedPayment');
    expect(() => run(state, { ...receipt, data: { ...receipt.data, id: 'over', amount: 75001 } })).toThrow(/balance/i);
    const settled = run(state, { ...receipt, data: { ...receipt.data, id: 'rest', amount: 75000 } });
    expect(balance(settled).pending).toBe(0);
    expect(dashboard(settled, NOW).received).toBe(100000);
  });

  it('allows zero pending but cannot lower the target below active receipts', () => {
    const state = run(run(base(), receipt), plan(0));
    expect(state.collaborations[0].expectedPayment).toBe(25000);
    expect(balance(state).pending).toBe(0);
    expect(() => run(state, plan(-1))).toThrow();
    expect(() => run(state, { ...receipt, data: { ...receipt.data, id: 'extra', amount: 1 } })).toThrow();
  });

  it('can set a target at creation without requiring one or a posting deadline', () => {
    const state = run(run(createEmptyState(), brand), {
      ...collaboration, data: { ...collaboration.data, dueDate: '', stage: 'yet_to_visit', expectedPayment: 30000 },
    });
    expect(balance(state).pending).toBe(30000);
    expect(run(state, receipt).collaborations[0].dueDate).toBe('');
    const noDeadline = run(base(), { type: 'collaboration.update', id: 'work-1', data: { dueDate: '' } });
    expect(noDeadline.collaborations[0].dueDate).toBe('');
    expect(() => run(base(), { type: 'collaboration.update', id: 'work-1', data: { dueDate: '2026-02-30' } })).toThrow();
  });

  it('reverses without rewriting history and restores pending without resurrecting a replay', () => {
    const state = run(run(base(), plan(100000)), receipt);
    const snapshot = structuredClone(state.payments[0]);
    const reversed = run(state, { type: 'payment.reverse', id: receipt.data.id });
    expect(reversed.payments[0]).toEqual({ ...snapshot, reversedAt: NOW });
    expect(balance(reversed)).toMatchObject({ received: 0, pending: 100000 });
    expect(dashboard(reversed, NOW)).toMatchObject({ received: 0, outstanding: 100000, thisMonth: 0 });
    expect(run(reversed, receipt)).toEqual(reversed);
    expect(run(reversed, { type: 'payment.reverse', id: receipt.data.id })).toEqual(reversed);
    expect(state.payments[0]).toEqual(snapshot);
  });

  it('replays identical direct receipts without audit/revision changes and checks collaboration identity', () => {
    const state = run(base(), receipt);
    expect(run(state, receipt)).toEqual(state);
    expect(() => run(state, { ...receipt, data: { ...receipt.data, collaborationId: 'other' } })).toThrow(/different payload/i);
    expect(() => run(state, { ...receipt, data: { ...receipt.data, invoiceId: 'invoice-1', collaborationId: undefined } })).toThrow(/different payload/i);
  });

  it('keeps direct receipts positive, bounded, dated in the past or today, and linked to a real collaboration', () => {
    expect(() => run(base(), { ...receipt, data: { ...receipt.data, date: '2026-10-02' } })).toThrow(/future/i);
    expect(() => run(base(), { ...receipt, data: { ...receipt.data, date: '2026-10-02' } }, '2026-10-01T18:30:00Z')).not.toThrow();
    expect(() => run(base(), { ...receipt, data: { ...receipt.data, collaborationId: 'missing' } })).toThrow(/not found/i);
    for (const amount of [0, -1, 0.5, 100000000001]) {
      expect(() => run(base(), { ...receipt, data: { ...receipt.data, amount } })).toThrow();
    }
    expect(commandSchema.safeParse({ ...receipt, data: { ...receipt.data, collaborationId: undefined } }).success).toBe(false);
    expect(commandSchema.safeParse({ ...payment, data: { ...payment.data, collaborationId: 'work-1' } }).success).toBe(false);
  });

  it('validates pending amounts, computed target ceilings and protected target updates', () => {
    for (const pending of [-1, 0.5, NaN, Infinity, 100000000001]) expect(() => run(base(), plan(pending))).toThrow();
    expect(() => run(run(base(), receipt), plan(100000000000))).toThrow();
    expect(() => run(base(), { type: 'collaboration.payment-plan', id: 'missing', pending: 0 })).toThrow(/not found/i);
    expect(commandSchema.safeParse({ type: 'collaboration.update', id: 'work-1', data: { expectedPayment: 0 } }).success).toBe(false);
    expect(commandSchema.safeParse({ ...plan(0), expectedPayment: 0 }).success).toBe(false);
  });

  it('rejects direct plans and receipts for issued invoices, even if the invoice is fully paid', () => {
    for (const state of [invoiced(), run(invoiced(), { ...payment, data: { ...payment.data, amount: 100000 } })]) {
      expect(() => run(state, { ...receipt, data: { ...receipt.data, id: 'direct' } })).toThrow(/issued invoice/i);
      expect(() => run(state, plan(0))).toThrow(/issued invoice/i);
    }
  });

  it('allows drafts but prevents issuing an invoice against direct tracking', () => {
    for (const direct of [run(base(), receipt), run(base(), plan(0)), run(base(), plan(75000))]) {
      const draft = run(direct, invoice);
      expect(draft.invoices[0].status).toBe('draft');
      expect(() => run(draft, { type: 'invoice.issue', id: 'invoice-1' })).toThrow(/direct/i);
    }
  });

  it('allows inactive historical accounting without double counting or modifying it', () => {
    let state = run(run(invoiced(), payment), { type: 'payment.reverse', id: 'receipt-1' });
    state = run(state, { type: 'invoice.void', id: 'invoice-1' });
    const history = structuredClone({ invoices: state.invoices, payments: state.payments });
    state = run(state, { ...receipt, data: { ...receipt.data, id: 'direct' } });
    state = run(state, plan(75000));
    expect(state.invoices).toEqual(history.invoices);
    expect(state.payments[0]).toEqual(history.payments[0]);
    expect(dashboard(state, NOW)).toMatchObject({ received: 25000, outstanding: 75000, invoiced: 0, overdue: 0 });
    expect(balance(state).received).toBe(25000);
  });

  it('allows an invoice after reversing unplanned direct receipts, preserving replay safety', () => {
    let state = run(run(base(), receipt), { type: 'payment.reverse', id: 'receipt-1' });
    state = run(run(state, invoice), { type: 'invoice.issue', id: 'invoice-1' });
    expect(run(state, receipt)).toEqual(state);
    expect(balance(state)).toEqual({ source: 'invoice', received: 0, expected: 100000, pending: 100000 });
  });

  it('combines invoice and direct accounting across collaborations exactly once', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
    const old = createDemoState();
    let state = run(old, { ...collaboration, data: { ...collaboration.data, brandId: 'demo-brand-1' } });
    state = run(run(state, receipt), plan(75000));
    expect(dashboard(state, NOW)).toMatchObject({ received: 3475000, invoiced: 5400000, outstanding: 2025000, overdue: 900000, thisMonth: 475000 });
    expect(collaborationBalance(state.collaborations[2], state.invoices, state.payments)).toEqual({ source: 'invoice', received: 450000, expected: 1500000, pending: 1050000 });
    expect(state.invoices).toEqual(old.invoices);
    expect(state.payments.slice(0, 6)).toEqual(old.payments);
  });

  it('loads strict old aggregates with no new keys and keeps programmatic invoice metrics', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(NOW));
    const old: StudioState = JSON.parse(JSON.stringify(createDemoState()));
    expect(old.collaborations.every((item) => !Object.hasOwn(item, 'expectedPayment'))).toBe(true);
    expect(old.payments.every((item) => !Object.hasOwn(item, 'collaborationId'))).toBe(true);
    const loaded = run(old, { type: 'profile.update', data: old.profile });
    expect(loaded.invoices).toEqual(old.invoices);
    expect(loaded.payments).toEqual(old.payments);
    expect(loaded.collaborations).toEqual(old.collaborations);
    expect(dashboard(loaded, NOW)).toMatchObject({ received: 3450000, invoiced: 5400000, outstanding: 1950000, overdue: 900000, yetToVisit: 0, yetToPost: 0 });
  });

  it('validates persisted target and accounting relationships rather than accepting forged mixtures', () => {
    const direct = run(base(), receipt);
    const tooLow = structuredClone(direct);
    tooLow.collaborations[0].expectedPayment = 24999;
    expect(() => dashboard(tooLow, NOW)).toThrow(/overpaid/i);
    const mixed = invoiced();
    mixed.payments.push(direct.payments[0]);
    expect(() => dashboard(mixed, NOW)).toThrow(/issued invoice/i);
    const targetAndInvoice = invoiced();
    targetAndInvoice.collaborations[0].expectedPayment = 0;
    expect(() => dashboard(targetAndInvoice, NOW)).toThrow(/issued invoice/i);
  });

  it('supports all seven stages, counts exact visit/post queues and never implicitly publishes', () => {
    expect(stages).toEqual(['yet_to_visit', 'yet_to_record', 'recorded', 'yet_to_edit', 'edited', 'yet_to_post', 'posted']);
    let state = run(createEmptyState(), brand);
    for (const stage of stages) state = run(state, { ...collaboration, data: { ...collaboration.data, id: stage, stage, dueDate: '' } });
    expect(dashboard(state, NOW)).toMatchObject({ yetToVisit: 1, yetToPost: 1, activeCollaborations: 6 });
    expect(publicPortfolio(state).collaborations).toEqual([]);
    state = run(state, { type: 'collaboration.update', id: 'yet_to_visit', data: { published: true } });
    expect(publicPortfolio(state).collaborations.map((item) => item.id)).toEqual(['yet_to_visit']);
    state = run(state, { type: 'collaboration.update', id: 'yet_to_visit', data: { stage: 'posted' } });
    state = run(state, { type: 'collaboration.update', id: 'yet_to_post', data: { stage: 'posted' } });
    expect(dashboard(state, NOW)).toMatchObject({ yetToVisit: 0, yetToPost: 0, activeCollaborations: 4 });
    expect(publicPortfolio(state).collaborations.map((item) => item.id)).toEqual(['yet_to_visit']);
  });

  it('explicitly excludes all financial fields from published collaborations', () => {
    let state = run(run(base(), receipt), plan(75000));
    state = run(state, { type: 'collaboration.update', id: 'work-1', data: { published: true } });
    Object.assign(state.collaborations[0], { futureFinancialField: 'PRIVATE', pending: 75000, received: 25000 });
    const view = publicPortfolio(state);
    expect(view.collaborations).toHaveLength(1);
    expect(Object.keys(view.collaborations[0]).sort()).toEqual(['brandId', 'brandName', 'category', 'createdAt', 'description', 'dueDate', 'id', 'image', 'published', 'reelUrl', 'stage', 'title']);
    expect(JSON.stringify(view)).not.toMatch(/expectedPayment|pending|received|invoiceId|PRIVATE|75000|100000/);
  });
});

describe('integer invoice accounting', () => {
  it('derives 75000 outstanding from a 100000 invoice and 25000 receipt', () => {
    const state = run(invoiced(), payment);
    expect(invoiceTotal(state.invoices[0])).toBe(100000);
    expect(invoicePaid(state.invoices[0], state.payments)).toBe(25000);
    expect(dashboard(state, NOW)).toMatchObject({ invoiced: 100000, received: 25000, outstanding: 75000, overdue: 75000, thisMonth: 0 });
    expect(invoiceStatus(state.invoices[0], state.payments, '2026-09-30')).toBe('partial');
    expect(invoiceStatus(state.invoices[0], state.payments, '2026-10-01')).toBe('overdue');
  });

  it('excludes draft and void invoices from all financial totals', () => {
    const draft = invoiced(false);
    expect(dashboard(draft, NOW)).toMatchObject({ received: 0, invoiced: 0, outstanding: 0, overdue: 0 });
    expect(invoiceStatus(draft.invoices[0], [], '2026-10-01')).toBe('draft');
    const voided = run(invoiced(), { type: 'invoice.void', id: 'invoice-1' });
    expect(dashboard(voided, NOW).invoiced).toBe(0);
    expect(invoiceStatus(voided.invoices[0], [], '2026-10-01')).toBe('void');
    expect(() => run(draft, payment)).toThrow();
    expect(() => run(voided, payment)).toThrow();
  });

  it('derives unpaid, paid and overdue without marking a paid invoice overdue', () => {
    const state = invoiced();
    expect(invoiceStatus(state.invoices[0], [], '2026-09-30')).toBe('unpaid');
    expect(invoiceStatus(state.invoices[0], [], '2026-10-01')).toBe('overdue');
    const paid = run(state, { ...payment, data: { ...payment.data, amount: 100000 } });
    expect(invoiceStatus(paid.invoices[0], paid.payments, '2026-10-01')).toBe('paid');
    expect(dashboard(paid, NOW).outstanding).toBe(0);
  });

  it('replays an identical payment ID without adding receipts, audit or revision', () => {
    const state = run(invoiced(), payment);
    const retried = run(state, payment, '2026-10-02T09:00:00Z');
    expect(retried).toEqual(state);
    expect(retried).not.toBe(state);
    expect(retried.payments).not.toBe(state.payments);
  });

  it.each(['amount', 'date', 'method', 'reference', 'invoiceId'] as const)('rejects conflicting reuse of a payment ID: %s', (field) => {
    const state = run(invoiced(), payment);
    const values = { amount: 24000, date: '2026-09-21', method: 'Cash', reference: 'changed', invoiceId: 'other' };
    expect(() => run(state, { ...payment, data: { ...payment.data, [field]: values[field] } })).toThrow();
  });

  it('preserves reversed receipts, permits void afterward, and never resurrects a replay', () => {
    const paid = run(invoiced(), payment);
    const reversed = run(paid, { type: 'payment.reverse', id: 'receipt-1' });
    expect(reversed.payments).toHaveLength(1);
    expect(reversed.payments[0].reversedAt).toBe(NOW);
    expect(dashboard(reversed, NOW)).toMatchObject({ received: 0, outstanding: 100000, overdue: 100000 });
    expect(run(reversed, payment)).toEqual(reversed);
    expect(run(reversed, { type: 'payment.reverse', id: 'receipt-1' })).toEqual(reversed);
    const voided = run(reversed, { type: 'invoice.void', id: 'invoice-1' });
    expect(run(voided, payment)).toEqual(voided);
    expect(() => run(voided, { ...payment, data: { ...payment.data, amount: 24000 } })).toThrow();
    expect(paid.payments[0].reversedAt).toBeUndefined();
  });

  it('rejects overpayment and voiding an invoice with an active receipt', () => {
    const state = run(invoiced(), payment);
    expect(() => run(state, { ...payment, data: { ...payment.data, id: 'receipt-2', amount: 75001 } })).toThrow();
    expect(() => run(state, { type: 'invoice.void', id: 'invoice-1' })).toThrow();
    expect(() => run(state, { ...payment, data: { ...payment.data, id: 'receipt-2', amount: 75000 } })).not.toThrow();
  });

  it('does not count receipts belonging to other invoices or reversed receipts', () => {
    const state = run(invoiced(), payment);
    expect(invoicePaid(state.invoices[0], [
      { ...state.payments[0], id: 'another', invoiceId: 'other' },
      { ...state.payments[0], reversedAt: NOW },
    ])).toBe(0);
  });

  it('requires issuer and bill-to before issue and preserves issued snapshots', () => {
    for (const field of ['issuer', 'billTo'] as const) {
      const draft = run(base(), { ...invoice, data: { ...invoice.data, [field]: '   ' } });
      expect(() => run(draft, { type: 'invoice.issue', id: 'invoice-1' })).toThrow();
    }
    const state = invoiced();
    const snapshot = structuredClone(state.invoices[0]);
    const changed = run(state, { type: 'profile.update', data: { ...state.profile, issuerDetails: 'New owner-supplied address' } });
    expect(changed.invoices[0]).toEqual(snapshot);
    expect(() => run(state, invoice)).toThrow();
    expect(run(state, { type: 'invoice.issue', id: 'invoice-1' })).toEqual(state);
    expect(() => run(run(state, { type: 'invoice.void', id: 'invoice-1' }), { type: 'invoice.issue', id: 'invoice-1' })).toThrow();
  });

  it('assigns distinct invoice numbers at issue and never reuses voided numbers', () => {
    let state = invoiced(false);
    expect(state.invoices[0].number).toBe('');
    state = run(state, { type: 'invoice.issue', id: 'invoice-1' });
    const first = state.invoices[0].number;
    expect(first).not.toBe('');
    state = run(state, { type: 'invoice.void', id: 'invoice-1' });
    state = run(state, { ...invoice, data: { ...invoice.data, id: 'invoice-2' } });
    state = run(state, { type: 'invoice.issue', id: 'invoice-2' });
    expect(state.invoices[1].number).not.toBe(first);
  });
});

describe('strict validation and relationships', () => {
  it.each([0, -1, 1.5, NaN, Infinity, 100000000001, Number.MAX_SAFE_INTEGER + 1])('rejects invalid receipt amount %s', (amount) => {
    expect(() => run(invoiced(), { ...payment, data: { ...payment.data, amount } })).toThrow();
  });

  it('accepts the money ceiling but rejects line multiplication and invoice sum overflow', () => {
    expect(commandSchema.safeParse({ ...payment, data: { ...payment.data, amount: 100000000000 } }).success).toBe(true);
    for (const items of [
      [{ description: 'Overflow', quantity: 2, unitPrice: 100000000000 }],
      [{ description: 'A', quantity: 1, unitPrice: 60000000000 }, { description: 'B', quantity: 1, unitPrice: 60000000000 }],
      [{ description: 'Fraction', quantity: 1.5, unitPrice: 100 }],
      [{ description: 'Zero', quantity: 1, unitPrice: 0 }],
      [],
    ]) {
      expect(() => run(base(), { ...invoice, data: { ...invoice.data, items } })).toThrow();
      expect(() => invoiceTotal({ ...invoiced().invoices[0], items })).toThrow();
    }
  });

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-9-01', 'yesterday', '2026-09-01T00:00:00Z'])('rejects impossible/non-date receipt date %s', (date) => {
    expect(() => run(invoiced(), { ...payment, data: { ...payment.data, date } })).toThrow();
  });

  it('accepts leap days, rejects future receipts, and respects the Kolkata midnight boundary', () => {
    expect(commandSchema.safeParse({ ...payment, data: { ...payment.data, date: '2024-02-29' } }).success).toBe(true);
    const state = invoiced();
    const todayPayment = { ...payment, data: { ...payment.data, date: '2026-10-02' } };
    expect(() => run(state, todayPayment, '2026-10-01T18:29:59Z')).toThrow();
    expect(() => run(state, todayPayment, '2026-10-01T18:30:00Z')).not.toThrow();
    expect(() => run(state, { ...payment, data: { ...payment.data, date: '2026-10-03' } }, '2026-10-01T18:30:00Z')).toThrow();
  });

  it('rejects reversed invoice dates and invalid actor/time inputs', () => {
    expect(() => run(base(), { ...invoice, data: { ...invoice.data, dueDate: '2026-08-31' } })).toThrow();
    expect(() => applyCommand(base(), invoice, '   ', NOW)).toThrow();
    expect(() => run(base(), invoice, '2026-02-30T12:00:00Z')).toThrow();
    expect(() => run(base(), invoice, 'not a time')).toThrow();
  });

  it('rejects missing records and cross-brand invoice relationships', () => {
    expect(() => run(createEmptyState(), collaboration)).toThrow();
    expect(() => run(createEmptyState(), invoice)).toThrow();
    expect(() => run(createEmptyState(), proposal)).toThrow();
    expect(() => run(createEmptyState(), testimonial)).toThrow();
    expect(() => run(createEmptyState(), payment)).toThrow();
    const state = run(base(), { ...brand, data: { ...brand.data, id: 'brand-2' } });
    expect(() => run(state, { ...invoice, data: { ...invoice.data, brandId: 'brand-2' } })).toThrow();
    expect(() => run(state, { ...invoice, data: { ...invoice.data, collaborationId: 'missing' } })).toThrow();
  });

  it.each<Command>([
    { type: 'invoice.issue', id: 'missing' }, { type: 'invoice.void', id: 'missing' },
    { type: 'payment.reverse', id: 'missing' }, { type: 'share.revoke', id: 'missing' },
    { type: 'testimonial.approve', id: 'missing', approved: true },
    { type: 'collaboration.update', id: 'missing', data: { published: true } },
    { ...comment, id: 'missing' }, { type: 'proposal.accept', id: 'missing', version: 1, name: 'Reviewer' },
  ])('rejects absent target for $type', (command) => {
    expect(() => run(base(), command)).toThrow();
  });

  it.each([
    [brand, { createdAt: NOW }], [collaboration, { published: true }],
    [invoice, { status: 'issued', number: 'FORGED' }], [payment, { reversedAt: NOW }],
    [proposal, { status: 'accepted', version: 4 }], [share, { revokedAt: NOW }],
    [testimonial, { approved: true }],
  ] as const)('rejects extra system-managed fields in %j', (command, extra) => {
    expect(commandSchema.safeParse({ ...command, data: { ...command.data, ...extra } }).success).toBe(false);
  });

  it('rejects unknown commands, top-level extras, empty patches and nested extras', () => {
    for (const command of [
      { type: 'invoice.update', id: 'invoice-1', data: { billTo: 'Rewritten' } },
      { ...brand, admin: true },
      { type: 'collaboration.update', id: 'work-1', data: {} },
      { type: 'collaboration.update', id: 'work-1', data: { brandId: 'brand-2' } },
      { ...invoice, data: { ...invoice.data, items: [{ ...invoice.data.items[0], tax: 18 }] } },
    ]) expect(commandSchema.safeParse(command).success).toBe(false);
  });

  it('rejects duplicate record IDs', () => {
    expect(() => run(base(), brand)).toThrow();
    expect(() => run(base(), collaboration)).toThrow();
    expect(() => run(proposed(), proposal)).toThrow();
    expect(() => run(proposed(), share)).toThrow();
    expect(() => run(run(base(), testimonial), testimonial)).toThrow();
    expect(() => run(run(proposed(), comment), comment)).toThrow();
  });

  it.each(['javascript:alert(1)', '//evil.example/x.jpg', '/images/../secret', '/images/%2e%2e/secret', '/api/media/a?x=1', 'https://evil.example/x.jpg'])('rejects unsafe/unapproved image URL %s', (image) => {
    expect(() => run(base(), { type: 'collaboration.update', id: 'work-1', data: { image } })).toThrow();
  });

  it.each(['/images/cafe.jpg', '/api/media/media_123', 'https://images.unsplash.com/photo-123?w=800', ''])('accepts safe image URL %s', (image) => {
    expect(() => run(base(), { type: 'collaboration.update', id: 'work-1', data: { image } })).not.toThrow();
  });

  it.each(['http://www.instagram.com/reel/a/', 'https://www.instagram.com.evil.example/reel/a/', 'https://evil.example/p/a/', 'https://www.instagram.com/not-reel/a/', 'https://user:pass@www.instagram.com/reel/a/', 'javascript:alert(1)'])('rejects unsafe reel URL %s', (reelUrl) => {
    expect(() => run(base(), { type: 'collaboration.update', id: 'work-1', data: { reelUrl } })).toThrow();
  });

  it('allows Instagram posts and validates profile email and Instagram URL', () => {
    const state = base();
    expect(() => run(state, { type: 'collaboration.update', id: 'work-1', data: { reelUrl: 'https://www.instagram.com/p/EXAMPLE_1/' } })).not.toThrow();
    for (const instagram of ['javascript:alert(1)', 'http://instagram.com/hey.its_priya_', 'https://instagram.com.evil.example/hey.its_priya_', 'https://instagram.com@evil.example/']) {
      expect(() => run(state, { type: 'profile.update', data: { ...state.profile, instagram } })).toThrow();
    }
    expect(() => run(state, { type: 'profile.update', data: { ...state.profile, email: 'invalid' } })).toThrow();
    const changed = run(state, { type: 'profile.update', data: { ...state.profile, tagline: 'A new tagline' } });
    expect(changed.profile.tagline).toBe('A new tagline');
  });
});

describe('proposal and sharing transitions', () => {
  it('creates a draft and issues it on share without changing prices or version', () => {
    const state = proposed(false);
    expect(state.proposals[0]).toMatchObject({ status: 'draft', version: 1, comments: [] });
    const sent = run(state, share);
    expect(sent.proposals[0]).toMatchObject({ status: 'sent', version: 1, items: proposal.data.items });
    expect(sent.shares[0].tokenHash).toBe('a'.repeat(64));
    expect(state.proposals[0].status).toBe('draft');
  });

  it('accepts only a sent, unexpired proposal at its current version', () => {
    const accept: Command = { type: 'proposal.accept', id: 'proposal-1', version: 1, name: 'Brand signer' };
    expect(() => run(proposed(false), accept)).toThrow();
    expect(() => run(proposed(), { ...accept, version: 2 })).toThrow();
    expect(() => run(proposed(), accept, '2026-10-31T18:30:00Z')).toThrow();
    const accepted = run(proposed(), accept, '2026-10-31T18:29:59Z');
    expect(accepted.proposals[0]).toMatchObject({ status: 'accepted', acceptedBy: 'Brand signer', acceptedAt: '2026-10-31T18:29:59.000Z', version: 1 });
    expect(() => run(accepted, accept)).toThrow();
  });

  it('records comments/counter-offers without modifying price or committing a posting date', () => {
    const state = proposed();
    const commented = applyCommand(state, comment, 'brand:reviewer', NOW);
    expect(commented.proposals[0].comments[0]).toMatchObject({ counterOffer: 80000, expectedDate: '2026-10-20', createdAt: NOW });
    expect(commented.proposals[0].items).toEqual(state.proposals[0].items);
    expect(commented.collaborations).toEqual(state.collaborations);
    expect(commented.audit.at(-1)?.actor).toBe('brand:reviewer');
    expect(() => run(proposed(false), comment)).toThrow();
    expect(() => run(state, comment, '2026-11-01T00:00:00Z')).toThrow();
    expect(() => run(state, { ...comment, data: { ...comment.data, expectedDate: '2026-02-30' } })).toThrow();
    expect(() => run(state, { ...comment, data: { ...comment.data, counterOffer: 0 } })).toThrow();
    expect(() => run(state, { ...comment, data: { ...comment.data, text: '<script>alert(1)</script>' } })).toThrow();
    expect(() => run(state, { ...comment, data: { ...comment.data, expectedDate: '', counterOffer: null } })).not.toThrow();
  });

  it('rotates only the same scope/target and supports explicit revocation', () => {
    const review: Command = { type: 'share.create', data: { ...share.data, id: 'review-1', targetId: 'work-1', scope: 'review', tokenHash: 'b'.repeat(64) } };
    let state = run(proposed(), review);
    state = run(state, { ...share, data: { ...share.data, id: 'share-2', tokenHash: 'c'.repeat(64) } });
    expect(state.shares.find((s) => s.id === 'share-1')?.revokedAt).toBe(NOW);
    expect(state.shares.find((s) => s.id === 'review-1')?.revokedAt).toBeUndefined();
    expect(state.shares.find((s) => s.id === 'share-2')?.revokedAt).toBeUndefined();
    state = run(state, { type: 'share.revoke', id: 'share-2' });
    expect(state.shares.find((s) => s.id === 'share-2')?.revokedAt).toBe(NOW);
    expect(run(state, { type: 'share.revoke', id: 'share-2' })).toEqual(state);
  });

  it('rejects expired shares, expired proposals, bad hashes, reused hashes and wrong targets/scopes', () => {
    const state = proposed(false);
    for (const data of [
      { ...share.data, expiresAt: NOW }, { ...share.data, expiresAt: '2026-09-30T00:00:00Z' },
      { ...share.data, expiresAt: '2026-02-30T00:00:00Z' },
      { ...share.data, tokenHash: 'raw-secret' }, { ...share.data, targetId: 'missing' },
      { ...share.data, targetId: 'work-1' }, { ...share.data, scope: 'review' as const },
    ]) expect(() => run(state, { type: 'share.create', data })).toThrow();
    expect(() => run(state, { ...share, data: { ...share.data, expiresAt: '2026-12-01T00:00:00Z' } }, '2026-11-01T00:00:00Z')).toThrow();
    expect(() => run(proposed(), { ...share, data: { ...share.data, id: 'share-2' } })).toThrow();
  });

  it('sharing an accepted proposal does not rewrite the accepted document', () => {
    const state = run(proposed(), { type: 'proposal.accept', id: 'proposal-1', version: 1, name: 'Signer' });
    const next = run(state, { ...share, data: { ...share.data, id: 'share-2', tokenHash: 'b'.repeat(64) } });
    expect(next.proposals[0]).toEqual(state.proposals[0]);
  });
});

describe('publication, audit and purity', () => {
  it('requires explicit publication and both testimonial consent and approval', () => {
    let state = run(base(), testimonial);
    expect(state.collaborations[0].published).toBe(false);
    expect(state.testimonials[0].approved).toBe(false);
    expect(publicPortfolio(state).testimonials).toEqual([]);
    state = run(state, { type: 'collaboration.update', id: 'work-1', data: { stage: 'posted', published: true } });
    expect(publicPortfolio(state).collaborations).toHaveLength(1);
    expect(publicPortfolio(state).testimonials).toEqual([]);
    state = run(state, { type: 'testimonial.approve', id: 'testimonial-1', approved: true });
    expect(publicPortfolio(state).testimonials).toHaveLength(1);
    state = run(state, { type: 'testimonial.approve', id: 'testimonial-1', approved: false });
    expect(publicPortfolio(state).testimonials).toEqual([]);
    const noConsent = run(base(), { ...testimonial, data: { ...testimonial.data, consent: false } });
    expect(() => run(noConsent, { type: 'testimonial.approve', id: 'testimonial-1', approved: true })).toThrow();
  });

  it('uses public field allowlists, filters orphan/unpublished work, and returns detached data', () => {
    let state = run(invoiced(), { type: 'collaboration.update', id: 'work-1', data: { published: true } });
    state = run(run(state, testimonial), { type: 'testimonial.approve', id: 'testimonial-1', approved: true });
    state.profile.issuerDetails = 'SECRET ISSUER';
    state.profile.paymentDetails = 'SECRET ACCOUNT';
    Object.assign(state.profile, { privateExtra: 'SECRET EXTRA' });
    Object.assign(state.collaborations[0], { budget: 123456, contact: 'SECRET COLLAB CONTACT' });
    Object.assign(state.testimonials[0], { email: 'SECRET REVIEW EMAIL' });
    const view = publicPortfolio(state);
    expect(Object.keys(view).sort()).toEqual(['collaborations', 'profile', 'testimonials']);
    expect(Object.keys(view.profile).sort()).toEqual(['bio', 'email', 'instagram', 'location', 'name', 'tagline']);
    expect(view.collaborations[0].brandName).toBe('Example café');
    expect(JSON.stringify(view)).not.toMatch(/SECRET|private@example.com|Private notes|unitPrice|billTo|budget|tokenHash/);
    view.collaborations[0].title = 'Changed outside';
    view.testimonials[0].text = 'Changed outside';
    view.profile.name = 'Changed outside';
    expect(state.collaborations[0].title).toBe('Café reel');
    expect(state.testimonials[0].text).toBe('Test-only feedback');
    expect(state.profile.name).toBe('Priya');
    state.collaborations[0].published = false;
    expect(publicPortfolio(state).testimonials).toEqual([]);
    state.brands = [];
    expect(publicPortfolio(state).collaborations).toEqual([]);
  });

  it('clones frozen state/commands, is deterministic with now, and audits every command mutation', () => {
    const commands: Command[] = [
      brand, collaboration, { type: 'collaboration.update', id: 'work-1', data: { published: true } },
      invoice, { type: 'invoice.issue', id: 'invoice-1' }, payment,
      { type: 'payment.reverse', id: 'receipt-1' }, { type: 'invoice.void', id: 'invoice-1' },
      proposal, share, comment, { type: 'proposal.accept', id: 'proposal-1', version: 1, name: 'Signer' },
      { type: 'share.revoke', id: 'share-1' }, testimonial,
      { type: 'testimonial.approve', id: 'testimonial-1', approved: true },
      { type: 'profile.update', data: { ...createEmptyState().profile, tagline: 'Updated' } },
    ];
    let state = createEmptyState();
    for (const command of commands) {
      const before = structuredClone(state);
      freezeDeep(state);
      freezeDeep(command);
      const next = run(state, command);
      expect(next).toEqual(run(state, command));
      expect(state).toEqual(before);
      expect(next.revision).toBe(state.revision + 1);
      expect(next.audit).toHaveLength(state.audit.length + 1);
      expect(next.audit.at(-1)).toMatchObject({ actor: ACTOR, action: command.type, at: NOW });
      expect(next.audit.at(-1)?.targetId).toBeTruthy();
      state = next;
    }
    expect(new Set(state.audit.map((entry) => entry.id)).size).toBe(commands.length);
  });

  it('does not partially mutate state when a command fails', () => {
    const state = invoiced();
    const before = structuredClone(state);
    expect(() => run(state, { ...payment, data: { ...payment.data, amount: 100001 } })).toThrow();
    expect(state).toEqual(before);
  });
});

describe('dashboard, calendar and seed', () => {
  it('returns six chronological receipt months including zeros over the year boundary', () => {
    let state = invoiced();
    state = run(state, { ...payment, data: { ...payment.data, id: 'old', amount: 10000, date: '2026-07-01' } }, '2027-01-10');
    state = run(state, { ...payment, data: { ...payment.data, id: 'dec', amount: 20000, date: '2026-12-31' } }, '2027-01-10');
    state = run(state, { ...payment, data: { ...payment.data, id: 'jan', amount: 30000, date: '2027-01-01' } }, '2027-01-10');
    const summary = dashboard(state, '2027-01-10');
    expect(summary.monthly).toEqual([
      { month: '2026-08', amount: 0 }, { month: '2026-09', amount: 0 },
      { month: '2026-10', amount: 0 }, { month: '2026-11', amount: 0 },
      { month: '2026-12', amount: 20000 }, { month: '2027-01', amount: 30000 },
    ]);
    expect(summary).toMatchObject({ received: 60000, thisMonth: 30000, outstanding: 40000, activeCollaborations: 1 });
    expect(dashboard(run(state, { type: 'collaboration.update', id: 'work-1', data: { stage: 'posted' } }), '2027-01-10').activeCollaborations).toBe(0);
    expect(dashboard(run(state, { type: 'payment.reverse', id: 'dec' }, '2027-01-10'), '2027-01-10').monthly[4].amount).toBe(0);
  });

  it('formats exact INR paise and uses Asia/Kolkata for today', () => {
    expect(formatMoney(12345678)).toBe('₹1,23,456.78');
    expect(formatMoney(1)).toBe('₹0.01');
    expect(formatMoney(0)).toBe('₹0.00');
    expect(() => formatMoney(1.5)).toThrow();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-31T18:30:00Z'));
    expect(todayISO()).toBe('2027-01-01');
    vi.setSystemTime(new Date('2026-12-31T18:29:59Z'));
    expect(todayISO()).toBe('2026-12-31');
  });

  it('creates independent empty states with the known profile and no invented billing identity', () => {
    const state = createEmptyState();
    expect(state.profile).toMatchObject({ name: 'Priya', email: 'heyitsvishnupriya@gmail.com', instagram: 'https://www.instagram.com/hey.its_priya_/', location: 'Hyderabad', issuerDetails: '', paymentDetails: '' });
    expect(state.revision).toBe(0);
    expect(state.testimonials).toEqual([]);
    expect(state.invoices).toEqual([]);
    state.profile.name = 'Changed';
    expect(createEmptyState().profile.name).toBe('Priya');
    expect(dashboard(createEmptyState(), NOW)).toMatchObject({ received: 0, invoiced: 0, outstanding: 0, overdue: 0, thisMonth: 0, activeCollaborations: 0 });
  });

  it.each(['2026-10-01T09:00:00Z', '2027-01-01T00:00:00Z', '2028-02-29T18:30:00Z'])('creates coherent synthetic demo data relative to %s', (now) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const state = createDemoState();
    expect(state.brands.length).toBeGreaterThanOrEqual(6);
    expect(state.brands.length).toBeLessThanOrEqual(8);
    expect(state.brands.map((b) => b.name)).toEqual(expect.arrayContaining(['Nomme', 'HawTea', 'Nord Coffee']));
    expect(state.collaborations).toHaveLength(5);
    expect(state.invoices).toHaveLength(5);
    expect(state.proposals).toHaveLength(3);
    expect(state.testimonials).toEqual([]);
    expect(state.profile.issuerDetails).toBe('');
    expect(state.profile.paymentDetails).toBe('');
    expect(state.payments.every((p) => p.date <= todayISO() && p.amount > 0 && Number.isSafeInteger(p.amount))).toBe(true);
    expect(dashboard(state, now).monthly.every((m) => m.amount > 0)).toBe(true);
    expect(dashboard(state, now).outstanding).toBeGreaterThan(0);
    expect(state.invoices.some((i) => invoicePaid(i, state.payments) > 0 && invoicePaid(i, state.payments) < invoiceTotal(i))).toBe(true);
    expect(state.invoices.some((i) => i.status === 'issued' && invoicePaid(i, state.payments) === 0)).toBe(true);
    for (const item of state.invoices) {
      expect(invoicePaid(item, state.payments)).toBeLessThanOrEqual(invoiceTotal(item));
      expect(state.brands.some((b) => b.id === item.brandId)).toBe(true);
    }
    expect(state.collaborations.filter((c) => c.published)).toHaveLength(4);
    expect(state.collaborations.filter((c) => !c.published).every((c) => c.stage !== 'posted')).toBe(true);
    expect(state.collaborations.every((c) => /^\/images\/(cafe|food|lifestyle|travel)\.jpg$/.test(c.image))).toBe(true);
    expect(() => run(state, { type: 'profile.update', data: state.profile }, now)).not.toThrow();
    const second = createDemoState();
    state.invoices[0].items[0].unitPrice = 1;
    expect(second.invoices[0].items[0].unitPrice).not.toBe(1);
  });
});