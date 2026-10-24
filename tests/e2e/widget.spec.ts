import { expect, test } from "@playwright/test";

test("personal budget reaches the launcher bridge; demo stays private and widget can be pinned", async ({ page }) => {
  await page.addInitScript(() => {
    const capture = { snapshots: [] as { rows: { available: number; spent: number }[] }[], pins: 0 };
    Object.assign(window, { widgetCapture: capture });
    window.PaisaWidget = {
      update: (json: string) => capture.snapshots.push(JSON.parse(json)),
      clear: () => { capture.snapshots = []; },
      canPin: () => true,
      requestPin: () => { capture.pins++; },
    };
  });
  await page.goto("/");
  await page.getByTestId("start-demo").click();
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { widgetCapture: { snapshots: unknown[] } }).widgetCapture.snapshots.length)).toBe(0);
  await page.getByTestId("demo-banner").getByRole("button", { name: "Switch" }).click();
  await page.getByTestId("start-personal").click();
  await page.getByTestId("ob-income").fill("60000");
  await page.getByTestId("ob-next").click();
  await page.getByTestId("ob-next").click();
  await page.getByTestId("ob-finish").click();
  await expect(page.getByTestId("spent-today")).toBeVisible();
  const snapshot = () => page.evaluate(() => (window as unknown as { widgetCapture: { snapshots: { capturedDate: string; rows: { date: string; available: number; spent: number }[] }[] } }).widgetCapture.snapshots.at(-1));
  await expect.poll(snapshot).toBeTruthy();
  const before = (await snapshot())!;
  const available = before.rows.find((r) => r.date === before.capturedDate)!.available;
  await page.getByTestId("today-add").click();
  await page.getByTestId("qa-amount").fill("460");
  await page.getByTestId("qa-merchant").fill("Private cash purchase");
  await page.getByTestId("qa-save").click();
  await expect.poll(async () => {
    const s = (await snapshot())!;
    return s.rows.find((r) => r.date === s.capturedDate)!.available;
  }).toBe(available - 46000);
  expect(JSON.stringify(await snapshot())).not.toContain("Private cash purchase");
  await page.goto("/settings#app");
  await page.getByText("Home widget", { exact: true }).click();
  await page.getByRole("button", { name: "Add to home screen" }).click();
  expect(await page.evaluate(() => (window as unknown as { widgetCapture: { pins: number } }).widgetCapture.pins)).toBe(1);
});

test("widget refresh imports bank SMS in the background route without showing app UI", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { widgetJobResult: null, widgetResult: null });
    window.PaisaWidget = {
      update: (json: string) => Object.assign(window, { widgetResult: JSON.parse(json) }),
      clear: () => {}, canPin: () => false, requestPin: () => {},
    };
    window.PaisaWidgetJob = { finish: (ok: boolean) => { Object.assign(window, { widgetJobResult: ok }); } };
    window.PaisaSms = {
      hasPermission: () => true, requestPermission: () => {},
      list: (since: number) => {
        const at = Date.now() - 1000;
        const messages = location.pathname.startsWith("/widget-sync") && since < at ? [{
          id: "widget-test", address: "VM-HDFCBK", date: at,
          body: "Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY Ref 123456789012",
        }] : [];
        return JSON.stringify({ messages, until: messages.length ? at : since, more: false });
      },
    };
  });
  await page.goto("/");
  await page.getByTestId("start-personal").click();
  await page.getByTestId("ob-income").fill("60000");
  await page.getByTestId("ob-next").click();
  await page.getByTestId("ob-next").click();
  await page.getByTestId("ob-finish").click();
  await expect(page.getByTestId("spent-today")).toBeVisible();
  await page.goto("/widget-sync/");
  await expect.poll(() => page.evaluate(() => (window as unknown as { widgetJobResult: boolean | null }).widgetJobResult)).toBe(true);
  const snapshot = await page.evaluate(() => (window as unknown as { widgetResult: { capturedDate: string; rows: { date: string; spent: number }[] } }).widgetResult);
  expect(snapshot.rows.find((r) => r.date === snapshot.capturedDate)?.spent).toBe(25000);
  await expect(page.getByTestId("available")).toHaveCount(0);
  await expect(page.getByTestId("start-personal")).toHaveCount(0);
});
