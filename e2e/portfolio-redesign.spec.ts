import { expect, test, type Page } from '@playwright/test';

const theme = (page: Page) => page.locator('html');
const transform = (page: Page, selector: string) => page.locator(selector).evaluate((el) => getComputedStyle(el).transform);
const noOverflow = async (page: Page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
};

test('theme follows system, persists an explicit choice, and survives navigation', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  const toggle = page.getByRole('button', { name: 'Toggle color theme' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const box = await toggle.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(theme(page)).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(theme(page)).toHaveAttribute('data-theme', 'light');
  await page.goto('/login');
  await expect(theme(page)).toHaveAttribute('data-theme', 'light');
  await page.goto('/');
  await toggle.click();
  await page.goto('/login');
  await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.studio-login')).toHaveCSS('background-color', 'rgb(24, 19, 34)');
  await expect(page.getByRole('textbox', { name: 'Your phone number' })).toHaveCSS('color', 'rgb(246, 239, 255)');
});

test('system changes and cross-tab preference changes are applied without reload', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(theme(page)).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  const other = await context.newPage();
  await other.goto('/');
  await other.evaluate(() => localStorage.setItem('hey-priya-theme', 'light'));
  await expect(theme(page)).toHaveAttribute('data-theme', 'light');
  await other.evaluate(() => localStorage.removeItem('hey-priya-theme'));
  await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  await other.close();
});

