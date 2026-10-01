'use client';

import { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import type { Invoice, Payment, Profile } from '@/lib/types';
import { invoiceDocumentData } from '@/lib/invoice-document';

export function InvoiceDownload({ invoice, payments, demo }: { invoice: Invoice; payments: Payment[]; profile: Profile; demo: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    setPending(true); setError('');
    try {
      const { pdf, Document, Page, Text, View, StyleSheet } = await import('@react-pdf/renderer');
      const data = invoiceDocumentData(invoice, payments, demo);
      // Core PDF font uses INR instead of a rupee glyph unsupported by Helvetica.
      const money = (value: number) => `INR ${(value / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const style = StyleSheet.create({
        page: { padding: 46, fontSize: 10, fontFamily: 'Helvetica', color: '#302a2d', lineHeight: 1.6 },
        mast: { fontSize: 26, fontFamily: 'Times-Roman', color: '#633951' },
        muted: { fontSize: 9, color: '#746b70' }, heading: { fontSize: 32, marginTop: 25, marginBottom: 6, fontFamily: 'Times-Roman' },
        row: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#ebe5e3' },
        split: { flexDirection: 'row', gap: 30, marginVertical: 22 }, half: { width: '50%' },
        label: { fontSize: 8, letterSpacing: 1, color: '#633951', marginBottom: 7 },
        description: { width: '48%', paddingRight: 8 }, qty: { width: '10%' }, amount: { width: '21%', textAlign: 'right' },
        total: { marginLeft: '45%', marginTop: 18 }, totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
        notes: { marginTop: 28, padding: 15, backgroundColor: '#faf8f5' },
        watermark: { padding: 10, backgroundColor: '#f1e2e7', color: '#633951', marginTop: 15, fontSize: 10 },
        footer: { position: 'absolute', bottom: 24, left: 46, right: 46, fontSize: 8, color: '#746b70' },
      });
      const document = <Document title={`Invoice ${data.number || 'Draft'}`} author="Hey Priya Studio"><Page size="A4" style={style.page} wrap>
        <Text style={style.mast}>Hey Priya Studio</Text><Text style={style.muted}>THOUGHTFULLY CREATED. CLEARLY BILLED.</Text>
        <Text style={style.heading}>Invoice</Text><Text>{data.number || 'Unissued draft'}</Text>
        {data.watermark && <Text style={style.watermark}>{data.watermark}</Text>}
        <View style={style.split}><View style={style.half}><Text style={style.label}>FROM</Text><Text>{data.issuer}</Text></View><View style={style.half}><Text style={style.label}>BILL TO</Text><Text>{data.billTo}</Text></View></View>
        <View style={style.split}><View style={style.half}><Text style={style.label}>ISSUE DATE</Text><Text>{data.issueDate}</Text></View><View style={style.half}><Text style={style.label}>PAYMENT DUE</Text><Text>{data.dueDate}</Text></View></View>
        <View style={style.row}><Text style={style.description}>DESCRIPTION</Text><Text style={style.qty}>QTY</Text><Text style={style.amount}>RATE</Text><Text style={style.amount}>AMOUNT</Text></View>
        {data.items.map((item, i) => <View key={i} style={style.row} wrap={false}><Text style={style.description}>{item.description}</Text><Text style={style.qty}>{item.quantity}</Text><Text style={style.amount}>{money(item.unitPrice)}</Text><Text style={style.amount}>{money(item.unitPrice * item.quantity)}</Text></View>)}
        <View style={style.total} wrap={false}><View style={style.totalRow}><Text>Total</Text><Text>{money(data.total)}</Text></View><View style={style.totalRow}><Text>Received</Text><Text>{money(data.paid)}</Text></View><View style={style.totalRow}><Text>Balance due</Text><Text>{money(data.balance)}</Text></View></View>
        {data.notes && <View style={style.notes}><Text style={style.label}>A LITTLE NOTE</Text><Text>{data.notes}</Text></View>}
        <Text style={{ ...style.muted, marginTop: 20 }}>Basic INR invoice. This document is not automatically a GST tax invoice. Thank you for creating something lovely together.</Text>
        <Text fixed style={style.footer} render={({ pageNumber, totalPages }) => `Hey Priya Studio · ${data.number || 'Draft'}                                                ${pageNumber} / ${totalPages}`} />
      </Page></Document>;
      const blob = await pdf(document).toBlob();
      const url = URL.createObjectURL(blob); const anchor = window.document.createElement('a');
      anchor.href = url; anchor.download = `${demo ? 'SAMPLE-' : ''}${data.number || 'Draft-invoice'}.pdf`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { setError('The PDF could not be created. Please retry.'); }
    finally { setPending(false); }
  }
  return <div><button type="button" className="studio-button studio-button-secondary" disabled={pending} onClick={download}>{pending ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}{pending ? 'Creating PDF…' : 'Download PDF'}</button>{error && <p role="alert">{error}</p>}</div>;
}