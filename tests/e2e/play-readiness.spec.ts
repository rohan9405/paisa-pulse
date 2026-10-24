import { expect, test } from "@playwright/test";

test("SMS import stays optional until requested and manual budgeting works without permission", async ({ page }) => {
  await page.addInitScript(() => {
    const state = { requests: 0, reads: 0, allowed: false };
    Object.assign(window, { smsTestState: state });
    window.PaisaSms = {
      hasPermission: () => state.allowed,
      requestPermission: () => { state.requests++; },
      list: (since: number) => { state.reads++; return JSON.stringify({ messages: [], until: since, more: false }); },
    };
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Privacy policy" })).toBeVisible();
  await page.getByTestId("start-personal").click();
  await page.getByTestId("ob-income").fill("60000");
  await page.getByTestId("ob-next").click();
  await page.getByTestId("ob-next").click();
  await page.getByTestId("ob-finish").click();
  await expect(page.getByTestId("spent-today")).toBeVisible();
  const state = () => page.evaluate(() => (window as unknown as { smsTestState: { requests: number; reads: number; allowed: boolean } }).smsTestState);
  expect(await state()).toEqual({ requests: 0, reads: 0, allowed: false });
  await page.getByRole("button", { name: "Set up SMS import" }).click();
  expect((await state()).requests).toBe(1);
  expect((await state()).reads).toBe(0);
  await page.evaluate(() => {
    (window as unknown as { smsTestState: { allowed: boolean } }).smsTestState.allowed = true;
    window.dispatchEvent(new Event("paisa-sms-permission"));
  });
  await expect(page.getByTestId("sms-setup-notice")).toHaveCount(0);
  await expect.poll(async () => (await state()).reads).toBeGreaterThan(0);
});

test("privacy policy is available before onboarding and explains background SMS and backups", async ({ page }) => {
  await page.goto("/privacy.html");
  await expect(page.getByRole("heading", { name: "drip Privacy Policy", exact: true })).toBeVisible();
  await expect(page.locator("main")).toContainText("while the app is closed");
  await expect(page.locator("main")).toContainText("Backups are not encrypted by drip");
  await expect(page.getByRole("link", { name: "softorbit.apps@gmail.com" })).toHaveAttribute("href", "mailto:softorbit.apps@gmail.com");
});
