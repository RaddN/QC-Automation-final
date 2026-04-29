const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--config' && next) {
      args.config = next;
      index += 1;
      continue;
    }

    if (arg === '--url' && next) {
      args.url = next;
      index += 1;
      continue;
    }

    if (arg === '--device' && next) {
      args.device = next;
      index += 1;
      continue;
    }

    if (arg === '--headed' || arg === '-h' || arg === '--h') {
      args.headed = true;
      continue;
    }

    if (arg === '--headless') {
      args.headless = true;
      continue;
    }

    if (arg === '--allow-cart-mutations') {
      args.allowCartMutations = true;
      continue;
    }
  }

  return args;
}

function buildDefaultConfig() {
  return {
    siteLabel: 'one-page-checkout-site',
    baseUrl: '',
    outputDir: './reports',
    deviceMode: 'desktop',
    browser: {
      channel: 'chrome',
      headed: true,
      slowMoMs: 0,
      viewport: {
        width: 1440,
        height: 1200,
      },
    },
    selectors: {
      products: 'ul.products li.product, .wc-block-grid__product, .product',
      productTitle: '.woocommerce-loop-product__title, h2, h3',
      addToCart: '.add_to_cart_button, .single_add_to_cart_button',
      directCheckout: '.direct-checkout-button, .onepaquc-checkout-btn, .plugincy-quick-checkout a',
      quickViewButton: '.opqvfw-btn, .rmenu-quick-view-overlay a',
      quickViewModal: '.opqvfw-modal-container',
      cartButton: '.rwc_cart-button',
      cartDrawer: '.cart-drawer',
      onePageCheckout: '.one-page-checkout-container, #checkout-popup.onepagecheckoutwidget, .checkout-popup.onepagecheckoutwidget',
      checkoutForm: 'form.checkout, .woocommerce-checkout, .wc-block-checkout',
      archiveVariations: '.archive-variations-container',
      archiveQuantity: '.rmenu-archive-quantity, .rmenupro-archive-quantity',
      trustBadges: '.onepaqucpro-trust-badges, .trust-badges, .trust-badge-wrapper, .trust-badges-wrapper',
    },
    consentButtonNames: ['Accept All', 'Accept'],
    noisePatterns: [
      'cookie',
      'consent',
      'googletag',
      'gtag',
      'google-analytics',
      'googlesyndication',
      'doubleclick',
      'facebook',
      'clarity',
      'hotjar',
    ],
    scenarioSettings: {
      includeInteractions: true,
      allowCartMutations: true,
      includeAddToCartInteractions: false,
      includeFloatingCartWorkflow: true,
      includeFloatingCartCheckout: true,
      directCheckoutRequiredOnly: true,
      strictRequiredTargets: false,
      maxDirectCheckoutInteractions: 8,
      maxTargets: 80,
    },
    testData: {
      couponCode: '',
    },
  };
}

function mergeConfig(base, override) {
  const output = { ...base, ...override };
  output.browser = {
    ...base.browser,
    ...(override.browser || {}),
    viewport: {
      ...base.browser.viewport,
      ...((override.browser || {}).viewport || {}),
    },
  };
  output.selectors = {
    ...base.selectors,
    ...(override.selectors || {}),
  };
  output.consentButtonNames = override.consentButtonNames || base.consentButtonNames;
  output.noisePatterns = override.noisePatterns || base.noisePatterns;
  output.scenarioSettings = {
    ...base.scenarioSettings,
    ...(override.scenarioSettings || {}),
  };
  output.testData = {
    ...(base.testData || {}),
    ...(override.testData || {}),
  };
  return output;
}

const DEVICE_PRESETS = {
  desktop: {
    name: 'desktop',
    viewport: { width: 1440, height: 1200 },
  },
  mobile: {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
};

function normalizeDeviceMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'd' || normalized === 'desktop') return 'desktop';
  if (normalized === 'm' || normalized === 'mobile') return 'mobile';
  return 'desktop';
}

function resolveDevicePreset(deviceMode) {
  return DEVICE_PRESETS[deviceMode] || DEVICE_PRESETS.desktop;
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function sanitizeId(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function hasValue(value) {
  return !(value === null || value === undefined || String(value).trim() === '');
}

function parseBoolean(value, defaultValue = false) {
  if (!hasValue(value)) {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'yes', 'true', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'no', 'false', 'off', 'disabled'].includes(normalized)) return false;
  return defaultValue;
}

function settingArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).map((item) => String(item)).filter(Boolean);
  }

  if (hasValue(value)) {
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return fallback;
}

function getDirectCheckoutPageKey(target) {
  if (!target) return '';
  if (target.kind === 'simpleProduct' || target.kind === 'variableProduct') return 'single';
  if (target.role === 'shop') return 'shop-page';
  if (target.role === 'parentCategory' || target.role === 'childCategory' || target.taxonomy === 'product_cat') {
    return 'category-archives';
  }
  if (target.role === 'tag' || target.taxonomy === 'product_tag') return 'tag-archives';
  if (target.kind === 'archive') return 'shortcodes';
  return '';
}

function getDirectCheckoutProductTypeKey(target) {
  if (!target) return '';
  if (target.kind === 'simpleProduct') return 'simple';
  if (target.kind === 'variableProduct') return 'variable';
  return '';
}

function getQuickViewPageKey(target) {
  if (!target) return '';
  if (target.kind === 'simpleProduct' || target.kind === 'variableProduct') return 'single-product';
  if (target.role === 'shop') return 'shop-page';
  if (target.role === 'parentCategory' || target.role === 'childCategory' || target.taxonomy === 'product_cat') {
    return 'category-archives';
  }
  if (target.role === 'brand' || /brand/i.test(String(target.taxonomy || ''))) return 'brand-archives';
  if (target.role === 'tag' || target.taxonomy === 'product_tag') return 'tag-archives';
  if (target.role === 'attributeTerm' || /^pa_/i.test(String(target.taxonomy || ''))) return 'attribute-archives';
  if (target.kind === 'archive') return 'shortcodes';
  return '';
}

function isDirectCheckoutExpectedOnTarget(target, flags) {
  if (!flags?.directCheckout) {
    return false;
  }

  const pageKey = getDirectCheckoutPageKey(target);
  if (!pageKey) {
    return false;
  }

  if (!(flags.directCheckoutAllowedPages || []).includes(pageKey)) {
    return false;
  }

  const productTypeKey = getDirectCheckoutProductTypeKey(target);
  if (productTypeKey && !(flags.directCheckoutAllowedTypes || []).includes(productTypeKey)) {
    return false;
  }

  return true;
}

function isQuickViewExpectedOnTarget(target, flags) {
  if (!flags?.quickView) {
    return false;
  }

  const pageKey = getQuickViewPageKey(target);
  if (!pageKey) {
    return false;
  }

  return (flags.quickViewAllowedPages || []).includes(pageKey);
}

function getExpectedDirectCheckoutOutcome(method) {
  const normalized = String(method || 'direct_checkout');
  if (normalized === 'direct_checkout') return 'checkout_redirect';
  if (normalized === 'cart_redirect') return 'cart_redirect';
  if (normalized === 'popup_checkout') return 'popup_checkout';
  if (normalized === 'side_cart') return 'side_cart';
  if (normalized === 'ajax_add') return 'ajax_add';
  return 'unknown';
}

function deriveSiteLabel(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const pathPart = parsed.pathname
      .replace(/^\/+|\/+$/g, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '');
    return sanitizeId([host, pathPart].filter(Boolean).join('-') || host || 'site');
  } catch {
    return 'site';
  }
}

function normalizeComparableUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    parsed.searchParams.delete('plugincydebug');
    const sorted = new URLSearchParams();
    for (const [key, value] of Array.from(parsed.searchParams.entries()).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey)
    )) {
      sorted.append(key, value);
    }
    const search = sorted.toString();
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${pathname}${search ? `?${search}` : ''}`;
  } catch {
    return String(rawUrl || '').trim();
  }
}

function requestPostDataIncludes(request, needle) {
  try {
    return (request.postData() || '').includes(needle);
  } catch {
    return false;
  }
}

function isAdminAjaxActionRequest(request, action) {
  return request.url().includes('admin-ajax.php') && requestPostDataIncludes(request, action);
}

function withDebugQuery(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.searchParams.set('plugincydebug', 'true');
  return parsed.toString();
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function loadInitialConfig(cliArgs) {
  let config = buildDefaultConfig();

  if (cliArgs.config) {
    const configPath = path.resolve(cliArgs.config);
    const loaded = await readJson(configPath);
    config = mergeConfig(config, loaded);
    config.configPath = configPath;
    config.runMode = 'config';
  } else {
    config.runMode = 'url-auto';
  }

  if (cliArgs.url) {
    config.baseUrl = cliArgs.url;
    if (!config.siteLabel || config.siteLabel === 'one-page-checkout-site') {
      config.siteLabel = deriveSiteLabel(cliArgs.url);
    }
    if (!config.runMode || config.runMode === 'config') {
      config.runMode = cliArgs.config ? 'config-url-override' : 'url-auto';
    }
  }

  if (!hasValue(config.baseUrl)) {
    throw new Error('Provide a base URL or a config file with baseUrl.');
  }

  config.deviceMode = normalizeDeviceMode(cliArgs.device || config.deviceMode);
  if (cliArgs.headed) config.browser.headed = true;
  if (cliArgs.headless) config.browser.headed = false;
  if (cliArgs.allowCartMutations) config.scenarioSettings.allowCartMutations = true;

  return config;
}

function createProgressLogger() {
  let total = 1;
  let current = 0;

  return {
    setTotal(nextTotal) {
      total = Math.max(1, Number(nextTotal) || 1);
      current = 0;
    },
    info(label) {
      console.log(`[info] ${label}`);
    },
    step(label) {
      current += 1;
      const percent = Math.min(100, Math.round((current / total) * 100));
      console.log(`[${current}/${total}] ${percent}% ${label}`);
    },
  };
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function normalizeTextForCompare(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUiText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uiTextEquals(actual, expected) {
  return normalizeUiText(actual).toLocaleLowerCase() === normalizeUiText(expected).toLocaleLowerCase();
}

function parseMoneyValue(value) {
  const digitMap = {
    '০': '0',
    '১': '1',
    '২': '2',
    '৩': '3',
    '৪': '4',
    '৫': '5',
    '৬': '6',
    '৭': '7',
    '৮': '8',
    '৯': '9',
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
  };

  /*
  let normalized = String(value || '').replace(/[০-۹]/g, (digit) => digitMap[digit] || digit);
  */
  let normalized = String(value || '').replace(/[\u09e6-\u09ef\u0660-\u0669\u06f0-\u06f9]/g, (digit) => digitMap[digit] || digit);
  normalized = normalized.replace(/[^\d.,-]/g, '');
  if (!normalized) return null;

  const lastDot = normalized.lastIndexOf('.');
  const lastComma = normalized.lastIndexOf(',');
  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = normalized.replace(/,/g, '');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function moneyCloseEnough(actual, expected, tolerance = 0.06) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  return Math.abs(actual - expected) <= tolerance;
}

function listIncludesProductName(items, productName) {
  const needle = normalizeTextForCompare(productName);
  if (needle.length < 6) {
    return false;
  }

  return (items || []).some((item) => {
    const haystack = normalizeTextForCompare(item);
    return haystack.includes(needle) || needle.includes(haystack);
  });
}

function createMessageFilter(config) {
  const noisePatterns = (config.noisePatterns || []).map((pattern) => new RegExp(pattern, 'i'));
  const criticalTypes = new Set(['console:error', 'pageerror', 'response:error', 'requestfailed']);

  return (messages) =>
    (messages || []).filter((message) => {
      if (!criticalTypes.has(message.type)) {
        return false;
      }

      const text = stripAnsi(`${message.text || ''} ${message.url || ''}`);
      return !noisePatterns.some((pattern) => pattern.test(text));
    });
}

function extractPageUrl(page) {
  if (!page) return null;
  return (
    page.debugUrl ||
    page.url ||
    page.term?.debugUrl ||
    page.term?.url ||
    page.product?.debugUrl ||
    page.product?.url ||
    null
  );
}

function extractPageName(page) {
  if (!page) return '';
  return page.term?.name || page.product?.name || page.label || '';
}

function buildTargets(debugData, config) {
  const maxTargets = Math.max(1, Number(config.scenarioSettings.maxTargets) || 80);
  const targets = [];
  const seen = new Set();

  const pushTarget = (target) => {
    if (!target || !target.url) return;

    const dedupeKey = normalizeComparableUrl(target.url);
    if (seen.has(dedupeKey)) return;

    seen.add(dedupeKey);
    targets.push({
      ...target,
      normalizedUrl: dedupeKey,
    });
  };

  for (const [key, page] of Object.entries(debugData?.requiredPages || {})) {
    pushTarget({
      key,
      role: key,
      kind: ['simpleProduct', 'variableProduct'].includes(key) ? key : 'archive',
      label: page.label || key,
      selectedItem: extractPageName(page),
      url: extractPageUrl(page),
      required: true,
    });
  }

  for (const taxonomy of debugData?.taxonomyArchives || []) {
    for (const termRole of ['sampleTerm', 'parentTerm', 'childTerm']) {
      const term = taxonomy[termRole];
      if (!term?.debugUrl && !term?.url) continue;

      pushTarget({
        key: `taxonomy-${taxonomy.name}-${termRole}`,
        role: termRole,
        kind: 'archive',
        label: `${taxonomy.label || taxonomy.name} ${termRole}`,
        selectedItem: term.name || '',
        taxonomy: taxonomy.name,
        url: term.debugUrl || term.url,
        required: false,
      });
    }
  }

  if (!targets.length) {
    pushTarget({
      key: 'base',
      role: 'base',
      kind: 'archive',
      label: 'Base URL',
      selectedItem: '',
      url: withDebugQuery(config.baseUrl),
      required: true,
    });
  }

  return targets.slice(0, maxTargets);
}

function deriveFeatureFlags(runtime) {
  const settings = runtime?.settings || {};
  const directCheckoutBehave = runtime?.cartParams?.directCheckoutBehave || {};
  const directCheckoutMethod =
    directCheckoutBehave.rmenupro_wc_checkout_method ||
    settings.rmenupro_wc_checkout_method ||
    runtime?.cartParams?.checkoutMethod ||
    'direct_checkout';

  return {
    directCheckout: parseBoolean(settings.rmenupro_add_direct_checkout_button, true),
    ajaxAddToCart: parseBoolean(settings.rmenupro_enable_ajax_add_to_cart, false),
    quickView: parseBoolean(settings.rmenupro_enable_quick_view, false),
    quickViewButtonText: settings.rmenupro_quick_view_button_text || '',
    quickViewDisplayType: settings.rmenupro_quick_view_display_type || runtime?.quickViewParams?.displayType || 'icon',
    quickViewAjaxAddToCart: parseBoolean(
      settings.rmenupro_quick_view_ajax_add_to_cart ?? runtime?.quickViewParams?.ajaxAddToCart,
      true
    ),
    quickViewCloseOnAdd: parseBoolean(settings.rmenupro_quick_view_close_on_add ?? runtime?.quickViewParams?.closeOnAdd, false),
    quickViewAllowedTypes: settingArray(settings.rmenupro_show_quick_view_by_types, ['simple', 'variable', 'grouped', 'external']),
    quickViewAllowedPages: settingArray(settings.rmenupro_show_quick_view_by_page, [
      'shop-page',
      'category-archives',
      'tag-archives',
      'brand-archives',
      'attribute-archives',
      'single-product',
      'search',
      'featured-products',
      'on-sale',
      'recent',
      'widgets',
      'shortcodes',
    ]),
    quickViewContentElements: settingArray(settings.rmenupro_quick_view_content_elements, [
      'image',
      'title',
      'rating',
      'price',
      'excerpt',
      'add_to_cart',
      'meta',
    ]),
    archiveQuantity: parseBoolean(settings.rmenupro_show_quantity_archive, false),
    archiveVariation: parseBoolean(settings.rmenupro_variation_show_archive, true),
    onePageCheckoutAll: parseBoolean(settings.onepaqucpro_checkout_enable_all, false),
    onePageCheckoutEnabled: parseBoolean(settings.onepaqucpro_checkout_enable, true),
    cartDrawerSticky: parseBoolean(settings.rmenu_enable_sticky_cart, false),
    mobileStickyAddToCart: parseBoolean(settings.rmenupro_sticky_add_to_cart_mobile, false),
    trustBadges: parseBoolean(settings.onepaqucpro_trust_badges_enabled, false),
    forceLogin: parseBoolean(settings.rmenupro_force_login, false),
    checkoutMethod: directCheckoutMethod,
    directCheckoutOutcome: getExpectedDirectCheckoutOutcome(directCheckoutMethod),
    directCheckoutClearCart: parseBoolean(
      directCheckoutBehave.rmenupro_wc_clear_cart ?? settings.rmenupro_wc_clear_cart,
      false
    ),
    directCheckoutConfirmation: parseBoolean(
      directCheckoutBehave.rmenupro_wc_add_confirmation ?? settings.rmenupro_wc_add_confirmation,
      false
    ),
    directCheckoutOneClickPurchase: parseBoolean(
      directCheckoutBehave.rmenupro_wc_one_click_purchase ?? settings.rmenupro_wc_one_click_purchase,
      false
    ),
    directCheckoutGuestEnabled: parseBoolean(settings.rmenupro_wc_checkout_guest_enabled, true),
    directCheckoutArchivePosition: settings.rmenupro_wc_direct_checkout_position || 'after_add_to_cart',
    directCheckoutSinglePosition: settings.rmenu_wc_direct_checkout_single_position || 'after_add_to_cart',
    directCheckoutText: settings['txt-direct-checkout'] || 'Buy Now',
    floatingCartCheckoutBehavior: settings.rmenu_cart_checkout_behavior || 'direct_checkout',
    floatingCartVariationSwitch: parseBoolean(runtime?.cartParams?.variationSwitchEnabled, false),
    floatingCartText: {
      title: settings.your_cart || 'Your Cart',
      selectAll: settings.txt_Select_All || 'Select All',
      selectedSuffix: settings.txt_Selected || runtime?.cartParams?.txtSelected || 'selected',
      recommendedTitle: settings.txt_you_may_like || 'You may also like',
      subtotal: settings.txt_subtotal || 'Subtotal',
      total: settings.txt_total || 'Total',
      checkout: settings.txt_checkout || 'Checkout',
      couponPlaceholder: runtime?.floatingCart?.coupon_placeholder || 'Enter coupon code',
      couponApply: runtime?.floatingCart?.apply || 'Apply',
      couponApplyLong: runtime?.floatingCart?.apply_coupon || 'Apply coupon',
    },
    directCheckoutAllowedTypes: settingArray(settings.rmenupro_show_quick_checkout_by_types, ['simple', 'variable', 'external']),
    directCheckoutAllowedPages: settingArray(settings.rmenupro_show_quick_checkout_by_page, [
      'single',
      'related',
      'upsells',
      'shop-page',
      'category-archives',
      'tag-archives',
      'featured-products',
      'on-sale',
      'recent',
      'widgets',
      'shortcodes',
    ]),
  };
}

function summarizeSettings(runtime) {
  const settings = runtime?.settings || {};
  const keys = [
    'rmenupro_add_direct_checkout_button',
    'rmenupro_wc_checkout_method',
    'rmenupro_enable_ajax_add_to_cart',
    'rmenupro_wc_clear_cart',
    'rmenupro_wc_add_confirmation',
    'rmenupro_wc_one_click_purchase',
    'rmenupro_wc_checkout_guest_enabled',
    'txt-direct-checkout',
    'rmenupro_wc_direct_checkout_position',
    'rmenu_wc_direct_checkout_single_position',
    'rmenupro_show_quick_checkout_by_types',
    'rmenupro_show_quick_checkout_by_page',
    'rmenupro_enable_quick_view',
    'rmenupro_show_quantity_archive',
    'rmenupro_variation_show_archive',
    'rmenu_variation_layout',
    'rmenupro_show_quick_view_by_types',
    'rmenupro_show_quick_view_by_page',
    'rmenupro_quick_view_button_text',
    'rmenupro_quick_view_button_position',
    'rmenupro_quick_view_display_type',
    'rmenupro_quick_view_ajax_add_to_cart',
    'rmenupro_quick_view_close_on_add',
    'rmenupro_quick_view_content_elements',
    'onepaqucpro_checkout_enable',
    'onepaqucpro_checkout_enable_all',
    'onepaqucpro_checkout_layout',
    'rmenu_enable_sticky_cart',
    'rmenupro_sticky_add_to_cart_mobile',
    'rmenupro_force_login',
    'onepaqucpro_trust_badges_enabled',
    'onepaqucpro_trust_badge_position',
    'your_cart',
    'txt_subtotal',
    'txt_total',
    'txt_checkout',
    'txt_Select_All',
    'txt_Selected',
    'txt_you_may_like',
  ];

  return Object.fromEntries(keys.map((key) => [key, settings[key] ?? null]));
}

function makeResult({ id, title, target = null, issues = [], skipped = false, reason = '', details = {}, screenshot = null }) {
  return {
    id,
    title,
    target,
    skipped,
    reason,
    issues,
    details,
    screenshot,
    passed: !skipped && issues.length === 0,
  };
}

function countFailed(tests) {
  return tests.reduce((count, test) => count + (test.passed || test.skipped ? 0 : 1), 0);
}

function statusLabel(test) {
  if (test.skipped) return 'SKIP';
  return test.passed ? 'PASS' : 'FAIL';
}

function summarizeIssue(test) {
  if (test.skipped) return test.reason || 'Skipped.';
  if (test.passed) return '';
  return (test.issues || []).join('; ');
}

function formatMarkdownValue(value) {
  if (Array.isArray(value)) {
    return value.join(',');
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function buildMarkdownReport(report) {
  const lines = [];
  lines.push(`# One Page Checkout QC: ${report.siteLabel}`);
  lines.push('');
  lines.push(`- Base URL: ${report.baseUrl}`);
  lines.push(`- Device: ${report.deviceMode}`);
  lines.push(`- Run mode: ${report.runMode}`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push(`- Targets tested: ${report.targets.length}`);
  lines.push(`- Failed tests: ${report.failedCount}`);
  lines.push('');

  lines.push('## Discovery');
  lines.push('');
  lines.push(`- Debug payload source: ${report.discovery.source || 'none'}`);
  lines.push(`- Missing required pages: ${report.discovery.missingRequiredPages.length}`);
  for (const missing of report.discovery.missingRequiredPages) {
    lines.push(`  - ${missing.label || missing.key}`);
  }
  if (report.discovery.missingRequiredPages.length && !report.discovery.strictRequiredTargets) {
    lines.push('- Missing catalog targets are informational because strict required targets are disabled.');
  }
  lines.push('');

  lines.push('## Feature Flags');
  lines.push('');
  for (const [key, value] of Object.entries(report.featureFlags || {})) {
    lines.push(`- ${key}: ${formatMarkdownValue(value)}`);
  }
  lines.push('');

  lines.push('## Findings');
  lines.push('');
  for (const test of report.tests) {
    const targetPart = test.target ? ` (${test.target.label}: ${test.target.url})` : '';
    lines.push(`### ${statusLabel(test)} ${test.title}${targetPart}`);
    const summary = summarizeIssue(test);
    if (summary) {
      lines.push('');
      lines.push(summary);
    }
    if (test.screenshot) {
      lines.push('');
      lines.push(`Screenshot: ${test.screenshot}`);
    }
    lines.push('');
  }

  if (report.uniqueMessages.length) {
    lines.push('## Browser Errors');
    lines.push('');
    for (const message of report.uniqueMessages.slice(0, 50)) {
      lines.push(`- ${message.type}: ${message.text || message.url || ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  let config = await loadInitialConfig(cliArgs);
  const devicePreset = resolveDevicePreset(config.deviceMode);
  config.deviceMode = devicePreset.name;
  config.browser.viewport = {
    ...config.browser.viewport,
    ...devicePreset.viewport,
  };

  const outputRoot = path.resolve(config.outputDir || './reports');
  const outputDir = path.join(outputRoot, `${timestamp()}-${sanitizeId(config.siteLabel)}-${config.deviceMode}`);
  await fs.mkdir(outputDir, { recursive: true });

  const reportJsonPath = path.join(outputDir, 'report.json');
  const reportMarkdownPath = path.join(outputDir, 'report.md');
  const generatedConfigPath = path.join(outputDir, 'generated-config.json');
  const progress = createProgressLogger();
  const filterRelevantMessages = createMessageFilter(config);
  const messages = [];
  const responseStatuses = new Map();

  const pushMessage = (message) => {
    messages.push({
      ...message,
      text: stripAnsi(message.text || ''),
      timestamp: new Date().toISOString(),
    });
  };

  const browserLaunchOptions = {
    headless: !config.browser.headed,
    slowMo: Number(config.browser.slowMoMs) || 0,
  };

  if (config.browser.channel) {
    browserLaunchOptions.channel = config.browser.channel;
  }

  let browser;
  try {
    browser = await chromium.launch(browserLaunchOptions);
  } catch (error) {
    if (!browserLaunchOptions.channel) {
      throw error;
    }
    console.warn(`[warn] Could not launch ${browserLaunchOptions.channel}; falling back to bundled Chromium.`);
    delete browserLaunchOptions.channel;
    browser = await chromium.launch(browserLaunchOptions);
  }

  const context = await browser.newContext({
    viewport: config.browser.viewport,
    isMobile: devicePreset.isMobile || false,
    hasTouch: devicePreset.hasTouch || false,
    deviceScaleFactor: devicePreset.deviceScaleFactor || 1,
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) {
      pushMessage({
        type: `console:${msg.type() === 'warning' ? 'warn' : 'error'}`,
        text: msg.text(),
        url: page.url(),
      });
    }
  });

  page.on('pageerror', (error) => {
    pushMessage({
      type: 'pageerror',
      text: error.message,
      url: page.url(),
    });
  });

  page.on('requestfailed', (request) => {
    pushMessage({
      type: 'requestfailed',
      text: `${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'request failed'}`,
      url: request.url(),
    });
  });

  page.on('response', (response) => {
    responseStatuses.set(response.url(), response.status());
    if (response.status() < 400) {
      return;
    }

    pushMessage({
      type: 'response:error',
      text: `${response.request().method()} ${response.url()} :: HTTP ${response.status()}`,
      url: response.url(),
      status: response.status(),
    });
  });

  const delay = (ms) => page.waitForTimeout(ms);

  async function dismissConsent() {
    for (const label of config.consentButtonNames || []) {
      try {
        const button = page.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).first();
        if (await button.isVisible({ timeout: 400 })) {
          await button.click({ force: true });
          await delay(400);
          return;
        }
      } catch {
        // Ignore missing consent buttons.
      }
    }
  }

  async function gotoPage(url) {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await dismissConsent();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);
    await delay(600);
    return response;
  }

  async function readDebugPayload() {
    return page.evaluate(() => {
      if (window.plugincyQcDebug && typeof window.plugincyQcDebug === 'object') {
        return {
          source: 'window.plugincyQcDebug',
          data: window.plugincyQcDebug,
        };
      }

      const jsonNode = document.getElementById('plugincy-qc-debug-data');
      if (jsonNode && jsonNode.textContent) {
        try {
          return {
            source: '#plugincy-qc-debug-data',
            data: JSON.parse(jsonNode.textContent),
          };
        } catch (error) {
          return {
            source: '#plugincy-qc-debug-data',
            data: null,
            error: error.message,
          };
        }
      }

      return {
        source: '',
        data: null,
      };
    });
  }

  async function readRuntime() {
    return page.evaluate(() => {
      const settings =
        window.onepaqucpro_rmsgValue && window.onepaqucpro_rmsgValue.plugincy_all_settings
          ? window.onepaqucpro_rmsgValue.plugincy_all_settings
          : {};

      const cartParams = window.onepaqucpro_wc_cart_params || {};
      const quickViewParams = window.rmenupro_quick_view_params || {};
      const rmsgValue = window.onepaqucpro_rmsgValue || {};

      return {
        settings,
        settingsCount: Object.keys(settings).length,
        cartParamsPresent: Boolean(window.onepaqucpro_wc_cart_params),
        quickViewParamsPresent: Boolean(window.rmenupro_quick_view_params),
        rmsgValuePresent: Boolean(window.onepaqucpro_rmsgValue),
        ajaxAddToCartParamsPresent: Boolean(window.rmenupro_ajax_object),
        floatingCart: rmsgValue.floating_cart || {},
        checkoutUrl: rmsgValue.checkout_url || cartParams.checkout_url || null,
        ajaxUrl: rmsgValue.ajax_url || cartParams.ajax_url || null,
        currencySymbol: rmsgValue.currency_symbol || null,
        cartParams: {
          ajaxUrl: cartParams.ajax_url || null,
          nonce: cartParams.nonce || null,
          removeCartItemNonce: cartParams.remove_cart_item || null,
          updateCartItemQuantityNonce: cartParams.update_cart_item_quantity || null,
          updateCartItemVariationNonce: cartParams.update_cart_item_variation || null,
          getCartContentNonce: cartParams.get_cart_content_none || null,
          txtSelected: cartParams.txt_selected || null,
          checkoutMethod: cartParams.rmenupro_wc_checkout_method || null,
          checkoutUrl: cartParams.checkout_url || null,
          cartUrl: cartParams.cart_url || null,
          checkoutUrlPresent: Boolean(cartParams.checkout_url),
          cartUrlPresent: Boolean(cartParams.cart_url),
          premiumFeature: cartParams.premium_feature ?? null,
          blocksQuantityControl: cartParams.blocks_quantity_control ?? null,
          blocksRemoveProduct: cartParams.blocks_remove_product ?? null,
          variationSwitchEnabled: cartParams.variation_switch_enabled ?? null,
          directCheckoutBehave: cartParams.direct_checkout_behave || {},
        },
        quickViewParams: {
          enabled: Boolean(window.rmenupro_quick_view_params),
          displayType: quickViewParams.display_type || null,
          ajaxAddToCart: quickViewParams.onepaqucpro_ajax_add_to_cart ?? quickViewParams.ajax_add_to_cart ?? null,
          closeOnAdd: quickViewParams.close_on_add ?? null,
          mobileOptimize: quickViewParams.mobile_optimize ?? null,
          elementsInPopup: quickViewParams.elements_in_popup || [],
        },
      };
    });
  }

  async function readPageFacts() {
    return page.evaluate((selectors) => {
      const safeQueryAll = (selector) => {
        if (!selector) return [];
        try {
          return Array.from(document.querySelectorAll(selector));
        } catch {
          return [];
        }
      };

      const isVisible = (node) => {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          (node.offsetWidth > 0 || node.offsetHeight > 0 || node.getClientRects().length > 0)
        );
      };

      const count = (selector) => safeQueryAll(selector).length;
      const visibleCount = (selector) => safeQueryAll(selector).filter(isVisible).length;
      const text = (selector) => safeQueryAll(selector)[0]?.textContent?.trim() || '';
      const productNodes = safeQueryAll(selectors.products);
      const directCheckoutNodes = safeQueryAll(selectors.directCheckout).filter(isVisible);
      const quickViewNodes = safeQueryAll(selectors.quickViewButton).filter(isVisible);
      const normalAddToCartNodes = safeQueryAll(selectors.addToCart).filter((node) => {
        return isVisible(node) && !node.matches(selectors.directCheckout);
      });
      const bodyText = document.body ? document.body.innerText || '' : '';
      const ids = new Map();
      const duplicateIds = [];

      for (const node of safeQueryAll('[id]')) {
        const id = node.id;
        if (!id) continue;
        ids.set(id, (ids.get(id) || 0) + 1);
      }

      for (const [id, occurrences] of ids.entries()) {
        if (occurrences > 1) {
          duplicateIds.push({ id, occurrences });
        }
      }

      const phpPatterns = [
        /Fatal error:[^\n]+/gi,
        /Parse error:[^\n]+/gi,
        /Warning:[^\n]+/gi,
        /Notice:[^\n]+/gi,
        /Deprecated:[^\n]+/gi,
        /Uncaught (?:Error|Exception):[^\n]+/gi,
        /There has been a critical error[^\n]*/gi,
      ];
      const phpErrorTexts = [];
      for (const pattern of phpPatterns) {
        const matches = bodyText.match(pattern) || [];
        phpErrorTexts.push(...matches.slice(0, 5));
      }

      const variableProductCards = productNodes.filter((node) => {
        const classText = node.className || '';
        return (
          /product[_-]type[_-]variable/i.test(classText) ||
          Boolean(node.querySelector('.product_type_variable, [data-product_type="variable"], [data-product-type="variable"]'))
        );
      }).length;

      const simpleProductCards = productNodes.filter((node) => {
        const classText = node.className || '';
        return (
          /product[_-]type[_-]simple/i.test(classText) ||
          Boolean(node.querySelector('.product_type_simple, [data-product_type="simple"], [data-product-type="simple"]'))
        );
      }).length;

      const missingProductImages = productNodes
        .flatMap((node) => Array.from(node.querySelectorAll('img')))
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .length;

      const criticalDuplicateIds = duplicateIds.filter((item) =>
        ['checkout-popup', 'checkout-form', 'plugincy-qc-debug', 'plugincy-qc-debug-data'].includes(item.id)
      );

      const directCheckoutButtons = directCheckoutNodes.slice(0, 12).map((node) => {
        const productNode = node.closest('.product, li.product, .wc-block-grid__product');
        const productIndex = productNode ? productNodes.indexOf(productNode) : -1;
        const classText = productNode?.className || '';
        let inferredProductType = node.getAttribute('data-product-type') || node.getAttribute('data-product_type') || '';
        if (!inferredProductType) {
          const classMatch = classText.match(/product[_-]type[_-]([a-z0-9_-]+)/i);
          inferredProductType = classMatch ? classMatch[1] : '';
        }

        return {
          text: node.textContent.trim().replace(/\s+/g, ' '),
          productId: node.getAttribute('data-product-id') || node.getAttribute('data-product_id') || '',
          productType: inferredProductType,
          href: node.getAttribute('href') || '',
          classes: node.className || '',
          disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true' || node.classList.contains('disabled')),
          productIndex,
          inProductLoop: Boolean(productNode),
          inSingleSummary: Boolean(node.closest('.summary, .entry-summary, form.cart')),
          overlayPosition:
            node.closest('.plugincy-quick-checkout')?.className ||
            node.closest('.rmenu-quick-view-overlay')?.className ||
            '',
        };
      });

      const quickViewButtons = quickViewNodes.slice(0, 12).map((node) => {
        const productNode = node.closest('.product, li.product, .wc-block-grid__product');
        const productIndex = productNode ? productNodes.indexOf(productNode) : -1;
        const classText = productNode?.className || '';
        const classMatch = classText.match(/product[_-]type[_-]([a-z0-9_-]+)/i);

        return {
          text: node.textContent.trim().replace(/\s+/g, ' '),
          productId: node.getAttribute('data-product-id') || node.getAttribute('data-product_id') || '',
          productType: node.getAttribute('data-product-type') || node.getAttribute('data-product_type') || (classMatch ? classMatch[1] : ''),
          href: node.getAttribute('href') || '',
          classes: node.className || '',
          productIndex,
          overlayPosition: node.closest('.rmenu-quick-view-overlay')?.className || '',
        };
      });

      return {
        title: document.title,
        h1: text('h1'),
        bodyClasses: document.body ? document.body.className : '',
        productCount: productNodes.length,
        visibleProductCount: productNodes.filter(isVisible).length,
        variableProductCards,
        simpleProductCards,
        addToCartCount: visibleCount(selectors.addToCart),
        normalAddToCartCount: normalAddToCartNodes.length,
        directCheckoutCount: visibleCount(selectors.directCheckout),
        directCheckoutButtons,
        quickViewButtonCount: visibleCount(selectors.quickViewButton),
        quickViewButtons,
        quickViewModalCount: count(selectors.quickViewModal),
        quickViewModalActive: safeQueryAll(selectors.quickViewModal).some((node) => node.classList.contains('active') && isVisible(node)),
        cartButtonCount: visibleCount(selectors.cartButton),
        cartDrawerCount: count(selectors.cartDrawer),
        cartDrawerOpen: safeQueryAll(selectors.cartDrawer).some((node) => node.classList.contains('open') || isVisible(node)),
        onePageCheckoutCount: visibleCount(selectors.onePageCheckout),
        checkoutFormCount: visibleCount(selectors.checkoutForm),
        archiveVariationsCount: visibleCount(selectors.archiveVariations),
        archiveQuantityCount: visibleCount(selectors.archiveQuantity),
        variationFormCount: count('form.variations_form'),
        variationSelectCount: count('form.variations_form select'),
        variationButtonCount: visibleCount('.variation-button, .var-attr-option'),
        trustBadgeCount: visibleCount(selectors.trustBadges),
        mobileStickyCartCount: visibleCount('.rmenupro-mobile-sticky-cart'),
        productSummaryCount: visibleCount('.summary, .entry-summary, .product_title'),
        outOfStockCount: visibleCount('.outofstock, .stock.out-of-stock'),
        missingProductImages,
        duplicateIds: duplicateIds.slice(0, 25),
        criticalDuplicateIds,
        phpErrorTexts: phpErrorTexts.slice(0, 10),
        pluginDomPresent: Boolean(
          document.querySelector(
            '.direct-checkout-button, .onepaquc-checkout-btn, .opqvfw-btn, .opqvfw-modal-container, .rmenupro-cart, .cart-drawer, .one-page-checkout-container, .archive-variations-container'
          )
        ),
      };
    }, config.selectors);
  }

  function buildPageIssues({ target, response, facts, runtime, flags, relevantMessages }) {
    const issues = [];
    const status = response ? response.status() : 0;
    const expectsDirectCheckout = isDirectCheckoutExpectedOnTarget(target, flags);
    const expectsQuickView = isQuickViewExpectedOnTarget(target, flags);
    const firstDirectButton = (facts.directCheckoutButtons || [])[0] || null;
    const firstQuickViewButton = (facts.quickViewButtons || [])[0] || null;

    if (status >= 400) {
      issues.push(`Page returned HTTP ${status}.`);
    }

    if (facts.phpErrorTexts.length) {
      issues.push(`PHP/runtime error text is visible on the page: ${facts.phpErrorTexts[0]}`);
    }

    if (facts.criticalDuplicateIds.length) {
      issues.push(`Critical duplicate IDs found: ${facts.criticalDuplicateIds.map((item) => `${item.id} (${item.occurrences})`).join(', ')}.`);
    }

    if (!runtime.cartParamsPresent && !runtime.rmsgValuePresent && !facts.pluginDomPresent) {
      issues.push('Plugincy checkout frontend runtime was not detected on this page.');
    }

    if (!flags.cartDrawerSticky && facts.cartButtonCount > 0) {
      issues.push('Floating cart is disabled in settings, but a floating cart button is visible.');
    }

    if (flags.cartDrawerSticky && runtime.cartParamsPresent && facts.cartButtonCount === 0) {
      issues.push('Floating cart is enabled in settings, but no floating cart button was found.');
    }

    if (!flags.directCheckout && facts.directCheckoutCount > 0) {
      issues.push('Direct checkout is disabled in settings, but direct checkout buttons are visible.');
    }

    if (flags.directCheckout && facts.directCheckoutCount > 0) {
      const disallowedButtons = (facts.directCheckoutButtons || []).filter((button) => {
        return button.productType && !(flags.directCheckoutAllowedTypes || []).includes(button.productType);
      });

      if (disallowedButtons.length) {
        const types = Array.from(new Set(disallowedButtons.map((button) => button.productType))).join(', ');
        issues.push(`Direct checkout buttons are visible for product type(s) not enabled in settings: ${types}.`);
      }
    }

    if (!expectsQuickView && facts.quickViewButtonCount > 0) {
      issues.push('Quick View buttons are visible on a page/type where Quick View is disabled by settings.');
    }

    if (expectsQuickView && facts.quickViewButtonCount > 0) {
      const disallowedQuickViewButtons = (facts.quickViewButtons || []).filter((button) => {
        return button.productType && !(flags.quickViewAllowedTypes || []).includes(button.productType);
      });

      if (disallowedQuickViewButtons.length) {
        const types = Array.from(new Set(disallowedQuickViewButtons.map((button) => button.productType))).join(', ');
        issues.push(`Quick View buttons are visible for product type(s) not enabled in settings: ${types}.`);
      }

      const expectedQuickViewText = String(flags.quickViewButtonText || '').trim();
      const quickViewUsesText = ['button', 'text_icon', 'hover_icon'].includes(String(flags.quickViewDisplayType || ''));
      if (
        quickViewUsesText &&
        expectedQuickViewText &&
        firstQuickViewButton?.text &&
        !firstQuickViewButton.text.toLowerCase().includes(expectedQuickViewText.toLowerCase())
      ) {
        issues.push(`Quick View button text does not match the configured text "${expectedQuickViewText}".`);
      }
    }

    if (expectsDirectCheckout && facts.directCheckoutCount > 0 && firstDirectButton) {
      const expectedText = String(flags.directCheckoutText || 'Buy Now').trim();
      if (expectedText && firstDirectButton.text && !firstDirectButton.text.toLowerCase().includes(expectedText.toLowerCase())) {
        issues.push(`Direct checkout button text does not match the configured text "${expectedText}".`);
      }

      const disabledUntilVariationSelection =
        target.kind === 'variableProduct' && (facts.variationSelectCount > 0 || facts.variationButtonCount > 0);
      if (firstDirectButton.disabled && !disabledUntilVariationSelection) {
        issues.push('Direct checkout button is visible but disabled.');
      }

      if (
        target.kind === 'archive' &&
        /^overlay_thumbnail/.test(String(flags.directCheckoutArchivePosition || '')) &&
        !String(firstDirectButton.overlayPosition || '').includes(flags.directCheckoutArchivePosition)
      ) {
        issues.push(`Direct checkout archive position is configured as ${flags.directCheckoutArchivePosition}, but the button was not rendered in the matching overlay wrapper.`);
      }

      if (
        (target.kind === 'simpleProduct' || target.kind === 'variableProduct') &&
        flags.directCheckoutSinglePosition === 'replace_add_to_cart' &&
        facts.normalAddToCartCount > 0
      ) {
        issues.push('Single product direct checkout is configured to replace add-to-cart, but a normal add-to-cart button is still visible.');
      }
    }

    if (target.kind === 'archive') {
      if (facts.productCount === 0) {
        issues.push('No WooCommerce product cards were found, so archive behavior cannot be QC tested.');
      }

      if (facts.productCount > 0 && expectsDirectCheckout && facts.directCheckoutCount === 0) {
        issues.push('Direct checkout is enabled, but no direct checkout buttons were found on the archive.');
      }

      if (facts.productCount > 0 && expectsQuickView) {
        if (facts.quickViewButtonCount === 0) {
          issues.push('Quick View is enabled, but no quick view buttons were found on the archive.');
        }
        if (facts.quickViewModalCount === 0) {
          issues.push('Quick View is enabled, but the modal container was not rendered.');
        }
      }

      if (facts.productCount > 0 && flags.archiveQuantity && facts.addToCartCount > 0 && facts.archiveQuantityCount === 0) {
        issues.push('Archive quantity controls are enabled, but no archive quantity inputs were found.');
      }

      if (facts.variableProductCards > 0 && flags.archiveVariation && facts.archiveVariationsCount === 0) {
        issues.push('Archive variation buttons are enabled and variable products are present, but no archive variation controls were found.');
      }
    }

    if (target.kind === 'simpleProduct') {
      if (facts.productSummaryCount === 0) {
        issues.push('Single product summary was not detected.');
      }

      if (facts.addToCartCount === 0 && facts.outOfStockCount === 0) {
        issues.push('Simple product page has no visible add-to-cart button and does not appear out of stock.');
      }

      if (expectsDirectCheckout && facts.directCheckoutCount === 0 && facts.outOfStockCount === 0) {
        issues.push('Direct checkout is enabled, but no direct checkout button was found on the simple product page.');
      }

      if (flags.onePageCheckoutEnabled && flags.onePageCheckoutAll && facts.onePageCheckoutCount === 0) {
        issues.push('One-page checkout for all products is enabled, but no one-page checkout container was found.');
      }

      if (config.deviceMode === 'mobile' && flags.mobileStickyAddToCart && facts.mobileStickyCartCount === 0) {
        issues.push('Mobile sticky add-to-cart is enabled, but no mobile sticky cart was found on the simple product page.');
      }
    }

    if (target.kind === 'variableProduct') {
      if (facts.variationFormCount === 0) {
        issues.push('Variable product page did not render a WooCommerce variations form.');
      }

      if (facts.variationSelectCount === 0 && facts.variationButtonCount === 0) {
        issues.push('Variable product page did not expose selectable variation controls.');
      }

      if (expectsDirectCheckout && facts.directCheckoutCount === 0 && facts.outOfStockCount === 0) {
        issues.push('Direct checkout is enabled, but no direct checkout button was found on the variable product page.');
      }

      if (flags.onePageCheckoutEnabled && flags.onePageCheckoutAll && facts.onePageCheckoutCount === 0) {
        issues.push('One-page checkout for all products is enabled, but no one-page checkout container was found.');
      }

      if (config.deviceMode === 'mobile' && flags.mobileStickyAddToCart && facts.mobileStickyCartCount === 0) {
        issues.push('Mobile sticky add-to-cart is enabled, but no mobile sticky cart was found on the variable product page.');
      }
    }

    if (flags.trustBadges && facts.checkoutFormCount > 0 && facts.trustBadgeCount === 0) {
      issues.push('Trust badges are enabled and a checkout form is present, but no trust badge UI was found.');
    }

    if (relevantMessages.length) {
      issues.push(`Browser console/request errors were emitted: ${relevantMessages[0].text || relevantMessages[0].url}`);
    }

    return issues;
  }

  const failureOverlayId = '__onepaquc_qc_failure_overlay__';

  function tonePalette(tone) {
    if (tone === 'result') {
      return {
        border: '#2563eb',
        fill: 'rgba(37, 99, 235, 0.12)',
        badge: '#2563eb',
      };
    }

    if (tone === 'context') {
      return {
        border: '#f59e0b',
        fill: 'rgba(245, 158, 11, 0.12)',
        badge: '#b45309',
      };
    }

    return {
      border: '#ef4444',
      fill: 'rgba(239, 68, 68, 0.12)',
      badge: '#dc2626',
    };
  }

  async function locatorToHighlightBox(locator, label, tone = 'context') {
    if (!locator) {
      return null;
    }

    const target = locator.first();
    if (!(await target.count().catch(() => 0))) {
      return null;
    }

    return target
      .evaluate(
        (node, payload) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            rect.width < 8 ||
            rect.height < 8
          ) {
            return null;
          }

          return {
            left: Math.max(0, rect.left + window.scrollX - 6),
            top: Math.max(0, rect.top + window.scrollY - 6),
            width: rect.width + 12,
            height: rect.height + 12,
            label: payload.label,
            tone: payload.tone,
          };
        },
        { label, tone }
      )
      .catch(() => null);
  }

  async function firstVisibleHighlightBox(selectors, label, tone = 'context', maxMatches = 1) {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];

    for (const selector of selectorList.filter(Boolean)) {
      let locator;
      try {
        locator = page.locator(selector);
      } catch {
        continue;
      }

      const count = Math.min(await locator.count().catch(() => 0), Math.max(1, maxMatches) * 4);
      for (let index = 0; index < count; index += 1) {
        const box = await locatorToHighlightBox(locator.nth(index), label, tone);
        if (box) {
          return box;
        }
      }
    }

    return null;
  }

  function dedupeHighlightBoxes(boxes) {
    const unique = [];

    for (const box of boxes.filter(Boolean)) {
      const duplicate = unique.some((existing) => {
        return (
          Math.abs(existing.left - box.left) < 6 &&
          Math.abs(existing.top - box.top) < 6 &&
          Math.abs(existing.width - box.width) < 6 &&
          Math.abs(existing.height - box.height) < 6
        );
      });

      if (!duplicate) {
        unique.push(box);
      }
    }

    return unique.slice(0, 8);
  }

  function inferFailureSelectorTargets(issues = []) {
    const text = issues.join(' ').toLowerCase();
    const targets = [];

    if (/quick view|modal/.test(text)) {
      targets.push(
        { selectors: config.selectors.quickViewModal, label: 'Quick View Modal', tone: 'filter' },
        { selectors: config.selectors.quickViewButton, label: 'Quick View Button', tone: 'context' }
      );
    }

    if (/archive variation|variation control/.test(text)) {
      targets.push(
        { selectors: '[data-onepaquc-qc-archive-variation-control="1"]', label: 'Clicked Variation Option', tone: 'filter' },
        { selectors: '[data-onepaquc-qc-archive-variation-container="1"]', label: 'Archive Variation Area', tone: 'context' },
        { selectors: '.archive-variations-container .variation-button, .archive-variations-container .var-attr-option', label: 'Archive Variation Option', tone: 'filter' }
      );
    } else if (/variation/.test(text)) {
      targets.push({ selectors: 'form.variations_form, .woocommerce-variation', label: 'Variation Form', tone: 'filter' });
    }

    if (/direct checkout|confirmation|clear-cart|ajax add|popup checkout|checkout method/.test(text)) {
      targets.push(
        { selectors: '[data-onepaquc-qc-direct-target="1"]', label: 'Direct Checkout Button', tone: 'filter' },
        { selectors: config.selectors.directCheckout, label: 'Direct Checkout Button', tone: 'filter' },
        { selectors: config.selectors.onePageCheckout, label: 'Checkout Popup / Inline Checkout', tone: 'result' }
      );
    }

    if (/floating cart|cart drawer|select-all|selected count|coupon|subtotal|total|quantity|remove|recommended|checkout button|cart item/.test(text)) {
      targets.push(
        { selectors: '.cart-drawer.open, .cart-drawer', label: 'Floating Cart Drawer', tone: 'filter' },
        { selectors: '.cart-drawer.open .cart-item, .cart-drawer .cart-item', label: 'Cart Item Area', tone: 'context' },
        { selectors: config.selectors.cartButton, label: 'Floating Cart Button', tone: 'context' }
      );
    }

    if (/trust badge/.test(text)) {
      targets.push(
        { selectors: config.selectors.trustBadges, label: 'Trust Badge Area', tone: 'filter' },
        { selectors: config.selectors.checkoutForm, label: 'Checkout Form', tone: 'context' }
      );
    }

    if (/sticky add-to-cart|mobile sticky/.test(text)) {
      targets.push({ selectors: '.rmenupro-sticky-add-to-cart, .sticky-add-to-cart, .mobile-sticky-add-to-cart', label: 'Mobile Sticky Cart', tone: 'filter' });
    }

    if (/product card|product area|woocommerce product/.test(text) || (/archive/.test(text) && !/archive variation/.test(text))) {
      targets.push({ selectors: config.selectors.products, label: 'Product Area', tone: 'result' });
    }

    if (/runtime|console|request|http|php/.test(text)) {
      targets.push({ selectors: '.woocommerce-error, .woocommerce-message, .woocommerce-info, body', label: 'Page / Error Area', tone: 'result' });
    }

    targets.push({ selectors: '.woocommerce-error, .woocommerce-message, .woocommerce-info, .rmenupro-toast-notification, .rmenupro-popup-notification', label: 'Notice / Error Message', tone: 'result' });

    return targets;
  }

  async function collectFailureHighlightBoxes(options = {}) {
    const boxes = [];
    const selectorTargets = [
      ...(Array.isArray(options.selectorTargets) ? options.selectorTargets : []),
      ...inferFailureSelectorTargets(options.issues || []),
    ];

    for (const target of selectorTargets) {
      const box = await firstVisibleHighlightBox(
        target.selectors || target.selector || [],
        target.label || 'Issue Area',
        target.tone || 'context',
        target.maxMatches || 1
      );
      if (box) {
        boxes.push(box);
      }
    }

    if (!boxes.length && options.includePageContext !== false) {
      const productBox = await firstVisibleHighlightBox(config.selectors.products, 'Product Area', 'result');
      if (productBox) {
        boxes.push(productBox);
      }
    }

    return dedupeHighlightBoxes(boxes);
  }

  async function injectFailureScreenshotOverlay(boxes, options = {}) {
    const preparedBoxes = (boxes || []).map((box) => {
      const palette = tonePalette(box.tone);
      return {
        ...box,
        borderColor: palette.border,
        fillColor: palette.fill,
        badgeColor: palette.badge,
      };
    });

    await page.evaluate(
      ({ overlayId, overlayBoxes, title, issues }) => {
        document.getElementById(overlayId)?.remove();

        const doc = document.documentElement;
        const body = document.body;
        const scrollHeight = Math.max(doc.scrollHeight, body.scrollHeight);
        const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
        const root = document.createElement('div');
        root.id = overlayId;
        root.setAttribute('data-onepaquc-qc-overlay', 'true');
        root.style.position = 'absolute';
        root.style.left = '0';
        root.style.top = '0';
        root.style.width = `${scrollWidth}px`;
        root.style.height = `${scrollHeight}px`;
        root.style.pointerEvents = 'none';
        root.style.zIndex = '2147483647';

        for (const box of overlayBoxes) {
          const frame = document.createElement('div');
          frame.setAttribute('data-onepaquc-qc-highlight', 'true');
          frame.style.position = 'absolute';
          frame.style.left = `${box.left}px`;
          frame.style.top = `${box.top}px`;
          frame.style.width = `${box.width}px`;
          frame.style.height = `${box.height}px`;
          frame.style.border = `3px solid ${box.borderColor}`;
          frame.style.borderRadius = '8px';
          frame.style.background = box.fillColor;
          frame.style.boxShadow = `0 0 0 2px rgba(255,255,255,0.9), 0 10px 26px ${box.fillColor}`;

          const badge = document.createElement('div');
          badge.textContent = box.label || 'Issue Area';
          badge.style.position = 'absolute';
          badge.style.left = '8px';
          badge.style.top = '-15px';
          badge.style.maxWidth = '260px';
          badge.style.padding = '4px 8px';
          badge.style.borderRadius = '999px';
          badge.style.background = box.badgeColor;
          badge.style.color = '#fff';
          badge.style.font = '700 12px/1.2 Arial, sans-serif';
          badge.style.whiteSpace = 'nowrap';
          badge.style.overflow = 'hidden';
          badge.style.textOverflow = 'ellipsis';
          badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
          frame.appendChild(badge);
          root.appendChild(frame);
        }

        const issueLines = (issues || []).filter(Boolean).slice(0, 4);
        if (title || issueLines.length) {
          const minTop = overlayBoxes.length ? Math.min(...overlayBoxes.map((box) => box.top)) : window.scrollY + 16;
          const maxBottom = overlayBoxes.length ? Math.max(...overlayBoxes.map((box) => box.top + box.height)) : window.scrollY + 16;
          const minLeft = overlayBoxes.length ? Math.min(...overlayBoxes.map((box) => box.left)) : 16;
          const bannerTop = minTop > 150 ? minTop - 132 : maxBottom + 18;
          const banner = document.createElement('div');
          banner.setAttribute('data-onepaquc-qc-summary', 'true');
          banner.style.position = 'absolute';
          banner.style.left = `${Math.max(12, Math.min(minLeft, Math.max(12, doc.clientWidth - 552)))}px`;
          banner.style.top = `${Math.max(12, Math.min(bannerTop, scrollHeight - 90))}px`;
          banner.style.maxWidth = `${Math.max(260, Math.min(520, doc.clientWidth - 24))}px`;
          banner.style.padding = '12px 14px';
          banner.style.borderRadius = '8px';
          banner.style.background = 'rgba(15, 23, 42, 0.95)';
          banner.style.color = '#fff';
          banner.style.boxShadow = '0 18px 38px rgba(15, 23, 42, 0.28)';
          banner.style.font = '500 13px/1.45 Arial, sans-serif';

          if (title) {
            const titleNode = document.createElement('div');
            titleNode.textContent = `QC issue: ${title}`;
            titleNode.style.fontWeight = '700';
            titleNode.style.fontSize = '14px';
            titleNode.style.marginBottom = issueLines.length ? '8px' : '0';
            banner.appendChild(titleNode);
          }

          issueLines.forEach((issue, index) => {
            const line = document.createElement('div');
            line.textContent = `${index === 0 ? 'Reason' : 'Also'}: ${issue}`;
            line.style.marginTop = '4px';
            banner.appendChild(line);
          });

          const instruction = document.createElement('div');
          instruction.textContent = overlayBoxes.length
            ? 'Instruction: inspect the highlighted area and compare it with the reason above.'
            : 'Instruction: no specific visible element was available, so inspect the current page state.';
          instruction.style.marginTop = '8px';
          instruction.style.color = '#cbd5e1';
          instruction.style.fontWeight = '600';
          banner.appendChild(instruction);

          root.appendChild(banner);
        }

        body.appendChild(root);
      },
      {
        overlayId: failureOverlayId,
        overlayBoxes: preparedBoxes,
        title: options.title || '',
        issues: (options.issues || []).filter(Boolean),
      }
    );
  }

  async function clearFailureScreenshotOverlay() {
    await page.evaluate((overlayId) => {
      document.getElementById(overlayId)?.remove();
    }, failureOverlayId).catch(() => null);
  }

  async function buildMobileFailureScreenshotClip() {
    if (config.deviceMode !== 'mobile') {
      return null;
    }

    return page
      .evaluate((overlayId) => {
        const doc = document.documentElement;
        const nodes = Array.from(
          document.querySelectorAll(`#${overlayId} [data-onepaquc-qc-highlight], #${overlayId} [data-onepaquc-qc-summary]`)
        );
        const rects = nodes
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              left: rect.left + window.scrollX,
              top: rect.top + window.scrollY,
              right: rect.right + window.scrollX,
              bottom: rect.bottom + window.scrollY,
            };
          })
          .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);

        if (!rects.length) {
          return null;
        }

        const scrollWidth = Math.max(doc.scrollWidth, document.body.scrollWidth);
        const scrollHeight = Math.max(doc.scrollHeight, document.body.scrollHeight);
        const top = Math.max(0, Math.min(...rects.map((rect) => rect.top)) - 24);
        const bottom = Math.min(scrollHeight, Math.max(...rects.map((rect) => rect.bottom)) + 24);
        const minHeight = Math.min(scrollHeight - top, Math.max(360, window.innerHeight * 0.7));

        return {
          x: 0,
          y: top,
          width: Math.max(1, Math.min(scrollWidth, window.innerWidth || scrollWidth)),
          height: Math.max(1, Math.min(scrollHeight - top, Math.max(bottom - top, minHeight))),
        };
      }, failureOverlayId)
      .catch(() => null);
  }

  async function captureFailureScreenshot(id, options = {}) {
    const fileName = `fail-${sanitizeId(id)}.png`;
    const filePath = path.join(outputDir, fileName);

    try {
      const boxes = await collectFailureHighlightBoxes(options);
      await injectFailureScreenshotOverlay(boxes, options);
      const clip = await buildMobileFailureScreenshotClip();
      if (clip) {
        await page.screenshot({ path: filePath, clip, animations: 'disabled' });
      } else {
        await page.screenshot({ path: filePath, fullPage: true, animations: 'disabled' });
      }
      return fileName;
    } catch {
      await page.screenshot({ path: filePath, fullPage: true }).catch(() => null);
      return fileName;
    } finally {
      await clearFailureScreenshotOverlay();
    }
  }

  async function screenshotForIssues(id, title, issues, options = {}) {
    if (!issues.length) {
      return null;
    }

    return captureFailureScreenshot(id, {
      ...options,
      title,
      issues,
    });
  }

  async function testQuickViewInteraction(target, featureFlags) {
    const id = `interaction-quick-view-${target.key}`;
    const issues = [];
    const details = {};
    const before = messages.length;

    try {
      const button = page.locator(config.selectors.quickViewButton).first();
      if (!(await button.count()) || !(await button.isVisible({ timeout: 1000 }).catch(() => false))) {
        return makeResult({
          id,
          title: 'Quick View interaction',
          target,
          skipped: true,
          reason: 'No visible quick view button was available.',
        });
      }
      details.buttonText = await button.textContent().catch(() => '');

      const product = page.locator(config.selectors.products).first();
      if (await product.count()) {
        await product.hover({ force: true }).catch(() => null);
      }

      await page.evaluate(() => {
        window.__onepaqucQcQuickViewEvents = [];
        if (window.jQuery) {
          window.jQuery(document.body)
            .off('rmenupro_quick_view_opened.onepaqucQcQuickView rmenupro_quick_view_closed.onepaqucQcQuickView')
            .on('rmenupro_quick_view_opened.onepaqucQcQuickView', function (_event, productId) {
              window.__onepaqucQcQuickViewEvents.push({
                type: 'rmenupro_quick_view_opened',
                productId: productId || '',
                timestamp: Date.now(),
              });
            })
            .on('rmenupro_quick_view_closed.onepaqucQcQuickView', function () {
              window.__onepaqucQcQuickViewEvents.push({
                type: 'rmenupro_quick_view_closed',
                timestamp: Date.now(),
              });
            });
        }
      });

      await button.click({ force: true });
      await delay(1200);

      const modalState = await page.evaluate((modalSelector) => {
        const modal = document.querySelector(modalSelector);
        if (!modal) return { exists: false, active: false, hasContent: false };
        const style = window.getComputedStyle(modal);
        const active =
          modal.classList.contains('active') &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (modal.offsetWidth > 0 || modal.offsetHeight > 0 || modal.getClientRects().length > 0);
        const hasContent = Boolean(modal.querySelector('.rmenupro-quick-view-inner')?.textContent?.trim());
        return {
          exists: true,
          active,
          hasContent,
          titleText: modal.querySelector('.product_title, h1, h2')?.textContent?.trim() || '',
          imageCount: modal.querySelectorAll('.rmenupro-quick-view-images img, img.wp-post-image').length,
          priceText: modal.querySelector('.price')?.textContent?.trim() || '',
          excerptText: modal.querySelector('.woocommerce-product-details__short-description')?.textContent?.trim() || '',
          addToCartCount: modal.querySelectorAll('.add_to_cart_button, .single_add_to_cart_button, form.cart .button').length,
          metaCount: modal.querySelectorAll('.product_meta').length,
        };
      }, config.selectors.quickViewModal);
      details.modalState = modalState;

      if (!modalState.exists) {
        issues.push('Quick View modal container does not exist after clicking a quick view button.');
      } else if (!modalState.active) {
        issues.push('Quick View modal did not become active after clicking a quick view button.');
      } else if (!modalState.hasContent) {
        issues.push('Quick View modal opened but did not render product content.');
      } else {
        const elements = featureFlags.quickViewContentElements || [];
        if (elements.includes('title') && !modalState.titleText) {
          issues.push('Quick View is configured to show the product title, but the opened modal did not render a title.');
        }
        if (elements.includes('image') && modalState.imageCount === 0) {
          issues.push('Quick View is configured to show the product image, but the opened modal did not render an image.');
        }
      }

      await page.locator('.rmenupro-quick-view-close').first().click({ force: true, timeout: 1000 }).catch(() => null);
      await page.keyboard.press('Escape').catch(() => null);
      await delay(500);

      const eventState = await page
        .evaluate(() => ({
          events: window.__onepaqucQcQuickViewEvents || [],
        }))
        .catch(() => ({ events: [] }));
      details.events = eventState.events;

      if (modalState.active && !eventState.events.some((event) => event.type === 'rmenupro_quick_view_opened')) {
        issues.push('Quick View opened, but the rmenupro_quick_view_opened event was not observed.');
      }

      if (modalState.active && !eventState.events.some((event) => event.type === 'rmenupro_quick_view_closed')) {
        issues.push('Quick View close was requested, but the rmenupro_quick_view_closed event was not observed.');
      }
    } catch (error) {
      issues.push(error.message);
    }

    const relevantMessages = filterRelevantMessages(messages.slice(before));
    if (relevantMessages.length) {
      issues.push(`Browser errors occurred during Quick View: ${relevantMessages[0].text || relevantMessages[0].url}`);
    }

    return makeResult({
      id,
      title: 'Quick View interaction',
      target,
      issues,
      details,
      screenshot: await screenshotForIssues(id, 'Quick View interaction', issues),
    });
  }

  async function testCartDrawerInteraction(target) {
    const id = `interaction-cart-drawer-${target.key}`;
    const issues = [];
    const before = messages.length;

    try {
      const button = page.locator(config.selectors.cartButton).first();
      if (!(await button.count()) || !(await button.isVisible({ timeout: 1000 }).catch(() => false))) {
        return makeResult({
          id,
          title: 'Cart drawer interaction',
          target,
          skipped: true,
          reason: 'No visible cart drawer button was available.',
        });
      }

      await button.click({ force: true });
      await delay(800);

      const drawerState = await page.evaluate((drawerSelector) => {
        const drawer = document.querySelector(drawerSelector);
        if (!drawer) return { exists: false, open: false };
        const style = window.getComputedStyle(drawer);
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (drawer.offsetWidth > 0 || drawer.offsetHeight > 0 || drawer.getClientRects().length > 0);
        return { exists: true, open: drawer.classList.contains('open') || visible };
      }, config.selectors.cartDrawer);

      if (!drawerState.exists) {
        issues.push('Cart drawer container does not exist after clicking the cart button.');
      } else if (!drawerState.open) {
        issues.push('Cart drawer did not open after clicking the cart button.');
      }

      await page.locator('.cart-drawer .close_button, .cart-drawer .close, .cart-drawer button[aria-label*="Close"]').first().click({ force: true, timeout: 1000 }).catch(() => null);
      await page.keyboard.press('Escape').catch(() => null);
    } catch (error) {
      issues.push(error.message);
    }

    const relevantMessages = filterRelevantMessages(messages.slice(before));
    if (relevantMessages.length) {
      issues.push(`Browser errors occurred during cart drawer interaction: ${relevantMessages[0].text || relevantMessages[0].url}`);
    }

    return makeResult({
      id,
      title: 'Cart drawer interaction',
      target,
      issues,
      screenshot: await screenshotForIssues(id, 'Cart drawer interaction', issues),
    });
  }

  async function testVariableSelection(target) {
    const id = `interaction-variable-selection-${target.key}`;
    const issues = [];
    const before = messages.length;

    try {
      const selects = page.locator('form.variations_form select');
      const count = await selects.count();
      if (!count) {
        return makeResult({
          id,
          title: 'Variable product selection',
          target,
          skipped: true,
          reason: 'No variation select fields were found.',
        });
      }

      for (let index = 0; index < count; index += 1) {
        const select = selects.nth(index);
        const optionValue = await select.evaluate((node) => {
          const option = Array.from(node.options).find((item) => item.value && !item.disabled);
          return option ? option.value : '';
        });

        if (!optionValue) {
          issues.push(`Variation select ${index + 1} has no selectable option.`);
          continue;
        }

        await select.selectOption(optionValue);
        await delay(300);

        const selectedValue = await select.inputValue().catch(() => '');
        if (selectedValue !== optionValue) {
          issues.push(`Variation select ${index + 1} did not retain the selected value.`);
        }
      }

      await delay(1000);
      const selectedState = await page.evaluate(() => {
        const form = document.querySelector('form.variations_form');
        const variationId = form?.querySelector('input.variation_id, input[name="variation_id"]')?.value || '';
        const addToCart = form?.querySelector('.single_add_to_cart_button');
        return {
          variationId,
          addToCartDisabled: Boolean(addToCart?.disabled || addToCart?.classList.contains('disabled')),
          visibleVariationText: document.querySelector('.woocommerce-variation')?.textContent?.trim() || '',
        };
      });

      if (!selectedState.variationId && selectedState.addToCartDisabled) {
        issues.push('Selecting the first available options did not produce a valid variation state.');
      }
    } catch (error) {
      issues.push(error.message);
    }

    const relevantMessages = filterRelevantMessages(messages.slice(before));
    if (relevantMessages.length) {
      issues.push(`Browser errors occurred during variation selection: ${relevantMessages[0].text || relevantMessages[0].url}`);
    }

    return makeResult({
      id,
      title: 'Variable product selection',
      target,
      issues,
      screenshot: await screenshotForIssues(id, 'Variable product selection', issues),
    });
  }

  async function testArchiveVariationSelection(target) {
    const id = `interaction-archive-variation-${target.key}`;
    const issues = [];
    const details = {};
    const before = messages.length;

    try {
      const candidate = await page.evaluate(() => {
        const markerContainer = 'data-onepaquc-qc-archive-variation-container';
        const markerControl = 'data-onepaquc-qc-archive-variation-control';
        document.querySelectorAll(`[${markerContainer}], [${markerControl}]`).forEach((node) => {
          node.removeAttribute(markerContainer);
          node.removeAttribute(markerControl);
        });

        const isVisible = (node) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width >= 8 &&
            rect.height >= 8 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight * 1.8
          );
        };

        for (const container of Array.from(document.querySelectorAll('.archive-variations-container'))) {
          const controls = Array.from(container.querySelectorAll('.variation-button, .var-attr-option')).filter((control) => {
            return (
              isVisible(control) &&
              !control.disabled &&
              !control.classList.contains('disabled') &&
              (control.dataset.id || control.dataset.value || control.textContent.trim())
            );
          });

          const control = controls.find((node) => !node.classList.contains('selected')) || controls[0];
          if (!control) {
            continue;
          }

          container.setAttribute(markerContainer, '1');
          control.setAttribute(markerControl, '1');

          return {
            layout: container.getAttribute('data-layout') || '',
            controlText: control.textContent.trim().replace(/\s+/g, ' '),
            controlValue: control.getAttribute('data-value') || control.getAttribute('data-id') || '',
            selectedBefore: control.classList.contains('selected'),
            variationIdBefore: container.querySelector('input.variation_id, input[name="variation_id"]')?.value || '',
            controlCount: controls.length,
          };
        }

        return null;
      });
      details.candidate = candidate;

      if (!candidate) {
        return makeResult({
          id,
          title: 'Archive variation selection',
          target,
          skipped: true,
          reason: 'No visible archive variation controls were available.',
        });
      }

      await page.evaluate(() => {
        if (window.__onepaqucQcArchiveVariationClickHandler) {
          document.removeEventListener('click', window.__onepaqucQcArchiveVariationClickHandler, true);
        }

        window.__onepaqucQcArchiveVariationClicks = [];
        window.__onepaqucQcArchiveVariationClickHandler = (event) => {
          const control = event.target.closest('[data-onepaquc-qc-archive-variation-control="1"], .archive-variations-container .variation-button, .archive-variations-container .var-attr-option');
          if (!control) {
            return;
          }

          window.__onepaqucQcArchiveVariationClicks.push({
            text: control.textContent.trim().replace(/\s+/g, ' '),
            className: control.className || '',
            defaultPrevented: event.defaultPrevented,
            timestamp: Date.now(),
          });
        };
        document.addEventListener('click', window.__onepaqucQcArchiveVariationClickHandler, true);
      });

      const control = page.locator('[data-onepaquc-qc-archive-variation-control="1"]').first();
      await control.scrollIntoViewIfNeeded().catch(() => null);
      await control.click({ force: true });
      await delay(800);

      const readMarkedArchiveVariationState = () => page.evaluate(() => {
        const container = document.querySelector('[data-onepaquc-qc-archive-variation-container="1"]');
        const selectedControls = Array.from(container?.querySelectorAll('.variation-button.selected, .var-attr-option.selected') || []);
        return {
          containerFound: Boolean(container),
          hasSelected: selectedControls.length > 0,
          selectedText: selectedControls.map((node) => node.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean),
          clickEvents: window.__onepaqucQcArchiveVariationClicks || [],
          variationId:
            container?.querySelector('input.variation_id, input[name="variation_id"]')?.value ||
            container?.querySelector('span.variation_id')?.textContent?.trim() ||
            '',
          modalOpen: Boolean(document.querySelector('.onepaqucpro-variation-modal')),
        };
      });

      let selected = await readMarkedArchiveVariationState();
      details.selected = selected;

      if (!selected.hasSelected && !selected.variationId) {
        await page.evaluate(() => {
          const controlNode = document.querySelector('[data-onepaquc-qc-archive-variation-control="1"]');
          if (controlNode) {
            controlNode.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          }
        });
        await delay(250);
        const fallbackSelected = await readMarkedArchiveVariationState();

        details.domFallbackSelected = fallbackSelected;
        if (fallbackSelected.hasSelected || fallbackSelected.variationId) {
          details.domFallbackUsed = true;
          selected = fallbackSelected;
        }
      }

      if (!selected.hasSelected && !selected.variationId) {
        issues.push('Archive variation control did not reflect a selected state after click.');
      }
    } catch (error) {
      issues.push(error.message);
    }

    const relevantMessages = filterRelevantMessages(messages.slice(before));
    if (relevantMessages.length) {
      issues.push(`Browser errors occurred during archive variation selection: ${relevantMessages[0].text || relevantMessages[0].url}`);
    }

    return makeResult({
      id,
      title: 'Archive variation selection',
      target,
      issues,
      details,
      screenshot: await screenshotForIssues(id, 'Archive variation selection', issues),
    });
  }

  async function selectFirstSingleProductVariationOptions() {
    const selects = page.locator('form.variations_form select');
    const count = await selects.count();
    if (!count) {
      return {
        attempted: false,
        selectedCount: 0,
        issues: [],
      };
    }

    const issues = [];
    let selectedCount = 0;

    for (let index = 0; index < count; index += 1) {
      const select = selects.nth(index);
      const optionValue = await select.evaluate((node) => {
        const option = Array.from(node.options).find((item) => item.value && !item.disabled);
        return option ? option.value : '';
      });

      if (!optionValue) {
        issues.push(`Variation select ${index + 1} has no selectable option.`);
        continue;
      }

      await select.selectOption(optionValue);
      selectedCount += 1;
      await delay(300);
    }

    await delay(900);

    return {
      attempted: true,
      selectedCount,
      issues,
    };
  }

  async function markDirectCheckoutCandidate(target) {
    return page.evaluate(
      ({ selector, targetKind }) => {
        const isVisible = (node) => {
          if (!node) return false;
          const style = window.getComputedStyle(node);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            (node.offsetWidth > 0 || node.offsetHeight > 0 || node.getClientRects().length > 0)
          );
        };

        const productTypeFor = (node) => {
          const productNode = node.closest('.product, li.product, .wc-block-grid__product');
          const classText = productNode?.className || '';
          const classMatch = classText.match(/product[_-]type[_-]([a-z0-9_-]+)/i);
          return (
            node.getAttribute('data-product-type') ||
            node.getAttribute('data-product_type') ||
            (classMatch ? classMatch[1] : '') ||
            ''
          );
        };

        for (const node of document.querySelectorAll('[data-onepaquc-qc-direct-target="1"]')) {
          node.removeAttribute('data-onepaquc-qc-direct-target');
        }

        const nodes = Array.from(document.querySelectorAll(selector)).filter((node) => {
          return (
            isVisible(node) &&
            !node.disabled &&
            node.getAttribute('aria-disabled') !== 'true' &&
            !node.classList.contains('disabled')
          );
        });

        if (!nodes.length) {
          return null;
        }

        const desiredType = targetKind === 'variableProduct' ? 'variable' : 'simple';
        let picked =
          nodes.find((node) => productTypeFor(node) === desiredType) ||
          nodes.find((node) => productTypeFor(node) === 'simple') ||
          nodes.find((node) => productTypeFor(node) !== 'variable') ||
          nodes[0];

        picked.setAttribute('data-onepaquc-qc-direct-target', '1');

        const productNode = picked.closest('.product, li.product, .wc-block-grid__product');
        return {
          text: picked.textContent.trim().replace(/\s+/g, ' '),
          productId: picked.getAttribute('data-product-id') || picked.getAttribute('data-product_id') || '',
          productType: productTypeFor(picked),
          classes: picked.className || '',
          href: picked.getAttribute('href') || '',
          productTitle: productNode?.querySelector('.woocommerce-loop-product__title, h2, h3, .product_title')?.textContent?.trim() || '',
        };
      },
      {
        selector: config.selectors.directCheckout,
        targetKind: target.kind,
      }
    );
  }

  async function readDirectCheckoutState() {
    return page.evaluate((selectors) => {
      const isVisible = (node) => {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          (node.offsetWidth > 0 || node.offsetHeight > 0 || node.getClientRects().length > 0)
        );
      };

      const popupNodes = Array.from(document.querySelectorAll('.checkout-popup')).filter(
        (node) => !node.classList.contains('onepagecheckoutwidget')
      );
      const inlineCheckoutNodes = Array.from(document.querySelectorAll(selectors.onePageCheckout)).filter(isVisible);
      const drawerNodes = Array.from(document.querySelectorAll(selectors.cartDrawer));

      return {
        url: window.location.href,
        title: document.title,
        popupVisible: popupNodes.some(isVisible),
        popupHasCheckout:
          popupNodes.some((node) => Boolean(node.querySelector('form.checkout, .woocommerce-checkout, .wc-block-checkout, #checkout-iframe'))) ||
          false,
        inlineCheckoutVisible: inlineCheckoutNodes.length > 0,
        checkoutFormVisible: Array.from(document.querySelectorAll(selectors.checkoutForm)).some(isVisible),
        cartDrawerOpen: drawerNodes.some((node) => node.classList.contains('open') && isVisible(node)),
        cartItemCount: document.querySelectorAll('.cart-drawer .cart-item, .woocommerce-cart-form__cart-item, .wc-block-cart-items__row').length,
        checkoutProductNames: Array.from(
          document.querySelectorAll(
            '.checkout-popup .woocommerce-checkout-review-order-table .product-name, .one-page-checkout-container .woocommerce-checkout-review-order-table .product-name, .wc-block-components-order-summary-item__description, .wc-block-components-product-name'
          )
        )
          .map((node) => node.textContent.trim().replace(/\s+/g, ' '))
          .filter(Boolean)
          .slice(0, 12),
        notices: Array.from(document.querySelectorAll('.woocommerce-message, .woocommerce-error, .woocommerce-info, .rmenupro-toast-notification, .rmenupro-popup-notification'))
          .map((node) => node.textContent.trim().replace(/\s+/g, ' '))
          .filter(Boolean)
          .slice(0, 5),
        addedEvents: window.__onepaqucQcDirectEvents || [],
      };
    }, config.selectors);
  }

  async function closeTransientUiBeforeDirectCheckout() {
    await page.locator('.opqvfw-modal-container.active .rmenupro-quick-view-close, .rmenupro-quick-view-close').first().click({ force: true, timeout: 700 }).catch(() => null);
    await page.locator('.cart-drawer.open .close_button, .cart-drawer.open .close, .cart-drawer.open button[aria-label*="Close"]').first().click({ force: true, timeout: 700 }).catch(() => null);
    await page.keyboard.press('Escape').catch(() => null);
    await delay(350);
  }

  async function testDirectCheckoutBehavior(target, featureFlags) {
    const id = `interaction-direct-checkout-${target.key}`;
    const issues = [];
    const details = {
      expectedOutcome: featureFlags.directCheckoutOutcome,
      method: featureFlags.checkoutMethod,
      confirmationExpected: featureFlags.directCheckoutConfirmation,
      clearCartExpected: featureFlags.directCheckoutClearCart,
    };
    const beforeMessages = messages.length;
    const startUrl = page.url();

    if (!config.scenarioSettings.allowCartMutations) {
      return makeResult({
        id,
        title: 'Direct checkout behavior',
        target,
        skipped: true,
        reason: 'Cart-changing direct checkout checks are disabled by config.',
      });
    }

    try {
      const currentRuntime = await readRuntime();
      details.checkoutUrl = currentRuntime.cartParams.checkoutUrl || '';
      details.cartUrl = currentRuntime.cartParams.cartUrl || '';
      details.stateBeforePreparation = await readDirectCheckoutState();

      await closeTransientUiBeforeDirectCheckout();

      if (target.kind === 'variableProduct') {
        const variationSelection = await selectFirstSingleProductVariationOptions();
        details.variationSelection = variationSelection;
        issues.push(...variationSelection.issues);
      }

      details.stateBeforeClick = await readDirectCheckoutState();

      const candidate = await markDirectCheckoutCandidate(target);
      details.button = candidate;

      if (!candidate) {
        return makeResult({
          id,
          title: 'Direct checkout behavior',
          target,
          skipped: true,
          reason: 'No visible direct checkout button was available.',
        });
      }

      if (candidate.productType === 'variable' && target.kind !== 'variableProduct') {
        return makeResult({
          id,
          title: 'Direct checkout behavior',
          target,
          skipped: true,
          reason: 'Only variable direct checkout buttons were available on this archive; archive variable modal behavior is covered separately.',
          details,
        });
      }

      await page.evaluate(() => {
        window.__onepaqucQcDirectEvents = [];
        if (window.jQuery) {
          window.jQuery(document.body)
            .off('added_to_cart.onepaqucQcDirect')
            .on('added_to_cart.onepaqucQcDirect', function (_event, fragments, cartHash) {
              window.__onepaqucQcDirectEvents.push({
                type: 'added_to_cart',
                cartHash: cartHash || '',
                fragmentKeys: fragments ? Object.keys(fragments) : [],
                timestamp: Date.now(),
              });
            });
        }
      });

      const dialogMessages = [];
      const dialogHandler = async (dialog) => {
        dialogMessages.push({
          type: dialog.type(),
          message: dialog.message(),
        });
        await dialog.accept();
      };
      page.on('dialog', dialogHandler);

      const ajaxRequestPromise = page
        .waitForRequest((request) => isAdminAjaxActionRequest(request, 'onepaqucpro_ajax_add_to_cart'), { timeout: 18000 })
        .catch(() => null);

      const ajaxAddPromise = page
        .waitForResponse(
          (response) => isAdminAjaxActionRequest(response.request(), 'onepaqucpro_ajax_add_to_cart'),
          { timeout: 18000 }
        )
        .catch(() => null);

      const clearCartRequestPromise = page
        .waitForRequest((request) => isAdminAjaxActionRequest(request, 'woocommerce_clear_cart'), { timeout: 18000 })
        .catch(() => null);

      const clearCartPromise = page
        .waitForResponse(
          (response) => isAdminAjaxActionRequest(response.request(), 'woocommerce_clear_cart'),
          { timeout: 18000 }
        )
        .catch(() => null);

      const navigationPromise = page
        .waitForURL((url) => normalizeComparableUrl(url.toString()) !== normalizeComparableUrl(startUrl), { timeout: 18000 })
        .catch(() => null);

      const directTarget = page.locator('[data-onepaquc-qc-direct-target="1"]').first();
      await directTarget.scrollIntoViewIfNeeded().catch(() => null);
      await directTarget.click({ force: true });
      await delay(500);

      const expectedOutcome = featureFlags.directCheckoutOutcome;
      const expectsAjax = ['popup_checkout', 'side_cart', 'ajax_add'].includes(expectedOutcome);
      const expectsRedirect = ['checkout_redirect', 'cart_redirect'].includes(expectedOutcome);

      const [ajaxRequest, ajaxResponse] = expectsAjax
        ? await Promise.all([ajaxRequestPromise, ajaxAddPromise])
        : await Promise.all([
            Promise.race([ajaxRequestPromise, delay(1200).then(() => null)]),
            Promise.race([ajaxAddPromise, delay(1200).then(() => null)]),
          ]);
      const [clearCartRequest, clearCartResponse] = featureFlags.directCheckoutClearCart
        ? await Promise.all([clearCartRequestPromise, clearCartPromise])
        : await Promise.all([
            Promise.race([clearCartRequestPromise, delay(500).then(() => null)]),
            Promise.race([clearCartPromise, delay(500).then(() => null)]),
          ]);

      if (expectsRedirect) {
        await navigationPromise;
      } else {
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);
      }

      await delay(1800);
      page.off('dialog', dialogHandler);

      let ajaxPayload = null;
      if (ajaxResponse) {
        try {
          ajaxPayload = await ajaxResponse.json();
        } catch {
          ajaxPayload = null;
        }
      }

      const finalState = await readDirectCheckoutState();
      details.dialogMessages = dialogMessages;
      details.ajaxRequestSeen = Boolean(ajaxRequest);
      details.ajaxRequestPostData = ajaxRequest ? (ajaxRequest.postData() || '').slice(0, 400) : null;
      details.ajaxStatus = ajaxResponse ? ajaxResponse.status() : null;
      details.ajaxPayload = ajaxPayload;
      details.clearCartRequestSeen = Boolean(clearCartRequest);
      details.clearCartStatus = clearCartResponse ? clearCartResponse.status() : null;
      details.finalState = finalState;

      if (featureFlags.directCheckoutConfirmation && dialogMessages.length === 0) {
        issues.push('Direct checkout confirmation is enabled, but no confirmation dialog appeared.');
      }

      if (!featureFlags.directCheckoutConfirmation && dialogMessages.some((dialog) => dialog.type === 'confirm')) {
        issues.push('A direct checkout confirmation dialog appeared even though confirmation is disabled.');
      }

      if (featureFlags.directCheckoutConfirmation && dialogMessages[0]) {
        const methodLabelMap = {
          direct_checkout: 'Redirect to Checkout',
          ajax_add: 'AJAX Add to Cart',
          cart_redirect: 'Redirect to Cart Page',
          popup_checkout: 'Popup Checkout',
          side_cart: 'Side Cart Slide-in',
        };
        const expectedLabel = methodLabelMap[featureFlags.checkoutMethod] || 'Direct Checkout';
        if (!dialogMessages[0].message.includes(expectedLabel)) {
          issues.push(`Confirmation dialog did not mention the configured method "${expectedLabel}".`);
        }
        if (featureFlags.directCheckoutClearCart && !/clear your current cart/i.test(dialogMessages[0].message)) {
          issues.push('Confirmation dialog did not warn that the cart will be cleared.');
        }
      }

      if (featureFlags.directCheckoutClearCart && !clearCartRequest && !clearCartResponse) {
        issues.push('Clear-cart is enabled, but no clear-cart AJAX request was observed.');
      } else if (featureFlags.directCheckoutClearCart && clearCartRequest && !clearCartResponse) {
        issues.push('Clear-cart AJAX request was sent, but no response was observed.');
      }

      if (expectsAjax) {
        if (!ajaxRequest && !ajaxResponse) {
          issues.push('Direct checkout should use AJAX for this method, but no add-to-cart AJAX request was observed.');
        } else if (ajaxRequest && !ajaxResponse) {
          issues.push('Direct checkout AJAX request was sent, but no response was observed.');
        } else if (ajaxResponse.status() >= 400) {
          issues.push(`Direct checkout AJAX request returned HTTP ${ajaxResponse.status()}.`);
        } else if (ajaxPayload && ajaxPayload.success !== true) {
          issues.push(`Direct checkout AJAX response was not successful: ${ajaxPayload.message || 'unknown error'}.`);
        }
      }

      const expectedProductName = ajaxPayload?.product_name || candidate.productTitle || '';
      if (
        expectedProductName &&
        (finalState.popupVisible || finalState.inlineCheckoutVisible || expectedOutcome === 'ajax_add') &&
        finalState.checkoutProductNames.length > 0 &&
        !listIncludesProductName(finalState.checkoutProductNames, expectedProductName)
      ) {
        issues.push(`Direct checkout added "${expectedProductName}", but that product was not found in the visible checkout/order summary.`);
      }

      if (expectedOutcome === 'checkout_redirect') {
        const checkoutUrl = details.checkoutUrl || '';
        if (checkoutUrl && !normalizeComparableUrl(finalState.url).startsWith(normalizeComparableUrl(checkoutUrl))) {
          issues.push('Direct checkout method is Redirect to Checkout, but the browser did not land on the checkout URL.');
        }
      } else if (expectedOutcome === 'cart_redirect') {
        const cartUrl = details.cartUrl || '';
        if (cartUrl && !normalizeComparableUrl(finalState.url).startsWith(normalizeComparableUrl(cartUrl))) {
          issues.push('Direct checkout method is Redirect to Cart Page, but the browser did not land on the cart URL.');
        }
      } else if (expectedOutcome === 'popup_checkout') {
        if (!finalState.popupVisible && !finalState.inlineCheckoutVisible) {
          issues.push('Direct checkout method is Popup Checkout, but neither the popup nor an inline one-page checkout became visible.');
        }
        if (finalState.popupVisible && !finalState.popupHasCheckout) {
          issues.push('Popup Checkout opened, but no checkout form or iframe was detected inside it.');
        }
      } else if (expectedOutcome === 'side_cart') {
        if (!finalState.cartDrawerOpen) {
          issues.push('Direct checkout method is Side Cart, but the cart drawer did not open.');
        }
      } else if (expectedOutcome === 'ajax_add') {
        if (finalState.popupVisible) {
          issues.push('Direct checkout method is AJAX Add to Cart, but the checkout popup opened.');
        }
        if (finalState.cartDrawerOpen) {
          issues.push('Direct checkout method is AJAX Add to Cart, but the side cart opened.');
        }
        if (!ajaxPayload?.success && !(finalState.addedEvents || []).length && !finalState.notices.length) {
          issues.push('AJAX Add to Cart did not produce a successful response, added-to-cart event, or visible notice.');
        }
      }
    } catch (error) {
      issues.push(error.message);
    }

    page.removeAllListeners('dialog');

    const relevantMessages = filterRelevantMessages(messages.slice(beforeMessages));
    if (relevantMessages.length) {
      issues.push(`Browser errors occurred during direct checkout: ${relevantMessages[0].text || relevantMessages[0].url}`);
    }

    return makeResult({
      id,
      title: 'Direct checkout behavior',
      target,
      issues,
      details,
      screenshot: await screenshotForIssues(id, 'Direct checkout behavior', issues),
    });
  }

  async function testSafeAddToCart(target) {
    const id = `interaction-add-to-cart-${target.key}`;
    const issues = [];
    const before = messages.length;

    try {
      const button = page
        .locator('.add_to_cart_button:not(.product_type_variable):not(.direct-checkout-button):not(.onepaquc-checkout-btn), .single_add_to_cart_button:not(.direct-checkout-button):not(.onepaquc-checkout-btn)')
        .first();

      if (!(await button.count()) || !(await button.isVisible({ timeout: 1000 }).catch(() => false))) {
        return makeResult({
          id,
          title: 'Add to cart interaction',
          target,
          skipped: true,
          reason: 'No safe simple add-to-cart button was available.',
        });
      }

      await button.click({ force: true });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);
      await delay(1200);

      const addState = await page.evaluate(() => {
        return {
          noticeText: document.querySelector('.woocommerce-message, .rmenupro-toast-notification, .rmenupro-popup-notification')?.textContent?.trim() || '',
          cartCountText: document.querySelector('.cart-count, .rwc_cart-count, .cart-contents-count')?.textContent?.trim() || '',
          bodyText: document.body?.innerText || '',
        };
      });

      if (!addState.noticeText && !/added to (your )?cart/i.test(addState.bodyText)) {
        issues.push('Add-to-cart click did not produce a visible success notification or cart message.');
      }
    } catch (error) {
      issues.push(error.message);
    }

    const relevantMessages = filterRelevantMessages(messages.slice(before));
    if (relevantMessages.length) {
      issues.push(`Browser errors occurred during add-to-cart: ${relevantMessages[0].text || relevantMessages[0].url}`);
    }

    return makeResult({
      id,
      title: 'Add to cart interaction',
      target,
      issues,
      screenshot: await screenshotForIssues(id, 'Add to cart interaction', issues),
    });
  }

  function getDebugProductId(debugData, key) {
    const pageInfo = debugData?.requiredPages?.[key] || {};
    return (
      pageInfo.product?.id ||
      pageInfo.product?.ID ||
      pageInfo.productId ||
      pageInfo.id ||
      ''
    );
  }

  function findTarget(targets, role) {
    return (targets || []).find((target) => target.role === role || target.key === role) || null;
  }

  async function runCartAjax(action, data = {}) {
    return page.evaluate(
      async ({ actionName, payloadData }) => {
        const cartParams = window.onepaqucpro_wc_cart_params || {};
        const rmsgValue = window.onepaqucpro_rmsgValue || {};
        const ajaxUrl =
          cartParams.ajax_url ||
          rmsgValue.ajax_url ||
          window.woocommerce_params?.ajax_url ||
          window.wc_add_to_cart_params?.ajax_url ||
          '';

        if (!ajaxUrl) {
          return { ok: false, status: 0, error: 'AJAX URL is not available on this page.' };
        }

        const form = new URLSearchParams();
        form.append('action', actionName);

        const appendValue = (key, value) => {
          if (value === undefined || value === null) return;
          if (Array.isArray(value)) {
            value.forEach((item) => form.append(`${key}[]`, item));
            return;
          }
          if (typeof value === 'object') {
            Object.entries(value).forEach(([childKey, childValue]) => appendValue(`${key}[${childKey}]`, childValue));
            return;
          }
          form.append(key, String(value));
        };

        const finalPayload = { ...payloadData };
        if (actionName === 'onepaqucpro_ajax_add_to_cart' && !finalPayload.nonce) {
          finalPayload.nonce = cartParams.nonce || '';
        }
        if (actionName === 'onepaqucpro_get_cart_content' && !finalPayload.nonce) {
          finalPayload.nonce = cartParams.get_cart_content_none || '';
        }
        if (actionName === 'onepaqucpro_update_cart_item_quantity' && !finalPayload.nonce) {
          finalPayload.nonce = cartParams.update_cart_item_quantity || '';
        }
        if (actionName === 'onepaqucpro_update_cart_item_variation' && !finalPayload.nonce) {
          finalPayload.nonce = cartParams.update_cart_item_variation || '';
        }
        if (actionName === 'onepaqucpro_remove_cart_item' && !finalPayload.nonce) {
          finalPayload.nonce = cartParams.remove_cart_item || '';
        }
        if ((actionName === 'apply_coupon' || actionName === 'remove_coupon') && !finalPayload.security) {
          finalPayload.security = rmsgValue.apply_coupon || '';
        }

        Object.entries(finalPayload).forEach(([key, value]) => appendValue(key, value));

        try {
          const response = await fetch(ajaxUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: form.toString(),
          });
          const text = await response.text();
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }

          return {
            ok: response.ok,
            status: response.status,
            json,
            text: text.slice(0, 1200),
          };
        } catch (error) {
          return { ok: false, status: 0, error: error.message };
        }
      },
      { actionName: action, payloadData: data }
    );
  }

  async function refreshFloatingCart(open = true) {
    await page
      .evaluate((shouldOpen) => {
        if (typeof window.updateCartContent === 'function') {
          window.updateCartContent(shouldOpen);
          return true;
        }
        if (shouldOpen && typeof window.openCartDrawer === 'function') {
          window.openCartDrawer();
          return true;
        }
        return false;
      }, open)
      .catch(() => false);
    await delay(1400);
  }

  async function openFloatingCart() {
    await refreshFloatingCart(true);
    const button = page.locator(config.selectors.cartButton).first();
    if ((await button.count()) && (await button.isVisible({ timeout: 1000 }).catch(() => false))) {
      await button.click({ force: true }).catch(() => null);
      await delay(500);
    }
    await page
      .evaluate(() => {
        if (typeof window.openCartDrawer === 'function') {
          window.openCartDrawer();
        }
      })
      .catch(() => null);
    await delay(500);
  }

  async function clearCartViaAjax() {
    const result = await runCartAjax('woocommerce_clear_cart');
    await refreshFloatingCart(false);
    return result;
  }

  async function addSimpleProductToCart(debugData, quantity = 1) {
    let productId = getDebugProductId(debugData, 'simpleProduct');

    if (!productId) {
      productId = await page
        .evaluate(() => {
          return (
            document.querySelector('form.cart [name="add-to-cart"]')?.value ||
            document.querySelector('.single_add_to_cart_button[name="add-to-cart"]')?.value ||
            document.querySelector('.single_add_to_cart_button')?.getAttribute('value') ||
            document.querySelector('.single_add_to_cart_button')?.getAttribute('data-product_id') ||
            ''
          );
        })
        .catch(() => '');
    }

    if (!productId) {
      return { ok: false, error: 'Simple product ID was not available from debug payload or product page.' };
    }

    return runCartAjax('onepaqucpro_ajax_add_to_cart', {
      product_id: productId,
      quantity,
    });
  }

  async function collectVariableProductSelection(debugData) {
    await selectFirstSingleProductVariationOptions();
    await delay(600);

    return page.evaluate((fallbackProductId) => {
      const form = document.querySelector('form.variations_form');
      const variations = {};

      if (form) {
        form.querySelectorAll('select[name^="attribute_"]').forEach((select) => {
          if (select.name && select.value) {
            variations[select.name] = select.value;
          }
        });
      }

      return {
        productId:
          form?.querySelector('[name="product_id"]')?.value ||
          form?.dataset.product_id ||
          form?.querySelector('[name="add-to-cart"]')?.value ||
          fallbackProductId ||
          '',
        variationId: form?.querySelector('input.variation_id, input[name="variation_id"]')?.value || '',
        quantity: form?.querySelector('input.qty, input[name="quantity"]')?.value || '1',
        variations,
      };
    }, getDebugProductId(debugData, 'variableProduct'));
  }

  async function addVariableProductToCart(debugData, variableTarget) {
    if (!variableTarget?.url) {
      return { ok: false, skipped: true, error: 'No variable product target was discovered.' };
    }

    await gotoPage(variableTarget.url);
    const selection = await collectVariableProductSelection(debugData);
    if (!selection.productId || !selection.variationId || !Object.keys(selection.variations || {}).length) {
      return {
        ok: false,
        selection,
        error: 'Could not select a complete variable product variation before adding to cart.',
      };
    }

    const result = await runCartAjax('onepaqucpro_ajax_add_to_cart', {
      product_id: selection.productId,
      quantity: selection.quantity || 1,
      variation_id: selection.variationId,
      variations: selection.variations,
    });
    return { ...result, selection };
  }

  async function readFloatingCartState() {
    const state = await page.evaluate((selectors) => {
      const isVisible = (node) => {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          (node.offsetWidth > 0 || node.offsetHeight > 0 || node.getClientRects().length > 0)
        );
      };
      const text = (node) => (node?.textContent || '').trim().replace(/\s+/g, ' ');
      const drawer = document.querySelector(selectors.cartDrawer);
      const cartButton = document.querySelector(selectors.cartButton);
      const summaryRows = drawer
        ? Array.from(drawer.querySelectorAll('.cart-summary .summary-row')).map((row) => {
            const spans = Array.from(row.children).filter((child) => child.tagName === 'SPAN');
            return {
              className: row.className || '',
              visible: isVisible(row),
              label: text(spans[0]),
              amountText: text(spans[spans.length - 1]),
            };
          })
        : [];

      const subtotalRow = summaryRows.find((row) => !/\bdiscount\b/.test(row.className) && !/\btotal\b/.test(row.className)) || null;
      const discountRow = summaryRows.find((row) => /\bdiscount\b/.test(row.className)) || null;
      const totalRow = summaryRows.find((row) => /\btotal\b/.test(row.className)) || null;

      const items = drawer
        ? Array.from(drawer.querySelectorAll('.cart-item')).map((item) => {
            const quantityInput = item.querySelector('.item-quantity');
            const editor = item.querySelector('.onepaqucpro-cart-variation-editor--drawer');
            const selects = editor ? Array.from(editor.querySelectorAll('.onepaqucpro-cart-variation-editor__select')) : [];
            return {
              key: item.getAttribute('data-cart-item-key') || '',
              title: text(item.querySelector('.item-title')),
              quantity: Number.parseFloat(quantityInput?.value || '0') || 0,
              unitPriceText: text(item.querySelector('.item-price')),
              checked: Boolean(item.querySelector('.item-checkbox')?.checked),
              hasCheckbox: Boolean(item.querySelector('.item-checkbox')),
              hasRemoveButton: Boolean(item.querySelector('.remove-item')),
              hasMinus: Boolean(item.querySelector('.quantity-btn.minus')),
              hasPlus: Boolean(item.querySelector('.quantity-btn.plus')),
              hasQuantityInput: Boolean(quantityInput),
              hasVariationEditor: Boolean(editor),
              variationEditorOpen: Boolean(editor?.classList.contains('is-open')),
              variationSelectCount: selects.length,
              variationOptions: selects.map((select) => ({
                value: select.value || '',
                options: Array.from(select.options)
                  .map((option) => ({ value: option.value, disabled: option.disabled }))
                  .filter((option) => option.value),
              })),
            };
          })
        : [];

      const recommendationNode = drawer?.querySelector('.you-may-also-like') || null;
      const recommendationItems = recommendationNode
        ? Array.from(recommendationNode.querySelectorAll('.recommended-product')).map((item) => ({
            title: text(item.querySelector('h4')),
            priceText: text(item.querySelector('.price')),
            buttonText: text(item.querySelector('.add-to-cart-button')),
            productId: item.querySelector('.add-to-cart-button')?.getAttribute('data-product-id') || '',
          }))
        : [];

      const checkoutButton = drawer?.querySelector('.checkout-button.checkout-button-drawer');

      return {
        url: window.location.href,
        exists: Boolean(drawer),
        open: Boolean(drawer && (drawer.classList.contains('open') || isVisible(drawer))),
        empty: Boolean(drawer?.querySelector('.empty-cart, .empty-cart-items')),
        headerText: text(drawer?.querySelector('.cart-header h2')),
        closeButtonVisible: isVisible(drawer?.querySelector('.close_button')),
        cartButtonVisible: isVisible(cartButton),
        cartButtonText: text(cartButton),
        cartCountText: text(cartButton?.querySelector('.cart-count')),
        selectAllLabel: text(drawer?.querySelector('.select-all-container label')),
        selectAllChecked: Boolean(drawer?.querySelector('#select-all-items')?.checked),
        selectedCountText: text(drawer?.querySelector('#selected-count-text')),
        removeSelectedVisible: isVisible(drawer?.querySelector('#remove-selected')),
        itemCount: items.length,
        checkedItemCount: items.filter((item) => item.checked).length,
        items,
        coupon: {
          inputVisible: isVisible(drawer?.querySelector('#coupon-code')),
          placeholder: drawer?.querySelector('#coupon-code')?.getAttribute('placeholder') || '',
          buttonVisible: isVisible(drawer?.querySelector('#apply-coupon')),
          buttonText: text(drawer?.querySelector('#apply-coupon')),
          messageText: text(drawer?.querySelector('#coupon-message')),
          appliedCoupons: Array.from(drawer?.querySelectorAll('.applied-coupon') || []).map((node) => text(node)),
        },
        recommendations: {
          visible: isVisible(recommendationNode),
          title: text(recommendationNode?.querySelector('h3')),
          count: recommendationItems.length,
          items: recommendationItems,
        },
        summary: {
          rows: summaryRows,
          subtotalLabel: subtotalRow?.label || '',
          subtotalText: subtotalRow?.amountText || '',
          discountVisible: Boolean(discountRow && isVisible(drawer?.querySelector('.summary-row.discount')) && discountRow.amountText),
          discountLabel: discountRow?.label || '',
          discountText: discountRow?.amountText || '',
          totalLabel: totalRow?.label || '',
          totalText: totalRow?.amountText || '',
        },
        checkoutButton: {
          visible: isVisible(checkoutButton),
          text: text(checkoutButton),
          href: checkoutButton?.getAttribute('href') || '',
          tagName: checkoutButton?.tagName || '',
        },
        popupCheckoutVisible: Array.from(document.querySelectorAll('.checkout-popup')).some(isVisible),
        checkoutFormVisible: Array.from(document.querySelectorAll('form.checkout, .woocommerce-checkout, .wc-block-checkout')).some(isVisible),
      };
    }, config.selectors);

    const parsedItems = (state.items || []).map((item) => ({
      ...item,
      unitPrice: parseMoneyValue(item.unitPriceText),
    }));
    const subtotal = parseMoneyValue(state.summary?.subtotalText);
    const total = parseMoneyValue(state.summary?.totalText);
    const discount = parseMoneyValue(state.summary?.discountText);
    const cartCount = parseMoneyValue(state.cartCountText);

    return {
      ...state,
      cartCount,
      items: parsedItems,
      summary: {
        ...state.summary,
        subtotal,
        total,
        discount,
        itemSubtotal: parsedItems.reduce((sum, item) => sum + (Number.isFinite(item.unitPrice) ? item.unitPrice * item.quantity : 0), 0),
      },
    };
  }

  async function waitForCartAjax(action, timeout = 9000) {
    return page
      .waitForResponse((response) => isAdminAjaxActionRequest(response.request(), action), { timeout })
      .catch(() => null);
  }

  async function testFloatingCartVariationEditor(debugData, targets, featureFlags, details) {
    const issues = [];
    const variableTarget = findTarget(targets, 'variableProduct');

    if (!variableTarget) {
      details.variationEditor = { skipped: true, reason: 'No variable product target was discovered.' };
      return issues;
    }

    await clearCartViaAjax();
    const addResult = await addVariableProductToCart(debugData, variableTarget);
    details.variationEditor = { addResult };

    if (!addResult.ok || addResult.json?.success === false) {
      details.variationEditor.skipped = true;
      details.variationEditor.reason = addResult.error || addResult.json?.message || 'Variable product could not be added to the cart.';
      return issues;
    }

    await openFloatingCart();
    let state = await readFloatingCartState();
    details.variationEditor.stateBefore = {
      itemCount: state.itemCount,
      items: state.items.map((item) => ({
        title: item.title,
        hasVariationEditor: item.hasVariationEditor,
        variationSelectCount: item.variationSelectCount,
      })),
    };

    const editorCount = await page.locator('.cart-drawer.open .onepaqucpro-cart-variation-editor--drawer').count();
    if (featureFlags.floatingCartVariationSwitch && editorCount === 0) {
      issues.push('Cart variation switching is enabled, but no variation changer was rendered for the variable cart item.');
      return issues;
    }

    if (!featureFlags.floatingCartVariationSwitch && editorCount > 0) {
      issues.push('Cart variation switching is disabled, but a variation changer is visible in the floating cart.');
      return issues;
    }

    if (!featureFlags.floatingCartVariationSwitch || editorCount === 0) {
      return issues;
    }

    const editor = page.locator('.cart-drawer.open .onepaqucpro-cart-variation-editor--drawer').first();
    await editor.locator('.onepaqucpro-cart-variation-editor__toggle').click({ force: true });
    await delay(350);

    const panelVisible = await editor
      .locator('.onepaqucpro-cart-variation-editor__panel')
      .evaluate((node) => !node.hidden)
      .catch(() => false);
    if (!panelVisible) {
      issues.push('Variation changer toggle did not open the variation panel.');
      return issues;
    }

    const selectCount = await editor.locator('.onepaqucpro-cart-variation-editor__select').count();
    let changed = false;
    for (let index = 0; index < selectCount; index += 1) {
      const select = editor.locator('.onepaqucpro-cart-variation-editor__select').nth(index);
      const alternateValue = await select.evaluate((node) => {
        const current = node.value;
        const option = Array.from(node.options).find((item) => item.value && item.value !== current && !item.disabled);
        return option ? option.value : '';
      });
      if (alternateValue) {
        await select.selectOption(alternateValue);
        changed = true;
        await delay(350);
        break;
      }
    }

    if (!changed) {
      details.variationEditor.skippedApply = 'No alternate variation option was available to apply.';
      return issues;
    }

    const applyButton = editor.locator('.onepaqucpro-cart-variation-editor__apply').first();
    const applyDisabled = await applyButton.evaluate((node) => Boolean(node.disabled)).catch(() => true);
    if (applyDisabled) {
      issues.push('Variation changer apply button stayed disabled after choosing a different option.');
      return issues;
    }

    const variationResponsePromise = waitForCartAjax('onepaqucpro_update_cart_item_variation', 12000);
    await applyButton.click({ force: true });
    const variationResponse = await variationResponsePromise;
    await delay(1600);

    details.variationEditor.ajaxStatus = variationResponse ? variationResponse.status() : null;
    if (!variationResponse) {
      issues.push('Applying a cart variation change did not send the expected AJAX request.');
      return issues;
    }
    if (variationResponse.status() >= 400) {
      issues.push(`Cart variation update AJAX returned HTTP ${variationResponse.status()}.`);
      return issues;
    }

    let payload = null;
    try {
      payload = await variationResponse.json();
    } catch {
      payload = null;
    }
    details.variationEditor.ajaxPayload = payload;
    if (payload && payload.success === false) {
      const message = payload.data?.message || payload.message || 'unknown error';
      issues.push(`Cart variation update failed: ${message}.`);
    }

    state = await readFloatingCartState();
    if (state.itemCount < 1) {
      issues.push('Cart item disappeared after applying a variation change.');
    }

    return issues;
  }

  async function testFloatingCartWorkflow(debugData, targets, featureFlags) {
    const id = 'interaction-floating-cart-workflow';
    const issues = [];
    const details = {
      expectedText: featureFlags.floatingCartText,
      checkoutBehavior: featureFlags.floatingCartCheckoutBehavior,
      couponCodeConfigured: Boolean(config.testData?.couponCode),
      steps: [],
    };
    const before = messages.length;

    if (!config.scenarioSettings.includeFloatingCartWorkflow) {
      return makeResult({
        id,
        title: 'Floating cart full workflow',
        skipped: true,
        reason: 'Floating cart workflow checks are disabled by config.',
      });
    }

    if (!config.scenarioSettings.allowCartMutations) {
      return makeResult({
        id,
        title: 'Floating cart full workflow',
        skipped: true,
        reason: 'Cart-changing workflow checks are disabled by config.',
      });
    }

    const seedTarget = findTarget(targets, 'shop') || (targets || []).find((target) => target.kind === 'archive') || findTarget(targets, 'simpleProduct') || targets[0];
    if (!seedTarget?.url) {
      return makeResult({
        id,
        title: 'Floating cart full workflow',
        skipped: true,
        reason: 'No product or shop target was available for the floating cart workflow.',
      });
    }

    try {
      await gotoPage(seedTarget.url);
      const cartButtonVisible = await page.locator(config.selectors.cartButton).first().isVisible({ timeout: 1500 }).catch(() => false);
      if (!cartButtonVisible) {
        return makeResult({
          id,
          title: 'Floating cart full workflow',
          skipped: true,
          reason: 'No visible floating cart button was available on the seed page.',
        });
      }

      await clearCartViaAjax();
      const addSimpleResult = await addSimpleProductToCart(debugData, 1);
      details.seedSimple = addSimpleResult;
      if (!addSimpleResult.ok || addSimpleResult.json?.success === false) {
        issues.push(`Simple product could not be added to seed the cart: ${addSimpleResult.error || addSimpleResult.json?.message || 'unknown error'}.`);
      }

      await openFloatingCart();
      let state = await readFloatingCartState();
      details.initialState = state;

      if (!state.exists) {
        issues.push('Floating cart drawer markup does not exist.');
      } else if (!state.open) {
        issues.push('Floating cart drawer did not open.');
      }

      if (state.itemCount < 1) {
        issues.push('Floating cart did not show the seeded cart item.');
      }

      const expectedText = featureFlags.floatingCartText || {};
      if (expectedText.title && !uiTextEquals(state.headerText, expectedText.title)) {
        issues.push(`Floating cart title text mismatch. Expected "${expectedText.title}", found "${state.headerText}".`);
      }
      if (!state.closeButtonVisible) {
        issues.push('Floating cart close button is not visible.');
      }
      if (expectedText.selectAll && !uiTextEquals(state.selectAllLabel, expectedText.selectAll)) {
        issues.push(`Select-all label mismatch. Expected "${expectedText.selectAll}", found "${state.selectAllLabel}".`);
      }
      if (expectedText.selectedSuffix && !normalizeUiText(state.selectedCountText).endsWith(normalizeUiText(expectedText.selectedSuffix))) {
        issues.push(`Selected count suffix mismatch. Expected suffix "${expectedText.selectedSuffix}", found "${state.selectedCountText}".`);
      }
      if (state.coupon.inputVisible && state.coupon.placeholder && expectedText.couponPlaceholder && !uiTextEquals(state.coupon.placeholder, expectedText.couponPlaceholder)) {
        issues.push(`Coupon placeholder mismatch. Expected "${expectedText.couponPlaceholder}", found "${state.coupon.placeholder}".`);
      }
      if (state.coupon.buttonVisible && !state.coupon.buttonText) {
        issues.push('Coupon apply button is visible but has no text.');
      }
      if (expectedText.subtotal && state.summary.subtotalLabel && !uiTextEquals(state.summary.subtotalLabel, expectedText.subtotal)) {
        issues.push(`Subtotal label mismatch. Expected "${expectedText.subtotal}", found "${state.summary.subtotalLabel}".`);
      }
      if (state.summary.totalLabel && !uiTextEquals(state.summary.totalLabel, expectedText.total || 'Total')) {
        issues.push(`Total label mismatch. Expected "${expectedText.total || 'Total'}", found "${state.summary.totalLabel}".`);
      }
      if (expectedText.checkout && !uiTextEquals(state.checkoutButton.text, expectedText.checkout)) {
        issues.push(`Checkout button text mismatch. Expected "${expectedText.checkout}", found "${state.checkoutButton.text}".`);
      }
      if (!state.checkoutButton.visible) {
        issues.push('Floating cart checkout button is not visible when the cart has an item.');
      }

      if (Number.isFinite(state.summary.subtotal) && Number.isFinite(state.summary.itemSubtotal) && state.itemCount === 1) {
        if (!moneyCloseEnough(state.summary.subtotal, state.summary.itemSubtotal)) {
          issues.push(`Cart subtotal does not match item price x quantity. Expected about ${state.summary.itemSubtotal}, found ${state.summary.subtotal}.`);
        }
      }
      if (state.summary.total !== null && !Number.isFinite(state.summary.total)) {
        issues.push(`Cart total is not a parseable number: "${state.summary.totalText}".`);
      }

      if (state.items[0]?.hasPlus) {
        const beforeQty = state.items[0].quantity;
        const beforeSubtotal = state.summary.subtotal;
        const unitPrice = state.items[0].unitPrice;
        const qtyResponsePromise = waitForCartAjax('onepaqucpro_update_cart_item_quantity');
        await page.locator('.cart-drawer.open .cart-item .quantity-btn.plus').first().click({ force: true });
        const qtyResponse = await qtyResponsePromise;
        await delay(1700);
        state = await readFloatingCartState();
        details.afterQuantityPlus = state;
        if (!qtyResponse) {
          issues.push('Quantity plus click did not send the expected cart quantity AJAX request.');
        }
        if (state.items[0]?.quantity !== beforeQty + 1) {
          issues.push(`Quantity plus click did not increment quantity from ${beforeQty} to ${beforeQty + 1}.`);
        }
        if (Number.isFinite(beforeSubtotal) && Number.isFinite(unitPrice) && Number.isFinite(state.summary.subtotal)) {
          const expectedSubtotal = beforeSubtotal + unitPrice;
          if (!moneyCloseEnough(state.summary.subtotal, expectedSubtotal)) {
            issues.push(`Subtotal did not increase by one unit price after quantity plus. Expected about ${expectedSubtotal}, found ${state.summary.subtotal}.`);
          }
        }
      } else {
        issues.push('Quantity plus button is missing from cart item.');
      }

      if (state.items[0]?.hasMinus) {
        const beforeQty = state.items[0].quantity;
        const qtyResponsePromise = waitForCartAjax('onepaqucpro_update_cart_item_quantity');
        await page.locator('.cart-drawer.open .cart-item .quantity-btn.minus').first().click({ force: true });
        const qtyResponse = await qtyResponsePromise;
        await delay(1700);
        state = await readFloatingCartState();
        details.afterQuantityMinus = state;
        if (!qtyResponse) {
          issues.push('Quantity minus click did not send the expected cart quantity AJAX request.');
        }
        if (beforeQty > 1 && state.items[0]?.quantity !== beforeQty - 1) {
          issues.push(`Quantity minus click did not decrement quantity from ${beforeQty} to ${beforeQty - 1}.`);
        }
        if (state.items[0]?.quantity < 1) {
          issues.push('Quantity minus allowed cart item quantity below 1.');
        }
      } else {
        issues.push('Quantity minus button is missing from cart item.');
      }

      await page
        .evaluate(() => {
          document.querySelectorAll('.cart-drawer .item-checkbox').forEach((checkbox) => {
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          });
        })
        .catch(() => null);
      await delay(300);

      if (await page.locator('.cart-drawer.open .item-checkbox').first().count()) {
        await page.locator('.cart-drawer.open .item-checkbox').first().check({ force: true });
        await delay(350);
        state = await readFloatingCartState();
        details.afterSelectOne = state;
        if (state.checkedItemCount !== 1) {
          issues.push('Selecting a single cart item did not check exactly one item.');
        }
        if (!normalizeUiText(state.selectedCountText).startsWith('1 ')) {
          issues.push(`Selected count did not update to 1 after selecting one item. Found "${state.selectedCountText}".`);
        }
        if (!state.removeSelectedVisible) {
          issues.push('Remove-selected button did not appear after selecting one item.');
        }

        await page.locator('.cart-drawer.open .item-checkbox').first().uncheck({ force: true });
        await delay(350);
      }

      if (await page.locator('.cart-drawer.open #select-all-items').count()) {
        await page.locator('.cart-drawer.open #select-all-items').check({ force: true });
        await delay(350);
        state = await readFloatingCartState();
        details.afterSelectAll = state;
        if (!state.selectAllChecked || state.checkedItemCount !== state.itemCount) {
          issues.push('Select-all checkbox did not select every visible cart item.');
        }
      }

      await page
        .evaluate(() => {
          const selectAll = document.querySelector('.cart-drawer #select-all-items');
          if (selectAll) {
            selectAll.checked = false;
            selectAll.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })
        .catch(() => null);
      await delay(350);

      state = await readFloatingCartState();
      if (state.itemCount === 1) {
        if (state.recommendations.visible) {
          if (expectedText.recommendedTitle && !uiTextEquals(state.recommendations.title, expectedText.recommendedTitle)) {
            issues.push(`Recommended-products title mismatch. Expected "${expectedText.recommendedTitle}", found "${state.recommendations.title}".`);
          }
          if (state.recommendations.count < 1) {
            issues.push('Recommended-products section is visible but contains no product cards.');
          }
          const invalidRecommendation = state.recommendations.items.find((item) => !item.title || !item.priceText || !item.buttonText || !item.productId);
          if (invalidRecommendation) {
            issues.push('A recommended product card is missing title, price, product id, or add-to-cart text.');
          }

          const beforeItemCount = state.itemCount;
          const addRecommendedResponsePromise = waitForCartAjax('onepaqucpro_ajax_add_to_cart', 12000);
          await page.locator('.cart-drawer.open .recommended-product .add-to-cart-button').first().click({ force: true });
          const addRecommendedResponse = await addRecommendedResponsePromise;
          await delay(2000);
          state = await readFloatingCartState();
          details.afterRecommendedAdd = state;
          if (!addRecommendedResponse) {
            issues.push('Recommended product add-to-cart click did not send the expected AJAX request.');
          }
          if (state.itemCount <= beforeItemCount && (!Number.isFinite(state.cartCount) || state.cartCount <= beforeItemCount)) {
            issues.push('Recommended product add-to-cart did not increase the cart contents.');
          }
        } else {
          details.recommendationsSkipped = 'No recommended products were rendered for the one-item cart state.';
        }
      }

      state = await readFloatingCartState();
      if (state.itemCount > 0 && (await page.locator('.cart-drawer.open .item-checkbox').first().count())) {
        const beforeCount = state.itemCount;
        await page.locator('.cart-drawer.open .item-checkbox').first().check({ force: true });
        await delay(300);
        const removeSelectedResponsePromise = waitForCartAjax('onepaqucpro_remove_cart_item', 12000);
        await page.locator('.cart-drawer.open #remove-selected').click({ force: true });
        const removeSelectedResponse = await removeSelectedResponsePromise;
        await delay(1900);
        state = await readFloatingCartState();
        details.afterRemoveSelectedOne = state;
        if (!removeSelectedResponse) {
          issues.push('Remove selected click did not send the expected cart removal AJAX request.');
        }
        if (state.itemCount >= beforeCount) {
          issues.push('Remove selected did not remove the selected cart item.');
        }
      }

      await addSimpleProductToCart(debugData, 1);
      await openFloatingCart();
      state = await readFloatingCartState();
      if (state.itemCount > 0 && (await page.locator('.cart-drawer.open .remove-item').first().count())) {
        const beforeCount = state.itemCount;
        const removeSingleResponsePromise = waitForCartAjax('onepaqucpro_remove_cart_item', 12000);
        await page.locator('.cart-drawer.open .remove-item').first().click({ force: true });
        const removeSingleResponse = await removeSingleResponsePromise;
        await delay(1900);
        state = await readFloatingCartState();
        details.afterRemoveSingle = state;
        if (!removeSingleResponse) {
          issues.push('Single remove icon click did not send the expected cart removal AJAX request.');
        }
        if (state.itemCount >= beforeCount && !state.empty) {
          issues.push('Single remove icon did not remove a cart item.');
        }
      }

      await clearCartViaAjax();
      await addSimpleProductToCart(debugData, 1);
      const variableTarget = findTarget(targets, 'variableProduct');
      if (variableTarget) {
        const variableAddForRemoveAll = await addVariableProductToCart(debugData, variableTarget);
        details.removeAllVariableSeed = variableAddForRemoveAll;
      }
      await openFloatingCart();
      state = await readFloatingCartState();
      if (state.itemCount > 0 && (await page.locator('.cart-drawer.open #select-all-items').count())) {
        await page.locator('.cart-drawer.open #select-all-items').check({ force: true });
        await delay(350);
        const removeAllResponsePromise = waitForCartAjax('onepaqucpro_remove_cart_item', 12000);
        await page.locator('.cart-drawer.open #remove-selected').click({ force: true });
        const removeAllResponse = await removeAllResponsePromise;
        await delay(2200);
        state = await readFloatingCartState();
        details.afterRemoveAll = state;
        if (!removeAllResponse) {
          issues.push('Remove all selected items did not send the expected cart removal AJAX request.');
        }
        if (state.itemCount !== 0 && !state.empty) {
          issues.push('Remove all selected items did not empty the floating cart.');
        }
      }

      const couponCode = String(config.testData?.couponCode || '').trim();
      if (couponCode) {
        await clearCartViaAjax();
        await addSimpleProductToCart(debugData, 1);
        await openFloatingCart();
        const applyCouponResponsePromise = waitForCartAjax('apply_coupon', 12000);
        await page.locator('.cart-drawer.open #coupon-code').fill(couponCode);
        await page.locator('.cart-drawer.open #apply-coupon').click({ force: true });
        const applyCouponResponse = await applyCouponResponsePromise;
        await delay(1700);
        state = await readFloatingCartState();
        details.afterCouponApply = state;
        if (!applyCouponResponse) {
          issues.push('Coupon apply click did not send the expected AJAX request.');
        } else if (applyCouponResponse.status() >= 400) {
          issues.push(`Coupon apply AJAX returned HTTP ${applyCouponResponse.status()}.`);
        }
        if (!state.summary.discountVisible && state.coupon.appliedCoupons.length === 0 && !/applied|success/i.test(state.coupon.messageText)) {
          issues.push('Configured coupon did not show an applied coupon, discount row, or success message.');
        }

        if (await page.locator('.cart-drawer.open .remove-coupon').first().count()) {
          const removeCouponResponsePromise = waitForCartAjax('remove_coupon', 12000);
          await page.locator('.cart-drawer.open .remove-coupon').first().click({ force: true });
          const removeCouponResponse = await removeCouponResponsePromise;
          await delay(1500);
          details.afterCouponRemove = await readFloatingCartState();
          if (!removeCouponResponse) {
            issues.push('Coupon remove click did not send the expected AJAX request.');
          }
        }
      } else {
        details.couponSkipped = 'No couponCode was configured in testData; valid coupon behavior was skipped.';
      }

      const variationIssues = await testFloatingCartVariationEditor(debugData, targets, featureFlags, details);
      issues.push(...variationIssues);

      await clearCartViaAjax();
      await gotoPage(seedTarget.url);
      await addSimpleProductToCart(debugData, 1);
      await openFloatingCart();
      state = await readFloatingCartState();
      details.beforeCheckoutClick = state;

      if (state.checkoutButton.visible && config.scenarioSettings.includeFloatingCartCheckout) {
        const startUrl = page.url();
        const checkoutRuntime = await readRuntime();
        const checkoutUrl = checkoutRuntime.cartParams.checkoutUrl || checkoutRuntime.checkoutUrl || '';
        const navigationPromise = page
          .waitForURL((url) => normalizeComparableUrl(url.toString()) !== normalizeComparableUrl(startUrl), { timeout: 12000 })
          .catch(() => null);

        await page.locator('.cart-drawer.open .checkout-button.checkout-button-drawer').first().click({ force: true });
        if (featureFlags.floatingCartCheckoutBehavior === 'popup_checkout') {
          await delay(1600);
          state = await readFloatingCartState();
          details.afterCheckoutClick = state;
          if (!state.popupCheckoutVisible && !state.checkoutFormVisible) {
            issues.push('Floating cart checkout is configured for popup checkout, but no checkout popup/form became visible.');
          }
        } else {
          await navigationPromise;
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);
          state = await readFloatingCartState();
          details.afterCheckoutClick = state;
          if (checkoutUrl && !normalizeComparableUrl(page.url()).startsWith(normalizeComparableUrl(checkoutUrl))) {
            issues.push('Floating cart checkout button did not navigate to the configured checkout URL.');
          } else if (!checkoutUrl && normalizeComparableUrl(page.url()) === normalizeComparableUrl(startUrl)) {
            issues.push('Floating cart checkout button did not navigate away or open checkout.');
          }
        }
      } else if (!config.scenarioSettings.includeFloatingCartCheckout) {
        details.checkoutSkipped = 'Checkout click is disabled by config.';
      }
    } catch (error) {
      issues.push(error.message);
    }

    const relevantMessages = filterRelevantMessages(messages.slice(before));
    if (relevantMessages.length) {
      issues.push(`Browser errors occurred during floating cart workflow: ${relevantMessages[0].text || relevantMessages[0].url}`);
    }

    return makeResult({
      id,
      title: 'Floating cart full workflow',
      issues,
      details,
      screenshot: await screenshotForIssues(id, 'Floating cart full workflow', issues),
    });
  }

  async function testTargetPage(target, featureFlags) {
    const before = messages.length;
    const response = await gotoPage(target.url);
    const runtime = await readRuntime();
    const flags = featureFlags || deriveFeatureFlags(runtime);
    const facts = await readPageFacts();
    const relevantMessages = filterRelevantMessages(messages.slice(before));
    const issues = buildPageIssues({ target, response, facts, runtime, flags, relevantMessages });
    const id = `page-${target.key}`;

    return makeResult({
      id,
      title: `Page checks: ${target.label}`,
      target,
      issues,
      details: {
        responseStatus: response ? response.status() : null,
        finalUrl: page.url(),
        facts,
        runtime: {
          settingsCount: runtime.settingsCount,
          cartParamsPresent: runtime.cartParamsPresent,
          quickViewParamsPresent: runtime.quickViewParamsPresent,
          rmsgValuePresent: runtime.rmsgValuePresent,
          ajaxAddToCartParamsPresent: runtime.ajaxAddToCartParamsPresent,
          cartParams: runtime.cartParams,
          quickViewParams: runtime.quickViewParams,
        },
        settingsSummary: summarizeSettings(runtime),
        relevantMessages,
      },
      screenshot: await screenshotForIssues(id, `Page checks: ${target.label}`, issues),
    });
  }

  try {
    const startedAt = new Date().toISOString();
    const debugUrl = withDebugQuery(config.baseUrl);
    progress.info(`Discovering QC targets from ${debugUrl}`);
    const discoveryResponse = await gotoPage(debugUrl);
    const discoveryRuntime = await readRuntime();
    const discoveryPayload = await readDebugPayload();
    const debugData = discoveryPayload.data || {
      plugin: 'one-page-quick-checkout-for-woocommerce-pro',
      requiredPages: {},
      taxonomyArchives: [],
      missing: [],
    };
    const featureFlags = deriveFeatureFlags(discoveryRuntime);
    const targets = buildTargets(debugData, config);
    const tests = [];
    let directCheckoutInteractionRuns = 0;
    const wantsFloatingCartWorkflow =
      config.scenarioSettings.includeInteractions && config.scenarioSettings.includeFloatingCartWorkflow;

    const missingRequiredPages = Object.entries(debugData.requiredPages || {})
      .filter(([, pageInfo]) => !extractPageUrl(pageInfo))
      .map(([key, pageInfo]) => ({ key, label: pageInfo.label || key }));

    const discoveryIssues = [];
    if (!discoveryPayload.data) {
      discoveryIssues.push('The Plugincy QC debug payload was not found. Deploy the plugin change that renders #plugincy-qc-debug-data for ?plugincydebug=true.');
    }
    if (discoveryResponse && discoveryResponse.status() >= 400) {
      discoveryIssues.push(`Discovery URL returned HTTP ${discoveryResponse.status()}.`);
    }
    if (config.scenarioSettings.strictRequiredTargets) {
      for (const missing of missingRequiredPages) {
        discoveryIssues.push(`Missing required target: ${missing.label}.`);
      }
    }

    tests.push(
      makeResult({
        id: 'discovery',
        title: 'Debug target discovery',
        issues: discoveryIssues,
        details: {
          debugUrl,
          source: discoveryPayload.source,
          missingRequiredPages,
          strictRequiredTargets: config.scenarioSettings.strictRequiredTargets,
          targetCount: targets.length,
          runtime: {
            settingsCount: discoveryRuntime.settingsCount,
            cartParamsPresent: discoveryRuntime.cartParamsPresent,
            rmsgValuePresent: discoveryRuntime.rmsgValuePresent,
            quickViewParamsPresent: discoveryRuntime.quickViewParamsPresent,
          },
        },
        screenshot: await screenshotForIssues('discovery', 'Debug target discovery', discoveryIssues),
      })
    );

    await writeJson(generatedConfigPath, {
      generatedAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      siteLabel: config.siteLabel,
      deviceMode: config.deviceMode,
      discoveredTargets: targets,
      featureFlags,
      settingsSummary: summarizeSettings(discoveryRuntime),
    });

    progress.setTotal(targets.length + 1 + (wantsFloatingCartWorkflow ? 1 : 0));
    progress.step('Discovery');

    for (const target of targets) {
      progress.step(target.label);
      try {
        const pageResult = await testTargetPage(target, featureFlags);
        tests.push(pageResult);
        if (!pageResult.passed) {
          console.log(`[issue found] ${pageResult.title}: ${pageResult.issues[0]}`);
        }

        const facts = pageResult.details.facts || {};
        if (config.scenarioSettings.includeInteractions) {
          if (target.kind === 'archive' && featureFlags.quickView && facts.quickViewButtonCount > 0) {
            const result = await testQuickViewInteraction(target, featureFlags);
            tests.push(result);
            if (!result.passed && !result.skipped) console.log(`[issue found] ${result.title}: ${result.issues[0]}`);
          }

          if (facts.cartButtonCount > 0) {
            const result = await testCartDrawerInteraction(target);
            tests.push(result);
            if (!result.passed && !result.skipped) console.log(`[issue found] ${result.title}: ${result.issues[0]}`);
          }

          if (target.kind === 'variableProduct' && facts.variationFormCount > 0) {
            const result = await testVariableSelection(target);
            tests.push(result);
            if (!result.passed && !result.skipped) console.log(`[issue found] ${result.title}: ${result.issues[0]}`);
          }

          if (target.kind === 'archive' && facts.archiveVariationsCount > 0) {
            const result = await testArchiveVariationSelection(target);
            tests.push(result);
            if (!result.passed && !result.skipped) console.log(`[issue found] ${result.title}: ${result.issues[0]}`);
          }

          const shouldRunDirectCheckout =
            featureFlags.directCheckout &&
            facts.directCheckoutCount > 0 &&
            isDirectCheckoutExpectedOnTarget(target, featureFlags) &&
            directCheckoutInteractionRuns < (Number(config.scenarioSettings.maxDirectCheckoutInteractions) || 8) &&
            (!config.scenarioSettings.directCheckoutRequiredOnly || target.required);

          if (shouldRunDirectCheckout) {
            directCheckoutInteractionRuns += 1;
            const result = await testDirectCheckoutBehavior(target, featureFlags);
            tests.push(result);
            if (!result.passed && !result.skipped) console.log(`[issue found] ${result.title}: ${result.issues[0]}`);
          }

          if (config.scenarioSettings.includeAddToCartInteractions && config.scenarioSettings.allowCartMutations && facts.addToCartCount > 0) {
            const result = await testSafeAddToCart(target);
            tests.push(result);
            if (!result.passed && !result.skipped) console.log(`[issue found] ${result.title}: ${result.issues[0]}`);
          }
        }
      } catch (error) {
        const failure = makeResult({
          id: `page-${target.key}`,
          title: `Page checks: ${target.label}`,
          target,
          issues: [error.message],
          screenshot: await captureFailureScreenshot(`page-${target.key}`, {
            title: `Page checks: ${target.label}`,
            issues: [error.message],
          }),
        });
        tests.push(failure);
        console.log(`[issue found] ${failure.title}: ${failure.issues[0]}`);
      }
    }

    if (wantsFloatingCartWorkflow) {
      progress.step('Floating cart workflow');
      if (!config.scenarioSettings.allowCartMutations) {
        tests.push(
          makeResult({
            id: 'interaction-floating-cart-workflow',
            title: 'Floating cart full workflow',
            skipped: true,
            reason: 'Cart-changing floating cart checks are disabled by config.',
          })
        );
      } else if (!featureFlags.cartDrawerSticky) {
        tests.push(
          makeResult({
            id: 'interaction-floating-cart-workflow',
            title: 'Floating cart full workflow',
            skipped: true,
            reason: 'Floating cart is disabled in settings.',
          })
        );
      } else {
        const result = await testFloatingCartWorkflow(debugData, targets, featureFlags);
        tests.push(result);
        if (!result.passed && !result.skipped) console.log(`[issue found] ${result.title}: ${result.issues[0]}`);
      }
    }

    const uniqueMessages = [];
    const seenMessages = new Set();
    for (const message of filterRelevantMessages(messages)) {
      const key = `${message.type}:${message.text}:${message.url}`;
      if (seenMessages.has(key)) continue;
      seenMessages.add(key);
      uniqueMessages.push(message);
    }

    const report = {
      siteLabel: config.siteLabel,
      baseUrl: config.baseUrl,
      runMode: config.runMode,
      deviceMode: config.deviceMode,
      configPath: config.configPath || null,
      outputDir,
      reportJsonPath,
      reportMarkdownPath,
      generatedConfigPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      discovery: {
        source: discoveryPayload.source,
        debugUrl,
        missingRequiredPages,
        strictRequiredTargets: config.scenarioSettings.strictRequiredTargets,
        payloadError: discoveryPayload.error || null,
      },
      targets,
      featureFlags,
      settingsSummary: summarizeSettings(discoveryRuntime),
      debugData,
      totalTests: tests.length,
      passedTests: tests.filter((test) => test.passed).length,
      skippedTests: tests.filter((test) => test.skipped).length,
      failedCount: countFailed(tests),
      tests,
      uniqueMessages,
      responseStatuses: Object.fromEntries(Array.from(responseStatuses.entries()).slice(0, 300)),
      effectiveConfig: {
        siteLabel: config.siteLabel,
        baseUrl: config.baseUrl,
        deviceMode: config.deviceMode,
        selectors: config.selectors,
        scenarioSettings: config.scenarioSettings,
      },
    };

    await writeJson(reportJsonPath, report);
    await fs.writeFile(reportMarkdownPath, buildMarkdownReport(report), 'utf8');

    console.log(`QC completed for ${config.siteLabel}`);
    console.log(`Run mode: ${config.runMode}`);
    console.log(`Device: ${config.deviceMode}`);
    console.log(`Targets: ${targets.length}`);
    console.log(`Report JSON: ${reportJsonPath}`);
    console.log(`Report MD:   ${reportMarkdownPath}`);
    console.log(`Generated config: ${generatedConfigPath}`);
    console.log(`Failed tests: ${report.failedCount}`);

    process.exitCode = report.failedCount > 0 ? 1 : 0;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
