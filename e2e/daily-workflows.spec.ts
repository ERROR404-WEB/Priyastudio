import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { CalendarAction, CalendarView, Shoot } from '../src/lib/calendar';
import type { Command, PublicPortfolio, StudioState } from '../src/lib/types';

// Real browser + real loopback HTTP/storage. No route fixtures, Google, resets or publishing.
// Removing direct receipts, persisted calendar writes, or stage-driven counts must fail these tests.
// Money/time expectations are hand-derived, not calculated by production domain helpers.
type Demo = Awaited<ReturnType<typeof localDemo>>;

async function localDemo(request: APIRequestContext, baseURL: string | undefined) {
  expect(baseURL, 'Synthetic writes are restricted to the local demo server').toMatch(/^http:\/\/(localhost|127\.0\.0\.1):3000\/?$/);
  const origin = new URL(baseURL!).origin;
  async function read() {
    const studioResponse = await request.get('/api/studio', { maxRedirects: 0 });
    expect(studioResponse.status(), 'Studio demo preflight must succeed without signing in').toBe(200);
    const studio = await studioResponse.json() as { demo: boolean; state: StudioState };
    expect(studio.demo, 'Refusing to mutate a non-demo studio').toBe(true);
    const calendarResponse = await request.get('/api/calendar', { maxRedirects: 0 });
    expect(calendarResponse.status(), 'Calendar demo preflight must succeed').toBe(200);
    const calendar = await calendarResponse.json() as CalendarView;
    expect(calendar.demo, 'Refusing to mutate a non-demo calendar').toBe(true);
    expect(calendar.connected, 'These tests must never use a Google account').toBe(false);
    expect(calendar.configured).toBe(false);
    return { state: studio.state, calendar };
  }
  async function mutate(command: Command) {
    await read(); // Recheck BOTH gates immediately before every API mutation, including cleanup.
    const response = await request.post('/api/studio', { headers: { Origin: origin }, data: { command }, maxRedirects: 0 });
    expect(response.status(), `Demo command ${command.type}`).toBe(200);
    return (await response.json() as { state: StudioState }).state;
  }
  async function calendarAction(action: CalendarAction) {
    await read();
    const response = await request.post('/api/calendar', { headers: { Origin: origin }, data: action, maxRedirects: 0 });
    expect(response.status(), `Demo calendar ${action.action}`).toBe(200);
    return await response.json() as CalendarView;
  }
  await read();
  return { read, mutate, calendarAction, origin };
}

async function uiWrite(page: Page, demo: Demo, path: '/api/studio' | '/api/calendar', perform: () => Promise<unknown>) {
  await demo.read(); // No browser submit/select that writes is allowed before both demo gates.
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url() === demo.origin + path && response.request().method() === 'POST'),
    perform(),
  ]);
  expect(response.status(), `Real browser POST ${path}`).toBe(200);
  await response.finished();
  return response;
}

function qaCollaboration(kind: string) {
  const suffix = randomUUID();
  return { id: `qa-daily-${kind}-${suffix}`, title: `QA daily ${kind} ${suffix}` };
}

async function createCollaboration(demo: Demo, work: ReturnType<typeof qaCollaboration>) {
  const { state } = await demo.read();
  const brand = state.brands.find((item) => item.id === 'demo-brand-1');
  expect(brand, 'Use an existing seeded brand; never create or modify a real brand').toBeDefined();
  await demo.mutate({ type: 'collaboration.create', data: {
    ...work, brandId: brand!.id, category: 'QA synthetic', stage: 'yet_to_visit', dueDate: '',
    image: '', reelUrl: '', description: 'Synthetic daily-workflow regression only. Never publish.',
  } });
}

