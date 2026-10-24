// Regenerate docs/screenshots from the static export in demo mode (fictional data).
//   NEXT_STATIC_EXPORT=1 NEXT_DIST_DIR=.next-android npx next build   (or python3 android/build.py)
//   node scripts/screenshots.mjs
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium, devices } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "..");
const WEB = join(ROOT, ".next-android");
const OUT = join(ROOT, "docs/screenshots");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/x-component", ".json": "application/json" };

if (!existsSync(join(WEB, "index.html"))) throw new Error("No static export in .next-android; build it first.");
mkdirSync(OUT, { recursive: true });

const server = createServer((req, res) => {
  let file = join(WEB, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!file.startsWith(WEB) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["Pixel 7"], timezoneId: "Asia/Kolkata", locale: "en-IN", colorScheme: "dark" });
const page = await context.newPage();

// Welcome screen first, before a mode is chosen.
await page.goto(`${base}/`);
await page.getByText("Set up my budget").waitFor();
await page.screenshot({ path: join(OUT, "welcome.png") });

await page.getByTestId("start-demo").click();
await page.getByTestId("unified-today").waitFor();
for (const [name, path] of [["today", "/"], ["activity", "/transactions/"], ["stats", "/dashboard/"]]) {
  await page.goto(`${base}${path}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200); // let charts and number animations settle
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  if (name === "today") {
    await page.getByTestId("calendar-anchor").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, "today-calendar.png") });
  }
  console.log("saved", name);
}

await browser.close();
server.close();
