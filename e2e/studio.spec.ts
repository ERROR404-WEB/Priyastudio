import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { StudioState } from '../src/lib/types';
import { invoicePaid, invoiceTotal, todayISO } from '../src/lib/domain';

test.afterEach(async ({ request }) => {
  const response = await request.get('/api/studio');
  if (!response.ok()) return;
  const data = await response.json();
  if (!data.demo) return;
  // Retain the audit trail, but never leave automated endorsements public after a failed run.
  for (const review of (data.state as StudioState).testimonials.filter((item) => item.name === 'QA synthetic reviewer' && item.approved)) {
    const result = await request.post('/api/studio', { headers: { Origin: 'http://localhost:3000' }, data: { command: { type: 'testimonial.approve', id: review.id, approved: false } } });
    expect(result.ok()).toBe(true);
  }
  for (const item of (data.state as StudioState).collaborations.filter((item) => item.id.startsWith('qa-review-work-') && item.published)) {
    const result = await request.post('/api/studio', { headers: { Origin: 'http://localhost:3000' }, data: { command: { type: 'collaboration.update', id: item.id, data: { published: false } } } });
    expect(result.ok()).toBe(true);
  }
});

test('public portfolio and studio navigation are usable on desktop and mobile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Priya');
  await page.getByRole('link', { name: /Explore my work/ }).click();
  await expect(page.getByRole('heading', { name: /A few stories/ })).toBeVisible();
  await page.goto('/studio');
  await expect(page.locator('.studio-demo-strip')).toContainText('Local demo');
  await page.getByRole('link', { name: 'Payments', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Payments');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open studio navigation' }).click();
  await page.getByRole('dialog').locator('.studio-nav-more summary').click();
  await page.getByRole('dialog').getByRole('link', { name: 'Brands', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('brands');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('persistent creation, partial/full receipts, reversals and a real PDF download', async ({ page, request }) => {
  test.setTimeout(90000);
  const original = await (await request.get('/api/studio')).json();
  expect(original.demo, 'Never run synthetic mutations against a hosted studio').toBe(true);
  const headers = { Origin: 'http://localhost:3000' };
  const mutation = async (command: unknown) => { const response = await request.post('/api/studio', { headers, data: { command } }); expect(response.ok(), await response.text()).toBe(true); };
  const state = async (): Promise<StudioState> => (await (await request.get('/api/studio')).json()).state;
  const suffix = Date.now(); const brandName = `QA sample brand ${suffix}`; const title = `QA sample story ${suffix}`;
  await page.goto('/studio/brands');
  await page.getByRole('button', { name: 'Add a brand', exact: true }).click();
  await page.getByLabel('Brand name', { exact: true }).fill(brandName);
  await page.getByLabel('Category', { exact: true }).fill('Testing');
  await page.getByRole('button', { name: 'Add brand', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/studio/collaborations');
  await page.getByRole('button', { name: 'New collaboration', exact: true }).click();
  await page.getByRole('combobox', { name: 'Brand', exact: true }).fill(brandName);
  await page.getByLabel('Collaboration title').fill(title);
  await page.getByRole('dialog').locator('summary').filter({ hasText: 'Optional details' }).click();
  await page.getByRole('combobox', { name: 'Category (optional)', exact: true }).fill('Testing');
  await page.getByLabel('Cover photograph').setInputFiles('public/images/hawtea.jpg');
  await expect(page.getByRole('button', { name: 'Create collaboration', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create collaboration', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('combobox', { name: 'Stage', exact: true }).selectOption('edited');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await state()).collaborations.find((item) => item.title === title)?.stage).toBe('edited');
  await mutation({ type: 'profile.update', data: { ...original.state.profile, issuerDetails: 'QA synthetic issuer — not for billing', paymentDetails: 'QA synthetic payment instructions — not payable' } });
  try {
    await page.goto('/studio/invoices');
    await page.getByRole('button', { name: 'Create invoice', exact: true }).click();
    await page.getByRole('combobox', { name: 'Collaboration', exact: true }).selectOption({ label: `${title} · ${brandName}` });
    await page.getByLabel('Item 1 description').fill('Synthetic testing deliverable');
    await page.getByLabel('Quantity', { exact: true }).fill('2');
    await page.getByLabel('Rate (₹)', { exact: true }).fill('500.01');
    await page.getByRole('button', { name: 'Create draft invoice' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const current = await state();
    const invoice = current.invoices.find((item) => item.brandId === current.brands.find((brand) => brand.name === brandName)?.id)!;
    expect(invoice.status).toBe('draft'); expect(invoiceTotal(invoice)).toBe(100002);
    expect(invoice.notes).toContain('QA synthetic payment instructions');
    await page.getByRole('row').filter({ hasText: brandName }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Issue invoice', exact: true }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Issue invoice', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.keyboard.press('Escape');
    const issued = (await state()).invoices.find((item) => item.id === invoice.id)!;
    expect(issued.status).toBe('issued');
    const record = async (amount: string, reference: string) => {
      await page.getByRole('button', { name: 'Record payment', exact: true }).click();
      await page.getByRole('combobox', { name: 'Collaboration', exact: true }).selectOption(issued.collaborationId);
      await page.getByRole('combobox', { name: 'Invoice', exact: true }).selectOption(issued.id);
      await page.getByLabel('Amount received (₹)').fill(amount);
      await page.getByRole('dialog').locator('summary').filter({ hasText: 'Optional details' }).click();
      await page.getByLabel('Reference (optional)').fill(reference);
      await page.getByRole('dialog').getByRole('button', { name: 'Record payment', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    await page.goto('/studio/payments');
    await record('250.01', `QA-partial-${suffix}`);
    await page.reload();
    expect(invoiceTotal(issued) - invoicePaid(issued, (await state()).payments)).toBe(75001);
    await record('750.01', `QA-final-${suffix}`);
    expect(invoicePaid(issued, (await state()).payments)).toBe(100002);
    await page.getByRole('row').filter({ hasText: `QA-final-${suffix}` }).getByRole('button', { name: 'Reverse', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm reversal' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(invoiceTotal(issued) - invoicePaid(issued, (await state()).payments)).toBe(75001);
    await page.goto('/studio/invoices');
    await page.getByRole('row').filter({ hasText: brandName }).getByRole('button').first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF' }).click();
    const download = await downloadPromise;
    const bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(2000);
    expect(download.suggestedFilename()).toBe(`SAMPLE-${issued.number}.pdf`);
  } finally {
    await mutation({ type: 'profile.update', data: original.state.profile });
    // Preserve test audit/history, but keep synthetic QA records out of balances and public work.
    const current = await state();
    const brand = current.brands.find((item) => item.name === brandName);
    for (const invoice of current.invoices.filter((item) => item.brandId === brand?.id)) {
      for (const payment of current.payments.filter((item) => item.invoiceId === invoice.id && !item.reversedAt)) await mutation({ type: 'payment.reverse', id: payment.id });
      await mutation({ type: 'invoice.void', id: invoice.id });
    }
  }
});

test('brand comments and acceptance, testimonial consent and moderation, link revocation', async ({ page, request }) => {
  test.setTimeout(90000);
  const original = await (await request.get('/api/studio')).json(); expect(original.demo).toBe(true);
  const headers = { Origin: 'http://localhost:3000' };
  const mutate = async (command: unknown) => { const response = await request.post('/api/studio', { headers, data: { command } }); expect(response.ok(), await response.text()).toBe(true); return (await response.json()).state as StudioState; };
  const id = `qa-proposal-${Date.now()}`;
  const state = original.state as StudioState;
  const campaign = { id: `qa-review-work-${Date.now()}`, brandId: state.brands[0].id };
  await mutate({ type: 'collaboration.create', data: { ...campaign, title: 'QA synthetic review campaign', category: 'Testing', stage: 'posted', dueDate: todayISO(), image: '', reelUrl: '', description: 'Automated local test only.' } });
  await mutate({ type: 'collaboration.update', id: campaign.id, data: { published: true } });
  await mutate({ type: 'proposal.create', data: { id, brandId: campaign.brandId, title: 'QA synthetic brand proposal', items: [{ description: 'A sample reel', quantity: 1, unitPrice: 500000 }], rights: 'Testing only. Organic use.', timeline: 'Testing only. Within seven days.', validUntil: todayISO() } });
  const share = async (targetId: string, scope: string) => {
    const response = await request.post('/api/studio/share', { headers, data: { targetId, scope } }); expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const proposalShare = await share(id, 'proposal');
  await page.goto(proposalShare.shareUrl);
  await expect(page.getByRole('heading', { name: /A lovely story/ })).toBeVisible();
  await page.getByLabel('Your name', { exact: true }).fill('QA sample reviewer');
  await page.getByLabel('Your note', { exact: true }).fill('Synthetic test feedback. Can we discuss the date?');
  await page.getByLabel('Suggested total budget in ₹', { exact: false }).fill('4500');
  await page.getByRole('button', { name: 'Send a little note' }).click();
  await expect(page.getByText('Your note is saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Accept this proposal' }).click();
  await page.getByLabel('Your full name', { exact: true }).fill('QA sample reviewer');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm acceptance' }).click();
  await expect(page.getByRole('heading', { name: 'It’s a lovely yes.' })).toBeVisible();
  const reviewShare = await share(campaign.id, 'review');
  await page.goto(reviewShare.shareUrl);
  await page.getByLabel('Your name', { exact: true }).fill('QA synthetic reviewer');
  await page.getByLabel('Your experience').fill(`Synthetic browser test ${id} — not an actual brand endorsement.`);
  await page.getByRole('button', { name: 'Send your testimonial' }).click();
  expect(await page.getByRole('checkbox').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send your testimonial' }).click();
  await expect(page.getByRole('heading', { name: 'A note worth keeping.' })).toBeVisible();
  let current = (await (await request.get('/api/studio')).json()).state as StudioState;
  const review = current.testimonials.find((item) => item.text.includes(id))!;
  expect(review.approved).toBe(false);
  expect((await (await request.get('/api/public/portfolio')).json()).portfolio.testimonials.some((item: { id: string }) => item.id === review.id)).toBe(false);
  await page.goto('/studio/portfolio');
  await page.getByRole('button', { name: /Kind words/ }).click();
  const card = page.locator('article').filter({ hasText: id });
  await card.getByRole('switch').click();
  await expect(card.getByRole('switch')).toBeChecked();
  await expect.poll(async () => (await (await request.get('/api/public/portfolio')).json()).portfolio.testimonials.some((item: { id: string }) => item.id === review.id)).toBe(true);
  await card.getByRole('switch').click();
  await expect(card.getByRole('switch')).not.toBeChecked();
  current = (await (await request.get('/api/studio')).json()).state;
  for (const link of current.shares.filter((item) => (item.targetId === id || item.scope === 'review' && item.targetId === campaign.id) && !item.revokedAt)) await mutate({ type: 'share.revoke', id: link.id });
  await page.goto(proposalShare.shareUrl);
  await expect(page.getByText('This invitation has expired', { exact: false })).toBeVisible();
  const publicData = await (await request.get('/api/public/portfolio')).json();
  expect(publicData.portfolio.profile).not.toHaveProperty('issuerDetails');
  expect(publicData.portfolio).not.toHaveProperty('payments');
});

test('all studio routes and public portfolio fit a 320px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const route of ['/', '/studio', '/studio/brands', '/studio/collaborations', '/studio/proposals', '/studio/invoices', '/studio/payments', '/studio/portfolio', '/studio/settings', '/login']) {
    await page.goto(route);
    if (route.startsWith('/studio')) await expect(page.getByRole('button', { name: 'Open studio navigation' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), route).toBe(true);
  }
});