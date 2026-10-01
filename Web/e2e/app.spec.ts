import { test, expect } from '@playwright/test';

test('production project URL calculates, switches schedules, and restores valid inputs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page.locator('#take-home-heading')).toHaveText('$2,034.56');
  await page.locator('#frequency').selectOption('biweekly');
  await expect(page.locator('#take-home-heading')).toHaveText('$1,878.06');
  await page.reload();
  await expect(page.locator('#frequency')).toHaveValue('biweekly');
  await expect(page.locator('#take-home-heading')).toHaveText('$1,878.06');
  await page.locator('#annualSalary').fill('65000.');
  await page.reload();
  await expect(page.locator('#annualSalary')).toHaveValue('65000');
  await page.locator('#annualSalary').fill('');
  await expect(page.locator('#validation-card')).toBeVisible();
  await expect(page.locator('#result-content')).toBeHidden();
  await expect(page.locator('#annual-summary')).toBeHidden();
  await page.reload();
  await expect(page.locator('#annualSalary')).toHaveValue('65000');
  await expect(page.locator('#take-home-heading')).toHaveText('$1,878.06');
  expect(errors).toEqual([]);
});

test('hourly inputs and independent employer pension work through the interface', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[name="incomeType"][value="hourly"]').check();
  await page.locator('#hourlyRate').fill('25');
  await page.locator('#hoursPerWeek').fill('37.5');
  await page.locator('#frequency').selectOption('biweekly');
  await expect(page.locator('#take-home-heading')).toHaveText('$1,470.41');
  await page.locator('#deductions-details > summary').click();
  await page.locator('#employerMatch-enabled').check();
  await page.locator('#employerMatch-amount').fill('5');
  await expect(page.locator('#pension-enabled')).not.toBeChecked();
  await expect(page.locator('#take-home-heading')).toHaveText('$1,470.41');
  await expect(page.locator('.employer-note')).toContainText('$93.75');
  await page.locator('#employerMatch-amount').fill('invalid');
  await expect(page.locator('#validation-card')).toBeVisible();
  await page.locator('#employerMatch-enabled').uncheck();
  await expect(page.locator('#take-home-heading')).toHaveText('$1,470.41');
});

test('iPhone-size layout has install help, usable inputs, and no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(page.locator('#take-home-heading')).toHaveText('$2,034.56');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('[data-install-help]').click();
  await expect(page.locator('#install-dialog')).toBeVisible();
  await expect(page.locator('#install-dialog')).toContainText('Safari');
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(page.locator('#install-dialog')).toBeHidden();
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#annualSalary').fill('120000');
  await page.locator('#selectedPayPeriod').fill('24');
  await expect(page.locator('#validation-card')).toBeHidden();
  await expect(page.locator('.breakdown-card')).toContainText('CPP');
});

test('all PWA resources resolve under the Pages path and a reload calculates offline', async ({ page, context, request }) => {
  await page.goto('./');
  await expect(page.locator('#take-home-heading')).toHaveText('$2,034.56');
  const manifestResponse = await request.get('./manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('./');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  expect((await request.get('./icons/apple-touch-icon.png')).ok()).toBe(true);
  expect((await request.get('./favicon.svg')).ok()).toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
  });
  await expect(page.locator('#pwa-update-banner')).toBeHidden();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#take-home-heading')).toHaveText('$2,034.56');
  await expect(page.locator('#network-status')).toContainText('Offline');
  await page.locator('#frequency').selectOption('biweekly');
  await expect(page.locator('#take-home-heading')).toHaveText('$1,878.06');
});

test('salary and hourly earnings remain visible and update each other without entry-switch drift', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#annualSalary')).toBeVisible();
  await expect(page.locator('#hourlyRate')).toBeVisible();
  await expect(page.locator('#hourlyRate')).toHaveValue('33.3333');
  await expect(page.locator('#gross-hourly-equivalent')).toHaveText('$33.33');
  await expect(page.locator('#net-hourly-equivalent')).toHaveText('$25.04');
  await page.locator('input[name="incomeType"][value="hourly"]').check();
  await expect(page.locator('#annualSalary')).toHaveValue('65000');
  await expect(page.locator('#take-home-heading')).toHaveText('$2,034.56');
  await page.locator('#hourlyRate').fill('25');
  await expect(page.locator('#annualSalary')).toHaveValue('48750');
  await page.locator('#annualSalary').fill('65000');
  await expect(page.locator('#hourlyRate')).toHaveValue('33.3333');
  await page.reload();
  await expect(page.locator('#annualSalary')).toHaveValue('65000');
  await expect(page.locator('#take-home-heading')).toHaveText('$2,034.56');
});

