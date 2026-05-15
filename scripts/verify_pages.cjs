const path = require("node:path");
const { chromium } = require("playwright");

const baseDir = "/Users/haogeng/Desktop/接单/120-利息计算/system";
const templatePath = process.env.VERIFY_FILE || path.join(baseDir, "标准导入示例.xlsx");
const outputPath = process.env.VERIFY_OUTPUT || path.join(baseDir, "outputs", "利息计算结果_验证导出.xlsx");
const sheetName = process.env.VERIFY_SHEET || "";
const screenshotPath = process.env.VERIFY_SCREENSHOT || "";

(async () => {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({ acceptDownloads: true });

  await page.goto("http://127.0.0.1:4173/index.html");
  await page.setInputFiles("#excelFile", templatePath);
  if (sheetName) await page.selectOption("#sheetSelect", sheetName);
  await page.waitForSelector("#monthlyPreview tr");

  const monthly = await readPreview(page, "#monthlyPreview");
  const quarterly = await readPreview(page, "#quarterlyPreview");
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#exportBtn"),
  ]);
  await download.saveAs(outputPath);
  await browser.close();

  console.log(JSON.stringify({ monthly, quarterly, outputPath }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function readPreview(page, selector) {
  return page.$$eval(`${selector} tr`, (rows) =>
    rows.slice(0, 8).map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent.trim()),
    ),
  );
}
