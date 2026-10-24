import { expect, test, type Page } from "@playwright/test";
import { dailyAllocation } from "../../src/lib/budget";
import { toISTKey } from "../../src/lib/dates";
import { formatINR } from "../../src/lib/money";

const addExpenseButton = (page: Page) => page.getByRole("button", { name: /add expense/i }).filter({ visible: true }).first();

test("onboarding → quick-add → reload persistence → dashboard updates", async ({ page }) => {
  const today = toISTKey();
  // Income ₹60,000 − rent ₹15,000 − SIP ₹5,000 = ₹40,000 pool.
  const allocation = dailyAllocation(40_000_00, today);

  await page.goto("/");
  await page.getByTestId("start-personal").click();

  // Step 1: income
  await page.getByTestId("ob-income").fill("60000");
  await page.getByTestId("ob-next").click();

  // Step 2: commitments — rent (already paid this month) and a SIP
  await page.getByRole("button", { name: "+ Rent" }).click();
  await page.getByRole("button", { name: "+ SIP" }).click();
  const rows = page.getByTestId("commitment-row");
  await rows.nth(0).getByLabel("Monthly amount").fill("15000");
  await rows.nth(0).getByLabel("Paid this month").check();
  await rows.nth(1).getByLabel("Monthly amount").fill("5000");
  await page.getByTestId("ob-next").click();

  // Step 3: start today, no opening adjustment
  await expect(page.getByTestId("ob-summary")).toContainText(formatINR(40_000_00));
  await expect(page.getByTestId("ob-summary")).toContainText(formatINR(allocation));
  await page.getByTestId("ob-finish").click();

  // Today shows actual spending; budget allowance is not part of this screen.
  await expect(page.getByTestId("spent-today")).toHaveText("₹0");
  await expect(page.getByTestId("available")).toHaveCount(0);
  await expect(page.getByTestId("demo-banner")).toHaveCount(0);

  // Quick-add an expense
  await addExpenseButton(page).click();
  await page.getByTestId("qa-amount").fill("250");
  await page.getByTestId("qa-merchant").fill("Chai Point");
  await page.getByRole("button", { name: /Food & Dining/ }).click();
  await page.getByTestId("qa-save").click();

  await expect(page.getByTestId("spent-today")).toHaveText("₹250");
  await expect(page.getByTestId("spent-today")).toHaveText("₹250");
  await expect(page.getByTestId("today-list")).toContainText("Chai Point");

  // Reload: data persists in IndexedDB
  await page.reload();
  await expect(page.getByTestId("spent-today")).toHaveText("₹250");
  await expect(page.getByTestId("today-list")).toContainText("Chai Point");

  // Dashboard reflects the expense; rent paid → not upcoming; SIP still to pay
  await page.goto("/dashboard");
  await expect(page.getByTestId("out-discretionary")).toHaveText("₹250");
  await expect(page.getByTestId("total-outgoings")).toHaveText("₹250");
  await expect(page.getByTestId("category-breakdown")).toContainText("Food & Dining");
  const bills = page.getByTestId("upcoming-bills");
  await expect(bills).toContainText("Rent");
  await expect(bills.locator("div", { hasText: "Rent" }).first()).toContainText("paid");

  // Add a second expense from the dashboard context and see it update live
  await addExpenseButton(page).click();
  await page.getByTestId("qa-amount").fill("100.50");
  await page.getByTestId("qa-merchant").fill("Uber");
  await page.getByTestId("qa-save").click();
  await expect(page.getByTestId("out-discretionary")).toHaveText("₹350.50");
  await expect(page.getByTestId("category-breakdown")).toContainText("Transport");
});

test("demo mode is clearly labelled and separate from personal data", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-demo").click();
  await expect(page.getByTestId("demo-banner")).toContainText(/fictional/i);
  await expect(page.getByTestId("spent-today")).toBeVisible();
  await page.goto("/import");
  await expect(page.getByText("CSV import is for personal mode")).toBeVisible();
});
