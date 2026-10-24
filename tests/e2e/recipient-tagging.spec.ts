import { expect, test } from "@playwright/test";
import { toISTKey } from "../../src/lib/dates";

test("tag by recipient, remember future payments, and nudge for past payments", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-demo").click();
  await expect(page.getByTestId("spent-today")).toBeVisible();
  await page.evaluate(async (today) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("paisa-pulse-demo");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("txns", "readwrite");
      for (const id of ["recipient-a", "recipient-b"]) tx.objectStore("txns").put({ id, date: today, amountPaise: 10000, kind: "expense", merchant: "Local Test Shop", category: "Other", method: "cash", source: { providerId: "manual", importedAt: Date.now() }, createdAt: Date.now(), updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, toISTKey());
  await page.goto("/transactions");
  await page.getByTestId("txn-search").fill("Local Test Shop");
  await page.getByRole("button", { name: "Recipients", exact: true }).click();
  const recipient = page.getByTestId("recipient-row");
  await expect(recipient).toContainText("2 transactions");
  await recipient.click();
  await page.getByTestId("recipient-category").selectOption("Bills");
  await page.getByLabel("Recipient tag").fill("Utility");
  await page.screenshot({ path: test.info().outputPath("recipient-tagging.png") });
  await page.getByTestId("recipient-save").click();
  await expect(recipient).toHaveCount(0);
  await page.getByTestId("recipients-archived").click();
  await expect(recipient).toContainText("Bills · Utility");
  await recipient.click();
  await expect(page.getByLabel("Recipient tag")).toHaveValue("Utility");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "Local Test Shop" }).first().click();
  await page.getByTestId("txn-category").selectOption("Groceries");
  await expect(page.getByText(/Apply the same category and tag to 1 other transaction/)).toBeVisible();
  await expect(page.getByTestId("txn-apply-past")).toBeChecked();
  await page.getByTestId("txn-save").click();
  await page.getByRole("button", { name: "Recipients", exact: true }).click();
  await expect(recipient).toContainText("Groceries");
  await expect(recipient).not.toContainText("Mixed");
  await page.reload();
  await page.getByTestId("txn-search").fill("Local Test Shop");
  await page.getByRole("button", { name: "Recipients", exact: true }).click();
  await expect(page.getByTestId("recipient-row")).toHaveCount(0);
  await page.getByTestId("recipients-archived").click();
  await expect(page.getByTestId("recipient-row")).toContainText("Groceries");
});