async function cleanup(demo: Demo, collaborationId: string) {
  // Only this run's UUID is owned. Keep every receipt/shoot and the audit trail; never reset files.
  // The finally below still cleans up money if calendar cleanup itself fails.
  try {
    const { calendar } = await demo.read();
    for (const shoot of calendar.shoots.filter((item) => item.collaborationId === collaborationId && !item.cancelled)) {
      await demo.calendarAction({ action: 'cancel', id: shoot.id, expectedRevision: shoot.revision });
    }
    const saved = (await demo.read()).calendar.shoots.filter((item) => item.collaborationId === collaborationId);
    expect(saved.every((item) => item.cancelled && item.status === 'cancelled')).toBe(true);
  } finally {
    const { state } = await demo.read();
    const work = state.collaborations.find((item) => item.id === collaborationId);
    if (work) {
      const receipts = state.payments.filter((item) => item.collaborationId === collaborationId);
      for (const payment of receipts.filter((item) => !item.reversedAt)) {
        await demo.mutate({ type: 'payment.reverse', id: payment.id });
      }
      await demo.mutate({ type: 'collaboration.payment-plan', id: collaborationId, pending: 0 });
      // Completed but private: leave no extra visit/post tasks or synthetic money in the dashboard.
      if (work.stage !== 'posted' || work.published) {
        await demo.mutate({ type: 'collaboration.update', id: collaborationId, data: { stage: 'posted', published: false } });
      }
      const final = (await demo.read()).state;
      expect(final.collaborations.find((item) => item.id === collaborationId)).toMatchObject({ expectedPayment: 0, stage: 'posted', published: false });
      const retained = final.payments.filter((item) => item.collaborationId === collaborationId);
      expect(retained.map((item) => item.id).sort()).toEqual(receipts.map((item) => item.id).sort());
      expect(retained.every((item) => !!item.reversedAt)).toBe(true);
      expect(retained.filter((item) => !item.reversedAt).reduce((sum, item) => sum + item.amount, 0)).toBe(0);
    }
  }
}

