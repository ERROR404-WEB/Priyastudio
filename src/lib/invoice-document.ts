import { invoicePaid, invoiceTotal } from './domain';
import type { Invoice, Payment } from './types';

/** Persist payment instructions with the invoice, never read mutable profile details for a PDF. */
export function invoiceNotes(notes: string, paymentDetails: string): string {
  const snapshot = [notes.trim(), `Payment instructions\n${paymentDetails.trim()}`].filter(Boolean).join('\n\n');
  if (snapshot.length > 5000) throw new Error('Invoice notes and payment instructions together must be at most 5000 characters.');
  return snapshot;
}

export function invoiceDocumentData(invoice: Invoice, payments: Payment[], demo: boolean) {
  const total = invoiceTotal(invoice);
  const paid = invoicePaid(invoice, payments);
  return { ...invoice, total, paid, balance: invoice.status === 'issued' ? total - paid : 0,
    watermark: demo ? 'SAMPLE — NOT FOR BILLING' : invoice.status === 'draft' ? 'DRAFT — NOT A PAYMENT REQUEST' : invoice.status === 'void' ? 'VOID — NOT PAYABLE' : '',
  };
}