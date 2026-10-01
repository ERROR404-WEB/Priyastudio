import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCommand } from '@/lib/domain';
import { createDemoState } from '@/lib/seed';
import { OverviewPage } from './overview';
import { PaymentsPage } from './payments';
import { InvoicesPage } from './invoices';

const fixture = vi.hoisted(() => ({ state: null as ReturnType<typeof createDemoState> | null }));
vi.mock('./store', async (original) => ({
  ...await original<typeof import('./store')>(),
  useStudio: () => ({ state: fixture.state, demo: true, search: '', pending: false }),
}));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));
  fixture.state = createDemoState();
});
afterEach(() => vi.useRealTimers());

describe('payment workflow presentation', () => {
  it('shows four Home cards with money values and plain stage counts, not invoice metrics', () => {
    const html = renderToStaticMarkup(createElement(OverviewPage));
    expect(html).toMatch(/>Money received</);
    expect(html).toMatch(/>Pending payments</);
    expect(html).toMatch(/>Yet to visit</);
    expect(html).toMatch(/>Yet to post</);
    expect(html).toContain('<strong>0</strong>');
    expect(html).not.toMatch(/invoiced|overdue/i);
  });

  it('does not render overdue labels or filters in the invoice workflow', () => {
    const html = renderToStaticMarkup(createElement(InvoicesPage));
    expect(html).not.toMatch(/overdue|total invoiced/i);
    expect(html).toMatch(/Partially paid|partial/);
    expect(html).toMatch(/unpaid/i);
  });

  it('identifies direct receipts by collaboration and brand and leaves unknown pending unset', () => {
    fixture.state = applyCommand(fixture.state!, {
      type: 'collaboration.create', data: { id: 'direct-work', brandId: 'demo-brand-1', title: 'Direct shoot', category: 'Lifestyle', stage: 'yet_to_visit', dueDate: '', image: '', reelUrl: '', description: '' },
    }, 'test');
    fixture.state = applyCommand(fixture.state, {
      type: 'payment.create', data: { id: 'direct-receipt', invoiceId: '', collaborationId: 'direct-work', amount: 10000, date: '2026-10-01', method: 'UPI', reference: '' },
    }, 'test');
    const html = renderToStaticMarkup(createElement(PaymentsPage));
    expect(html).toMatch(/<h1>Payments<\/h1>/);
    expect(html).toContain('Direct shoot');
    expect(html).toContain('Nomme');
    expect(html).toContain('Not set');
    expect(html).toContain('Still to receive');
    expect(html).not.toMatch(/overdue|total invoiced/i);
  });

  it('omits unscheduled work from upcoming posting deadlines', () => {
    fixture.state = applyCommand(fixture.state!, { type: 'collaboration.update', id: 'demo-work-5', data: { dueDate: '' } }, 'test');
    const html = renderToStaticMarkup(createElement(OverviewPage));
    expect(html).not.toContain('studio-date-tile');
    expect(html).toContain('No posting deadlines set.');
  });
});