async function publicProjection(request: APIRequestContext, collaborationId: string, privateValues: string[] = []) {
  const response = await request.get('/api/public/portfolio', { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const body = await response.json() as { demo: boolean; portfolio: PublicPortfolio };
  expect(body.demo).toBe(true);
  expect(Object.keys(body).sort()).toEqual(['demo', 'portfolio']);
  expect(Object.keys(body.portfolio).sort()).toEqual(['collaborations', 'profile', 'testimonials']);
  expect(body.portfolio.profile).not.toHaveProperty('issuerDetails');
  expect(body.portfolio.profile).not.toHaveProperty('paymentDetails');
  expect(body.portfolio.collaborations.some((item) => item.id === collaborationId)).toBe(false);
  expect(body.portfolio.collaborations.length, 'Check actual seeded public records, not an empty projection').toBeGreaterThan(0);
  for (const item of body.portfolio.collaborations) {
    expect(Object.keys(item).sort()).toEqual([
      'brandId', 'brandName', 'category', 'createdAt', 'description', 'dueDate', 'id', 'image',
      'published', 'reelUrl', 'stage', 'title',
    ]);
  }
  const json = JSON.stringify(body);
  expect(json).not.toMatch(/"(?:expectedPayment|payments|invoices|shoots|startsAt|endsAt|reminderMinutes|tokenHash|credentials)"\s*:/);
  for (const value of [collaborationId, ...privateValues]) expect(json).not.toContain(value);
}

function balanceRow(page: Page, title: string) {
  return page.getByRole('region', { name: 'Collaboration payment balances', exact: true })
    .getByRole('row').filter({ has: page.getByText(title, { exact: true }) });
}

async function balanceVisible(page: Page, title: string, received: string, pending: string) {
  const row = balanceRow(page, title);
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('cell').nth(1)).toHaveText(received);
  await expect(row.getByRole('cell').nth(2)).toHaveText(pending);
}

function directReceipts(state: StudioState, collaborationId: string, expectedPayment: number, received: number) {
  expect(state.invoices.filter((item) => item.collaborationId === collaborationId), 'No invoice is created or required').toHaveLength(0);
  expect(state.collaborations.find((item) => item.id === collaborationId)).toMatchObject({ expectedPayment, published: false });
  const receipts = state.payments.filter((item) => item.collaborationId === collaborationId);
  for (const payment of receipts) expect(payment.invoiceId).toBe('');
  expect(receipts.filter((item) => !item.reversedAt).reduce((sum, item) => sum + item.amount, 0)).toBe(received);
  return receipts;
}

async function recordDirect(page: Page, demo: Demo, title: string, amount: string, reference: string) {
  await balanceRow(page, title).getByRole('button', { name: `Record payment for ${title}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Record payment', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Invoice', exact: true })).toHaveCount(0);
  await dialog.getByLabel('Amount received (₹)', { exact: true }).fill(amount);
  await dialog.getByRole('combobox', { name: 'Payment method', exact: true }).selectOption('UPI');
  await dialog.locator('summary').filter({ hasText: 'Optional details' }).click();
  await dialog.getByLabel('Reference (optional)', { exact: true }).fill(reference);
  await uiWrite(page, demo, '/api/studio', () => dialog.getByRole('button', { name: 'Record payment', exact: true }).click());
  await expect(dialog).toHaveCount(0);
}

test('invoice-independent receipts persist exact partial/full balances and reversal history', async ({ page, request, baseURL }) => {
  test.setTimeout(90_000);
  const demo = await localDemo(request, baseURL);
  const work = qaCollaboration('payments');
  try {
    await createCollaboration(demo, work);
    await page.goto('/studio/payments');
    await balanceVisible(page, work.title, '₹0.00', 'Not set');
    await balanceRow(page, work.title).getByRole('button', { name: `Set still to receive for ${work.title}`, exact: true }).click();
    const plan = page.getByRole('dialog', { name: 'Still to receive', exact: true });
    await plan.getByLabel('Still to receive (₹)', { exact: true }).fill('1000');
    await uiWrite(page, demo, '/api/studio', () => plan.getByRole('button', { name: 'Save pending amount', exact: true }).click());
    await expect(plan).toHaveCount(0);
    await page.reload();
    await balanceVisible(page, work.title, '₹0.00', '₹1,000.00');
    directReceipts((await demo.read()).state, work.id, 100000, 0);

    const partialReference = `${work.id}-partial`;
    const finalReference = `${work.id}-remainder`;
    await recordDirect(page, demo, work.title, '250.01', partialReference);
    await page.reload();
    await balanceVisible(page, work.title, '₹250.01', '₹749.99');
    const partial = directReceipts((await demo.read()).state, work.id, 100000, 25001);
    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({ amount: 25001, method: 'UPI', reference: partialReference, invoiceId: '', collaborationId: work.id });

    await recordDirect(page, demo, work.title, '749.99', finalReference);
    await page.reload();
    await balanceVisible(page, work.title, '₹1,000.00', '₹0.00');
    await expect(balanceRow(page, work.title).getByRole('button', { name: `Record payment for ${work.title}`, exact: true })).toHaveCount(0);
    const full = directReceipts((await demo.read()).state, work.id, 100000, 100000);
    expect(full).toHaveLength(2);
    const remainder = full.find((item) => item.reference === finalReference)!;
    expect(remainder).toMatchObject({ amount: 74999, method: 'UPI', invoiceId: '', collaborationId: work.id });

    const ledger = page.getByRole('region', { name: 'Receipt ledger', exact: true });
    const row = ledger.getByRole('row').filter({ hasText: finalReference });
    await expect(row).toContainText('Direct payment');
    await row.getByRole('button', { name: 'Reverse', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Reverse this receipt?', exact: true });
    await expect(confirmation).toBeVisible();
    expect((await demo.read()).state.payments.find((item) => item.id === remainder.id)).toEqual(remainder);
    await uiWrite(page, demo, '/api/studio', () => confirmation.getByRole('button', { name: 'Confirm reversal', exact: true }).click());
    await expect(confirmation).toHaveCount(0);
    await page.reload();
    await balanceVisible(page, work.title, '₹250.01', '₹749.99');
    await expect(row.getByText('Reversed', { exact: true })).toBeVisible();
    await expect(row.getByText('History preserved', { exact: true })).toBeVisible();
    await expect(ledger.getByRole('row').filter({ hasText: partialReference }).getByText('Received', { exact: true })).toBeVisible();
    const reversed = directReceipts((await demo.read()).state, work.id, 100000, 25001);
    expect(reversed).toHaveLength(2);
    expect(reversed.find((item) => item.id === remainder.id)).toEqual({ ...remainder, reversedAt: expect.any(String) });
    expect(reversed.find((item) => item.id === partial[0].id)).toEqual(partial[0]);
    await publicProjection(request, work.id, [partialReference, finalReference]);
  } finally {
    await cleanup(demo, work.id);
  }
});

async function dashboardCounts(page: Page, visits: number, posts: number) {
  await page.goto('/studio');
  const overview = page.getByRole('region', { name: 'Studio overview', exact: true });
  for (const [label, count] of [['Yet to visit', visits], ['Yet to post', posts]] as const) {
    await expect(overview.getByRole('article').filter({ has: page.getByText(label, { exact: true }) }).locator('strong')).toHaveText(String(count));
  }
}

test('production stage changes persist and update visit/post dashboard counts without publishing', async ({ page, request, baseURL }) => {
  test.setTimeout(90_000);
  const demo = await localDemo(request, baseURL);
  const initial = (await demo.read()).state;
  const visits = initial.collaborations.filter((item) => item.stage === 'yet_to_visit').length;
  const posts = initial.collaborations.filter((item) => item.stage === 'yet_to_post').length;
  const work = qaCollaboration('stages');
  try {
    await createCollaboration(demo, work);
    await dashboardCounts(page, visits + 1, posts);
    for (const [stage, expectedVisits, expectedPosts] of [
      ['yet_to_record', visits, posts], ['yet_to_post', visits, posts + 1], ['posted', visits, posts],
    ] as const) {
      await page.goto('/studio/collaborations');
      await page.getByRole('button', { name: 'List view', exact: true }).click();
      const select = page.getByRole('combobox', { name: `Production stage for ${work.title}`, exact: true });
      await uiWrite(page, demo, '/api/studio', () => select.selectOption(stage));
      await expect(select).toHaveValue(stage);
      expect((await demo.read()).state.collaborations.find((item) => item.id === work.id)).toMatchObject({ stage, published: false });
      await dashboardCounts(page, expectedVisits, expectedPosts);
    }
    await publicProjection(request, work.id);
  } finally {
    await cleanup(demo, work.id);
  }
});

function futureDate(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function shootCard(page: Page, title: string) {
  return page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

function savedShoot(calendar: CalendarView, collaborationId: string): Shoot {
  const shoots = calendar.shoots.filter((item) => item.collaborationId === collaborationId);
  expect(shoots, 'A real persisted shoot must exist exactly once').toHaveLength(1);
  return shoots[0];
}

test('demo shoots persist private India times/reminders, reschedule revisions and confirmed cancellation history', async ({ page, request, baseURL }) => {
  test.setTimeout(90_000);
  const demo = await localDemo(request, baseURL);
  const work = qaCollaboration('shoots');
  const title = `QA private shoot ${work.id}`;
  const location = `QA PRIVATE location ${work.id} — never public`;
  const day = futureDate(7);
  const nextDay = futureDate(8);
  try {
    await createCollaboration(demo, work);
    await page.goto('/studio/calendar');
    await expect(page.getByRole('heading', { name: 'Sample shoots only', exact: true })).toBeVisible();
    await expect(page.getByText('Local demo saves sample shoots on this computer.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /Connect Google Calendar|Retry sync|Check Google sync/ })).toHaveCount(0);
    const form = page.getByRole('form', { name: 'Plan a shoot', exact: true });
    await form.getByRole('combobox', { name: 'Collaboration', exact: true }).selectOption(work.id);
    await form.getByLabel('Title (optional)', { exact: true }).fill(title);
    await form.getByLabel('Start date', { exact: true }).fill(day);
    await form.getByLabel('End date', { exact: true }).fill(day);
    await expect(form.getByLabel('Start time', { exact: true })).toHaveValue('09:00');
    await expect(form.getByLabel('End time', { exact: true })).toHaveValue('10:00');
    await expect(form.getByRole('combobox', { name: 'Remind me', exact: true })).toHaveValue('1440,60');
    await form.getByLabel('Location (optional)', { exact: true }).fill(location);
    const createdResponse = await uiWrite(page, demo, '/api/calendar', () => form.getByRole('button', { name: 'Save shoot', exact: true }).click());
    expect(createdResponse.request().postDataJSON()).toMatchObject({ action: 'save', expectedRevision: 0 });
    await expect(shootCard(page, title)).toBeVisible();
    const created = savedShoot((await demo.read()).calendar, work.id);
    expect(created).toMatchObject({ collaborationId: work.id, title, location, revision: 1, cancelled: false, status: 'pending', error: null,
      startsAt: `${day}T03:30:00.000Z`, endsAt: `${day}T04:30:00.000Z`, timeZone: 'Asia/Kolkata', reminderMinutes: [1440, 60] });
    await page.reload();
    const card = shootCard(page, title);
    await expect(card.getByText(location, { exact: true })).toBeVisible();
    await expect(card.getByText('Saved in studio · Google sync pending', { exact: true })).toBeVisible();
    await expect(card.getByText('Google synced', { exact: true })).toHaveCount(0);
    await expect(card.getByText('Reminders: 1 day and 1 hour before · preview only', { exact: true })).toBeVisible();
    await expect(card.locator('time')).toHaveAttribute('datetime', `${day}T03:30:00.000Z`);
    expect(savedShoot((await demo.read()).calendar, work.id)).toEqual(created);
    await publicProjection(request, work.id, [title, location, created.id]);

    await card.getByRole('button', { name: `Reschedule ${title}`, exact: true }).click();
    const edit = page.getByRole('form', { name: 'Reschedule shoot', exact: true });
    await expect(edit.getByLabel('Start date', { exact: true })).toHaveValue(day);
    await expect(edit.getByLabel('Location (optional)', { exact: true })).toHaveValue(location);
    await expect(edit.getByRole('combobox', { name: 'Remind me', exact: true })).toHaveValue('1440,60');
    await edit.getByLabel('Start date', { exact: true }).fill(nextDay);
    await edit.getByLabel('End date', { exact: true }).fill(nextDay);
    await edit.getByLabel('Start time', { exact: true }).fill('11:15');
    await edit.getByLabel('End time', { exact: true }).fill('12:45');
    const rescheduleResponse = await uiWrite(page, demo, '/api/calendar', () => edit.getByRole('button', { name: 'Save new time', exact: true }).click());
    expect(rescheduleResponse.request().postDataJSON()).toMatchObject({ action: 'save', expectedRevision: 1, shoot: { id: created.id } });
    await expect(edit).toHaveCount(0);
    await page.reload();
    await expect(card.locator('time')).toHaveAttribute('datetime', `${nextDay}T05:45:00.000Z`);
    await expect(card.getByText('Saved in studio · Google sync pending', { exact: true })).toBeVisible();
    const rescheduled = savedShoot((await demo.read()).calendar, work.id);
    expect(rescheduled).toEqual({ ...created, revision: 2, startsAt: `${nextDay}T05:45:00.000Z`, endsAt: `${nextDay}T07:15:00.000Z` });
    expect((await demo.read()).state.collaborations.find((item) => item.id === work.id)).toMatchObject({ dueDate: '', published: false });

    await card.getByRole('button', { name: `Cancel ${title}`, exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Cancel this shoot?', exact: true });
    await expect(confirmation).toContainText('stay in your studio history');
    expect(savedShoot((await demo.read()).calendar, work.id)).toEqual(rescheduled);
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(savedShoot((await demo.read()).calendar, work.id)).toEqual(rescheduled);
    await card.getByRole('button', { name: `Cancel ${title}`, exact: true }).click();
    const cancellationResponse = await uiWrite(page, demo, '/api/calendar', () => confirmation.getByRole('button', { name: 'Cancel shoot', exact: true }).click());
    expect(cancellationResponse.request().postDataJSON()).toEqual({ action: 'cancel', id: created.id, expectedRevision: 2 });
    await expect(confirmation).toHaveCount(0);
    await page.reload();
    await expect(card.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(card.getByText(location, { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: `Reschedule ${title}`, exact: true })).toHaveCount(0);
    await expect(card.getByRole('button', { name: `Cancel ${title}`, exact: true })).toHaveCount(0);
    expect(savedShoot((await demo.read()).calendar, work.id)).toEqual({ ...rescheduled, revision: 3, cancelled: true, status: 'cancelled' });
    await publicProjection(request, work.id, [title, location, created.id]);
  } finally {
    await cleanup(demo, work.id);
  }
});