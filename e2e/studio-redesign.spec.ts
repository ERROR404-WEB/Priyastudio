import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CalendarView } from '../src/lib/calendar';

const routes = ['/studio', '/studio/collaborations', '/studio/calendar', '/studio/payments', '/studio/brands', '/studio/proposals', '/studio/invoices', '/studio/portfolio', '/studio/settings', '/login'];
const primary = ['Home', 'Collaborations', 'Shoot calendar', 'Payments'];
const secondary = ['Brands', 'Rate cards', 'Invoices', 'Portfolio', 'Settings'];

test.beforeEach(async ({ page }) => {
  // Only visual calendar data is stubbed. Studio reads real data; these tests never submit writes.
  const view: CalendarView = { demo: true, configured: false, connected: false, reconnectRequired: false, shoots: [{
    id: 'qa-visual-shoot', collaborationId: 'qa-visual-work', title: 'QA upcoming lavender shoot',
    startsAt: '2099-10-01T04:00:00.000Z', endsAt: '2099-10-01T05:00:00.000Z', timeZone: 'Asia/Kolkata',
    location: 'Private sample location', reminderMinutes: [1440, 60], revision: 1, cancelled: false, status: 'pending', error: null,
  }] };
  await page.route('**/api/calendar', async (route) => {
    expect(route.request().method(), 'Visual tests must not save calendar data').toBe('GET');
    await route.fulfill({ json: view });
  });
  await page.route('**/api/studio', async (route) => {
    expect(route.request().method(), 'Visual tests must not mutate the studio').toBe('GET');
    await route.continue();
  });
});

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((value) => localStorage.setItem('hey-priya-theme', value), theme);
}

async function fits(page: Page, context: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), { message: context }).toBeLessThanOrEqual(0);
}

async function touchTargets(root: Locator) {
  const small = await root.locator('button, a, input, select, textarea, summary').evaluateAll((elements) => elements.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || !element.checkVisibility() || element.classList.contains('studio-skip')) return [];
    // A wrapping label is also the native checkbox's pointer target.
    const target = element.matches('input[type="checkbox"]') ? element.closest('label') ?? element : element;
    const box = target.getBoundingClientRect();
    return box.height < 44 || box.width < 44 ? [`${element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 60) || element.getAttribute('name')}: ${box.width}×${box.height}`] : [];
  }));
  expect(small, 'Every visible control has a 44px target').toEqual([]);
}

async function themedSurface(locator: Locator, token: string) {
  // Catch hardcoded light surfaces in dark mode, including portalled dialogs.
  await expect.poll(() => locator.evaluate((element, name) => {
    const probe = document.createElement('span'); probe.style.backgroundColor = `var(${name})`; element.append(probe);
    const expected = getComputedStyle(probe).backgroundColor; probe.remove();
    return getComputedStyle(element).backgroundColor === expected;
  }, token)).toBe(true);
}

