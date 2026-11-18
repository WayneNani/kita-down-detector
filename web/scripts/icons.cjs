// Erzeugt die PNG-Icons aus den SVGs (einmalig bzw. nach Änderungen am Icon).
// Nutzt Chromium über Playwright: node scripts/icons.cjs
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const pub = join(__dirname, '../public/');
const ziele = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon.svg', 'apple-touch-icon.png', 180],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
];
(async () => {
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [svg, png, groesse] of ziele) {
  const inhalt = readFileSync(join(pub, svg), 'utf8');
  await page.setViewportSize({ width: groesse, height: groesse });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${inhalt.replace('<svg ', `<svg width="${groesse}" height="${groesse}" `)}</body></html>`,
  );
  await page.screenshot({ path: join(pub, png), omitBackground: png !== 'apple-touch-icon.png', clip: { x: 0, y: 0, width: groesse, height: groesse } });
  console.log('geschrieben:', png);
}
await browser.close();
})();
