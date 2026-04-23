const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT_DIR, "config", "site.config.json");
const SCENARIOS_PATH = path.join(ROOT_DIR, "config", "shipping-scenarios.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function safeName(value) {
  return String(value || "scenario").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function getHostFromUrl(url) {
  return new URL(url).hostname;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    headed: null,
    config: CONFIG_PATH,
    scenarios: SCENARIOS_PATH,
    scenarioId: "",
    limit: 0,
    skipSetup: false
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--headed") flags.headed = true;
    if (arg === "--headless") flags.headed = false;
    if (arg === "--skip-setup") flags.skipSetup = true;
    if (arg === "--config" && args[i + 1]) flags.config = path.resolve(args[++i]);
    if (arg === "--scenarios" && args[i + 1]) flags.scenarios = path.resolve(args[++i]);
    if (arg === "--scenario-id" && args[i + 1]) flags.scenarioId = String(args[++i]);
    if (arg === "--limit" && args[i + 1]) flags.limit = Number(args[++i]) || 0;
  }
  return flags;
}

function log(message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${message}`);
}

async function shot(page, filePath, fullPage = true) {
  try {
    await page.screenshot({ path: filePath, fullPage, timeout: 20000 });
  } catch (_) {
    await page.screenshot({ path: filePath, fullPage: false, timeout: 12000 }).catch(() => undefined);
  }
}

async function waitForSettle(page, ms = 1200) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 20000 });
  } catch (_) {
    // keep going
  }
  await page.waitForTimeout(ms);
}

async function fillFieldIfExists(page, selector, value) {
  if (value === undefined || value === null) return false;
  const locator = page.locator(selector).first();
  if (!(await locator.count().then((n) => n > 0).catch(() => false))) return false;
  const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "input");
  if (tag === "select") {
    const val = String(value);
    const selected = await locator.selectOption({ value: val }).catch(() => []);
    if (selected.length < 1) {
      await locator.selectOption({ label: val }).catch(() => undefined);
    }
  } else {
    await locator.fill(String(value));
  }
  return true;
}

async function detectAndLoginIfNeeded(page, config, dir) {
  log("Login check: opening wp-admin.");
  await page.goto(config.site.adminUrl, { waitUntil: "domcontentloaded", timeout: config.browser.timeoutMs });
  await waitForSettle(page);
  await shot(page, path.join(dir, "00-admin-entry.png"));
  const needsLogin = page.url().includes("wp-login.php") || (await page.locator("#user_login, input[name='log']").count().then((n) => n > 0).catch(() => false));
  if (!needsLogin) {
    log("Login check: session already authenticated.");
    return { loginTried: false, loggedIn: true };
  }
  log("Login action: credentials detected and submitting login form.");
  await page.fill("#user_login, input[name='log']", config.auth.username);
  await page.fill("#user_pass, input[name='pwd']", config.auth.password);
  await shot(page, path.join(dir, "00-admin-login-filled.png"));
  await page.locator("#wp-submit, input[type='submit'][name='wp-submit']").first().click();
  await waitForSettle(page, 2000);
  await shot(page, path.join(dir, "00-admin-after-login.png"));
  const ok = !page.url().includes("wp-login.php");
  log(`Login result: ${ok ? "success" : "failed"}.`);
  return { loginTried: true, loggedIn: ok };
}

async function saveCurrentForm(page) {
  const submit = page.locator("input#submit.button-primary, #mainform #submit, button.button-primary[type='submit']").first();
  const exists = await submit.count().then((n) => n > 0).catch(() => false);
  if (!exists) return false;
  await submit.evaluate((el) => {
    el.removeAttribute("disabled");
  }).catch(() => undefined);
  await submit.click({ timeout: 8000 }).catch(() => undefined);
  await waitForSettle(page, 2200);
  return true;
}

async function ensureShippingSettings(page, config, dir) {
  log("Setup: opening plugin settings for location shipping.");
  const url = config.site.locationSettingsUrl || "http://location-wise-product.local/wp-admin/admin.php?page=multi-location-product-and-inventory-management-settings#location-wise-everything";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.browser.timeoutMs });
  await waitForSettle(page);
  await fillFieldIfExists(page, "select[name='mulopimfwc_display_options[enable_location_shipping]']", "on");
  await fillFieldIfExists(page, "select[name='mulopimfwc_display_options[shipping_calculation_method]']", "per_location");
  const saved = await saveCurrentForm(page);
  await shot(page, path.join(dir, "01-settings-location-shipping.png"));
  log(`Setup: location shipping settings ${saved ? "saved" : "not saved (submit not found)"}.`);
  return { saved };
}

async function getExistingZones(page) {
  await page.goto("http://location-wise-product.local/wp-admin/admin.php?page=wc-settings&tab=shipping", { waitUntil: "domcontentloaded" });
  await waitForSettle(page);
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll("table.wc-shipping-zones tbody tr").forEach((tr) => {
      const name = tr.querySelector(".wc-shipping-zone-name")?.textContent?.trim() || "";
      const edit = tr.querySelector(".wc-shipping-zone-action-edit")?.getAttribute("href") || "";
      const m = edit.match(/zone_id=(\d+)/);
      out.push({ name, editHref: edit, zoneId: m ? Number(m[1]) : null });
    });
    return out;
  });
}

async function addRegionByLabel(page, label) {
  const input = page.locator("[id^='woocommerce-tree-select-control__input']").first();
  if (!(await input.count().then((n) => n > 0).catch(() => false))) return false;
  await input.fill(label);
  await page.waitForTimeout(500);
  const option = page.locator("button:has-text('" + label + "'), .woocommerce-tree-select-control__menu [role='option']:has-text('" + label + "')").first();
  if (await option.count().then((n) => n > 0).catch(() => false)) {
    await option.click();
    await page.waitForTimeout(500);
    return true;
  }
  await input.press("Enter").catch(() => undefined);
  await page.waitForTimeout(500);
  return true;
}

async function createShippingZone(page, zoneDef, dir) {
  log(`Setup: creating shipping zone "${zoneDef.name}".`);
  await page.goto("http://location-wise-product.local/wp-admin/admin.php?page=wc-settings&tab=shipping&zone_id=new", { waitUntil: "domcontentloaded" });
  await waitForSettle(page);
  await fillFieldIfExists(page, "#zone_name", zoneDef.name);

  if (Array.isArray(zoneDef.regionLabels) && zoneDef.regionLabels.length > 0) {
    const removeEverywhere = page.locator("button[aria-label*='Remove Everywhere']").first();
    if (await removeEverywhere.count().then((n) => n > 0).catch(() => false)) {
      await removeEverywhere.click().catch(() => undefined);
    }
    for (const label of zoneDef.regionLabels) {
      await addRegionByLabel(page, label);
    }
  }

  await shot(page, path.join(dir, `02-zone-${safeName(zoneDef.name)}-before-save.png`));
  await saveCurrentForm(page);
  await waitForSettle(page);
  const m = page.url().match(/zone_id=(\d+)/);
  const zoneId = m ? Number(m[1]) : null;
  log(`Setup: shipping zone "${zoneDef.name}" created with zone_id=${zoneId || "unknown"}.`);
  return zoneId;
}

async function ensureShippingMethodInZone(page, zoneId, methodDef, dir) {
  log(`Setup: ensuring method "${methodDef.methodId}" in zone ${zoneId}.`);
  const url = `http://location-wise-product.local/wp-admin/admin.php?page=wc-settings&tab=shipping&zone_id=${zoneId}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForSettle(page);

  const existing = await page.evaluate(({ methodId, titleLike }) => {
    const rows = Array.from(document.querySelectorAll(".wc-shipping-zone-method-rows tr"));
    if (rows.length > 0 && !titleLike) return true;
    const needle = (titleLike || "").toLowerCase();
    for (const row of rows) {
      const title = row.querySelector(".wc-shipping-zone-method-title")?.textContent?.trim() || "";
      if (needle && title.toLowerCase().includes(needle)) return true;
    }
    return rows.some((row) => row.textContent.toLowerCase().includes(methodId.toLowerCase().replace("_", " ")));
  }, { methodId: methodDef.methodId || "flat_rate", titleLike: methodDef.titleContains || "" });
  if (existing) {
    log(`Setup: method already exists in zone ${zoneId}.`);
    await shot(page, path.join(dir, `03-zone-${zoneId}-method-existing.png`));
    return true;
  }

  const addBtn = page.locator(".wc-shipping-zone-add-method").first();
  if (!(await addBtn.count().then((n) => n > 0).catch(() => false))) {
    log(`Setup: add method button not found for zone ${zoneId}.`);
    return false;
  }
  await addBtn.click({ timeout: 8000 }).catch(() => {
    throw new Error(`Add shipping method button not clickable for zone ${zoneId}.`);
  });
  await page.waitForTimeout(1000);
  const methodId = methodDef.methodId || "flat_rate";
  await page.locator(`input[name='add_method_id'][value='${methodId}']`).first().check({ timeout: 8000 }).catch(() => undefined);
  await page.locator("#btn-next").first().click({ timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(700);
  await page.locator("#btn-ok").first().click({ timeout: 8000 }).catch(() => undefined);
  await waitForSettle(page, 2000);
  await saveCurrentForm(page).catch(() => undefined);
  await shot(page, path.join(dir, `03-zone-${zoneId}-method-added.png`));
  log(`Setup: method "${methodId}" added to zone ${zoneId}.`);
  return true;
}

async function setupShippingZones(page, config, dir) {
  const defs = config.setup?.shippingZones || [];
  const zoneMap = {};
  const existing = await getExistingZones(page);
  for (const z of existing) {
    zoneMap[z.name] = { zoneId: z.zoneId, editHref: z.editHref, from: "existing" };
  }

  for (const def of defs) {
    let zoneId = zoneMap[def.name]?.zoneId || null;
    if (!zoneId) {
      zoneId = await createShippingZone(page, def, dir);
    } else {
      log(`Setup: zone "${def.name}" already exists (zone_id=${zoneId}).`);
    }
    if (zoneId && def.method) {
      await ensureShippingMethodInZone(page, zoneId, def.method, dir);
    }
    zoneMap[def.name] = { zoneId, from: zoneMap[def.name]?.from || "created" };
  }
  return zoneMap;
}

async function setLocationAssignments(page, assignment, zoneMap, dir) {
  const pageUrl = "http://location-wise-product.local/wp-admin/edit-tags.php?taxonomy=mulopimfwc_store_location&post_type=product&orderby=display_order&order=asc";
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await waitForSettle(page);
  log(`Setup: assigning shipping zone/method for location "${assignment.locationName}".`);

  const zoneId = zoneMap[assignment.zoneName]?.zoneId;
  if (!zoneId) {
    log(`Setup warning: zone "${assignment.zoneName}" not found. Location assignment skipped.`);
    return { ok: false, reason: "zone_missing" };
  }

  const editHref = await page.evaluate((locationName) => {
    const rows = Array.from(document.querySelectorAll("#the-list tr"));
    for (const row of rows) {
      const title = row.querySelector(".row-title")?.textContent?.trim() || "";
      if (title.toLowerCase() === locationName.toLowerCase()) {
        const edit = row.querySelector(".row-actions .edit a, .row-actions a[href*='action=edit']")?.getAttribute("href");
        return edit || "";
      }
    }
    return "";
  }, assignment.locationName);

  let mode = "create";
  if (editHref) {
    mode = "edit";
    const abs = editHref.startsWith("http") ? editHref : `http://location-wise-product.local/wp-admin/${editHref.replace(/^\//, "")}`;
    await page.goto(abs, { waitUntil: "domcontentloaded" });
    await waitForSettle(page);
  }

  if (mode === "create") {
    await fillFieldIfExists(page, "#tag-name, input[name='tag-name']", assignment.locationName);
    await fillFieldIfExists(page, "#tag-slug, input[name='slug']", assignment.slug || safeName(assignment.locationName));
  } else {
    await fillFieldIfExists(page, "#name, input[name='name']", assignment.locationName);
  }

  await page.selectOption("#shipping_zones", String(zoneId)).catch(() => undefined);
  await page.dispatchEvent("#shipping_zones", "change").catch(() => undefined);
  await page.waitForTimeout(1200);

  if (assignment.shippingMethodContains) {
    const methodSelected = await page.evaluate((needleRaw) => {
      const needle = (needleRaw || "").toLowerCase();
      const select = document.querySelector("#shipping_methods");
      if (!select) return false;
      let selectedAny = false;
      Array.from(select.options || []).forEach((opt) => {
        if ((opt.textContent || "").toLowerCase().includes(needle)) {
          opt.selected = true;
          selectedAny = true;
        }
      });
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return selectedAny;
    }, assignment.shippingMethodContains);
    log(`Setup: method selection for "${assignment.locationName}" -> ${methodSelected ? "selected" : "no matching method option found"}.`);
  }

  const submitSel = mode === "create" ? "#submit.button-primary" : "#submit.button-primary, #edittag #submit";
  const submitClicked = await page.locator(submitSel).first().click({ timeout: 8000 }).then(() => true).catch(() => false);
  if (!submitClicked) {
    const fallbackSaved = await saveCurrentForm(page);
    if (!fallbackSaved) {
      log(`Setup warning: submit button not clickable for location "${assignment.locationName}" in ${mode} mode.`);
      await shot(page, path.join(dir, `04-location-${safeName(assignment.locationName)}-${mode}-submit-missing.png`));
      if (mode === "edit") {
        // Fallback path: create a new location when edit form is not available in this admin state.
        const fallbackName = `${assignment.locationName}-auto`;
        log(`Setup fallback: creating "${fallbackName}" instead.`);
        await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
        await waitForSettle(page);
        await fillFieldIfExists(page, "#tag-name, input[name='tag-name']", fallbackName);
        await fillFieldIfExists(page, "#tag-slug, input[name='slug']", safeName(fallbackName));
        await page.selectOption("#shipping_zones", String(zoneId)).catch(() => undefined);
        await page.dispatchEvent("#shipping_zones", "change").catch(() => undefined);
        await page.waitForTimeout(1200);
        await page.locator("#submit.button-primary").first().click({ timeout: 8000 }).catch(() => undefined);
        await waitForSettle(page, 2300);
        await shot(page, path.join(dir, `04-location-${safeName(fallbackName)}-fallback-create.png`));
        return { ok: true, zoneId, mode: "fallback-create" };
      }
      return { ok: false, reason: "submit_not_clickable", zoneId, mode };
    }
  }
  await waitForSettle(page, 2300);
  await shot(page, path.join(dir, `04-location-${safeName(assignment.locationName)}-${mode}.png`));
  log(`Setup: location "${assignment.locationName}" ${mode === "create" ? "created" : "updated"} and assigned zone ${zoneId}.`);
  return { ok: true, zoneId, mode };
}

async function clearCart(page, config) {
  await page.goto(config.site.cartUrl, { waitUntil: "domcontentloaded", timeout: config.browser.timeoutMs });
  await waitForSettle(page, 900);
  let loops = 0;
  while (loops < 20) {
    loops += 1;
    const remove = page.locator(".woocommerce-cart-form .product-remove a.remove, a.remove").first();
    if (!(await remove.count().then((n) => n > 0).catch(() => false))) break;
    await remove.click().catch(() => undefined);
    await waitForSettle(page, 1100);
  }
}

async function setScenarioLocationOnShop(page, context, config, scenario) {
  const host = getHostFromUrl(config.site.baseUrl);
  const cookieValue = scenario.storeLocationCookie || scenario.locationCookie || config.defaults?.storeLocationCookie || "";
  if (cookieValue) {
    await context.addCookies([{
      name: "mulopimfwc_store_location",
      value: cookieValue,
      domain: host,
      path: "/"
    }]);
    log(`Scenario: location cookie set to "${cookieValue}".`);
  }

  const selectRule = scenario.shopLocation || scenario.location || null;
  if (selectRule) {
    const changed = await page.evaluate((rule) => {
      const selectors = [
        "#mulopimfwc_store_location",
        "select.mulopimfwc-location-selector",
        "select[name='mulopimfwc_store_location']",
        "select[name='location_id']"
      ];
      for (const selector of selectors) {
        const sel = document.querySelector(selector);
        if (!sel) continue;
        let option = null;
        if (rule.value) {
          option = Array.from(sel.options).find((o) => o.value === String(rule.value));
        } else if (rule.labelContains) {
          const n = String(rule.labelContains).toLowerCase();
          option = Array.from(sel.options).find((o) => (o.textContent || "").toLowerCase().includes(n));
        }
        if (!option) continue;
        sel.value = option.value;
        option.selected = true;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return { changed: true, value: option.value, label: option.textContent || "" };
      }
      return { changed: false };
    }, selectRule);
    log(`Scenario: shop location selector ${changed.changed ? `updated (${changed.label || changed.value})` : "not found/matched"}.`);
    await page.waitForTimeout(1300);
  }
}

async function addProductToCartFromShop(page, config, scenario, dir) {
  log("Scenario: opening shop and adding product to cart.");
  await page.goto(config.site.shopUrl || `${config.site.baseUrl.replace(/\/$/, "")}/shop/`, { waitUntil: "domcontentloaded", timeout: config.browser.timeoutMs });
  await waitForSettle(page, 1500);
  await setScenarioLocationOnShop(page, page.context(), config, scenario);
  await shot(page, path.join(dir, "05-shop-before-add.png"));

  const productId = String(scenario.cart?.productId || config.defaults?.addToCartProductId || "");
  let clicked = false;
  let fallbackHref = "";
  if (productId) {
    const btn = page.locator(`a.add_to_cart_button[data-product_id='${productId}']`).first();
    if (await btn.count().then((n) => n > 0).catch(() => false)) {
      fallbackHref = (await btn.getAttribute("href").catch(() => "")) || "";
      const visible = await btn.isVisible().catch(() => false);
      if (visible) {
        await btn.click();
        clicked = true;
      }
    }
  }
  if (!clicked) {
    const firstVisible = page.locator("a.add_to_cart_button:visible").first();
    if (await firstVisible.count().then((n) => n > 0).catch(() => false)) {
      fallbackHref = fallbackHref || (await firstVisible.getAttribute("href").catch(() => "")) || "";
      await firstVisible.click();
      clicked = true;
    }
  }
  if (!clicked && fallbackHref) {
    const absoluteHref = fallbackHref.startsWith("http")
      ? fallbackHref
      : `${config.site.baseUrl.replace(/\/$/, "")}/${fallbackHref.replace(/^\//, "")}`;
    await page.goto(absoluteHref, { waitUntil: "domcontentloaded", timeout: config.browser.timeoutMs });
    clicked = true;
  }
  if (!clicked) {
    throw new Error("No add-to-cart button available on shop page.");
  }

  await waitForSettle(page, 2200);
  await shot(page, path.join(dir, "06-shop-after-add.png"));
  log("Scenario: add to cart clicked successfully.");
}

async function goCheckoutAndAssertHasCart(page, config) {
  await page.goto(config.site.checkoutUrl, { waitUntil: "domcontentloaded", timeout: config.browser.timeoutMs });
  await waitForSettle(page, 1800);
  const url = page.url();
  if (url.includes("/cart")) {
    throw new Error("Checkout redirected to cart (cart appears empty).");
  }
}

async function fillCheckoutAddress(page, config, address) {
  const s = config.selectors;
  const useShipping = (address.type || "shipping") === "shipping";
  if (useShipping) {
    const diff = page.locator(s.shipToDifferentAddressCheckbox).first();
    if (await diff.count().then((n) => n > 0).catch(() => false)) {
      const checked = await diff.isChecked().catch(() => false);
      if (!checked) await diff.check().catch(() => undefined);
    }
  }

  const map = useShipping ? {
    firstName: s.shippingFirstName || s.billingFirstName,
    lastName: s.shippingLastName || s.billingLastName,
    country: s.shippingCountry || s.billingCountry,
    address1: s.shippingAddress1 || s.billingAddress1,
    city: s.shippingCity || s.billingCity,
    state: s.shippingState || s.billingState,
    postcode: s.shippingPostcode || s.billingPostcode
  } : {
    firstName: s.billingFirstName,
    lastName: s.billingLastName,
    country: s.billingCountry,
    address1: s.billingAddress1,
    city: s.billingCity,
    state: s.billingState,
    postcode: s.billingPostcode
  };

  await fillFieldIfExists(page, map.firstName, address.firstName);
  await fillFieldIfExists(page, map.lastName, address.lastName);
  await fillFieldIfExists(page, map.country, address.country);
  await fillFieldIfExists(page, map.address1, address.address1);
  await fillFieldIfExists(page, map.city, address.city);
  await fillFieldIfExists(page, map.state, address.state);
  await fillFieldIfExists(page, map.postcode, address.postcode);
  await fillFieldIfExists(page, s.billingEmail, address.email || "qc@example.com");
  await fillFieldIfExists(page, s.billingPhone, address.phone || "9000000000");
  await waitForSettle(page, 2200);
}

async function readShippingMethods(page, config) {
  const methods = [];
  for (const selector of config.selectors.shippingMethods || []) {
    const loc = page.locator(selector);
    const count = await loc.count().catch(() => 0);
    if (!count) continue;
    const texts = await loc.allTextContents();
    for (const t of texts) {
      const clean = String(t || "").replace(/\s+/g, " ").trim();
      if (clean) methods.push(clean);
    }
  }
  return [...new Set(methods)];
}

async function readNoShippingMessage(page) {
  const candidates = [".woocommerce-error", ".woocommerce-info", ".woocommerce-notices-wrapper", ".wc-block-components-notice-banner"];
  for (const selector of candidates) {
    const text = await page.locator(selector).first().textContent().catch(() => "");
    if (normalizeText(text)) return text.replace(/\s+/g, " ").trim().slice(0, 400);
  }
  return "";
}

async function withTimeout(promise, ms, fallback) {
  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  const result = await Promise.race([promise, timeoutPromise]);
  if (timer) clearTimeout(timer);
  return result;
}

function assertScenario(expected, methodsBefore, methodsAfterAddressChange, methodsAfterLocationChange, methodsAfterReload, noShippingMsg) {
  const failures = [];
  const beforeNorm = methodsBefore.map(normalizeText);
  const msgNorm = normalizeText(noShippingMsg);

  if (typeof expected?.atLeastOneMethod === "boolean") {
    if (expected.atLeastOneMethod && methodsBefore.length < 1) {
      const allowed = (expected.allowAsPassIfNoMethodMessageContainsAny || []).some((needle) => msgNorm.includes(normalizeText(needle)));
      if (!allowed) failures.push("Expected at least one shipping method, but none found.");
    }
    if (!expected.atLeastOneMethod && methodsBefore.length > 0) {
      failures.push(`Expected zero shipping methods, but got: ${methodsBefore.join(" | ")}`);
    }
  }
  if (expected?.mustIncludeAnyOf?.length) {
    const ok = expected.mustIncludeAnyOf.some((name) => beforeNorm.some((method) => method.includes(normalizeText(name))));
    if (!ok) failures.push(`Expected one of methods: ${expected.mustIncludeAnyOf.join(", ")}`);
  }
  if (expected?.mustExcludeAll?.length) {
    const hits = expected.mustExcludeAll.filter((name) => beforeNorm.some((method) => method.includes(normalizeText(name))));
    if (hits.length) failures.push(`Found excluded methods: ${hits.join(", ")}`);
  }
  if (expected?.methodsShouldChangeAfterAddressUpdate) {
    const a = JSON.stringify(methodsBefore.map(normalizeText).sort());
    const b = JSON.stringify((methodsAfterAddressChange || []).map(normalizeText).sort());
    if (a === b) failures.push("Shipping methods did not change after address update.");
  }
  if (expected?.methodsShouldChangeAfterLocationUpdate) {
    const a = JSON.stringify(methodsBefore.map(normalizeText).sort());
    const b = JSON.stringify((methodsAfterLocationChange || []).map(normalizeText).sort());
    if (a === b) failures.push("Shipping methods did not change after location update.");
  }
  if (expected?.methodsShouldStayStableAfterReload) {
    const a = JSON.stringify(methodsBefore.map(normalizeText).sort());
    const b = JSON.stringify((methodsAfterReload || []).map(normalizeText).sort());
    if (a !== b) failures.push("Shipping methods changed after reload but expected stable.");
  }
  return failures;
}

async function runScenario(context, config, scenario, runDir, index) {
  const scenarioBase = `${String(index + 1).padStart(2, "0")}-${safeName(scenario.id)}`;
  const scenarioDir = path.join(runDir, scenarioBase);
  ensureDir(scenarioDir);
  const page = await context.newPage();

  const out = {
    id: scenario.id,
    description: scenario.description,
    startedAt: new Date().toISOString(),
    success: false,
    failures: [],
    observations: {}
  };

  try {
    log(`Scenario ${scenario.id}: starting.`);
    await clearCart(page, config);
    log(`Scenario ${scenario.id}: cart cleared.`);
    await addProductToCartFromShop(page, config, scenario, scenarioDir);
    await goCheckoutAndAssertHasCart(page, config);
    await shot(page, path.join(scenarioDir, "07-checkout-opened.png"));
    log(`Scenario ${scenario.id}: checkout opened.`);

    await fillCheckoutAddress(page, config, scenario.address);
    await shot(page, path.join(scenarioDir, "08-checkout-after-address.png"));
    log(`Scenario ${scenario.id}: customer address filled.`);

    let methodsBefore = await readShippingMethods(page, config);
    out.observations.methodsBefore = methodsBefore;
    log(`Scenario ${scenario.id}: methods before -> ${methodsBefore.join(" | ") || "none"}.`);

    let methodsAfterAddressChange = null;
    if (scenario.addressChange) {
      const changed = { ...scenario.address, ...scenario.addressChange };
      await fillCheckoutAddress(page, config, changed);
      await shot(page, path.join(scenarioDir, "09-checkout-after-address-change.png"));
      methodsAfterAddressChange = await readShippingMethods(page, config);
      out.observations.methodsAfterAddressChange = methodsAfterAddressChange;
      log(`Scenario ${scenario.id}: methods after address change -> ${methodsAfterAddressChange.join(" | ") || "none"}.`);
    }

    let methodsAfterLocationChange = null;
    if (scenario.locationChange) {
      const changed = await page.evaluate((rule) => {
        const selectors = [
          "#mulopimfwc_store_location",
          "select.mulopimfwc-location-selector",
          "select[name='mulopimfwc_store_location']",
          "select[name='location_id']"
        ];
        for (const selector of selectors) {
          const sel = document.querySelector(selector);
          if (!sel) continue;
          let target = null;
          if (rule.value) target = Array.from(sel.options).find((o) => o.value === String(rule.value));
          if (!target && rule.labelContains) {
            const n = String(rule.labelContains).toLowerCase();
            target = Array.from(sel.options).find((o) => (o.textContent || "").toLowerCase().includes(n));
          }
          if (!target) continue;
          sel.value = target.value;
          target.selected = true;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        return false;
      }, scenario.locationChange);
      await waitForSettle(page, 1700);
      await shot(page, path.join(scenarioDir, "10-checkout-after-location-change.png"));
      methodsAfterLocationChange = await readShippingMethods(page, config);
      out.observations.methodsAfterLocationChange = methodsAfterLocationChange;
      log(`Scenario ${scenario.id}: location change ${changed ? "applied" : "not found"}; methods -> ${methodsAfterLocationChange.join(" | ") || "none"}.`);
    }

    let methodsAfterReload = null;
    if (scenario.expected?.methodsShouldStayStableAfterReload) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForSettle(page, 1900);
      await shot(page, path.join(scenarioDir, "11-checkout-after-reload.png"));
      methodsAfterReload = await readShippingMethods(page, config);
      out.observations.methodsAfterReload = methodsAfterReload;
    }

    log(`Scenario ${scenario.id}: collecting no-shipping notice.`);
    const noShippingMessage = await withTimeout(readNoShippingMessage(page), 10000, "");
    out.observations.noShippingMessage = noShippingMessage;
    log(`Scenario ${scenario.id}: capturing final screenshot.`);
    await shot(page, path.join(scenarioDir, "12-checkout-final.png"));

    if (config.output?.saveHtmlSnapshot) {
      log(`Scenario ${scenario.id}: saving checkout html snapshot.`);
      const html = await withTimeout(page.content(), 15000, "<!-- timeout collecting page content -->");
      fs.writeFileSync(path.join(scenarioDir, "checkout-final.html"), html, "utf-8");
    }

    out.failures = assertScenario(
      scenario.expected || {},
      methodsBefore,
      methodsAfterAddressChange,
      methodsAfterLocationChange,
      methodsAfterReload,
      noShippingMessage
    );
    out.success = out.failures.length === 0;
    log(`Scenario ${scenario.id}: ${out.success ? "PASS" : "FAIL"}${out.failures.length ? ` -> ${out.failures.join(" || ")}` : ""}`);
  } catch (error) {
    out.failures.push(`Runtime error: ${error.message}`);
    out.success = false;
    log(`Scenario ${scenario.id}: runtime error -> ${error.message}`);
    await shot(page, path.join(scenarioDir, "zz-error.png")).catch(() => undefined);
  } finally {
    out.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(scenarioDir, "result.json"), JSON.stringify(out, null, 2), "utf-8");
    fs.writeFileSync(
      path.join(scenarioDir, "result.txt"),
      [
        `Scenario: ${out.id}`,
        `Description: ${out.description}`,
        `Success: ${out.success}`,
        `Started: ${out.startedAt}`,
        `Finished: ${out.finishedAt}`,
        `Failures: ${out.failures.length ? out.failures.join(" || ") : "None"}`,
        `Methods before: ${(out.observations.methodsBefore || []).join(" | ") || "None"}`,
        `No-shipping message: ${(out.observations.noShippingMessage || "").slice(0, 400)}`
      ].join("\n"),
      "utf-8"
    );
    await page.close();
  }

  let finalDir = scenarioDir;
  if (!out.success) {
    const incorrectDir = path.join(runDir, `incorrect_${path.basename(scenarioDir)}`);
    if (!fs.existsSync(incorrectDir)) {
      fs.renameSync(scenarioDir, incorrectDir);
      finalDir = incorrectDir;
    }
  }
  return { ...out, folder: finalDir };
}

async function runSetup(context, config, runDir) {
  const page = await context.newPage();
  const setupDir = path.join(runDir, "00-setup");
  ensureDir(setupDir);
  const setupResult = { ok: true, failures: [], zoneMap: {} };

  try {
    const login = await detectAndLoginIfNeeded(page, config, setupDir);
    if (!login.loggedIn) throw new Error("Login failed.");

    const settings = await ensureShippingSettings(page, config, setupDir);
    if (!settings.saved) log("Setup warning: settings save button not detected.");

    const zoneMap = await setupShippingZones(page, config, setupDir);
    setupResult.zoneMap = zoneMap;
    await shot(page, path.join(setupDir, "05-shipping-zones-overview.png"));

    const assignments = config.setup?.locationAssignments || [];
    for (const assignment of assignments) {
      const r = await setLocationAssignments(page, assignment, zoneMap, setupDir);
      if (!r.ok) setupResult.failures.push(`Location assignment failed for ${assignment.locationName} (${r.reason || "unknown"})`);
    }
  } catch (error) {
    setupResult.ok = false;
    setupResult.failures.push(error.message);
    await shot(page, path.join(setupDir, "zz-setup-error.png")).catch(() => undefined);
  } finally {
    fs.writeFileSync(path.join(setupDir, "setup-result.json"), JSON.stringify(setupResult, null, 2), "utf-8");
    await page.close();
  }
  return setupResult;
}

function printSummary(runDir, results, setupResult) {
  const passed = results.filter((r) => r.success).length;
  const failed = results.length - passed;
  console.log("\n==============================================");
  console.log("Shipping QC automation complete");
  console.log(`Run folder: ${runDir}`);
  console.log(`Setup: ${setupResult ? (setupResult.ok ? "OK" : "FAILED") : "skipped"}`);
  console.log(`Total scenarios: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("==============================================\n");
  for (const r of results) {
    console.log(`${r.success ? "PASS" : "FAIL"} - ${r.id} -> ${r.folder}`);
    if (!r.success) r.failures.forEach((f) => console.log(`  - ${f}`));
  }
}

async function main() {
  const flags = parseArgs();
  const config = readJson(flags.config);
  let scenarios = readJson(flags.scenarios).filter((s) => s.enabled !== false);
  if (flags.scenarioId) scenarios = scenarios.filter((s) => s.id === flags.scenarioId);
  if (flags.limit > 0) scenarios = scenarios.slice(0, flags.limit);
  if (!scenarios.length) throw new Error("No enabled scenarios found.");

  const runDir = path.resolve(ROOT_DIR, config.output?.rootDir || "./reports", `${nowStamp()}-${safeName(config.projectName || "shipping-qc")}`);
  ensureDir(runDir);

  const browser = await chromium.launch({
    headless: flags.headed === null ? !config.browser.headed : !flags.headed,
    slowMo: config.browser.slowMo ?? 0
  });
  const context = await browser.newContext({ viewport: config.browser.viewport || { width: 1600, height: 1000 } });
  context.setDefaultTimeout(config.browser.timeoutMs || 120000);

  let setupResult = null;
  const results = [];
  try {
    if (!flags.skipSetup) {
      log("Global setup: started.");
      setupResult = await runSetup(context, config, runDir);
      if (!setupResult.ok) log(`Global setup: failed -> ${setupResult.failures.join(" || ")}`);
      else log("Global setup: completed.");
    } else {
      log("Global setup: skipped by --skip-setup.");
    }

    for (let i = 0; i < scenarios.length; i += 1) {
      log(`Running ${i + 1}/${scenarios.length}: ${scenarios[i].id}`);
      const r = await runScenario(context, config, scenarios[i], runDir, i);
      results.push(r);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    runDir,
    setup: setupResult,
    total: results.length,
    passed: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    scenarios: results.map((r) => ({ id: r.id, success: r.success, folder: r.folder, failures: r.failures }))
  };
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  fs.writeFileSync(
    path.join(runDir, "summary.txt"),
    [
      `Project: ${config.projectName}`,
      `Generated at: ${summary.generatedAt}`,
      `Run folder: ${runDir}`,
      `Setup: ${setupResult ? (setupResult.ok ? "OK" : "FAILED") : "skipped"}`,
      `Total: ${summary.total}`,
      `Passed: ${summary.passed}`,
      `Failed: ${summary.failed}`
    ].join("\n"),
    "utf-8"
  );

  printSummary(runDir, results, setupResult);
}

main().catch((error) => {
  console.error("\nFatal error while running shipping QC automation:");
  console.error(error);
  process.exit(1);
});
