import { expect, test, type Page } from "@playwright/test";

async function start(page: Page, mode: "tracking" | "actual") {
  await page.goto("/");
  await page.getByTestId("start-personal").click();
  if (mode === "tracking") await page.getByTestId("ob-track").click();
  else await page.getByRole("button", { name: /Use actual payments/ }).click();
  await expect(page.getByTestId("ob-income")).toHaveCount(0);
  await page.getByTestId("ob-next").click();
  await expect(page.getByRole("heading", { name: "When do we start counting?" })).toBeVisible();
  await expect(page.getByLabel("Opening adjustment", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Monthly amount")).toHaveCount(0);
  await page.getByTestId("ob-finish").click();
}

async function add(page: Page, amount: string, merchant: string, category?: string) {
  await page.getByRole("button", { name: /add expense/i }).filter({ visible: true }).first().click();
  await page.getByTestId("qa-amount").fill(amount);
  await page.getByTestId("qa-merchant").fill(merchant);
  if (category) await page.getByLabel("More categories").selectOption(category);
  await page.getByTestId("qa-save").click();
  await expect(page.getByTestId("qa-save")).toBeHidden();
}

test("tracking hides budget inputs and keeps remembered transaction tagging", async ({ page }) => {
  await start(page, "tracking");
  await add(page, "500", "Local Tracking Shop");
  await expect(page.getByTestId("spent-today")).toHaveText("₹500");
  await expect(page.getByTestId("available")).toHaveCount(0);
  await page.getByTestId("day-payments").locator("summary").click();
  await page.getByTestId("today-list").getByRole("button").filter({ hasText: "Local Tracking Shop" }).click();
  await page.getByTestId("txn-category").selectOption("Groceries");
  await page.getByTestId("txn-save").click();
  await add(page, "200", "Local Tracking Shop");
  await page.goto("/transactions");
  await page.getByTestId("txn-search").fill("Local Tracking Shop");
  await expect(page.getByTestId("txn-row")).toHaveCount(2);
  await expect(page.getByTestId("txn-row").filter({ hasText: "Groceries" })).toHaveCount(2);
  await page.goto("/settings");
  await page.getByTestId("edit-budget").click();
  await expect(page.getByTestId("settings-income")).toHaveCount(0);
  await expect(page.getByLabel("Monthly amount")).toHaveCount(0);
  await page.getByRole("tab", { name: "Daily budget", exact: true }).click();
  await page.getByTestId("settings-income").fill("30000");
  await page.getByTestId("save-budget").click();
  await expect(page.getByTestId("save-budget")).toBeHidden();
  await page.goto("/");
  await expect(page.getByTestId("spent-today")).toHaveText("₹700");
  await expect(page.getByTestId("available")).toHaveCount(0);
});

test("actual mode takes no budget amounts and is funded by recorded income", async ({ page }) => {
  await start(page, "actual");
  await expect(page.getByTestId("spent-today")).toHaveText("₹0");
  // A small non-salary credit funds today in any week; a salary from the 25th on would count for next month.
  await add(page, "9000", "Freelance payment", "Income");
  await page.getByRole("tab", { name: "Income", exact: true }).click();
  await expect(page.getByTestId("income-today")).toHaveText("₹9,000");
  await expect(page.getByTestId("available")).toHaveCount(0);
  await page.goto("/settings");
  await page.getByTestId("edit-budget").click();
  await expect(page.getByTestId("settings-income")).toHaveCount(0);
  await expect(page.getByLabel("Monthly amount")).toHaveCount(0);
  await page.getByRole("tab", { name: "Track expenses", exact: true }).click();
  await expect(page.getByTestId("set-aside-categories")).toHaveCount(0);
  await page.getByTestId("save-budget").click();
  await expect(page.getByTestId("save-budget")).toBeHidden();
  await page.goto("/briefing");
  await expect(page.getByTestId("calendar")).toBeVisible();
  await expect(page.getByTestId("unified-today")).toBeVisible();
  await expect(page.getByRole("button", { name: /Morning|Night/ })).toHaveCount(0);
  await expect(page.getByText("+5 bonus XP")).toHaveCount(0);
  await expect(page.getByTestId("tomorrow")).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Cumulative expenses" })).toBeVisible();
  await expect(page.getByText("Budget spent vs allowance")).toHaveCount(0);
});