test('blocked storage falls back to the OS without hydration errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'getItem', { value() { throw new DOMException('Blocked', 'SecurityError'); } });
    Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.goto('/');
  await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(theme(page)).toHaveAttribute('data-theme', 'light');
  expect(errors.filter((message) => /hydration|uncaught|didn't match/i.test(message))).toEqual([]);
});

test('public work filters and navigation preserve the approved public projection', async ({ page, request }) => {
  const response = await request.get('/api/public/portfolio');
  const { portfolio, demo } = await response.json();
  expect(portfolio).not.toHaveProperty('payments');
  expect(portfolio.profile).not.toHaveProperty('paymentDetails');
  expect(portfolio.collaborations.every((item: { published: boolean }) => item.published)).toBe(true);
  const brandsIn = (items: { brandId: string }[]) => new Set(items.map((item) => item.brandId)).size;
  await page.goto('/');
  await page.getByRole('link', { name: 'Explore my work', exact: true }).click();
  await expect(page).toHaveURL(/#work$/);
  await expect(page.locator('.portfolio-work')).toHaveCount(brandsIn(portfolio.collaborations));
  if (demo) await expect(page.locator('.portfolio-demo')).toContainText('sample');
  const categories = [...new Set<string>(portfolio.collaborations.map((item: { category: string }) => item.category))];
  for (const category of categories) {
    const inCategory = portfolio.collaborations.filter((item: { category: string }) => item.category === category);
    await page.getByRole('button', { name: category, exact: true }).click();
    await expect(page.getByRole('button', { name: category, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.portfolio-work')).toHaveCount(brandsIn(inCategory));
    for (const brandName of new Set<string>(inCategory.map((item: { brandName: string }) => item.brandName))) {
      await expect(page.locator('.portfolio-work').getByRole('heading', { name: brandName, exact: true })).toBeVisible();
    }
  }
  await page.getByRole('button', { name: 'All stories', exact: true }).click();
  await expect(page.locator('.portfolio-work')).toHaveCount(brandsIn(portfolio.collaborations));
  await expect(page.locator('.testimonial-grid blockquote')).toHaveCount(portfolio.testimonials.length);
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/');
  await expect(page.locator('#work .section-heading > p')).toHaveText('A collection of places, moments and brands, through my lens.');
  await page.locator('.portfolio-menu summary').click();
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Collaborate', exact: true }).click();
  await expect(page).toHaveURL(/#contact$/);
  await expect(page.locator('.portfolio-menu')).not.toHaveAttribute('open', '');
  await expect(page.getByRole('link', { name: /Let’s talk collaborations/ })).toHaveAttribute('href', `mailto:${portfolio.profile.email}`);
  await noOverflow(page);
});

test('each brand has one card whose dialog lists all of its stories; brand wall and search narrow the archive', async ({ page, request }) => {
  const { portfolio } = await (await request.get('/api/public/portfolio')).json();
  const brands = new Set(portfolio.collaborations.map((item: { brandId: string }) => item.brandId));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: new RegExp(`^${brands.size} brands?`) })).toBeVisible();
  const first = portfolio.collaborations[0];
  const stories = portfolio.collaborations.filter((item: { brandId: string }) => item.brandId === first.brandId);
  await page.locator('.portfolio-work').getByRole('button', { name: first.brandName, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: first.brandName });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.brand-reels li')).toHaveCount(stories.length);
  for (const story of stories) await expect(dialog.getByRole('heading', { name: story.title, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.locator('.brand-wall').getByRole('button', { name: new RegExp(`^${first.brandName}`) }).click();
  await expect(page.getByRole('dialog', { name: first.brandName })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search brands or stories' }).fill('zz-no-such-brand');
  await expect(page.locator('.portfolio-work')).toHaveCount(0);
  await page.getByRole('button', { name: /Show all stories/ }).click();
  await expect(page.locator('.portfolio-work')).toHaveCount(brands.size);
  await noOverflow(page);
});

test('fine-pointer hero depth, scroll parallax, card tilt and decorative follower are real transforms', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('.portfolio')).toHaveAttribute('data-motion', 'ready');
  const hero = page.locator('.hero-visual');
  const box = (await hero.boundingBox())!;
  const initial = await transform(page, '.hero-photo');
  await page.mouse.move(box.x + box.width * .85, box.y + box.height * .2);
  await expect.poll(() => transform(page, '.hero-photo')).not.toBe(initial);
  const pointer = await transform(page, '.hero-photo');
  await page.evaluate(() => scrollTo({ top: 280, behavior: 'instant' }));
  await expect.poll(() => transform(page, '.hero-photo')).not.toBe(pointer);
  const card = page.locator('.portfolio-work-photo').first();
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(2, 2);
  const untilted = await card.evaluate((el) => getComputedStyle(el).transform);
  const cardBox = (await card.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width * .8, cardBox.y + cardBox.height * .3);
  await expect.poll(() => card.evaluate((el) => getComputedStyle(el).transform)).not.toBe(untilted);
  await expect.poll(() => card.locator('img').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)).toBeGreaterThan(1);
  await expect(page.locator('.portfolio-follower')).toHaveCSS('pointer-events', 'none');
  const all = page.getByRole('button', { name: 'All stories', exact: true });
  await all.scrollIntoViewIfNeeded();
  await all.hover();
  await expect(page.locator('.portfolio-follower')).toHaveCSS('opacity', '1');
  await all.click();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).cursor)).not.toBe('none');
  await noOverflow(page);
});

test('reduced motion disables depth, tilt, follower and reveal translations, including live changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.portfolio')).toHaveAttribute('data-motion', 'static');
  const initial = await transform(page, '.hero-photo');
  await page.mouse.move(1150, 350);
  await page.evaluate(() => scrollTo({ top: 200, behavior: 'instant' }));
  expect(await transform(page, '.hero-photo')).toBe(initial);
  await expect(page.locator('.portfolio-follower')).toHaveCSS('display', 'none');
  for (const selector of ['.hero-photo', '.detail-photo', '.portfolio-work-photo', '.portfolio-work-photo img', '[data-reveal]']) {
    for (const item of await page.locator(selector).all()) {
      await expect(item).toHaveCSS('transform', 'none');
      await expect(item).toHaveCSS('opacity', '1');
    }
  }
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.portfolio')).toHaveAttribute('data-motion', 'ready');
});