test('the reverse calculator has independent inputs and results, and invalid targets clear its result', async ({ page }) => {
  await page.goto('./');
  await page.locator('#annualSalary').fill('50000');
  const forwardTakeHome = await page.locator('#take-home-heading').textContent();
  await page.locator('#mode-reverse').click();
  await expect(page.locator('#forward-panel')).toBeHidden();
  await expect(page.locator('#reverse-panel')).toBeVisible();
  await page.locator('#targetNetBasis').selectOption('perPay');
  await page.locator('#targetNet').fill('2034.56');
  await page.locator('#find-gross-button').click();
  await expect(page.locator('#reverse-status')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('#reverse-result')).toBeVisible();
  await expect(page.locator('#reverse-result')).toContainText('$2,034.56');
  await expect(page.locator('#reverse-gross-heading')).toBeVisible();
  await page.locator('#mode-forward').click();
  await expect(page.locator('#annualSalary')).toHaveValue('50000');
  await expect(page.locator('#take-home-heading')).toHaveText(forwardTakeHome!);
  await page.locator('#frequency').selectOption('weekly');
  await page.locator('#mode-reverse').click();
  await expect(page.locator('#reverse-frequency')).toHaveValue('semiMonthly');
  await expect(page.locator('#reverse-result')).toBeVisible();
  await page.locator('#targetNet').fill('invalid');
  await expect(page.locator('#reverse-result')).toBeHidden();
  await page.locator('#find-gross-button').click();
  await expect(page.locator('#reverse-status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#find-gross-button')).toBeEnabled();
});

test('Simplified Chinese persists, explains payroll concepts on hover/focus, and switches back without changing money', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.locator('#language-zh').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('label[for="annualSalary"]')).toContainText('年薪');
  await expect(page.locator('#take-home-heading')).toHaveText('$2,034.56');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#deductions-details > summary').click();
  await expect(page.locator('#deductions-details .concept-help')).toHaveCount(7);
  expect(await page.locator('.concept-help').evaluateAll(buttons => buttons.every(button => button.closest('.deductions-body')))).toBe(true);
  await expect(page.locator('.concept-help[data-concept="cpp"]')).toHaveCount(0);
  const pensionHelp = page.locator('#deductions-details .concept-help[data-concept="pension"]').first();
  await pensionHelp.hover();
  await expect(page.locator('#concept-tooltip')).toBeVisible();
  await expect(page.locator('#concept-tooltip')).toContainText('退休');
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await expect(page.locator('#concept-tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#concept-tooltip')).toBeHidden();
  await pensionHelp.focus();
  await expect(page.locator('#concept-tooltip')).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.locator('#annualSalary').fill('65000');
  await expect(page.locator('label[for="annualSalary"]')).toContainText('年薪');
  await page.locator('#language-en').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA');
  await expect(page.locator('label[for="annualSalary"]')).toHaveText('Annual salary');
  await expect(page.locator('#annualSalary')).toHaveValue('65000');
  await expect(page.locator('#take-home-heading')).toHaveText('$2,034.56');
  await expect(page.locator('.concept-help')).toHaveCount(0);
});

test('the phone places its single take-home card after income and returns it to the desktop results column', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(page.locator('#mobile-hero-slot #forward-take-home')).toHaveCount(1);
  const income = await page.locator('#income-card').boundingBox();
  const hero = await page.locator('#forward-take-home').boundingBox();
  const schedule = await page.locator('[aria-labelledby="frequency-heading"]').boundingBox();
  expect(hero!.y).toBeGreaterThanOrEqual(income!.y + income!.height);
  expect(hero!.y + hero!.height).toBeLessThanOrEqual(schedule!.y);
  await expect(page.locator('#take-home-heading')).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#result-content #forward-take-home')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#mobile-hero-slot #forward-take-home')).toHaveCount(1);
  await page.locator('#annualSalary').fill('');
  await expect(page.locator('#take-home-heading')).toHaveCount(0);
  await page.locator('#annualSalary').fill('65000');
  await expect(page.locator('#mobile-hero-slot #take-home-heading')).toHaveText('$2,034.56');
});
