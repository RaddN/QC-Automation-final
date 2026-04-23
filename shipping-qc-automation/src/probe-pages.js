const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

async function run() {
  const outDir = path.resolve(__dirname, "..", "probe-output");
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("http://location-wise-product.local/wp-admin/", { waitUntil: "domcontentloaded" });
  if (page.url().includes("wp-login.php")) {
    await page.fill("#user_login", "admin");
    await page.fill("#user_pass", "admin");
    await page.click("#wp-submit");
    await page.waitForLoadState("domcontentloaded");
  }

  const urls = [
    "http://location-wise-product.local/wp-admin/admin.php?page=wc-settings&tab=shipping",
    "http://location-wise-product.local/wp-admin/admin.php?page=wc-settings&tab=shipping&zone_id=1",
    "http://location-wise-product.local/wp-admin/edit-tags.php?taxonomy=mulopimfwc_store_location&post_type=product&orderby=display_order&order=asc",
    "http://location-wise-product.local/wp-admin/admin.php?page=multi-location-product-and-inventory-management-settings#location-wise-everything",
    "http://location-wise-product.local/shop/",
    "http://location-wise-product.local/checkout/"
  ];

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const html = await page.content();
    fs.writeFileSync(path.join(outDir, `page-${i + 1}.html`), html, "utf-8");
    await page.screenshot({ path: path.join(outDir, `page-${i + 1}.png`), fullPage: true });
    console.log(`saved ${i + 1}: ${url}`);
  }

  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