test('Home exposes four clear metrics, working quick actions and private upcoming shoots', async ({ page }) => {
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.locator('.studio-demo-strip')).toContainText('Local demo');
  await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search collaborations, brands, invoices…');
  const stats = page.locator('.studio-stats');
  await expect(stats.locator('article')).toHaveCount(4);
  for (const label of ['Money received', 'Pending payments', 'Yet to visit', 'Yet to post']) await expect(stats.getByText(label, { exact: true })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/\b(invoiced|overdue)\b/i);
  await expect(page.getByRole('region', { name: 'Upcoming shoots' })).toContainText('QA upcoming lavender shoot');
  await page.getByRole('link', { name: 'Add collaboration', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add collaboration' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/studio');
  await page.getByRole('link', { name: 'Plan shoot', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Plan a shoot' })).toBeVisible();
  await page.goto('/studio');
  await page.getByRole('link', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record payment', exact: true }).first()).toBeVisible();
});

test('four primary destinations and keyboard More keep desktop and mobile navigation usable', async ({ page }) => {
  await page.goto('/studio');
  const desktop = page.locator('.studio-sidebar').getByRole('navigation');
  for (const name of primary) await expect(desktop.getByRole('link', { name, exact: true })).toBeVisible();
  for (const name of secondary) await expect(desktop.getByRole('link', { name, exact: true })).not.toBeVisible();
  await desktop.locator('summary').focus(); await page.keyboard.press('Enter');
  for (const name of secondary) await expect(desktop.getByRole('link', { name, exact: true })).toBeVisible();
  await desktop.getByRole('link', { name: 'Brands', exact: true }).click();
  await expect(desktop.getByRole('link', { name: 'Brands', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(desktop.getByRole('link', { name: 'Brands', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  const trigger = page.getByRole('button', { name: 'Open studio navigation' });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Studio navigation' });
  await expect(drawer.getByRole('link', { name: 'Brands', exact: true })).toBeVisible();
  const last = drawer.getByRole('link', { name: 'View public portfolio' });
  await last.focus(); await page.keyboard.press('Tab');
  await expect(drawer.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(last).toBeFocused();
  await touchTargets(drawer);
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.getByRole('link', { name: 'Shoot calendar', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Shoot calendar', exact: true })).toBeVisible();
  await trigger.click();
  for (const name of secondary) await expect(drawer.getByRole('link', { name, exact: true })).not.toBeVisible();
  await drawer.locator('summary').click();
  await drawer.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/settings$/);
});

test('theme preference travels from public to Studio and back, including reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/studio');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await themedSurface(page.locator('.studio-app'), '--background');
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} portal forms support keyboard, clear fields and 44px controls at 320px`, async ({ page }, info) => {
    await setTheme(page, theme);
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/studio/collaborations');
    const trigger = page.getByRole('button', { name: 'New collaboration', exact: true });
    await trigger.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await themedSurface(dialog, '--surface-raised');
    await expect(dialog.getByLabel('Collaboration title')).toBeVisible();
    const summary = dialog.locator('summary');
    await summary.focus(); await page.keyboard.press('Enter');
    await expect(dialog.getByLabel('Posting deadline (optional)')).not.toHaveAttribute('required', '');
    await touchTargets(dialog);
    await fits(page, `${theme} collaboration dialog`);
    const submit = dialog.getByRole('button', { name: 'Create collaboration', exact: true });
    await submit.focus(); await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
    await page.screenshot({ path: info.outputPath('collaboration-dialog.png') });
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    await page.goto('/studio/payments');
    await page.getByRole('button', { name: 'Record payment', exact: true }).first().click();
    await themedSurface(dialog, '--surface-raised');
    await expect(dialog.getByRole('combobox', { name: 'Collaboration', exact: true })).toBeVisible();
    await dialog.locator('summary').click();
    await expect(dialog.getByLabel('Reference (optional)')).toBeVisible();
    await touchTargets(dialog); await fits(page, `${theme} payment dialog`);
    await page.keyboard.press('Escape');
  });

  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`${theme} Studio and login fit ${width}px without clipping controls`, async ({ page }, info) => {
      test.setTimeout(120000);
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(route);
        await expect(page.locator(route === '/login' ? '.studio-login-form' : '.studio-main')).toBeVisible();
        if (route === '/studio/calendar') await expect(page.getByRole('form', { name: 'Plan a shoot' })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await themedSurface(page.locator(route === '/login' ? '.studio-login' : '.studio-app'), '--background');
        await fits(page, `${route} ${theme} ${width}px`);
        await touchTargets(page.locator(route === '/login' ? '.studio-login' : '.studio-app'));
        if (route === '/studio' && (width === 320 || width === 1440)) await page.screenshot({ path: info.outputPath('home.png'), fullPage: true });
        if (route === '/studio/collaborations') {
          await page.getByRole('button', { name: 'Board view' }).click();
          await fits(page, `board ${theme} ${width}px`);
          await page.getByRole('button', { name: 'List view' }).click();
          await fits(page, `list ${theme} ${width}px`);
        }
      }
    });
  }
}

test('Studio theme transitions respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/studio');
  const toggle = page.getByRole('button', { name: 'Toggle color theme' });
  await toggle.click();
  expect(await page.locator('.studio-card').first().evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await page.locator('.studio-card').first().evaluate((element) => getComputedStyle(element).transitionDuration)).not.toBe('0s');
});