test('touch has scroll motion with no cursor dependency', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/');
  await expect(page.locator('.portfolio')).toHaveAttribute('data-motion', 'ready');
  await expect(page.locator('.hero-visual')).toHaveCSS('position', 'sticky');
  await expect(page.locator('.portfolio-follower')).toHaveCSS('display', 'none');
  await noOverflow(page);
  await context.close();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme} portfolio fits every breakpoint and saves desktop/mobile evidence`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(theme(page)).toHaveAttribute('data-theme', colorScheme);
    for (const width of [320, 390, 768, 1024, 1440, 1600]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.evaluate(() => document.fonts.ready);
      await noOverflow(page);
      const toggle = (await page.getByRole('button', { name: 'Toggle color theme' }).boundingBox())!;
      const logo = (await page.getByRole('link', { name: 'Hey Priya home', exact: true }).boundingBox())!;
      expect(logo.x + logo.width).toBeLessThanOrEqual(toggle.x);
      if (width === 320 || width === 1600) {
        for (const image of await page.locator('.portfolio-work-photo img').all()) await image.scrollIntoViewIfNeeded();
        await expect.poll(() => page.locator('.portfolio img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
        await page.screenshot({ path: testInfo.outputPath(`portfolio-${colorScheme}-${width}.png`), fullPage: true });
      }
    }
  });
}

test('server-rendered content and mobile navigation work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 780 }, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Priya');
  await expect(page.locator('.hero-photo img')).toBeVisible();
  await expect(page.locator('.hero-copy')).toHaveCSS('opacity', '1');
  await page.locator('.portfolio-menu summary').click();
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Selected work' }).click();
  await expect(page).toHaveURL(/#work$/);
  await expect(page.locator('.portfolio-work').first()).toBeVisible();
  await noOverflow(page);
  await context.close();
});

test('theme initializes before hydration and ignores invalid saved values', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route(/\/_next\/.*\.js(?:\?|$)/, (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem('hey-priya-theme', 'not-a-theme'));
  await page.goto('/');
  await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(24, 19, 34)');
  await page.addInitScript(() => localStorage.setItem('hey-priya-theme', 'light'));
  await page.reload();
  await expect(theme(page)).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(252, 249, 244)');
});

test('keyboard can toggle themes, close mobile navigation and use filters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Toggle color theme' });
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('.portfolio-menu')).toHaveAttribute('open', '');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'About me' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.portfolio-menu summary')).toBeFocused();
  await expect(page.locator('.portfolio-menu')).not.toHaveAttribute('open', '');
  const filter = page.getByRole('group', { name: 'Filter selected work' }).getByRole('button').nth(1);
  await filter.focus();
  await page.keyboard.press('Enter');
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status')).not.toContainText('All stories');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme} semantic palette and invitation form remain legible`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');
    const contrasts = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const luminance = (token: string) => {
        const hex = style.getPropertyValue(token).trim().replace('#', '');
        const value = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
        const rgb = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255).map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
        return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
      };
      return [
        ['--foreground', '--background'], ['--muted', '--background'],
        ['--muted', '--surface-soft'], ['--primary', '--surface-soft'],
        ['--on-primary', '--primary'], ['--photo-ink', '--photo-paper'],
        ['--error-text', '--error-bg'], ['--success-text', '--success-bg'],
      ].map(([text, surface]) => {
        const a = luminance(text); const b = luminance(surface);
        return { text, surface, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      });
    });
    for (const pair of contrasts) expect(pair.ratio, `${pair.text} on ${pair.surface}`).toBeGreaterThanOrEqual(4.5);
    // Read-only fixture: exercise the real invitation component without creating a share or submitting feedback.
    await page.route('**/api/public/review/portfolio-theme-check', (route) => route.fulfill({ json: {
      demo: true, creatorName: 'Priya', brandName: 'Preview brand',
      collaboration: { id: 'theme-preview', title: 'A sample story', image: '/images/hawtea.jpg', reelUrl: '' },
    } }));
    await page.goto('/review/portfolio-theme-check');
    await expect(page.getByRole('heading', { name: 'Your honest words.' })).toBeVisible();
    await expect(page.locator('.share-card').first()).toHaveCSS('background-color', colorScheme === 'dark' ? 'rgb(33, 27, 45)' : 'rgb(255, 252, 249)');
    await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toHaveCSS('color', colorScheme === 'dark' ? 'rgb(246, 239, 255)' : 'rgb(48, 38, 57)');
    await page.setViewportSize({ width: 320, height: 844 });
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`share-${colorScheme}-320.png`), fullPage: true });
    await page.goto('/login');
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`login-${colorScheme}-320.png`), fullPage: true });
  });
}