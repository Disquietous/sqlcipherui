import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const { chromium } = await import('/Users/jmyers/.nvm/versions/node/v24.7.0/lib/node_modules/playwright/index.mjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'screenshots');
const BASE = 'http://localhost:5273';
const DB_PATH = resolve(__dirname, '..', 'test.db');

const VIEWPORT = { width: 1440, height: 900 };

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();

  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Close any existing connections, then open only test.db
  await page.evaluate(async (dbPath) => {
    const conns = await fetch('/api/db/connections').then(r => r.json());
    if (Array.isArray(conns)) {
      for (const c of conns) {
        await fetch('/api/db/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: c.path }),
        }).catch(() => {});
      }
    }
    await fetch('/api/db/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dbPath }),
    });
  }, DB_PATH);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // --- IDE: Data Browse ---
  // Ensure schema view is active, then click users table
  await page.locator('.rail-btn').filter({ hasText: /schema/i }).click();
  await page.waitForTimeout(400);
  const usersItem = page.locator('.sb-item').filter({ hasText: 'users' }).first();
  if (await usersItem.isVisible()) {
    await usersItem.click();
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: `${OUT}/ide-data-browse.png` });

  // --- IDE: Query ---
  await page.locator('.rail-btn').filter({ hasText: /query/i }).click();
  await page.waitForTimeout(800);

  const sql = `SELECT u.name, u.email, u.role,
       COUNT(o.id) AS order_count,
       COALESCE(SUM(o.total), 0) AS total_spent
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id
ORDER BY total_spent DESC`;

  // Set textarea value and fire input event to trigger React state update
  await page.evaluate((q) => {
    const ta = document.querySelector('.sql-editor-ta');
    if (ta) {
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      nativeSet.call(ta, q);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, sql);
  await page.waitForTimeout(400);

  const runBtn = page.locator('button').filter({ hasText: /^Run/ }).first();
  if (await runBtn.isVisible()) {
    await runBtn.click();
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: `${OUT}/ide-query.png` });

  // --- Schema Designer ---
  await page.locator('.mode-btn').filter({ hasText: /schema/i }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/schema-designer.png` });

  // --- Data Flows: Home ---
  await page.locator('.mode-btn').filter({ hasText: /data flow/i }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/dataflows-home.png` });

  // --- Data Flows: Editor ---
  const pipelineCard = page.locator('[class*="df-card"], [class*="pipeline-card"]').first();
  if (await pipelineCard.isVisible()) {
    await pipelineCard.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/dataflows-editor.png` });
  }

  await browser.close();
  console.log('Screenshots saved to', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
