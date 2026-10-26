import { expect, test } from "@playwright/test";

test("lowercase is opt-in, persists, and preserves vendor names in both states", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-demo").click();
  await page.getByTestId("spent-today").waitFor();
  await page.goto("/settings#app");
  const toggle = page.getByRole("switch", { name: /lowercase copy/i });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("text-transform", "none");
  await page.getByText("Lowercase copy", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("text-transform", "lowercase");
  await page.reload();
  await expect(toggle).toBeChecked();

  await page.goto("/transactions");
  const vendor = page.getByTestId("txn-row").first().locator("[data-preserve-case]");
  const original = await vendor.textContent();
  expect(original).toMatch(/[A-Z]/);
  await expect(vendor).toHaveCSS("text-transform", "none");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("text-transform", "lowercase");
  await page.getByTestId("txn-row").first().click();
  await expect(page.getByLabel("Merchant", { exact: true })).toHaveValue(original!);
  await expect(page.getByLabel("Merchant", { exact: true })).toHaveCSS("text-transform", "none");

  await page.goto("/settings#app");
  await page.getByText("Lowercase copy", { exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("text-transform", "none");
  await page.goto("/transactions");
  await expect(vendor).toHaveText(original!);
  await expect(vendor).toHaveCSS("text-transform", "none");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("text-transform", "none");
});
