import { expect, test } from "@playwright/test";

async function tracking(page: import("@playwright/test").Page) {
  await page.goto("/"); await page.getByTestId("start-personal").click();
  await page.getByTestId("ob-track").click(); await page.getByTestId("ob-next").click();
  await page.getByTestId("ob-finish").click();
  await expect(page.getByTestId("spent-today")).toBeVisible();
}

test("tracking includes bills with no budget promotion and navigation merges Brief into Today", async ({ page }, info) => {
  await tracking(page);
  const mobile = info.project.name === "mobile";
  if (mobile) {
    const nav = page.getByRole("navigation", { name: "Primary", exact: true });
    await expect(nav.locator('[data-testid^="nav-"]')).toHaveCount(5);
    await expect(nav.locator('[data-primary="true"]')).toHaveCount(1);
    await expect(page.getByTestId("nav-today")).toHaveAttribute("data-primary", "true");
    await page.getByTestId("nav-manual").click();
  } else await page.getByRole("button", { name: "Add expense", exact: true }).filter({ visible: true }).click();
  await page.getByTestId("qa-amount").fill("1200"); await page.getByTestId("qa-merchant").fill("Rent");
  await page.getByRole("button", { name: /🧾 Bills/ }).click(); await page.getByTestId("qa-save").click();
  await expect(page.getByTestId("spent-today")).toHaveText("₹1,200");
  await expect(page.getByTestId("available")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Set a budget", exact: true })).toHaveCount(0);
  if (mobile) await page.getByTestId("nav-settings").click(); else await page.goto("/settings");
  await expect(page.getByTestId("budget-summary")).toContainText("Just tracking");
  await page.screenshot({ path: info.outputPath("tracking-navigation.png"), fullPage: true });
});

test("IPO partial allotment shows a hold and investment without creating income or expenses", async ({ page }, info) => {
  await page.addInitScript(() => {
    const now = Date.now() - 3000;
    const bodies = ["Rs.15000 blocked in A/c X1234 for ACME IPO. UMRN ABC12345", "Rs.5000 debited from A/c X1234 for ACME IPO. UMRN ABC12345"];
    window.PaisaSms = { hasPermission: () => true, requestPermission() {}, list(since) {
      const messages = bodies.map((body, i) => ({ id: String(i + 1), address: "VM-HDFCBK", body, date: now + i * 1000 })).filter((m) => m.date > since);
      return JSON.stringify({ messages, until: messages.at(-1)?.date ?? since, more: false });
    } };
  });
  await tracking(page);
  await expect(page.getByTestId("ipo-holds")).toContainText("ACME");
  await expect(page.getByTestId("ipo-holds")).toContainText("₹10,000");
  await expect(page.getByTestId("spent-today")).toHaveText("₹0");
  await page.goto("/transactions");
  await expect(page.getByTestId("txn-row")).toContainText("Investments · IPO");
  await page.goto("/");
  await page.getByTestId("ipo-holds").getByRole("button").click();
  await expect(page.getByRole("dialog")).toContainText("Partly settled");
  await page.screenshot({ path: info.outputPath("ipo-hold.png") });
});
