import { test, expect, type Page } from '@playwright/test';

// Sammelt Konsolenfehler und CSP-Verstöße; jeder Test muss ohne auskommen.
function beobachte(page: Page): string[] {
  const probleme: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/401/.test(m.text())) probleme.push(m.text());
  });
  page.on('pageerror', (e) => probleme.push(e.message));
  return probleme;
}

async function waehle(page: Page, status: RegExp) {
  await page.getByRole('radio', { name: status }).first().check({ force: true });
}

test('Suche, Kita-Seite mit eingebetteten Daten, Favorit', async ({ page }) => {
  const probleme = beobachte(page);
  await page.goto('/');
  await page.getByRole('searchbox').first().fill('Domspatzen');
  await page.keyboard.press('Enter');
  await page.getByRole('link', { name: /Testkita Domspatzen/ }).first().click();
  await expect(page).toHaveTitle(/Testkita Domspatzen \(Köln\)/);
  await page.getByRole('button', { name: /Zu „Meine Kitas“ hinzufügen/ }).first().click();
  await page.goto('/');
  await expect(page.getByText('Testkita Domspatzen').first()).toBeVisible();
  expect(probleme).toEqual([]);
});

test('anonyme Meldung mit Proof-of-Work', async ({ page }) => {
  const probleme = beobachte(page);
  await page.goto('/kita/2');
  await page.getByRole('button', { name: /Einschränkung melden/ }).click();
  await waehle(page, /Verkürzte Betreuungszeiten/);
  await page.locator('input[name$="uhrzeit_von"], input[type=time]').first().fill('08:00');
  await page.locator('input[type=time]').nth(1).fill('12:30');
  await page.waitForFunction(() => (document.querySelector('input[name=altcha]') as HTMLInputElement | null)?.value?.length! > 20, null, { timeout: 60_000 });
  const antwort = page.waitForResponse((r) => r.url().includes('/meldungen') && r.request().method() === 'POST');
  await page.locator('button[type=submit]').last().click();
  expect((await antwort).status()).toBe(201);
  await expect(page.locator('.heute-karte')).toContainText('Verkürzte Betreuungszeiten');
  expect(probleme).toEqual([]);
});

test('Kita-Seite ohne Kontaktadresse bietet Adresse hinterlegen an', async ({ page }) => {
  await page.goto('/kita/2');
  await expect(page.getByRole('link', { name: /Adresse hinterlegen/ })).toBeVisible();
});

test('Datenschutzseite und unbekannte Seite', async ({ page }) => {
  await page.goto('/datenschutz');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Datenschutz');
  const r = await page.goto('/kita/999999');
  expect(r?.status()).toBe(404);
});

test('Ansicht: Tage ohne Meldung als regulär (lokal, Standard aus)', async ({ page }) => {
  await page.goto('/kita/6');
  const schalter = page.getByRole('switch', { name: /Tage ohne Meldung als reguläre Betreuung/ });
  await expect(schalter).not.toBeChecked();
  await expect(page.locator('.tage-liste')).toContainText('Keine Meldung');
  await schalter.check();
  await expect(page.locator('.tage-liste li:not(.wochenende)').first()).toContainText('Vermutlich regulär');
  // Wochenenden (und NRW-Feiertage) bleiben „Keine Meldung“ – Kitas sind dann regulär geschlossen
  await expect(page.locator('.tage-liste li.wochenende').first()).toContainText('Keine Meldung');
  // bleibt nach Neuladen erhalten, nur lokal
  await page.reload();
  await expect(page.getByRole('switch', { name: /Tage ohne Meldung/ })).toBeChecked();
});
