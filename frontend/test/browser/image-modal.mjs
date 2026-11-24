// Run against a preview or the served storefront. No checkout/account mutations.
// PLAYWRIGHT_MODULE may point at an already installed Playwright module.
import assert from 'node:assert/strict';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.CHECK_BASE || 'http://127.0.0.1:4327';
const evidence = process.env.EVIDENCE_DIR;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1440]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      await page.goto(`${base}/shop/rfx-samsung-32gb-ddr4-3200-ecc-rdimm-m393a4g43ab3-cwe`);
      await page.evaluate((theme) => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme); }, theme);
      const trigger = page.getByTestId('product-main-image-btn');
      await trigger.click();
      await page.getByTestId('image-modal-image').evaluate((img) => img.decode());
      const image = page.getByTestId('image-modal-image');
      const transform = () => image.evaluate((img) => img.style.transform);
      assert.match(await transform(), /scale\(1\)/);
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      assert.match(await transform(), /scale\(1\.5\)/, 'zoom button enlarges photo');
      const color = await page.getByRole('button', { name: 'Zoom in', exact: true }).evaluate((button) => getComputedStyle(button).color);
      assert.equal(color, 'rgb(255, 255, 255)', `${theme} controls readable on the dark viewer`);
      await page.getByRole('button', { name: 'Reset zoom' }).click();
      const box = await page.getByTestId('image-modal-viewport').boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const cdp = await context.newCDPSession(page);
      const touch = (id, x, y) => ({ id, x, y, radiusX: 2, radiusY: 2 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, cx - 40, cy), touch(2, cx + 40, cy)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, cx - 100, cy), touch(2, cx + 100, cy)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => document.querySelector('[data-testid=image-modal-image]').style.transform.includes('scale(2.5)'));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, cx, cy)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, cx + 60, cy)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => document.querySelector('[data-testid=image-modal-image]').style.transform.includes('translate(60px'));
      if (evidence) await page.screenshot({ path: path.join(evidence, `zoom-${width}-${theme}.png`) });
      await page.getByRole('button', { name: 'Reset zoom' }).click();
      assert.match(await transform(), /translate\(0px, 0px\) scale\(1\)/);
      await page.keyboard.press('Escape');
      assert.equal(await page.getByTestId('image-modal').count(), 0);
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.equal(await trigger.evaluate((button) => button === document.activeElement), true);
      await trigger.click();
      assert.match(await transform(), /scale\(1\)/, 'reopening resets zoom');
      await page.getByRole('button', { name: 'Close image viewer' }).click();
      assert.equal(await page.getByTestId('image-modal').count(), 0);
      console.log(`PASS ${width}px ${theme}: zoom button, native touch pinch/pan, reset, Escape, focus and reopen`);
      await context.close();
    }
  }
} finally { await browser.close(); }
