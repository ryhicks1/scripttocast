/**
 * Capture the Work screenshots.
 *
 *   npm  i -D playwright        (once)
 *   npx  playwright install chromium
 *   node tools/capture-screenshots.mjs
 *
 * Run it from the `site/` folder. Writes JPEGs into img/work/, which index.html
 * already points at. Until the files exist each card shows a fallback plate, so
 * the page is never broken — it just gets better once these land.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const SHOTS = [
  { slug: 'sakura',       url: 'https://www.sakurawollongong.com/',                        w: 1600, h: 900 },
  { slug: 'teacherchang', url: 'https://teacher-chang.vercel.app/',                        w: 1440, h: 900 },
  { slug: 'willcool',     url: 'https://illawarra-previews.vercel.app/will-cool-hvac/',    w: 1440, h: 900 },
  { slug: 'acting',       url: 'https://www.actingresources.com/',                         w: 1440, h: 900 },
  { slug: 'castingbrief', url: 'https://www.castingbrief.com/',                            w: 1440, h: 900 },
];

await mkdir('img/work', { recursive: true });
const browser = await chromium.launch();

for (const { slug, url, w, h } of SHOTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    // let fonts settle and nudge lazy-loaded imagery above the fold
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    // dismiss anything that commonly covers the hero
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[class*="cookie" i],[id*="cookie" i],[class*="consent" i]')) {
        el.remove();
      }
    });
    await page.screenshot({ path: `img/work/${slug}.jpg`, type: 'jpeg', quality: 82 });
    console.log(`✓ ${slug}.jpg`);
  } catch (err) {
    console.error(`✗ ${slug}: ${err.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();
console.log('\nDone. Commit img/work/ and redeploy.');
