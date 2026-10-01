import { expect, test, type Page } from '@playwright/test';

async function sceneAt(page: Page, progress: number) {
  const top = await page.locator('.hero-scroll-track').evaluate((track, value) => {
    const scene = track.querySelector<HTMLElement>('.hero-visual')!;
    const range = (track as HTMLElement).offsetHeight - scene.offsetHeight;
    return track.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(scene).top) + range * value;
  }, progress);
  await page.evaluate((value) => scrollTo({ top: value, behavior: 'instant' }), top);
  await expect.poll(() => page.locator('.hero-scroll-track').evaluate((el) => Number(el.getAttribute('data-scroll-progress')))).toBeCloseTo(progress, 1);
}

async function photoFrame(page: Page) {
  return page.locator('.hero-photo').evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { y: m.m42, z: m.m43, tilt: m.m13, sceneTop: el.parentElement!.getBoundingClientRect().top };
  });
}

for (const [width, touch] of [[320, false], [390, true], [1440, false]] as const) {
  test(`scroll alone drives visible sticky 3D depth at ${width}px${touch ? ' with touch' : ''}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    try {
      await page.goto('http://localhost:3000/');
      await expect(page.locator('.hero-scroll-track')).toBeVisible();
      await expect(page.locator('.portfolio')).toHaveAttribute('data-motion', 'ready');
      await expect(page.locator('.hero-visual')).toHaveCSS('position', 'sticky');
      // No mouse movement: compare a meaningful range, not just any changed matrix.
      await sceneAt(page, .15);
      const before = await photoFrame(page);
      await page.screenshot({ path: info.outputPath('scroll-start.png') });
      await sceneAt(page, .85);
      const after = await photoFrame(page);
      expect(Math.abs(after.y - before.y)).toBeGreaterThan(width < 900 ? 35 : 70);
      expect(Math.abs(after.z - before.z)).toBeGreaterThan(width < 900 ? 12 : 45);
      expect(Math.abs(after.tilt - before.tilt)).toBeGreaterThan(.05);
      expect(Math.abs(after.sceneTop - before.sceneTop)).toBeLessThan(2);
      await page.screenshot({ path: info.outputPath('scroll-end.png') });
      if (touch || width < 900) await expect(page.locator('.portfolio-follower')).toHaveCSS('display', 'none');
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        for (const progress of [0, .25, .5, .75, 1]) {
          await sceneAt(page, progress);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        }
      }
      await page.getByRole('link', { name: 'Explore my work', exact: true }).click();
      await expect(page).toHaveURL(/#work$/);
      await expect(page.getByRole('heading', { name: /A few stories/ })).toBeVisible();
    } finally { await context.close(); }
  });
}

test('work images continue parallax below the hero without a pointer, including after filtering', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  async function checkImageMotion() {
    const card = page.locator('.portfolio-work').first();
    const top = await card.evaluate((el) => el.getBoundingClientRect().top + scrollY);
    await page.evaluate((value) => scrollTo({ top: value - innerHeight * .75, behavior: 'instant' }), top);
    const imageY = () => card.locator('img').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
    await expect.poll(() => card.locator('.portfolio-work-photo').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--work-progress'))).not.toBe('');
    const start = await imageY();
    await page.evaluate(() => scrollBy({ top: 320, behavior: 'instant' }));
    await expect.poll(async () => Math.abs((await imageY()) - start)).toBeGreaterThan(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  await checkImageMotion();
  await page.getByRole('group', { name: 'Filter selected work' }).getByRole('button').nth(1).click();
  await checkImageMotion();
});

test('reduced motion removes sticky travel and restores a static layout live', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.portfolio')).toHaveAttribute('data-motion', 'ready');
  await sceneAt(page, .5);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.portfolio')).toHaveAttribute('data-motion', 'static');
  await expect(page.locator('.hero-visual')).not.toHaveCSS('position', 'sticky');
  for (const el of await page.locator('[data-depth], .portfolio-work-photo, .portfolio-work-photo img').all()) await expect(el).toHaveCSS('transform', 'none');
  const heights = await page.locator('.hero-scroll-track').evaluate((el) => ({ track: el.getBoundingClientRect().height, scene: el.querySelector('.hero-visual')!.getBoundingClientRect().height }));
  expect(heights.track - heights.scene).toBeLessThan(5);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.portfolio')).toHaveAttribute('data-motion', 'ready');
});

test('animated scene stays bounded across tablet breakpoints, short screens and pointer extremes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  for (const [width, height] of [[768, 1024], [899, 900], [900, 900], [1024, 768], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('.portfolio')).toHaveAttribute('data-motion', 'ready');
    for (const progress of [0, .5, 1]) {
      await sceneAt(page, progress);
      for (const [x, y] of [[1, 1], [width - 1, height - 1]]) {
        await page.mouse.move(x, y);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), { message: `${width}x${height} at ${progress}` }).toBeLessThanOrEqual(0);
      }
    }
  }
});