import { test, expect, type Page } from '@playwright/test';
import { applyCommand } from '../src/lib/domain';
import { createDemoState } from '../src/lib/seed';
import type { CalendarAction, CalendarView, Shoot } from '../src/lib/calendar';
import type { Command } from '../src/lib/types';

// UI-only HTTP fixtures: never mutate the user's demo files or contact Google.
const shoot: Shoot = { id: 'browser-shoot', collaborationId: 'demo-work-1', title: 'Browser shoot', startsAt: '2026-10-03T03:30:00.000Z', endsAt: '2026-10-03T04:30:00.000Z', timeZone: 'Asia/Kolkata', location: 'Synthetic location', reminderMinutes: [1440, 60], revision: 1, cancelled: false, status: 'pending', error: null };
async function studio(page: Page) {
  await page.route('**/api/studio', (route) => route.fulfill({ json: { state: createDemoState(), demo: true } }));
  await page.route('https://accounts.google.com/**', (route) => route.abort());
  await page.route('https://www.googleapis.com/**', (route) => route.abort());
}

test('calendar validates India times, safely retries a lost save, reschedules and confirms cancellation', async ({ page }) => {
  await studio(page);
  const view: CalendarView = { configured: true, connected: true, demo: false, reconnectRequired: false, shoots: [] };
  const writes: CalendarAction[] = [];
  let loseResponse = true;
  await page.route('**/api/calendar', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: view });
    const action = route.request().postDataJSON() as CalendarAction; writes.push(action);
    if (action.action === 'save') {
      if (loseResponse) { loseResponse = false; return route.abort('failed'); }
      view.shoots = [{ ...shoot, ...action.shoot, revision: action.expectedRevision + 1, status: 'synced' }];
    } else if (action.action === 'cancel') {
      view.shoots = [{ ...view.shoots[0], revision: 3, cancelled: true, status: 'error', error: 'Cancelled in studio; Google deletion is not confirmed. Retry deletion.' }];
    } else if (action.action === 'retry') view.shoots[0] = { ...view.shoots[0], status: 'cancelled', error: null };
    return route.fulfill({ json: view });
  });
  await page.goto('/studio/calendar');
  await page.getByRole('combobox', { name: 'Collaboration', exact: true }).selectOption('demo-work-1');
  await page.getByLabel('Title (optional)', { exact: true }).fill('Browser shoot');
  await page.getByLabel('Start date', { exact: true }).fill('2026-10-03');
  await page.getByLabel('End date', { exact: true }).fill('2026-10-03');
  await page.getByLabel('End time', { exact: true }).fill('08:00');
  await page.getByRole('button', { name: 'Save shoot', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'end after the start' })).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByLabel('End time', { exact: true }).fill('10:00');
  await page.getByRole('button', { name: 'Save shoot', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /fetch/i })).toBeVisible();
  await expect(page.getByLabel('Start date', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry this save' }).click();
  await expect(page.getByText('Google synced', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  expect(writes[1]).toMatchObject({ action: 'save', expectedRevision: 0, shoot: { collaborationId: 'demo-work-1', title: 'Browser shoot', startsAt: '2026-10-03T03:30:00.000Z', endsAt: '2026-10-03T04:30:00.000Z', reminderMinutes: [1440, 60] } });
  await page.getByRole('button', { name: 'Check Google sync', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sync this shoot to Google?' })).toContainText('not a read-only check');
  await page.keyboard.press('Escape');
  expect(writes).toHaveLength(2);
  await page.getByRole('button', { name: 'Reschedule Browser shoot', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Collaboration', exact: true })).toBeFocused();
  await page.getByLabel('Start date', { exact: true }).fill('2026-10-04');
  await page.getByLabel('End date', { exact: true }).fill('2026-10-04');
  await page.getByRole('button', { name: 'Save new time', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save shoot', exact: true })).toBeVisible();
  expect(writes[2]).toMatchObject({ action: 'save', expectedRevision: 1, shoot: { startsAt: '2026-10-04T03:30:00.000Z', endsAt: '2026-10-04T04:30:00.000Z' } });
  await page.getByRole('button', { name: 'Cancel Browser shoot', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(writes).toHaveLength(3);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel shoot', exact: true }).click();
  await expect(page.getByText('Google deletion pending', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry deletion', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Retry Google deletion?' })).toBeVisible();
  expect(writes).toHaveLength(4);
  await page.getByRole('dialog').getByRole('button', { name: 'Retry deletion', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  expect(writes[3]).toMatchObject({ action: 'cancel', expectedRevision: 2 });
  expect(writes[4]).toMatchObject({ action: 'retry' });
});

test('a shoot can start a brand-new brand and collaboration without leaving the calendar', async ({ page }) => {
  let state = createDemoState(); const commands: Command[] = []; const saves: CalendarAction[] = [];
  await page.route('**/api/studio', async (route) => {
    if (route.request().method() === 'POST') {
      const { command } = route.request().postDataJSON() as { command: Command };
      commands.push(command); state = applyCommand(state, command, 'browser-fixture', new Date().toISOString());
    }
    return route.fulfill({ json: { state, demo: true } });
  });
  const view: CalendarView = { configured: false, connected: false, demo: true, reconnectRequired: false, shoots: [] };
  await page.route('**/api/calendar', async (route) => {
    if (route.request().method() === 'POST') {
      const action = route.request().postDataJSON() as CalendarAction; saves.push(action);
      if (action.action === 'save') view.shoots = [{ ...shoot, ...action.shoot, revision: 1, status: 'pending' }];
    }
    return route.fulfill({ json: view });
  });
  await page.goto('/studio/calendar');
  await page.getByRole('combobox', { name: 'Collaboration', exact: true }).selectOption({ label: '+ New collaboration (new or existing brand)' });
  await page.getByRole('combobox', { name: 'Brand', exact: true }).fill('Blue Tokai');
  await expect(page.getByText(/New brand: “Blue Tokai”/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Brand category', exact: true }).fill('Cafés');
  await page.getByLabel('Collaboration title', { exact: true }).fill('Tasting visit');
  await page.getByRole('button', { name: 'Save shoot', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tasting visit', level: 3 })).toBeVisible();
  expect(commands.map((command) => command.type)).toEqual(['brand.create', 'collaboration.create']);
  const [brand, collaboration] = commands as [Extract<Command, { type: 'brand.create' }>, Extract<Command, { type: 'collaboration.create' }>];
  expect(brand.data).toMatchObject({ name: 'Blue Tokai', category: 'Cafés' });
  expect(collaboration.data).toMatchObject({ brandId: brand.data.id, title: 'Tasting visit', category: 'Cafés', stage: 'yet_to_visit' });
  expect(saves[0]).toMatchObject({ action: 'save', shoot: { collaborationId: collaboration.data.id } });
});

test('a misspelled brand prompts to reuse the existing one and cannot be saved unanswered', async ({ page }) => {
  let state = createDemoState(); const commands: Command[] = [];
  await page.route('**/api/studio', async (route) => {
    if (route.request().method() === 'POST') {
      const { command } = route.request().postDataJSON() as { command: Command };
      commands.push(command); state = applyCommand(state, command, 'browser-fixture', new Date().toISOString());
    }
    return route.fulfill({ json: { state, demo: true } });
  });
  const view: CalendarView = { configured: false, connected: false, demo: true, reconnectRequired: false, shoots: [] };
  await page.route('**/api/calendar', (route) => route.fulfill({ json: view }));
  await page.goto('/studio/calendar');
  await page.getByRole('combobox', { name: 'Collaboration', exact: true }).selectOption({ label: '+ New collaboration (new or existing brand)' });
  const brand = page.getByRole('combobox', { name: 'Brand', exact: true });
  await brand.fill('nord cofee');
  await expect(page.getByText('Is this the same brand?')).toBeVisible();
  await page.getByLabel('Collaboration title', { exact: true }).fill('Second visit');
  await page.getByRole('button', { name: 'Save shoot', exact: true }).click();
  expect(await brand.evaluate((el) => (el as HTMLInputElement).validationMessage)).toContain('similar name');
  expect(commands).toHaveLength(0);
  await page.getByRole('button', { name: 'Yes, use “Nord Coffee”' }).click();
  await expect(brand).toHaveValue('Nord Coffee');
  await expect(page.getByText('Is this the same brand?')).toHaveCount(0);
  await brand.fill('Nordic Bakes');
  await expect(page.getByText('Is this the same brand?')).toBeVisible();
  await page.getByRole('button', { name: /is a different brand/ }).click();
  await expect(page.getByText('Is this the same brand?')).toHaveCount(0);
});

test('calendar keeps disconnect available after setup loss and fits narrow viewports', async ({ page }) => {
  await studio(page);
  const view: CalendarView = { configured: false, connected: true, demo: false, reconnectRequired: false, shoots: [{ ...shoot, title: 'Long title '.repeat(20), location: 'x'.repeat(500) }] };
  const writes: CalendarAction[] = [];
  await page.route('**/api/calendar', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: view });
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...view, connected: false, notice: 'Disconnected locally. Google revocation could not be confirmed.' } });
  });
  await page.goto('/studio/calendar');
  await expect(page.getByRole('heading', { name: 'Owner setup required' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Google Calendar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry sync', exact: true })).toHaveCount(0);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `calendar width ${width}`).toBe(true);
  }
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('existing Google events stay in place');
  expect(writes).toHaveLength(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Disconnect calendar', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'revocation could not be confirmed' })).toBeVisible();
  expect(writes).toEqual([{ action: 'disconnect' }]);
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
});