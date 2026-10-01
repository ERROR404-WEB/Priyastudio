import { describe, expect, it } from 'vitest';
import { createDemoState } from './seed';
import { invoiceDocumentData, invoiceNotes } from './invoice-document';

describe('invoice PDF projection', () => {
  it('snapshots payment instructions in notes without silently truncating billing details', () => {
    expect(invoiceNotes('Thank you.', 'UPI: owner@bank')).toBe('Thank you.\n\nPayment instructions\nUPI: owner@bank');
    expect(() => invoiceNotes('x'.repeat(4990), 'Bank details')).toThrow('5000');
  });
  it('uses saved billing snapshots and calculates remaining balance from receipts', () => {
    const state = createDemoState();
    const invoice = state.invoices[2];
    const data = invoiceDocumentData(invoice, state.payments, true);
    expect(data.issuer).toBe(invoice.issuer);
    expect(data.total).toBe(1500000);
    expect(data.paid).toBe(450000);
    expect(data.balance).toBe(1050000);
    expect(data.watermark).toBe('SAMPLE — NOT FOR BILLING');
  });
  it('does not present a draft or void as an amount payable', () => {
    const state = createDemoState();
    expect(invoiceDocumentData(state.invoices[4], state.payments, false).balance).toBe(0);
    expect(invoiceDocumentData(state.invoices[4], state.payments, false).watermark).toBe('DRAFT — NOT A PAYMENT REQUEST');
    expect(invoiceDocumentData({ ...state.invoices[4], status: 'void' }, [], false).watermark).toBe('VOID — NOT PAYABLE');
  });
});