import { expect, test } from "@playwright/test";
import { addDays, toISTKey } from "../../src/lib/dates";

test("CSV import: mapping, validation, dedupe on re-import, refund flag", async ({ page }) => {
  const today = toISTKey();
  const d = (n: number) => {
    const [y, m, dd] = addDays(today, -n).split("-");
    return `${dd}/${m}/${y}`;
  };
  const csv = [
    "Statement for A/C XXXX1234,,,,",
    "Date,Narration,Ref No,Withdrawal Amt,Deposit Amt",
    `${d(2)},UPI-SWIGGY-swiggy@icici-ICIC0000001-Food,R1,450.00,`,
    `${d(2)},POS 4321XXXX1234 DMART AVENUE,R2,"1,250.50",`,
    `31/02/2026,BROKEN DATE,R3,10.00,`,
    `${d(1)},NEFT SELF TRANSFER TO SBI,R4,"20,000.00",`,
    `${d(1)},REFUND FROM SOMEWHERE,R5,,99.00`,
  ].join("\n");
  const file = { name: "hdfc.csv", mimeType: "text/csv", buffer: Buffer.from(csv) };

  await page.goto("/");
  await page.getByTestId("start-personal").click();
  await page.getByTestId("ob-income").fill("50000");
  await page.getByTestId("ob-next").click();
  await page.getByTestId("ob-next").click();
  await page.getByTestId("ob-start").fill(addDays(today, -5));
  await page.getByTestId("ob-finish").click();
  await expect(page.getByTestId("spent-today")).toBeVisible();

  await page.goto("/import");
  await page.getByTestId("csv-input").setInputFiles(file);
  const preview = page.getByTestId("csv-preview");
  await expect(preview).toContainText("doesn't match DD/MM/YYYY");
  await expect(page.getByTestId("csv-import")).toHaveText("Import 4 transactions");
  await page.getByTestId("csv-import").click();
  await expect(page.getByTestId("import-result")).toContainText("Imported 4");
  await expect(page.getByTestId("import-result")).toContainText("1 invalid row");

  // Same file again → everything valid is a duplicate.
  await page.goto("/import");
  await page.getByTestId("csv-input").setInputFiles(file);
  await expect(page.getByTestId("csv-import")).toHaveText("Import 0 transactions");
  await expect(page.getByTestId("csv-import")).toBeDisabled();

  // Transfer excluded, refund flagged for review.
  await page.goto("/dashboard");
  await expect(page.getByTestId("out-expenses")).toHaveText("₹1,700.50");
  await page.goto("/transactions?review=1");
  await expect(page.getByTestId("txn-row")).toHaveCount(1);
  await expect(page.getByTestId("txn-row")).toContainText("review");
});
