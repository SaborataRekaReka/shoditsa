import { chromium, devices } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const outDir = path.resolve("docs", "screenshots", `capture-${stamp}`);
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function captureSet(name, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const save = async (label, fullPage = false) => {
    const filePath = path.join(outDir, `${name}-${label}.png`);
    await page.screenshot({ path: filePath, fullPage });
    console.log(filePath);
  };

  await page.goto("https://shoditsa.ru/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector(".hub-screen", { timeout: 20000 });
  await save("01-hub");

  await page.locator("button.category-card--diagnosis").click();
  await page.waitForSelector(".title-screen", { timeout: 15000 });
  await save("02-diagnosis-title");

  // Rules modal on title screen
  await page.locator(".app-header nav button").nth(0).click();
  await page.waitForSelector(".modal", { timeout: 10000 });
  await save("03-rules-modal");
  await page.locator('.modal [aria-label="Закрыть"]').first().click();

  // Start game screen
  await page.locator(".play-button").click();
  await page.waitForSelector(".game-shell", { timeout: 15000 });
  await page.waitForSelector("#movie-search", { timeout: 10000 });
  await save("04-game-start");

  // Stats modal from game screen
  await page.locator(".app-header nav button").nth(2).click();
  await page.waitForSelector(".modal", { timeout: 10000 });
  await save("05-stats-modal");
  await page.locator('.modal [aria-label="Закрыть"]').first().click();

  // Archive screen
  await page.locator(".app-header nav button").nth(1).click();
  await page.waitForSelector(".rewatch-screen", { timeout: 15000 });
  await save("06-archive");

  await context.close();
}

await captureSet("desktop", { viewport: { width: 1600, height: 1000 } });
await captureSet("mobile", { ...devices["Pixel 7"] });

await browser.close();

console.log("DONE");
console.log(outDir);
