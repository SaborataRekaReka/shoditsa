import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const outDir = path.resolve("docs", "screenshots", `capture-16x9-stable-${stamp}`);
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

await page.emulateMedia({ reducedMotion: "reduce" });

const disableMotionCss = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
`;

const settle = async () => {
  await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.evaluate(async () => {
    try {
      if (document.fonts?.ready) await document.fonts.ready;
    } catch {}

    const pending = Array.from(document.images).filter((img) => !img.complete);
    await Promise.all(
      pending.map((img) => new Promise((resolve) => {
        const done = () => resolve(null);
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }))
    );

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
};

const save = async (label) => {
  const filePath = path.join(outDir, `${label}.jpg`);
  await page.screenshot({ path: filePath, type: "jpeg", quality: 95, fullPage: false });
  console.log(filePath);
};

await page.goto("https://shoditsa.ru/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.addStyleTag({ content: disableMotionCss });
await page.waitForSelector(".hub-screen", { timeout: 20000 });
await settle();
await save("01-hub");

await page.locator("button.category-card--diagnosis").click();
await page.waitForSelector(".title-screen", { timeout: 15000 });
await settle();
await save("02-diagnosis-title");

await page.locator(".app-header nav button").nth(0).click();
await page.waitForSelector(".modal", { timeout: 10000 });
await settle();
await save("03-rules-modal");
await page.locator(".modal-head button").first().click();
await settle();

await page.locator(".play-button").click();
await page.waitForSelector(".game-shell", { timeout: 15000 });
await page.waitForSelector("#movie-search", { timeout: 10000 });
await settle();
await save("04-game-start");

await page.locator(".app-header nav button").nth(2).click();
await page.waitForSelector(".modal", { timeout: 10000 });
await settle();
await save("05-stats-modal");
await page.locator(".modal-head button").first().click();
await settle();

await page.locator(".app-header nav button").nth(1).click();
await page.waitForSelector(".rewatch-screen", { timeout: 15000 });
await settle();
await save("06-archive");

await context.close();
await browser.close();

console.log("DONE");
console.log(outDir);
