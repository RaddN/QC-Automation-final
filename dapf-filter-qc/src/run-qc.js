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

    if (arg === '--headed') {
      args.headed = true;
      continue;
    }

    if (arg === '--headless') {
      args.headless = true;
      continue;
    }
  }

  return args;
}

function buildDefaultConfig() {
  return {
    siteLabel: 'site',
    baseUrl: '',
    outputDir: './reports',
    deviceMode: 'desktop',
    browser: {
      channel: 'chrome',
      headed: true,
      slowMoMs: 0,
      viewport: {
        width: 1440,
        height: 1400,
      },
    },
    selectors: {
      form: '#product-filter',
      applyButtonName: 'Apply Filters',
      resetButtonName: 'Reset Filters',
      pagination: '.woocommerce-pagination, .plugincy-filter-pagination, nav.woocommerce-pagination, ul.page-numbers',
      sorting: 'form.woocommerce-ordering select.orderby, form.woocommerce-ordering select, .woocommerce-ordering select.orderby, .woocommerce-ordering select, select.orderby',
      resultCount: '.woocommerce-result-count',
      emptyMessage: '.woocommerce-info, .woocommerce-no-products-found',
      productTitles: 'ul.products li.product h2',
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
    testData: {
      searchText: '',
      priceRange: {
        min: '',
        max: '',
      },
      sku: '',
      discount: '',
      dimensions: {
        min_height: '',
        max_height: '',
        min_length: '',
        max_length: '',
      },
    },
    maxDuplicateFieldsetsPerId: 3,
    fieldOverrides: {},
    skipFieldsets: [],
    actionTargets: {
      collapseFieldsetId: '',
      optionSearchFieldsetId: '',
      optionSearchPlaceholder: '',
      optionSearchText: '',
      resetFieldsetId: '',
      resetValue: '',
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

  output.testData = {
    ...base.testData,
    ...(override.testData || {}),
    priceRange: {
      ...base.testData.priceRange,
      ...((override.testData || {}).priceRange || {}),
    },
    dimensions: {
      ...base.testData.dimensions,
      ...((override.testData || {}).dimensions || {}),
    },
  };

  output.actionTargets = {
    ...base.actionTargets,
    ...(override.actionTargets || {}),
  };

  output.fieldOverrides = {
    ...base.fieldOverrides,
    ...(override.fieldOverrides || {}),
  };

  output.consentButtonNames = override.consentButtonNames || base.consentButtonNames;
  output.noisePatterns = override.noisePatterns || base.noisePatterns;
  output.skipFieldsets = override.skipFieldsets || base.skipFieldsets;

  return output;
}

const DEVICE_PRESETS = {
  desktop: {
    name: 'desktop',
    viewport: {
      width: 1440,
      height: 1400,
    },
  },
  mobile: {
    name: 'mobile',
    viewport: {
      width: 390,
      height: 844,
    },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
};

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
    .slice(0, 80);
}

function buildFieldKey(id, title, domIndex) {
  const indexPart = String(Math.max(0, Number(domIndex) || 0)).padStart(3, '0');
  const idPart = sanitizeId(id || 'group');
  const titlePart = sanitizeId(title || '');
  return [indexPart, idPart, titlePart].filter(Boolean).join('-');
}

function pickRepresentativeItems(items, limit) {
  if (!Array.isArray(items) || items.length <= limit) {
    return Array.isArray(items) ? items : [];
  }

  if (!Number.isFinite(limit) || limit < 1) {
    return items;
  }

  const indices = new Set();
  if (limit === 1) {
    indices.add(Math.floor((items.length - 1) / 2));
  } else {
    for (let step = 0; step < limit; step += 1) {
      indices.add(Math.round((step * (items.length - 1)) / (limit - 1)));
    }
  }

  return [...indices]
    .sort((left, right) => left - right)
    .map((index) => items[index])
    .filter(Boolean);
}

function selectRepresentativeFieldsets(metadata, maxDuplicateFieldsetsPerId, explicitRefs = []) {
  if (!Array.isArray(metadata) || !metadata.length) {
    return [];
  }

  if (!Number.isFinite(maxDuplicateFieldsetsPerId) || maxDuplicateFieldsetsPerId < 1) {
    return metadata;
  }

  const explicitSet = new Set((explicitRefs || []).map((value) => String(value || '').trim()).filter(Boolean));
  const grouped = new Map();

  for (const fieldset of metadata) {
    const bucketKey = fieldset?.id || fieldset?.key;
    if (!bucketKey) {
      continue;
    }

    if (!grouped.has(bucketKey)) {
      grouped.set(bucketKey, []);
    }

    grouped.get(bucketKey).push(fieldset);
  }

  const selectedKeys = new Set();

  for (const group of grouped.values()) {
    const picked = pickRepresentativeItems(group, maxDuplicateFieldsetsPerId);
    for (const fieldset of picked) {
      if (fieldset?.key) {
        selectedKeys.add(fieldset.key);
      }
    }

    for (const fieldset of group) {
      if (explicitSet.has(fieldset?.key) || explicitSet.has(fieldset?.id)) {
        selectedKeys.add(fieldset.key);
      }
    }
  }

  return metadata.filter((fieldset) => selectedKeys.has(fieldset.key));
}

function equalsSet(actual, expected) {
  if ((actual || []).length !== (expected || []).length) return false;
  const left = [...(actual || [])].sort();
  const right = [...(expected || [])].sort();
  return left.every((value, index) => value === right[index]);
}

function includesAllValues(actual, expected) {
  const set = new Set((actual || []).map((value) => String(value)));
  return (expected || []).every((value) => set.has(String(value)));
}

function summarizeIssueCounts(tests) {
  return tests.reduce((count, test) => count + (test.passed ? 0 : 1), 0);
}

function hasValue(value) {
  return !(value === null || value === undefined || String(value).trim() === '');
}

function hasAllValues(values) {
  return Object.values(values || {}).every((value) => hasValue(value));
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/[^0-9.-]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeToggle(value) {
  if (!hasValue(value)) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['on', 'yes', 'true', '1'].includes(normalized)) {
    return true;
  }
  if (['off', 'no', 'false', '0'].includes(normalized)) {
    return false;
  }
  return null;
}

function parseOptionCount(text) {
  const match = String(text || '').match(/\((\d[\d,.\s]*)\)\s*$/);
  if (!match) {
    return null;
  }

  const parsed = parseNumber(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUrlMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['ajax', 'query_string', 'permalinks'].includes(mode) ? mode : 'unknown';
}

function shouldExpectUrlChange(urlMode) {
  return urlMode === 'query_string' || urlMode === 'permalinks';
}

function shouldExpectReloadPersistence(urlMode) {
  return urlMode === 'query_string' || urlMode === 'permalinks';
}

function buildSelectorPool(...values) {
  const pool = [];
  const seen = new Set();
  const push = (value) => {
    if (!hasValue(value)) {
      return;
    }

    const normalized = String(value).trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    pool.push(normalized);
  };

  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        push(item);
      }
      continue;
    }

    push(value);
  }

  return pool;
}

function normalizeComparableState(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeComparableState(item))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeComparableState(value[key])])
    );
  }

  return value;
}

function statesEqual(left, right) {
  return JSON.stringify(normalizeComparableState(left)) === JSON.stringify(normalizeComparableState(right));
}

function buildSummarySignature(summary) {
  return JSON.stringify({
    resultCount: summary?.resultCount || null,
    emptyMessage: summary?.emptyMessage || null,
    productCount: summary?.productCount ?? null,
    titles: Array.isArray(summary?.titles) ? summary.titles.slice(0, 8) : [],
  });
}

function summariesDiffer(left, right) {
  return buildSummarySignature(left) !== buildSummarySignature(right);
}

function pickQuartileRange(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const minIndex = Math.floor((sorted.length - 1) * 0.25);
  const maxIndex = Math.floor((sorted.length - 1) * 0.75);
  let min = sorted[minIndex];
  let max = sorted[Math.max(maxIndex, minIndex)];

  if (min === max) {
    max = sorted[sorted.length - 1];
  }

  if (min === max) {
    return null;
  }

  return { min, max };
}

function deriveSiteLabel(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const pathPart = parsed.pathname
      .replace(/^\/+|\/+$/g, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '');
    const combined = [host, pathPart].filter(Boolean).join('-');
    return sanitizeId(combined || host || 'site');
  } catch {
    return 'site';
  }
}

function pickSearchToken(text) {
  const clean = String(text || '').replace(/\([^)]*\)/g, ' ');
  const parts = clean
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && /[A-Za-z]/.test(part));

  if (!parts.length) {
    return '';
  }

  return parts.slice(0, 2).join(' ');
}

function isMeaningfulSelectOption(option) {
  if (!option || !hasValue(option.value)) {
    return false;
  }

  const value = String(option.value).trim();
  const text = String(option.text || '').trim();

  if (!value) {
    return false;
  }

  if (/^(any|all)$/i.test(value) || /^(any|all)\b/i.test(text)) {
    return false;
  }

  return true;
}

function hasSearchableChoiceText(fieldset) {
  return (fieldset.choiceOptions || []).some((option) => hasValue(pickSearchToken(option.text)));
}

function deriveSearchText(products, baselineSummary) {
  const titles = [
    ...products.map((product) => product?.name).filter(Boolean),
    ...(baselineSummary?.titles || []),
  ];

  for (const title of titles) {
    const token = pickSearchToken(title);
    if (token) {
      return token;
    }
  }

  return '';
}

function derivePriceRangeFromProducts(products) {
  const prices = products
    .map((product) => parseNumber(product?.prices?.price))
    .filter((price) => Number.isFinite(price) && price > 0);

  const picked = pickQuartileRange(prices);
  if (!picked) {
    return { min: '', max: '' };
  }

  return {
    min: String(Math.round(picked.min)),
    max: String(Math.round(picked.max)),
  };
}

function getPriceBoundsFromFieldset(metadata) {
  const fieldset = metadata.find((field) => field.id === 'price-range');
  if (!fieldset) {
    return null;
  }

  const minInput = fieldset.controls.find((control) => control.name === 'mn_price');
  const maxInput = fieldset.controls.find((control) => control.name === 'mx_price');
  const min = parseNumber(minInput?.value);
  const max = parseNumber(maxInput?.value);

  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return null;
  }

  return { min, max };
}

function derivePriceRangeFromFieldset(metadata) {
  const bounds = getPriceBoundsFromFieldset(metadata);
  if (!bounds) {
    return { min: '', max: '' };
  }

  const { min, max } = bounds;

  const range = max - min;
  const derivedMin = min + Math.max(1, Math.round(range * 0.1));
  const derivedMax = min + Math.max(2, Math.round(range * 0.4));

  if (derivedMax <= derivedMin) {
    return { min: String(min), max: String(max) };
  }

  return {
    min: String(derivedMin),
    max: String(Math.min(max, derivedMax)),
  };
}

function derivePriceRange(metadata, products) {
  const bounds = getPriceBoundsFromFieldset(metadata);
  const fromProducts = derivePriceRangeFromProducts(products);
  if (hasValue(fromProducts.min) && hasValue(fromProducts.max)) {
    if (!bounds) {
      return fromProducts;
    }

    const clampedMin = Math.max(bounds.min, Math.min(parseNumber(fromProducts.min), bounds.max));
    const clampedMax = Math.max(bounds.min, Math.min(parseNumber(fromProducts.max), bounds.max));
    if (Number.isFinite(clampedMin) && Number.isFinite(clampedMax) && clampedMax > clampedMin) {
      return {
        min: String(Math.round(clampedMin)),
        max: String(Math.round(clampedMax)),
      };
    }
  }

  return derivePriceRangeFromFieldset(metadata);
}

function deriveSku(products) {
  const match = products.find((product) => hasValue(product?.sku));
  return match?.sku || '';
}

function deriveDiscount(products) {
  for (const product of products) {
    const regularPrice = parseNumber(product?.prices?.regular_price);
    const salePrice = parseNumber(product?.prices?.sale_price);

    if (!Number.isFinite(regularPrice) || !Number.isFinite(salePrice)) {
      continue;
    }

    if (regularPrice <= 0 || salePrice <= 0 || salePrice >= regularPrice) {
      continue;
    }

    const discount = Math.round(((regularPrice - salePrice) / regularPrice) * 100);
    if (discount > 0) {
      return String(discount);
    }
  }

  return '';
}

function deriveDimensions(products) {
  const match = products.find((product) => {
    return Number.isFinite(parseNumber(product?.dimensions?.height)) &&
      Number.isFinite(parseNumber(product?.dimensions?.length));
  });

  if (!match) {
    return {
      min_height: '',
      max_height: '',
      min_length: '',
      max_length: '',
    };
  }

  const height = parseNumber(match.dimensions.height);
  const length = parseNumber(match.dimensions.length);
  const around = (value) => {
    if (!Number.isFinite(value)) {
      return ['', ''];
    }

    if (Number.isInteger(value) && value >= 2) {
      return [String(value - 1), String(value + 1)];
    }

    if (value > 0) {
      return [
        String(Math.max(0, Number((value * 0.9).toFixed(2)))),
        String(Number((value * 1.1).toFixed(2))),
      ];
    }

    return [String(value), String(value)];
  };

  const [minHeight, maxHeight] = around(height);
  const [minLength, maxLength] = around(length);

  return {
    min_height: minHeight,
    max_height: maxHeight,
    min_length: minLength,
    max_length: maxLength,
  };
}

function isMultiValueChoiceName(name) {
  return /^attribute\[|^custom_meta\[|^custom_taxonomy\[/i.test(String(name || ''));
}

function rankCandidateOptions(options, totalProducts) {
  return [...(options || [])]
    .filter((option) => hasValue(option?.value))
    .sort((left, right) => {
      const leftVisible = left?.wrapperVisible !== false;
      const rightVisible = right?.wrapperVisible !== false;
      if (leftVisible !== rightVisible) {
        return leftVisible ? -1 : 1;
      }

      const leftCount = Number.isFinite(left?.count) ? left.count : null;
      const rightCount = Number.isFinite(right?.count) ? right.count : null;

      const score = (count) => {
        if (!Number.isFinite(count)) {
          return 100000;
        }

        if (count <= 0) {
          return 50000 + Math.abs(count);
        }

        if (Number.isFinite(totalProducts) && totalProducts > 0 && count >= totalProducts) {
          return 25000 + count;
        }

        return count;
      };

      const leftScore = score(leftCount);
      const rightScore = score(rightCount);
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }

      return String(left?.text || left?.value || '').localeCompare(
        String(right?.text || right?.value || '')
      );
    });
}

function pickChoiceOptions(options, chooseCount, totalProducts) {
  const ranked = rankCandidateOptions(options, totalProducts);
  const preferred = ranked.filter((option) => {
    if (!hasValue(option?.value)) {
      return false;
    }

    if (!Number.isFinite(option?.count)) {
      return true;
    }

    if (option.count <= 0) {
      return false;
    }

    if (Number.isFinite(totalProducts) && totalProducts > 0 && option.count >= totalProducts) {
      return false;
    }

    return true;
  });

  const source = preferred.length ? preferred : ranked;
  return source.slice(0, chooseCount);
}

function pickSelectOptionValues(options, chooseCount, totalProducts) {
  const ranked = rankCandidateOptions(
    (options || []).filter((option) => isMeaningfulSelectOption(option)),
    totalProducts
  );
  return ranked.slice(0, chooseCount).map((option) => option.value);
}

function deriveFieldOverrides(metadata, baselineSummary = null) {
  const overrides = {};
  const totalProducts = Number.isFinite(baselineSummary?.productCount)
    ? baselineSummary.productCount
    : null;

  for (const fieldset of metadata) {
    const controls = fieldset.controls.filter((control) => control.name);
    const visibleControls = controls.filter((control) => control.visible);
    const checkboxes = fieldset.checkboxOptions || [];
    const radios = fieldset.radioOptions || [];
    const selectControls = controls.filter((control) => control.tag === 'select');

    const overrideKey = fieldset.key || fieldset.id;
    if (!overrideKey) {
      continue;
    }

    if (['search_text', 'price-range', 'dimensions', 'sku', 'discount', 'date_filter'].includes(fieldset.id)) {
      continue;
    }

    if (checkboxes.length) {
      const firstCheckboxName = controls.find((control) => control.type === 'checkbox')?.name || '';
      const chooseCount = isMultiValueChoiceName(firstCheckboxName)
        ? Math.min(2, checkboxes.length)
        : 1;
      const chosenValues = pickChoiceOptions(
        checkboxes.filter((option) => option.wrapperVisible !== false),
        chooseCount,
        totalProducts
      )
        .map((option) => option.value)
        .filter(Boolean);

      if (chosenValues.length) {
        overrides[overrideKey] = {
          kind: 'checkboxes',
          values: chosenValues,
        };
      }

      continue;
    }

    if (radios.length) {
      const firstRadio = pickChoiceOptions(
        radios.filter((option) => option.wrapperVisible !== false),
        1,
        totalProducts
      )[0] ||
        controls.find((control) => control.type === 'radio');
      if (firstRadio?.value) {
        overrides[overrideKey] = {
          kind: 'radios',
          values: [firstRadio.value],
        };
      }
      continue;
    }

    if (selectControls.length) {
      const select = visibleControls.find((control) => control.tag === 'select') || selectControls[0];
      const values = pickSelectOptionValues(
        select.options || [],
        select.type === 'select-multiple' ? 2 : 1,
        totalProducts
      );

      if (values.length) {
        overrides[overrideKey] = {
          kind: select.type === 'select-multiple' ? 'multi-select' : 'single-select',
          selectName: select.name,
          values,
        };
      }
    }
  }

  return overrides;
}

function deriveActionTargets(metadata) {
  const resetField = metadata.find((field) => (field.checkboxOptions || []).length > 0) || null;
  const collapseField =
    metadata.find((field) => field.hasItemsContainer && field.isCollapsible && (field.choiceOptions || []).length > 0) ||
    metadata.find((field) => field.hasItemsContainer && field.isCollapsible) ||
    null;
  const optionSearchField = metadata.find((field) => {
    return (field.choiceOptions || []).length > 1 &&
      hasSearchableChoiceText(field) &&
      (field.hasTermsSearch || hasValue(field.termsSearchPlaceholder));
  });

  const searchText = optionSearchField
    ? (optionSearchField.choiceOptions || [])
        .map((option) => pickSearchToken(option.text))
        .find((value) => hasValue(value)) || pickSearchToken(optionSearchField.title)
    : '';

  return {
    collapseFieldset: collapseField?.key || collapseField?.id || '',
    collapseFieldsetId: collapseField?.id || '',
    optionSearchFieldset: optionSearchField?.key || optionSearchField?.id || '',
    optionSearchFieldsetId: optionSearchField?.id || '',
    optionSearchPlaceholder: optionSearchField?.termsSearchPlaceholder || '',
    optionSearchText: searchText,
    resetFieldset: resetField?.key || resetField?.id || '',
    resetFieldsetId: resetField?.id || '',
    resetValue: pickChoiceOptions(resetField?.checkboxOptions || [], 1, null)[0]?.value || '',
  };
}

function buildAutoDiscoveryConfig(baseConfig, metadata, storeCatalog, baselineSummary) {
  const products = storeCatalog?.products || [];
  const sampledMetadata = selectRepresentativeFieldsets(
    metadata,
    baseConfig.maxDuplicateFieldsetsPerId
  );

  return {
    siteLabel:
      baseConfig.siteLabel && baseConfig.siteLabel !== 'site'
        ? baseConfig.siteLabel
        : deriveSiteLabel(baseConfig.baseUrl),
    testData: {
      searchText: deriveSearchText(products, baselineSummary),
      priceRange: derivePriceRange(metadata, products),
      sku: deriveSku(products),
      discount: deriveDiscount(products),
      dimensions: deriveDimensions(products),
    },
    fieldOverrides: deriveFieldOverrides(sampledMetadata, baselineSummary),
    actionTargets: deriveActionTargets(metadata),
    autoDiscovery: {
      used: true,
      source: storeCatalog?.ok ? 'dom+woo-store-api' : 'dom-only',
      storeApiEndpoint: storeCatalog?.endpoint || null,
      storeApiOk: Boolean(storeCatalog?.ok),
      storeApiError: storeCatalog?.error || null,
      discoveredProductCount: products.length,
      sampledFieldsetCount: sampledMetadata.length,
      maxDuplicateFieldsetsPerId: baseConfig.maxDuplicateFieldsetsPerId,
    },
  };
}

async function loadInitialConfig(cliArgs) {
  const defaultConfig = buildDefaultConfig();
  let config = defaultConfig;
  let configPath = null;

  if (cliArgs.config) {
    configPath = path.resolve(cliArgs.config);
    const raw = await fs.readFile(configPath, 'utf8');
    const fileConfig = JSON.parse(raw);
    config = mergeConfig(defaultConfig, fileConfig);
  }

  if (cliArgs.url) {
    config.baseUrl = cliArgs.url.trim();
  }

  if (cliArgs.device) {
    config.deviceMode = String(cliArgs.device).trim().toLowerCase();
  }

  if (cliArgs.headed) {
    config.browser.headed = true;
  }

  if (cliArgs.headless) {
    config.browser.headed = false;
  }

  if (!config.baseUrl) {
    throw new Error('Provide either --config or --url.');
  }

  config.baseUrl = config.baseUrl.trim();
  config.configPath = configPath;
  config.runMode = configPath ? 'config' : 'url-auto';
  config.deviceMode = ['desktop', 'mobile'].includes(config.deviceMode) ? config.deviceMode : 'desktop';

  if (!config.siteLabel || config.siteLabel === 'site') {
    config.siteLabel = deriveSiteLabel(config.baseUrl);
  }

  return config;
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function buildMarkdownReport(report) {
  const lines = [];
  const failedActionTests = report.actionTests.filter((test) => !test.passed);
  const failedFilterTests = report.filterTests.filter((test) => !test.passed);

  lines.push(`# QC Report: ${report.siteLabel}`);
  lines.push('');
  lines.push(`- Run mode: ${report.runMode}`);
  lines.push(`- Device: ${report.deviceMode}`);
  lines.push(`- Base URL: ${report.baseUrl}`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push(`- Action tests: ${report.passedActionTests}/${report.totalActionTests} passed`);
  lines.push(`- Filter tests: ${report.passedFilterTests}/${report.totalFilterTests} passed`);
  lines.push(`- Failed tests: ${report.failedCount}`);
  lines.push(`- JSON report: ${report.reportJsonPath}`);
  lines.push(`- Output directory: ${report.outputDir}`);

  if (report.generatedConfigPath) {
    lines.push(`- Generated config: ${report.generatedConfigPath}`);
  }

    if (report.autoDiscovery?.used) {
      lines.push(`- Auto discovery source: ${report.autoDiscovery.source}`);
      lines.push(`- Auto-discovered products: ${report.autoDiscovery.discoveredProductCount}`);
      if (Number.isFinite(report.autoDiscovery.sampledFieldsetCount)) {
        lines.push(`- Sampled fieldsets: ${report.autoDiscovery.sampledFieldsetCount}`);
      }
      if (Number.isFinite(report.autoDiscovery.maxDuplicateFieldsetsPerId)) {
        lines.push(`- Duplicate fieldset cap: ${report.autoDiscovery.maxDuplicateFieldsetsPerId} per DOM id`);
      }
      if (report.autoDiscovery.storeApiError) {
        lines.push(`- Auto discovery API error: ${report.autoDiscovery.storeApiError}`);
      }
    }

  if (report.pluginDebug?.available) {
    lines.push(
      `- Plugin selectors: product=${report.pluginDebug.selectors.product || 'n/a'}, pagination=${report.pluginDebug.selectors.pagination || 'n/a'}, sorting=${report.pluginDebug.selectors.sorting || 'n/a'}, resultCount=${report.pluginDebug.selectors.resultCount || 'n/a'}`
    );
    lines.push(
      `- Plugin features: apply=${report.pluginDebug.applyMode}, url=${report.pluginDebug.urlMode || 'unknown'}, overlay=${report.pluginDebug.advanced.useOverlay === null ? 'n/a' : report.pluginDebug.advanced.useOverlay ? 'on' : 'off'}, ajax pagination=${report.pluginDebug.advanced.paginationViaAjax === null ? 'n/a' : report.pluginDebug.advanced.paginationViaAjax ? 'on' : 'off'}, ajax sorting=${report.pluginDebug.advanced.sortingViaAjax === null ? 'n/a' : report.pluginDebug.advanced.sortingViaAjax ? 'on' : 'off'}`
    );
    lines.push(
      `- Plugin filters: search=${report.pluginDebug.manage.flags.showSearch === null ? 'n/a' : report.pluginDebug.manage.flags.showSearch ? 'on' : 'off'}, categories=${report.pluginDebug.manage.flags.showCategories === null ? 'n/a' : report.pluginDebug.manage.flags.showCategories ? 'on' : 'off'}, attributes=${report.pluginDebug.manage.flags.showAttributes === null ? 'n/a' : report.pluginDebug.manage.flags.showAttributes ? 'on' : 'off'}, tags=${report.pluginDebug.manage.flags.showTags === null ? 'n/a' : report.pluginDebug.manage.flags.showTags ? 'on' : 'off'}, price=${report.pluginDebug.manage.flags.showPriceRange === null ? 'n/a' : report.pluginDebug.manage.flags.showPriceRange ? 'on' : 'off'}, rating=${report.pluginDebug.manage.flags.showRating === null ? 'n/a' : report.pluginDebug.manage.flags.showRating ? 'on' : 'off'}`
    );
    lines.push(`- Plugin mobile: style=${report.pluginDebug.mobileStyle || 'n/a'}, breakpoint=${report.pluginDebug.mobileBreakpoint || 'n/a'}`);
  }

  lines.push('');
  lines.push('## Failing Action Tests');
  lines.push('');

  if (!failedActionTests.length) {
    lines.push('All action tests passed.');
    lines.push('');
  } else {
    for (const test of failedActionTests) {
      lines.push(`### ${test.title} (${test.id})`);
      lines.push('');
      for (const issue of test.issues) {
        lines.push(`- ${issue}`);
      }
      if (test.reason) {
        lines.push(`- ${test.reason}`);
      }
      if (test.messages?.length) {
        for (const message of test.messages.slice(0, 5)) {
          lines.push(`- ${message.type}: ${message.text}`);
        }
      }
      lines.push('');
    }
  }

  lines.push('## Failing Filter Tests');
  lines.push('');

  if (!failedFilterTests.length) {
    lines.push('All filter tests passed.');
    lines.push('');
  } else {
    for (const test of failedFilterTests) {
      lines.push(`### ${test.title} (${test.id})`);
      lines.push('');
      lines.push(`- Kind: ${test.kind}`);
      lines.push(`- URL mode: ${test.urlMode || 'unknown'}`);
      lines.push(`- Apply URL: ${test.applyUrl || 'n/a'}`);
      lines.push(`- Reload URL: ${test.reloadUrl || 'n/a'}`);
      for (const issue of test.issues) {
        lines.push(`- ${issue}`);
      }
      if (test.screenshot) {
        lines.push(`- Screenshot: ${test.screenshot}`);
      }
      if (test.messages?.length) {
        for (const message of test.messages.slice(0, 5)) {
          lines.push(`- ${message.type}: ${message.text}`);
        }
      }
      lines.push('');
    }
  }

  if (report.uniqueMessages.length) {
    lines.push('## Unique Browser Messages');
    lines.push('');
    for (const message of report.uniqueMessages.slice(0, 20)) {
      lines.push(`- ${message.type}: ${message.text}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeCssIdentifier(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char}`);
}

function groupSelector(formSelector, groupId) {
  return `${formSelector} .plugincy-filter-group#${escapeCssIdentifier(groupId)}`;
}

function buildProductTitleSelector(productSelector) {
  if (!hasValue(productSelector)) {
    return 'ul.products li.product h2';
  }

  return [
    `${productSelector} li.product .woocommerce-loop-product__title`,
    `${productSelector} li.product h2`,
    `${productSelector} .product h2`,
    `${productSelector} h2`,
  ].join(', ');
}

function normalizeComparableUrl(rawUrl, options = {}) {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    parsed.searchParams.delete('plugincydebug');

    const filtersQueryKeys = buildSelectorPool(options.filtersQueryKey, 'filters');
    const orderbyKeys = buildSelectorPool(options.orderbyQueryKey, 'orderby');
    const paginationKeys = buildSelectorPool(options.paginationQueryKey, 'paged', 'page');
    const defaultOrderby = hasValue(options.defaultOrderby) ? String(options.defaultOrderby) : null;

    for (const [key, value] of Array.from(parsed.searchParams.entries())) {
      if (!hasValue(value)) {
        parsed.searchParams.delete(key);
      }
    }

    if (options.stripDefaultFilterFlag) {
      for (const key of filtersQueryKeys) {
        if (parsed.searchParams.get(key) === '1') {
          parsed.searchParams.delete(key);
        }
      }
    }

    if (options.stripFirstPage) {
      for (const key of paginationKeys) {
        if (parsed.searchParams.get(key) === '1') {
          parsed.searchParams.delete(key);
        }
      }
    }

    if (defaultOrderby) {
      for (const key of orderbyKeys) {
        if (parsed.searchParams.get(key) === defaultOrderby) {
          parsed.searchParams.delete(key);
        }
      }
    }

    const sorted = new URLSearchParams();
    for (const [key, value] of Array.from(parsed.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      return `${leftKey}=${leftValue}`.localeCompare(`${rightKey}=${rightValue}`);
    })) {
      sorted.append(key, value);
    }
    const search = sorted.toString();
    const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${normalizedPath}${search ? `?${search}` : ''}`;
  } catch {
    return String(rawUrl || '').trim();
  }
}

function urlsEqual(left, right, options = {}) {
  return normalizeComparableUrl(left, options) === normalizeComparableUrl(right, options);
}

function withDebugQuery(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.searchParams.set('plugincydebug', 'true');
  return parsed.toString();
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

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));
  let config = await loadInitialConfig(cliArgs);
  const devicePreset = resolveDevicePreset(config.deviceMode);
  config.deviceMode = devicePreset.name;
  config.browser.viewport = {
    ...config.browser.viewport,
    ...devicePreset.viewport,
  };

  const runId = timestamp();
  const outputBaseDir = config.configPath
    ? path.resolve(path.dirname(config.configPath), '..', config.outputDir)
    : path.resolve(process.cwd(), config.outputDir);
  const outputDir = path.join(
    outputBaseDir,
    `${sanitizeId(config.siteLabel)}-${sanitizeId(config.deviceMode)}-${runId}`
  );
  const progress = createProgressLogger();

  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({
    channel: config.browser.channel || 'chrome',
    headless: !config.browser.headed,
    slowMo: config.browser.slowMoMs || 0,
  });

  const context = await browser.newContext({
    viewport: config.browser.viewport,
    isMobile: Boolean(devicePreset.isMobile),
    hasTouch: Boolean(devicePreset.hasTouch),
    deviceScaleFactor: devicePreset.deviceScaleFactor || 1,
  });

  const page = await context.newPage();
  const noisePatterns = config.noisePatterns.map((pattern) => new RegExp(pattern, 'i'));
  const trackedOrigin = new URL(config.baseUrl).origin;
  const externalNoiseHostPatterns = [
    /google-analytics\.com$/i,
    /googletagmanager\.com$/i,
    /googlesyndication\.com$/i,
    /doubleclick\.net$/i,
    /facebook\.com$/i,
    /facebook\.net$/i,
    /clarity\.ms$/i,
    /hotjar\.com$/i,
    /cookiebot\.com$/i,
    /cookielaw\.org$/i,
  ];
  const globalMessages = [];
  const networkActivity = [];
  const pluginDebugRaw = {
    manage: null,
    style: null,
    seo: null,
    advanced: null,
    runtime: null,
  };

  const pushMessage = (type, text) => {
    const message = String(text || '').trim();
    if (!message) return;
    globalMessages.push({ type, text: message });
  };

  const isSameOriginUrl = (rawUrl) => {
    try {
      return new URL(rawUrl).origin === trackedOrigin;
    } catch {
      return false;
    }
  };

  const isExternalNoiseUrl = (rawUrl) => {
    try {
      const hostname = new URL(rawUrl).hostname;
      return externalNoiseHostPatterns.some((pattern) => pattern.test(hostname));
    } catch {
      return false;
    }
  };

  const isTrackedRequest = (request) => {
    const resourceType = request.resourceType();
    if (!['document', 'xhr', 'fetch'].includes(resourceType)) {
      return false;
    }

    const url = request.url();
    if (!isSameOriginUrl(url)) {
      return false;
    }

    return true;
  };

  const markNetworkActivity = () => networkActivity.length;
  const getNetworkActivitySince = (cursor) => networkActivity.slice(cursor);

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      const text = msg.text();
      if (/^Failed to load resource:/i.test(text)) {
        return;
      }
      pushMessage(`console:${type}`, text);
    }
  });

  page.on('pageerror', (error) => {
    pushMessage('pageerror', error?.stack || error?.message || String(error));
  });

  page.on('requestfailed', (request) => {
    if (!isTrackedRequest(request) || isExternalNoiseUrl(request.url())) {
      return;
    }

    const failure = request.failure();
    const errorText = failure ? failure.errorText : 'unknown';
    if (/ERR_ABORTED/i.test(errorText)) {
      return;
    }

    networkActivity.push({
      kind: 'requestfailed',
      method: request.method(),
      resourceType: request.resourceType(),
      status: null,
      url: request.url(),
      errorText,
      timestamp: Date.now(),
    });
    pushMessage(
      'requestfailed',
      `${request.method()} ${request.url()} :: ${errorText}`
    );
  });

  page.on('response', (response) => {
    const request = response.request();
    if (!isTrackedRequest(request) || isExternalNoiseUrl(request.url())) {
      return;
    }

    networkActivity.push({
      kind: 'response',
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
      url: response.url(),
      timestamp: Date.now(),
    });

    if (response.status() >= 400) {
      pushMessage(
        'response:error',
        `${request.method()} ${response.url()} :: HTTP ${response.status()}`
      );
    }
  });

  const delay = (ms) => page.waitForTimeout(ms);
  const reportJsonPath = path.join(outputDir, 'report.json');
  const reportMarkdownPath = path.join(outputDir, 'report.md');
  const generatedConfigPath = path.join(outputDir, 'generated-config.json');

  const summarizePluginDebug = () => {
    const advanced = pluginDebugRaw.advanced || {};
    const style = pluginDebugRaw.style || {};
    const manage = pluginDebugRaw.manage || {};
    const runtime = pluginDebugRaw.runtime || {};
    const formDataset = runtime.formDataset || {};
    const localized = runtime.localized || {};

    const applyMode =
      style.apply_behavior &&
      style.show_apply_button &&
      style.show_apply_reset_on &&
      style.show_apply_reset_on.reset_btn !== 'separate' &&
      style.apply_behavior.reset_btn === 'only_apply' &&
      style.show_apply_button.reset_btn === 'yes'
        ? 'explicit'
        : 'auto';

    return {
      available: Boolean(
        pluginDebugRaw.advanced ||
        pluginDebugRaw.style ||
        Object.keys(formDataset).length ||
        Object.keys(localized).length
      ),
      applyMode,
      urlMode: normalizeUrlMode(manage.use_url_filter),
      useOverlay: String(advanced.use_overlay || '').toLowerCase() === 'on',
      mobileBreakpoint: parseNumber(
        advanced.mobile_breakpoint ||
          formDataset.mobileBreakpoint ||
          localized.mobile_breakpoint ||
          runtime.mobileBreakpoint
      ),
      mobileStyle: formDataset.mobileStyle || null,
      queryKeys: {
        filters: localized.filters_word_in_permalinks || 'filters',
        orderby: localized.orderby_query_key || 'orderby',
        pagination: localized.pagination_query_key || 'paged',
      },
      selectors: {
        product: advanced.product_selector || formDataset.product_selector || null,
        pagination: advanced.pagination_selector || formDataset.pagination_selector || null,
        sorting: advanced.sorting_selector || null,
        resultCount: advanced.result_count_selector || null,
      },
      advanced: {
        useOverlay: normalizeToggle(advanced.use_overlay),
        paginationViaAjax: normalizeToggle(advanced.pagination_via_ajax),
        sortingViaAjax: normalizeToggle(advanced.sorting_via_ajax),
        browserHistoryStepNavigation: normalizeToggle(advanced.browser_history_step_navigation),
        smartAutoScroll: normalizeToggle(advanced.smart_auto_scroll),
        waitCursorOnFiltering: normalizeToggle(advanced.wait_cursor_on_filtering),
        sidebarOnTop: normalizeToggle(advanced.sidebar_on_top),
      },
      style: {
        showApplyButton: style.show_apply_button?.reset_btn || null,
        showResetButton: style.show_reset_button?.reset_btn || null,
        showApplyResetOn: style.show_apply_reset_on?.reset_btn || null,
        applyBehavior: style.apply_behavior?.reset_btn || null,
      },
      manage: {
        useUrlFilter: manage.use_url_filter || null,
        showLoader: manage.show_loader || null,
        useCustomTemplate: normalizeToggle(manage.use_custom_template),
        flags: {
          showSearch: normalizeToggle(manage.show_search),
          showCategories: normalizeToggle(manage.show_categories),
          showAttributes: normalizeToggle(manage.show_attributes),
          showTags: normalizeToggle(manage.show_tags),
          showPriceRange: normalizeToggle(manage.show_price_range),
          showRating: normalizeToggle(manage.show_rating),
          showBrand: normalizeToggle(manage.show_brand),
          showAuthor: normalizeToggle(manage.show_author),
          showStatus: normalizeToggle(manage.show_status),
          showOnsale: normalizeToggle(manage.show_onsale),
          showFeatured: normalizeToggle(manage.show_featured),
          showDimension: normalizeToggle(manage.show_dimension),
          showSku: normalizeToggle(manage.show_sku),
          showDiscount: normalizeToggle(manage.show_discount),
          showDateFilter: normalizeToggle(manage.show_date_filter),
          showCustomFields: normalizeToggle(manage.show_custom_fields),
          showCustomTaxonomies: normalizeToggle(manage.show_custom_taxonomies),
        },
      },
    };
  };

  const applyPluginRuntimeOverrides = (pluginDebug) => {
    if (!pluginDebug?.available) {
      return;
    }

    if (hasValue(pluginDebug.selectors.resultCount)) {
      config.selectors.resultCount = pluginDebug.selectors.resultCount;
    }

    if (hasValue(pluginDebug.selectors.product)) {
      config.selectors.productTitles = buildProductTitleSelector(pluginDebug.selectors.product);
    }
  };

  const buildSemanticUrlCompareOptions = (pluginDebug, overrides = {}) => {
    return {
      filtersQueryKey: pluginDebug?.queryKeys?.filters || 'filters',
      orderbyQueryKey: pluginDebug?.queryKeys?.orderby || 'orderby',
      paginationQueryKey: pluginDebug?.queryKeys?.pagination || 'paged',
      stripDefaultFilterFlag: true,
      stripFirstPage: true,
      ...overrides,
    };
  };

  const buildSortingSelectorPool = (pluginDebug) =>
    buildSelectorPool(
      pluginDebug?.selectors?.sorting,
      config.selectors.sorting,
      'form.woocommerce-ordering select.orderby',
      'form.woocommerce-ordering select',
      '.woocommerce-ordering select.orderby',
      '.woocommerce-ordering select',
      'select.orderby'
    );

  const buildPaginationSelectorPool = (pluginDebug) =>
    buildSelectorPool(
      pluginDebug?.selectors?.pagination,
      config.selectors.pagination,
      '.woocommerce-pagination',
      'nav.woocommerce-pagination',
      '.plugincy-filter-pagination',
      'ul.page-numbers'
    );

  async function dismissConsent() {
    for (const label of config.consentButtonNames) {
      try {
        const button = page
          .getByRole('button', { name: new RegExp(`^${escapeRegex(label)}$`, 'i') })
          .first();
        if (await button.isVisible({ timeout: 400 })) {
          await button.click({ force: true });
          await delay(500);
          return;
        }
      } catch {
        // Ignore absent consent buttons.
      }
    }
  }

  async function waitForAjaxSettled(previousUrl = page.url()) {
    await Promise.allSettled([
      page.waitForURL((url) => !urlsEqual(url.toString(), previousUrl), { timeout: 8000 }),
      page.waitForLoadState('networkidle', { timeout: 8000 }),
      page.waitForFunction(
        () => {
          const busyNodes = document.querySelectorAll(
            '#roverlay.is-visible, #loader.is-visible, [aria-busy="true"]'
          );
          const jqueryIdle = !(window.jQuery && typeof window.jQuery.active === 'number' && window.jQuery.active > 0);
          return jqueryIdle && busyNodes.length === 0;
        },
        undefined,
        { timeout: 15000 }
      ),
    ]);

    await delay(1200);
    await dismissConsent();
    await delay(200);
  }

  async function readRuntimeDetails() {
    return page.evaluate((formSelector) => {
      const form = document.querySelector(formSelector);
      const localized =
        typeof window.dapfforwcpro_data === 'object' && window.dapfforwcpro_data
          ? {
              mobile_breakpoint: window.dapfforwcpro_data.mobile_breakpoint || null,
              filters_word_in_permalinks: window.dapfforwcpro_data.filters_word_in_permalinks || null,
              orderby_query_key:
                window.dapfforwcpro_data.dapfforwc_seo_permalinks_options?.dapfforwc_permalinks_prefix_options?.orderby || null,
              pagination_query_key:
                window.dapfforwcpro_data.dapfforwc_seo_permalinks_options?.dapfforwc_permalinks_prefix_options?.pagination || null,
            }
          : {};

      return {
        formDataset: form ? { ...form.dataset } : {},
        localized,
        mobileBreakpoint:
          typeof window.__dapfforwcpro_mobile_bp !== 'undefined'
            ? window.__dapfforwcpro_mobile_bp
            : null,
      };
    }, config.selectors.form);
  }

  async function openShortcodeCollapsibleIfNeeded() {
    const toggle = page.locator('.dapfforwcpro-shortcode-collapsable-toggle:visible').first();
    if (!(await toggle.count())) {
      return false;
    }

    const formVisible = await page.locator(config.selectors.form).isVisible().catch(() => false);
    const expanded = (await toggle.getAttribute('aria-expanded').catch(() => null)) || 'false';
    if (formVisible || expanded === 'true') {
      return false;
    }

    await toggle.click({ force: true });
    await delay(500);
    return true;
  }

  async function openOverlayIfNeeded() {
    const needsOpen = await page.evaluate((formSelector) => {
      const form = document.querySelector(formSelector);
      if (!form) return true;
      const style = window.getComputedStyle(form);
      const groups = form.querySelectorAll('.plugincy-filter-group');
      const visible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        (form.offsetWidth > 0 || form.offsetHeight > 0);
      return !visible || groups.length === 0;
    }, config.selectors.form);

    if (!needsOpen) {
      return false;
    }

    const candidates = [
      page.locator('.dapfforwcpro-overlay-button:visible').first(),
      page.locator('[id^="dapfforwcpro-overlay-"][id$="-button"]:visible').first(),
      page.getByRole('button', { name: /open filters|show filters|filters/i }).first(),
    ];

    for (const candidate of candidates) {
      try {
        if ((await candidate.count()) && (await candidate.isVisible({ timeout: 500 }))) {
          await candidate.click({ force: true });
          await delay(700);
          return true;
        }
      } catch {
        // Ignore and continue.
      }
    }

    return false;
  }

  async function ensureFilterUiReady() {
    await page.locator(config.selectors.form).waitFor({ state: 'attached', timeout: 20000 });
    await dismissConsent();
    await openShortcodeCollapsibleIfNeeded();
    await openOverlayIfNeeded();
    await page.waitForFunction(
      (formSelector) => {
        const form = document.querySelector(formSelector);
        if (!form) return false;
        return (
          form.querySelectorAll('.plugincy-filter-group').length > 0 ||
          Boolean(form.querySelector('input, select, textarea'))
        );
      },
      config.selectors.form,
      { timeout: 15000 }
    );
    await waitForAjaxSettled();
  }

  async function inspectPluginSettings() {
    const debugUrl = withDebugQuery(config.baseUrl);
    progress.info(`Inspecting plugin debug settings: ${debugUrl}`);

    const debugListener = async (msg) => {
      if (msg.type() !== 'log') {
        return;
      }

      const args = msg.args();
      if (!args.length) {
        return;
      }

      let label = '';
      try {
        label = await args[0].jsonValue();
      } catch {
        label = msg.text();
      }

      if (typeof label !== 'string') {
        return;
      }

      let payload = null;
      if (args[1]) {
        try {
          payload = await args[1].jsonValue();
        } catch {
          payload = null;
        }
      }

      if (/^Form Manage Settings/i.test(label)) {
        pluginDebugRaw.manage = payload;
      } else if (/^Form Style Settings/i.test(label)) {
        pluginDebugRaw.style = payload;
      } else if (/^SEO setup Settings/i.test(label)) {
        pluginDebugRaw.seo = payload;
      } else if (/^Advanced Settings/i.test(label)) {
        pluginDebugRaw.advanced = payload;
      }
    };

    page.on('console', debugListener);
    try {
      await page.goto(debugUrl, { waitUntil: 'domcontentloaded' });
      await ensureFilterUiReady();
      pluginDebugRaw.runtime = await readRuntimeDetails();
      await delay(1200);
    } finally {
      page.off('console', debugListener);
    }
  }

  async function navigateTo(url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await ensureFilterUiReady();
  }

  async function navigateToBase() {
    await navigateTo(config.baseUrl);
  }

  async function captureResultSummary() {
    return page.evaluate((selectors) => {
      const safeText = (selector) => {
        if (!selector) return null;
        try {
          return document.querySelector(selector)?.textContent?.trim() || null;
        } catch {
          return null;
        }
      };

      const safeTexts = (selector) => {
        if (!selector) return [];
        try {
          return Array.from(document.querySelectorAll(selector))
            .slice(0, 5)
            .map((node) => node.textContent.trim())
            .filter(Boolean);
        } catch {
          return [];
        }
      };

      const safeCount = (selector) => {
        if (!selector) return 0;
        try {
          return document.querySelectorAll(selector).length;
        } catch {
          return 0;
        }
      };

      return {
        resultCount: safeText(selectors.resultCount),
        emptyMessage: safeText(selectors.emptyMessage),
        titles: safeTexts(selectors.productTitles),
        productCount: safeCount(selectors.productTitles),
      };
    }, config.selectors);
  }

  async function getMetadata() {
    const metadata = await page.evaluate((formSelector) => {
      const form = document.querySelector(formSelector);
      if (!form) return [];

      const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const extractOptionCount = (value) => {
        const match = String(value || '').match(/\((\d[\d,.\s]*)\)\s*$/);
        if (!match) {
          return null;
        }

        const parsed = Number(String(match[1]).replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
      };
      const isVisible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (element.offsetWidth > 0 || element.offsetHeight > 0)
        );
      };
      const extractOptionText = (input) => {
        if (input.labels?.length) {
          const labelText = normalizeText(input.labels[0].textContent);
          if (labelText) {
            return labelText;
          }
        }

        const candidates = [
          input.closest('label'),
          input.closest('a'),
          input.closest('li'),
          input.closest('.filterout-node'),
          input.closest('.dapfforwcpro-category-row'),
          input.parentElement,
          input.parentElement?.parentElement,
        ];

        for (const candidate of candidates) {
          const text = normalizeText(candidate?.textContent);
          if (text) {
            return text;
          }
        }

        return input.value || input.id || '';
      };

      return Array.from(form.querySelectorAll('.plugincy-filter-group')).map((group) => {
        const controls = Array.from(group.querySelectorAll('input, select, textarea')).map(
          (element) => {
            const base = {
              tag: element.tagName.toLowerCase(),
              type: element.type || null,
              name: element.name || null,
              id: element.id || null,
              placeholder: element.placeholder || null,
              value: element.value ?? null,
              visible: isVisible(element),
            };

            if (element.tagName === 'SELECT') {
              base.options = Array.from(element.options).map((option) => ({
                value: option.value,
                text: normalizeText(option.textContent),
                count: extractOptionCount(option.textContent),
                selected: option.selected,
              }));
            }

            return base;
          }
        );

        const choiceOptions = Array.from(
          group.querySelectorAll('input[type="checkbox"][name], input[type="radio"][name]')
        ).map((input) => ({
          wrapperVisible: isVisible(
            input.closest('label') ||
            input.closest('a') ||
            input.closest('li') ||
            input.closest('.filterout-node') ||
            input.closest('.dapfforwcpro-category-row') ||
            input.parentElement ||
            input
          ),
          id: input.id || null,
          name: input.name || null,
          value: input.value || null,
          text: extractOptionText(input),
          count: extractOptionCount(extractOptionText(input)),
          type: input.type || 'checkbox',
        }));

        const titleElement =
          group.querySelector('legend > span:not(.screen-reader-text)') ||
          group.querySelector('legend .screen-reader-text') ||
          group.querySelector('.plugincy_title > span') ||
          group.querySelector('.plugincy_title');
        const titleBar = group.querySelector('legend, .plugincy_title');
        const searchInput =
          group.querySelector('input.search-terms') ||
          group.querySelector('input[type="search"]:not([name])') ||
          group.querySelector('input[type="text"]:not([name])');
        const titleClass = titleBar?.className || '';

        return {
          id: group.id || null,
          title: normalizeText(titleElement?.textContent) || normalizeText(group.id) || null,
          controls,
          choiceOptions,
          checkboxOptions: choiceOptions.filter((option) => option.type === 'checkbox'),
          radioOptions: choiceOptions.filter((option) => option.type === 'radio'),
          hasVisibleControl: controls.some((control) => control.visible),
          hasVisibleChoiceOption: choiceOptions.some((option) => option.wrapperVisible),
          hasItemsContainer: Boolean(group.querySelector('.items')),
          hasTermsSearch: Boolean(searchInput || group.querySelector('.search_terms')),
          termsSearchPlaceholder: searchInput?.placeholder || null,
          isCollapsible:
            /plugincy_collapsable_(arrow|minimize_initial)/.test(titleClass) ||
            Boolean(titleBar?.querySelector('.collaps')),
          rootTag: group.tagName.toLowerCase(),
        };
      });
    }, config.selectors.form);

    return metadata.map((fieldset, domIndex) => ({
      ...fieldset,
      domIndex,
      key: buildFieldKey(fieldset.id, fieldset.title, domIndex),
    }));
  }

  async function fetchStoreCatalog() {
    return page.evaluate(async () => {
      const endpoint = new URL('/wp-json/wc/store/v1/products?per_page=50', window.location.origin);

      try {
        const response = await fetch(endpoint.toString(), {
          credentials: 'same-origin',
        });

        if (!response.ok) {
          return {
            ok: false,
            endpoint: endpoint.toString(),
            error: `HTTP ${response.status}`,
            products: [],
          };
        }

        const payload = await response.json();
        return {
          ok: Array.isArray(payload),
          endpoint: endpoint.toString(),
          error: Array.isArray(payload) ? null : 'Unexpected response shape',
          products: Array.isArray(payload) ? payload : [],
        };
      } catch (error) {
        return {
          ok: false,
          endpoint: endpoint.toString(),
          error: error?.message || String(error),
          products: [],
        };
      }
    });
  }

  async function expandGroupsForDiscovery() {
    await page.evaluate((formSelector) => {
      const groups = Array.from(document.querySelectorAll(`${formSelector} .plugincy-filter-group`));

      for (const group of groups) {
        const title = group.querySelector('legend, .plugincy_title');
        const items = Array.from(group.children).filter((node) => {
          return !(node.matches && node.matches('legend, .plugincy_title'));
        });

        if (!title || !items.length) {
          continue;
        }

        const collapsed = items.every((item) => item.classList.contains('dapfforwcpro-hidden-important'));
        if (!collapsed) {
          continue;
        }

        const toggle = title.matches('.plugincy_collapsable_arrow')
          ? title.querySelector('.collaps') || title
          : title;
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    }, config.selectors.form);

    await delay(500);
  }

  function attributeSelector(name) {
    return `[name="${String(name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  }

  function attributeValueSelector(attribute, value) {
    return `[${attribute}="${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  }

  async function supportsFilterApi() {
    return page.evaluate(() => {
      return Boolean(
        window.dapfforwcpro_FILTER_API &&
          typeof window.dapfforwcpro_FILTER_API.refresh === 'function'
      );
    });
  }

  async function invokeFilterApiRefresh() {
    return page.evaluate(() => {
      if (
        !window.dapfforwcpro_FILTER_API ||
        typeof window.dapfforwcpro_FILTER_API.refresh !== 'function'
      ) {
        return false;
      }

      window.dapfforwcpro_FILTER_API.refresh();
      return true;
    });
  }

  function createGroupRef(fieldset) {
    return {
      key: fieldset?.key || null,
      id: fieldset?.id || null,
      domIndex: Number.isInteger(fieldset?.domIndex) ? fieldset.domIndex : null,
      title: fieldset?.title || null,
    };
  }

  function resolveGroupRef(groupRef) {
    if (!groupRef || typeof groupRef !== 'object') {
      return {
        key: null,
        id: hasValue(groupRef) ? String(groupRef) : null,
        domIndex: null,
        title: null,
      };
    }

    return {
      key: hasValue(groupRef.key) ? String(groupRef.key) : null,
      id: hasValue(groupRef.id || groupRef.fieldId) ? String(groupRef.id || groupRef.fieldId) : null,
      domIndex: Number.isInteger(groupRef.domIndex) ? groupRef.domIndex : null,
      title: hasValue(groupRef.title) ? String(groupRef.title) : null,
    };
  }

  function groupLocator(groupRef) {
    const ref = resolveGroupRef(groupRef);

    if (hasValue(ref.id)) {
      const groupsById = page.locator(groupSelector(config.selectors.form, ref.id));
      if (hasValue(ref.title) && sanitizeId(ref.title) !== sanitizeId(ref.id)) {
        return groupsById
          .filter({
            has: page.locator('legend, .plugincy_title').filter({ hasText: ref.title }),
          })
          .first();
      }

      return groupsById.first();
    }

    const groups = page.locator(`${config.selectors.form} .plugincy-filter-group`);
    if (Number.isInteger(ref.domIndex) && ref.domIndex >= 0) {
      return groups.nth(ref.domIndex);
    }

    return groups.first();
  }

  async function captureFormControlState() {
    return page.evaluate((formSelector) => {
      const form = document.querySelector(formSelector);
      if (!form) {
        return {};
      }

      const state = {};
      const fields = Array.from(form.querySelectorAll('input[name], select[name], textarea[name]'));

      for (const field of fields) {
        const name = String(field.getAttribute('name') || '').trim();
        if (!name) {
          continue;
        }

        const tagName = String(field.tagName || '').toLowerCase();
        const type = String(field.type || '').toLowerCase();

        if (type === 'checkbox') {
          if (!Array.isArray(state[name])) {
            state[name] = [];
          }
          if (field.checked) {
            state[name].push(String(field.value ?? ''));
          }
          continue;
        }

        if (type === 'radio') {
          if (!(name in state)) {
            state[name] = null;
          }
          if (field.checked) {
            state[name] = String(field.value ?? '');
          }
          continue;
        }

        if (tagName === 'select' && field.multiple) {
          state[name] = Array.from(field.selectedOptions).map((option) => String(option.value ?? ''));
          continue;
        }

        state[name] = String(field.value ?? '');
      }

      for (const key of Object.keys(state)) {
        if (Array.isArray(state[key])) {
          state[key] = [...state[key]].sort();
        }
      }

      return state;
    }, config.selectors.form);
  }

  async function readSortingState(pluginDebug) {
    const selectorPool = buildSortingSelectorPool(pluginDebug);
    return page.evaluate((selectors) => {
      const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const isVisible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (element.offsetWidth > 0 || element.offsetHeight > 0)
        );
      };

      const resolveSelect = (node) => {
        if (!node) return null;
        if (String(node.tagName || '').toLowerCase() === 'select') {
          return node;
        }
        return node.querySelector('select');
      };

      for (const selector of selectors) {
        try {
          const nodes = Array.from(document.querySelectorAll(selector));
          for (const node of nodes) {
            const select = resolveSelect(node);
            if (!select || !isVisible(select)) {
              continue;
            }

            return {
              selector,
              name: select.name || null,
              value: String(select.value ?? ''),
              selectedText: normalizeText(select.selectedOptions?.[0]?.textContent || ''),
              options: Array.from(select.options || []).map((option) => ({
                value: String(option.value ?? ''),
                text: normalizeText(option.textContent || option.label || ''),
                disabled: Boolean(option.disabled),
              })),
            };
          }
        } catch {
          // Ignore invalid selectors and continue.
        }
      }

      return null;
    }, selectorPool);
  }

  async function changeSortingValue(pluginDebug, nextValue) {
    const selectorPool = buildSortingSelectorPool(pluginDebug);
    return page.evaluate(
      ({ selectors, value }) => {
        const isVisible = (element) => {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            (element.offsetWidth > 0 || element.offsetHeight > 0)
          );
        };

        const resolveSelect = (node) => {
          if (!node) return null;
          if (String(node.tagName || '').toLowerCase() === 'select') {
            return node;
          }
          return node.querySelector('select');
        };

        for (const selector of selectors) {
          try {
            const nodes = Array.from(document.querySelectorAll(selector));
            for (const node of nodes) {
              const select = resolveSelect(node);
              if (!select || !isVisible(select)) {
                continue;
              }

              const option = Array.from(select.options || []).find(
                (candidate) => String(candidate.value ?? '') === String(value)
              );
              if (!option) {
                continue;
              }

              select.value = String(value);
              select.dispatchEvent(new Event('input', { bubbles: true }));
              select.dispatchEvent(new Event('change', { bubbles: true }));

              return {
                selector,
                name: select.name || null,
                value: String(select.value ?? ''),
              };
            }
          } catch {
            // Ignore invalid selectors and continue.
          }
        }

        return null;
      },
      {
        selectors: selectorPool,
        value: String(nextValue ?? ''),
      }
    );
  }

  async function readPaginationState(pluginDebug) {
    const selectorPool = buildPaginationSelectorPool(pluginDebug);
    return page.evaluate((selectors) => {
      const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const isVisible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (element.offsetWidth > 0 || element.offsetHeight > 0)
        );
      };

      const extractPageNumber = (value) => {
        const match = normalizeText(value).match(/\d+/);
        return match ? Number(match[0]) : null;
      };

      const visited = new Set();

      for (const selector of selectors) {
        try {
          const wrappers = Array.from(document.querySelectorAll(selector));
          for (const wrapper of wrappers) {
            if (!wrapper || visited.has(wrapper) || !isVisible(wrapper)) {
              continue;
            }

            visited.add(wrapper);
            const currentNode =
              wrapper.querySelector('[aria-current="page"]') ||
              wrapper.querySelector('.page-numbers.current') ||
              wrapper.querySelector('.current');
            const currentLabel = normalizeText(currentNode?.textContent || '');
            const currentPage = extractPageNumber(currentLabel);
            const targets = Array.from(
              wrapper.querySelectorAll('a[href], button, [role="button"], [data-page], [data-target-page], [data-pagination]')
            )
              .filter(isVisible)
              .map((element) => {
                const label = normalizeText(element.textContent || element.getAttribute('aria-label') || '');
                const datasetPage =
                  element.getAttribute('data-page') ||
                  element.getAttribute('data-target-page') ||
                  element.getAttribute('data-pagination') ||
                  '';
                return {
                  label,
                  page: extractPageNumber(datasetPage || label),
                  href: element.getAttribute('href') || null,
                  rel: element.getAttribute('rel') || null,
                  className: String(element.className || ''),
                };
              });

            return {
              selector,
              currentPage,
              currentLabel,
              targets,
            };
          }
        } catch {
          // Ignore invalid selectors and continue.
        }
      }

      return null;
    }, selectorPool);
  }

  async function clickPaginationTarget(pluginDebug, preferredPage = 2) {
    const selectorPool = buildPaginationSelectorPool(pluginDebug);
    return page.evaluate(
      ({ selectors, preferred }) => {
        const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            (element.offsetWidth > 0 || element.offsetHeight > 0)
          );
        };

        const extractPageNumber = (value) => {
          const match = normalizeText(value).match(/\d+/);
          return match ? Number(match[0]) : null;
        };

        const visited = new Set();

        for (const selector of selectors) {
          try {
            const wrappers = Array.from(document.querySelectorAll(selector));
            for (const wrapper of wrappers) {
              if (!wrapper || visited.has(wrapper) || !isVisible(wrapper)) {
                continue;
              }

              visited.add(wrapper);
              const currentNode =
                wrapper.querySelector('[aria-current="page"]') ||
                wrapper.querySelector('.page-numbers.current') ||
                wrapper.querySelector('.current');
              const currentPage = extractPageNumber(currentNode?.textContent || '');
              const elements = Array.from(
                wrapper.querySelectorAll('a[href], button, [role="button"], [data-page], [data-target-page], [data-pagination]')
              ).filter(isVisible);

              const mapped = elements.map((element) => ({
                element,
                label: normalizeText(element.textContent || element.getAttribute('aria-label') || ''),
                page: extractPageNumber(
                  element.getAttribute('data-page') ||
                    element.getAttribute('data-target-page') ||
                    element.getAttribute('data-pagination') ||
                    element.textContent ||
                    element.getAttribute('aria-label') ||
                    ''
                ),
                href: element.getAttribute('href') || null,
                rel: element.getAttribute('rel') || null,
                className: String(element.className || ''),
              }));

              let target = mapped.find(
                (candidate) => Number.isFinite(candidate.page) && candidate.page === preferred && candidate.page !== currentPage
              );

              if (!target) {
                target = mapped.find((candidate) => {
                  return (
                    /(^|\s)next(\s|$)/i.test(candidate.className) ||
                    /(^|\s)next(\s|$)/i.test(candidate.rel || '') ||
                    /^next$/i.test(candidate.label) ||
                    /^next page$/i.test(candidate.label)
                  );
                });
              }

              if (!target) {
                target = mapped.find(
                  (candidate) => Number.isFinite(candidate.page) && candidate.page !== currentPage
                );
              }

              if (!target) {
                continue;
              }

              target.element.scrollIntoView({ block: 'center', inline: 'nearest' });
              target.element.click();

              return {
                selector,
                currentPage,
                targetPage: Number.isFinite(target.page) ? target.page : null,
                targetLabel: target.label || null,
                href: target.href || null,
              };
            }
          } catch {
            // Ignore invalid selectors and continue.
          }
        }

        return null;
      },
      {
        selectors: selectorPool,
        preferred: Number(preferredPage) || 2,
      }
    );
  }

  async function readCollapseState(groupRef) {
    const locator = groupLocator(groupRef);
    if (!(await locator.count())) {
      return null;
    }

    return locator.evaluate((group) => {
      const items = Array.from(group.children).filter((node) => {
        return !(node.matches && node.matches('legend, .plugincy_title'));
      });

      if (!items.length) {
        return null;
      }

      const hidden = items.every((item) => item.classList.contains('dapfforwcpro-hidden-important'));
      const visible = items.some((item) => {
        const style = window.getComputedStyle(item);
        return (
          !item.classList.contains('dapfforwcpro-hidden-important') &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (item.offsetWidth > 0 || item.offsetHeight > 0)
        );
      });

      return {
        collapsed: hidden || !visible || items.every((item) => window.getComputedStyle(item).display === 'none'),
        visible,
        displays: items.map((item) => window.getComputedStyle(item).display),
        hiddenClassCount: items.filter((item) => item.classList.contains('dapfforwcpro-hidden-important')).length,
      };
    });
  }

  async function clickGroupToggle(groupRef) {
    const group = groupLocator(groupRef);
    if (!(await group.count())) {
      return false;
    }

    const collapseToggle = group.locator('.plugincy_title .collaps, legend .collaps').first();
    if ((await collapseToggle.count()) && (await collapseToggle.isVisible().catch(() => false))) {
      await collapseToggle.click({ force: true }).catch(() => {});
      return true;
    }

    const title = group.locator('legend, .plugincy_title').first();
    if ((await title.count()) && (await title.isVisible().catch(() => false))) {
      try {
        await title.click({ force: true });
        return true;
      } catch {
        // Fall through to DOM dispatch below.
      }
    }

    return group.evaluate((node) => {
      const titleEl = node.querySelector('legend, .plugincy_title');
      const toggle = titleEl?.matches('.plugincy_collapsable_arrow')
        ? titleEl.querySelector('.collaps') || titleEl
        : titleEl;

      if (!toggle) {
        return false;
      }

      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    });
  }

  async function openGroupIfCollapsed(groupRef) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentState = await readCollapseState(groupRef);
      if (!currentState?.collapsed) {
        return;
      }

      await clickGroupToggle(groupRef);
      await delay(400);
    }
  }

  async function readChoiceState(groupRef) {
    const locator = groupLocator(groupRef);
    if (!(await locator.count())) {
      return [];
    }

    return locator.evaluate((group) => {
      return Array.from(
        group.querySelectorAll('input[type="checkbox"][name]:checked, input[type="radio"][name]:checked')
      ).map((input) => input.value);
    });
  }

  async function readMultiInputValues(groupRef, inputNames) {
    const locator = groupLocator(groupRef);
    if (!(await locator.count())) {
      return {};
    }

    return locator.evaluate((group, names) => {
      const state = {};
      for (const name of names) {
        const input = group.querySelector(`[name="${CSS.escape(name)}"]`);
        state[name] = input ? input.value : null;
      }
      return state;
    }, inputNames);
  }

  async function readSelectState(groupRef, selectName) {
    const locator = groupLocator(groupRef);
    if (!(await locator.count())) {
      return [];
    }

    return locator.evaluate((group, name) => {
      const select = group.querySelector(`select[name="${CSS.escape(name)}"]`);
      if (!select) return [];
      return Array.from(select.selectedOptions).map((option) => option.value);
    }, selectName);
  }

  async function readSingleSelectValue(groupRef, selectName) {
    const values = await readSelectState(groupRef, selectName);
    return values[0] ?? null;
  }

  async function activateChoiceControl(groupRef, control) {
    const group = groupLocator(groupRef);
    if (!(await group.count())) {
      return false;
    }

    const selectors = [];
    if (control.id) {
      selectors.push(`#${escapeCssIdentifier(control.id)}`);
    }
    if (control.name) {
      selectors.push(`input${attributeSelector(control.name)}${attributeValueSelector('value', control.value)}`);
    }
    selectors.push(`input${attributeValueSelector('value', control.value)}`);

    for (const selector of selectors) {
      const locator = group.locator(selector).first();
      if (!(await locator.count())) {
        continue;
      }

      try {
        await locator.check({ force: true, timeout: 3000 });
        return true;
      } catch {
        try {
          await locator.click({ force: true, timeout: 3000 });
          return true;
        } catch {
          // Fall back to wrapper click and DOM mutation below.
        }
      }

      for (const wrapperSelector of [
        `label:has(${selector})`,
        `.dapfforwcpro-category-row:has(${selector})`,
        `li:has(${selector})`,
        `a:has(${selector})`,
      ]) {
        const wrapper = group.locator(wrapperSelector).first();
        if (!(await wrapper.count())) {
          continue;
        }

        try {
          await wrapper.click({ force: true, timeout: 3000 });
          return true;
        } catch {
          // Continue to the next wrapper fallback.
        }
      }
    }

    return group.evaluate(
      (node, { controlId, name, value }) => {
        let input = null;
        if (controlId) {
          input = node.querySelector(`#${CSS.escape(controlId)}`);
        }

        if (!input && name) {
          input = Array.from(node.querySelectorAll(`input[name="${CSS.escape(name)}"]`)).find(
            (candidate) => String(candidate.value) === String(value)
          ) || null;
        }

        if (!input) {
          input = Array.from(node.querySelectorAll('input[type="checkbox"], input[type="radio"]')).find(
            (candidate) => String(candidate.value) === String(value)
          ) || null;
        }

        if (!input) return false;
        input.checked = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      {
        controlId: control.id,
        name: control.name,
        value: control.value,
      }
    );
  }

  async function fillInputByName(groupRef, inputName, value) {
    const group = groupLocator(groupRef);
    const locator = group.locator(attributeSelector(inputName)).first();

    if (!(await locator.count())) {
      return false;
    }

    try {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.fill(String(value), { timeout: 3000 });
      await locator.dispatchEvent('input');
      await locator.dispatchEvent('change');
      return true;
    } catch {
      return group.evaluate(
        (node, { name, nextValue }) => {
          const input = node.querySelector(`[name="${CSS.escape(name)}"]`);
          if (!input) return false;
          input.value = String(nextValue);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        },
        {
          name: inputName,
          nextValue: String(value),
        }
      );
    }
  }

  async function fillFieldsetLooseInput(groupRef, placeholder, value) {
    const group = groupLocator(groupRef);
    if (!(await group.count())) {
      return false;
    }

    return group.evaluate(
      (node, { expectedPlaceholder, nextValue }) => {
        const isVisible = (element) => {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            (element.offsetWidth > 0 || element.offsetHeight > 0)
          );
        };

        let input =
          (expectedPlaceholder
            ? Array.from(node.querySelectorAll('input')).find(
                (candidate) => candidate.placeholder === expectedPlaceholder
              )
            : null) ||
          Array.from(node.querySelectorAll('input.search-terms, input[type="search"]:not([name]), input[type="text"]:not([name])')).find(isVisible) ||
          node.querySelector('input.search-terms, input[type="search"]:not([name]), input[type="text"]:not([name])');

        if (!input) {
          const searchToggle = node.querySelector('.search_terms');
          if (searchToggle) {
            searchToggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            input =
              (expectedPlaceholder
                ? Array.from(node.querySelectorAll('input')).find(
                    (candidate) => candidate.placeholder === expectedPlaceholder
                  )
                : null) ||
              node.querySelector('input.search-terms, input[type="search"]:not([name]), input[type="text"]:not([name])');
          }
        }

        if (!input) return false;
        input.value = String(nextValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      {
        expectedPlaceholder: placeholder || '',
        nextValue: String(value),
      }
    );
  }

  async function submitGroupOptionSearch(groupRef) {
    const group = groupLocator(groupRef);
    if (!(await group.count())) {
      return false;
    }

    return group.evaluate((node) => {
      const button = node.querySelector('.plugincy-term-search-submit');
      if (!button) return false;
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    });
  }

  async function selectOptionByName(groupRef, selectName, values) {
    const group = groupLocator(groupRef);
    if (!(await group.count())) {
      return false;
    }

    return group.evaluate(
      (node, { name, selectedValues }) => {
        const select = node.querySelector(`select[name="${CSS.escape(name)}"]`);
        if (!select) return false;
        const wanted = new Set((Array.isArray(selectedValues) ? selectedValues : [selectedValues]).map(String));
        for (const option of Array.from(select.options)) {
          option.selected = wanted.has(option.value);
        }
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      {
        name: selectName,
        selectedValues: Array.isArray(values) ? values : [values],
      }
    );
  }

  async function captureFailureScreenshot(caseId, phase) {
    const file = path.join(outputDir, `fail-${sanitizeId(caseId)}-${phase}.png`);
    try {
      await page.screenshot({ path: file, fullPage: true });
      return file;
    } catch {
      return null;
    }
  }

  function filterRelevantMessages(messages) {
    return messages.filter((message) => !noisePatterns.some((pattern) => pattern.test(message.text)));
  }

  async function hasVisibleApplyButton() {
    const classLocator = page.locator(`${config.selectors.form} .dapfforwc-apply-filters-btn`).first();
    if ((await classLocator.count()) && (await classLocator.isVisible().catch(() => false))) {
      return true;
    }

    for (const label of [config.selectors.applyButtonName, 'Apply Filters', 'Apply']) {
      try {
        const button = page.getByRole('button', { name: new RegExp(escapeRegex(label), 'i') }).first();
        if (await button.isVisible({ timeout: 400 })) {
          return true;
        }
      } catch {
        // Ignore.
      }
    }

    return false;
  }

  async function clickVisibleApplyButton() {
    const classLocator = page.locator(`${config.selectors.form} .dapfforwc-apply-filters-btn`).first();
    if ((await classLocator.count()) && (await classLocator.isVisible().catch(() => false))) {
      await classLocator.click({ force: true });
      return true;
    }

    for (const label of [config.selectors.applyButtonName, 'Apply Filters', 'Apply']) {
      try {
        const button = page.getByRole('button', { name: new RegExp(escapeRegex(label), 'i') }).first();
        if (await button.isVisible({ timeout: 400 })) {
          await button.click({ force: true });
          return true;
        }
      } catch {
        // Ignore.
      }
    }

    return false;
  }

  async function clickVisibleResetButton() {
    const classLocator = page.locator(`${config.selectors.form} .dapfforwc-reset-filters-btn`).first();
    if ((await classLocator.count()) && (await classLocator.isVisible().catch(() => false))) {
      await classLocator.click({ force: true });
      return true;
    }

    for (const label of [config.selectors.resetButtonName, 'Reset Filters', 'Reset']) {
      try {
        const button = page.getByRole('button', { name: new RegExp(escapeRegex(label), 'i') }).first();
        if (await button.isVisible({ timeout: 400 })) {
          await button.click({ force: true });
          return true;
        }
      } catch {
        // Ignore.
      }
    }

    return false;
  }

  async function clickGroupResetButton(groupRef) {
    const locator = groupLocator(groupRef).locator('.reset-value').first();
    if (!(await locator.count())) {
      return false;
    }

    if (!(await locator.isVisible().catch(() => false))) {
      return false;
    }

    await locator.click({ force: true });
    return true;
  }

  async function clickVisibleSearchButton() {
    const classLocator = page.locator(`${config.selectors.form} .plugincy-search-submit`).first();
    if ((await classLocator.count()) && (await classLocator.isVisible().catch(() => false))) {
      await classLocator.click({ force: true });
      return true;
    }

    const roleLocator = page.getByRole('button', { name: /search/i }).first();
    if ((await roleLocator.count()) && (await roleLocator.isVisible().catch(() => false))) {
      await roleLocator.click({ force: true });
      return true;
    }

    return false;
  }

  async function pressEnterOnNamedField(groupRef, inputName) {
    const locator = groupLocator(groupRef).locator(attributeSelector(inputName)).first();

    if (!(await locator.count())) {
      return false;
    }

    await locator.focus().catch(() => {});
    await locator.press('Enter').catch(() => {});
    return true;
  }

  async function blurNamedField(groupRef, inputName) {
    const locator = groupLocator(groupRef).locator(attributeSelector(inputName)).first();

    if (!(await locator.count())) {
      return false;
    }

    await locator.focus().catch(() => {});
    await locator.dispatchEvent('blur').catch(() => {});
    return true;
  }

  async function applyPendingChanges(pluginDebug, options = {}) {
    const previousUrl = page.url();
    const networkCursor = markNetworkActivity();
    const shouldClickApply = pluginDebug.applyMode === 'explicit' || (await hasVisibleApplyButton());
    let mode = 'auto-change';

    if (options.preferSearchSubmit) {
      const clickedSearch = await clickVisibleSearchButton();
      if (clickedSearch) {
        mode = 'search-submit';
      } else if (await pressEnterOnNamedField(options.groupRef, options.searchInputName || 'plugincy_search')) {
        mode = 'search-enter';
      }
    } else if (options.preferBlurInputs && Array.isArray(options.inputNames)) {
      for (const inputName of options.inputNames) {
        await blurNamedField(options.groupRef, inputName);
      }
      mode = 'input-blur';
    }

    if (shouldClickApply && !['search-submit', 'search-enter'].includes(mode)) {
      const clicked = await clickVisibleApplyButton();
      if (clicked) {
        mode = 'explicit-button';
      }
    } else if (options.forceRefreshApi && await supportsFilterApi()) {
      const usedApi = await invokeFilterApiRefresh();
      if (usedApi) {
        mode = 'filter-api-refresh';
      }
    }

    await waitForAjaxSettled(previousUrl);
    return {
      mode,
      url: page.url(),
      networkActivity: getNetworkActivitySince(networkCursor),
    };
  }

  async function resetPendingChanges(groupRef) {
    const previousUrl = page.url();
    const usedGlobalReset = await clickVisibleResetButton();
    const usedGroupReset = !usedGlobalReset && groupRef ? await clickGroupResetButton(groupRef) : false;
    await waitForAjaxSettled(previousUrl);
    return {
      mode: usedGlobalReset ? 'global-reset' : usedGroupReset ? 'group-reset' : 'not-found',
      url: page.url(),
    };
  }

  async function submitCaseChanges(testCase, pluginDebug) {
    if (testCase.fieldId === 'search_text') {
      return applyPendingChanges(pluginDebug, {
        groupRef: testCase.groupRef,
        preferSearchSubmit: true,
        searchInputName: Object.keys(testCase.values || {})[0] || 'plugincy_search',
      });
    }

    if (testCase.fieldId === 'price-range') {
      return applyPendingChanges(pluginDebug, {
        groupRef: testCase.groupRef,
        preferBlurInputs: true,
        inputNames: Object.keys(testCase.values || {}),
      });
    }

    if (testCase.kind === 'text' || testCase.kind === 'inputs') {
      return applyPendingChanges(pluginDebug, {
        groupRef: testCase.groupRef,
        forceRefreshApi: true,
      });
    }

    return applyPendingChanges(pluginDebug);
  }

  async function collectVisibleOptionTexts(groupRef) {
    const group = groupLocator(groupRef);
    if (!(await group.count())) {
      return [];
    }

    return group.evaluate((node) => {
        const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            (element.offsetWidth > 0 || element.offsetHeight > 0)
          );
        };

        const extractOptionText = (input) => {
          if (input.labels?.length) {
            const labelText = normalizeText(input.labels[0].textContent);
            if (labelText) return labelText;
          }

          const candidate =
            input.closest('label') ||
            input.closest('a') ||
            input.closest('li') ||
            input.closest('.filterout-node') ||
            input.closest('.dapfforwcpro-category-row') ||
            input.parentElement;
          return normalizeText(candidate?.textContent || input.value || input.id || '');
        };

        const fromInputs = Array.from(
          node.querySelectorAll('.items input[type="checkbox"], .items input[type="radio"]')
        )
          .map((input) => {
            const wrapper =
              input.closest('label') ||
              input.closest('a') ||
              input.closest('li') ||
              input.closest('.filterout-node') ||
              input.closest('.dapfforwcpro-category-row') ||
              input.parentElement;
            if (!isVisible(wrapper || input)) return null;
            return extractOptionText(input);
          })
          .filter(Boolean);

          const source = fromInputs.length
            ? fromInputs
            : Array.from(node.querySelectorAll('.items a, .items label'))
                .filter(isVisible)
                .map((node) => normalizeText(node.textContent))
                .filter(Boolean);

        return Array.from(new Set(source)).slice(0, 25);
      });
  }

  function countFieldsetIdOccurrences(metadata) {
    return (metadata || []).reduce((counts, fieldset) => {
      if (!fieldset?.id) {
        return counts;
      }

      counts.set(fieldset.id, (counts.get(fieldset.id) || 0) + 1);
      return counts;
    }, new Map());
  }

  function resolveFieldOverride(fieldset, idOccurrences) {
    if (fieldset?.key && config.fieldOverrides[fieldset.key]) {
      return config.fieldOverrides[fieldset.key];
    }

    if (fieldset?.id && (idOccurrences.get(fieldset.id) || 0) <= 1 && config.fieldOverrides[fieldset.id]) {
      return config.fieldOverrides[fieldset.id];
    }

    return {};
  }

  function findFieldsetByRef(metadata, ref) {
    if (!hasValue(ref)) {
      return null;
    }

    const match = String(ref).trim();
    return metadata.find((fieldset) => fieldset.key === match) ||
      metadata.find((fieldset) => fieldset.id === match) ||
      null;
  }

  function buildCases(metadata, baselineSummary = null) {
    const cases = [];
    const skip = new Set(config.skipFieldsets || []);
    const idOccurrences = countFieldsetIdOccurrences(metadata);
    const fieldsetsToTest = selectRepresentativeFieldsets(
      metadata,
      config.maxDuplicateFieldsetsPerId,
      Object.keys(config.fieldOverrides || {})
    );
    const totalProducts = Number.isFinite(baselineSummary?.productCount)
      ? baselineSummary.productCount
      : null;

    for (const fieldset of fieldsetsToTest) {
      const fieldsetId = fieldset.id || '';
      const caseId = fieldset.key || fieldsetId;
      if (!caseId || skip.has(fieldset.key) || (fieldsetId && skip.has(fieldsetId))) {
        continue;
      }

      const groupRef = createGroupRef(fieldset);
      const override = resolveFieldOverride(fieldset, idOccurrences);
      if (override.skip) {
        continue;
      }

      const namedControls = fieldset.controls.filter((control) => control.name);
      const visibleNamedControls = namedControls.filter((control) => control.visible);
      const checkboxControls = namedControls.filter((control) => control.type === 'checkbox');
      const radioControls = namedControls.filter((control) => control.type === 'radio');
      const selectControls = namedControls.filter((control) => control.tag === 'select');

      if (override.kind === 'checkboxes' || override.kind === 'radios') {
        const requestedType = override.kind === 'radios' ? 'radio' : 'checkbox';
        const pool = requestedType === 'radio' ? radioControls : checkboxControls;
        const byValue = new Map(pool.map((control) => [control.value, control]));
        const chosen = (override.values || [])
          .map((value) => byValue.get(value))
          .filter(Boolean)
          .map((control) => ({
            id: control.id || null,
            name: control.name || null,
            value: control.value,
            type: control.type,
          }));

        if (chosen.length) {
          cases.push({
            id: caseId,
            fieldId: fieldsetId,
            groupRef,
            title: fieldset.title,
            kind: override.kind,
            values: chosen,
          });
        }
        continue;
      }

      if (override.kind === 'inputs' || override.kind === 'text') {
        if (hasAllValues(override.values || {})) {
          cases.push({
            id: caseId,
            fieldId: fieldsetId,
            groupRef,
            title: fieldset.title,
            kind: override.kind,
            values: override.values || {},
          });
        }
        continue;
      }

      if (override.kind === 'single-select' || override.kind === 'multi-select') {
        if ((override.values || []).length) {
          cases.push({
            id: caseId,
            fieldId: fieldsetId,
            groupRef,
            title: fieldset.title,
            kind: override.kind,
            selectName: override.selectName || selectControls[0]?.name || null,
            values: override.values || [],
          });
        }
        continue;
      }

      if (fieldsetId === 'search_text') {
        const searchControlVisible = visibleNamedControls.some((control) => {
          return control.name === 'plugincy_search' || control.name === 'title';
        });
        if (hasValue(config.testData.searchText) && searchControlVisible) {
          cases.push({
            id: caseId,
            fieldId: fieldsetId,
            groupRef,
            title: fieldset.title,
            kind: 'text',
            values: { plugincy_search: config.testData.searchText },
          });
        }
        continue;
      }

      if (fieldsetId === 'price-range') {
        if (hasAllValues(config.testData.priceRange)) {
          cases.push({
            id: caseId,
            fieldId: fieldsetId,
            groupRef,
            title: fieldset.title,
            kind: 'inputs',
            values: {
              mn_price: config.testData.priceRange.min,
              mx_price: config.testData.priceRange.max,
            },
          });
        }
        continue;
      }

      if (fieldsetId === 'dimensions') {
        if (hasAllValues(config.testData.dimensions)) {
          cases.push({
            id: caseId,
            fieldId: fieldsetId,
            groupRef,
            title: fieldset.title,
            kind: 'inputs',
            values: config.testData.dimensions,
          });
        }
        continue;
      }

      if (fieldsetId === 'sku') {
        const skuVisible = visibleNamedControls.some((control) => control.name === 'sku' || control.name === 'sku[]');
        if (hasValue(config.testData.sku) && skuVisible) {
          cases.push({
            id: caseId,
            fieldId: fieldsetId,
            groupRef,
            title: fieldset.title,
            kind: 'text',
            values: { sku: config.testData.sku },
          });
        }
        continue;
      }

      if (fieldsetId === 'discount') {
        const discountVisible = visibleNamedControls.some((control) => control.name === 'discount' || control.name === 'discount[]');
        if (hasValue(config.testData.discount) && discountVisible) {
          cases.push({
            id: caseId,
            fieldId: fieldsetId,
            groupRef,
            title: fieldset.title,
            kind: 'text',
            values: { discount: config.testData.discount },
          });
        }
        continue;
      }

      if (fieldsetId === 'date_filter') {
        const select = visibleNamedControls.find((control) => control.tag === 'select' && control.name === 'date_filter')
          || selectControls.find((control) => control.name === 'date_filter');
        const candidate = (select?.options || []).find((option) => option.value && !/all/i.test(option.text));

        if (candidate) {
          cases.push({
            id: caseId,
            fieldId: fieldsetId,
            groupRef,
            title: fieldset.title,
            kind: 'single-select',
            selectName: 'date_filter',
            values: [candidate.value],
          });
        }
        continue;
      }

      if (checkboxControls.length) {
        const chooseCount = isMultiValueChoiceName(checkboxControls[0].name)
          ? Math.min(2, checkboxControls.length)
          : 1;
        const chosenControls = pickChoiceOptions(
          (fieldset.checkboxOptions || checkboxControls).filter((option) => option.wrapperVisible !== false),
          chooseCount,
          totalProducts
        );

        if (!chosenControls.length) {
          continue;
        }

        cases.push({
          id: caseId,
          fieldId: fieldsetId,
          groupRef,
          title: fieldset.title,
          kind: 'checkboxes',
          values: chosenControls.map((control) => ({
            id: control.id || null,
            name: control.name || null,
            value: control.value,
            type: control.type,
          })),
        });
        continue;
      }

      if (radioControls.length) {
        const control = pickChoiceOptions(
          (fieldset.radioOptions || radioControls).filter((option) => option.wrapperVisible !== false),
          1,
          totalProducts
        )[0] || radioControls[0];
        if (!control) {
          continue;
        }
        cases.push({
          id: caseId,
          fieldId: fieldsetId,
          groupRef,
          title: fieldset.title,
          kind: 'radios',
          values: [
            {
              id: control.id || null,
              name: control.name || null,
              value: control.value,
              type: control.type,
            },
          ],
        });
        continue;
      }

      if (selectControls.length) {
        const select = visibleNamedControls.find((control) => control.tag === 'select') || selectControls[0];
        const values = pickSelectOptionValues(
          select.options || [],
          select.type === 'select-multiple' ? 2 : 1,
          totalProducts
        );

        if (values.length) {
          cases.push({
            id: caseId,
            fieldId: fieldsetId,
            groupRef,
            title: fieldset.title,
            kind: select.type === 'select-multiple' ? 'multi-select' : 'single-select',
            selectName: select.name,
            values,
          });
        }
      }
    }

    return cases;
  }

  async function readCaseState(testCase) {
    if (testCase.kind === 'checkboxes' || testCase.kind === 'radios') {
      return readChoiceState(testCase.groupRef);
    }
    if (testCase.kind === 'text' || testCase.kind === 'inputs') {
      return readMultiInputValues(testCase.groupRef, Object.keys(testCase.values));
    }
    if (testCase.kind === 'single-select') {
      return readSingleSelectValue(testCase.groupRef, testCase.selectName);
    }
    if (testCase.kind === 'multi-select') {
      return readSelectState(testCase.groupRef, testCase.selectName);
    }
    return null;
  }

  function evaluateCaseState(testCase, actualState, expectedState, baselineState) {
    if (testCase.kind === 'checkboxes') {
      return includesAllValues(actualState || [], expectedState || []);
    }

    if (testCase.kind === 'radios') {
      return String(actualState?.[0] ?? actualState ?? '') === String(expectedState?.[0] ?? '');
    }

    if (testCase.kind === 'text' || testCase.kind === 'inputs') {
      return Object.entries(expectedState || {}).every(([name, value]) => {
        return String(actualState?.[name] ?? '') === String(value);
      });
    }

    if (testCase.kind === 'single-select') {
      return String(actualState ?? '') === String(expectedState?.[0] ?? '');
    }

    if (testCase.kind === 'multi-select') {
      return includesAllValues(actualState || [], expectedState || []);
    }

    return false;
  }

  async function executeFilterCase(testCase, pluginDebug) {
    await navigateToBase();
    const urlMode = normalizeUrlMode(pluginDebug?.urlMode || pluginDebug?.manage?.useUrlFilter);
    const baselineUrl = page.url();
    const baselineSummary = await captureResultSummary();
    const baselineState = await readCaseState(testCase);
    const messageStart = globalMessages.length;

    await openGroupIfCollapsed(testCase.groupRef);

    if (testCase.kind === 'checkboxes' || testCase.kind === 'radios') {
      for (const input of testCase.values) {
        await activateChoiceControl(testCase.groupRef, input);
        await delay(200);
      }
    } else if (testCase.kind === 'text' || testCase.kind === 'inputs') {
      for (const [name, value] of Object.entries(testCase.values)) {
        await fillInputByName(testCase.groupRef, name, value);
        await delay(150);
      }
    } else if (testCase.kind === 'single-select' || testCase.kind === 'multi-select') {
      await selectOptionByName(testCase.groupRef, testCase.selectName, testCase.values);
      await delay(300);
    }

    const applyInfo = await submitCaseChanges(testCase, pluginDebug);
    const applyUrl = applyInfo.url;
    const summaryAfterApply = await captureResultSummary();
    const stateAfterApply = await readCaseState(testCase);
    const applyNetworkActivity = applyInfo.networkActivity || [];

    await page.reload({ waitUntil: 'domcontentloaded' });
    await ensureFilterUiReady();
    const reloadUrl = page.url();
    const summaryAfterReload = await captureResultSummary();
    const stateAfterReload = await readCaseState(testCase);
    const expectedState =
      testCase.kind === 'checkboxes' || testCase.kind === 'radios'
        ? testCase.values.map((item) => item.value)
        : testCase.kind === 'single-select' || testCase.kind === 'multi-select'
          ? testCase.values
          : testCase.values;
    const applyStateOk = evaluateCaseState(testCase, stateAfterApply, expectedState, baselineState);
    const reloadStateOk = evaluateCaseState(testCase, stateAfterReload, expectedState, baselineState);

    const urlChanged = !urlsEqual(applyUrl, baselineUrl);
    const reloadUrlStable = urlsEqual(reloadUrl, applyUrl);
    const summaryChangedAfterApply = summariesDiffer(baselineSummary, summaryAfterApply);
    const observedApplyEffect = urlChanged || summaryChangedAfterApply || applyNetworkActivity.length > 0;
    const expectsUrlChange = shouldExpectUrlChange(urlMode);
    const expectsReloadPersistence = shouldExpectReloadPersistence(urlMode);
    const relevantMessages = filterRelevantMessages(globalMessages.slice(messageStart));
    const issues = [];

    if (!observedApplyEffect) {
      issues.push('Filter interaction did not produce an observable same-origin network, DOM, or URL change.');
    }
    if (expectsUrlChange && !urlChanged) {
      issues.push(`Filtered URL did not change in ${urlMode} mode.`);
    }
    if (!applyStateOk) {
      issues.push('Selected state was not preserved immediately after apply.');
    }
    if (expectsReloadPersistence && !reloadStateOk) {
      issues.push('Selected state was not preserved after page reload.');
    }
    if (expectsReloadPersistence && !reloadUrlStable) {
      issues.push('Reload changed the filtered URL unexpectedly.');
    }
    if (relevantMessages.length) {
      issues.push('Browser console/request errors were emitted during this flow.');
    }

    let screenshot = null;
    if (issues.length) {
      screenshot = await captureFailureScreenshot(testCase.id, 'apply-reload');
    }

    return {
      id: testCase.id,
      fieldId: testCase.fieldId,
      title: testCase.title,
      kind: testCase.kind,
      expected:
        testCase.kind === 'checkboxes' || testCase.kind === 'radios'
          ? testCase.values.map((item) => item.value)
          : testCase.kind === 'single-select' || testCase.kind === 'multi-select'
            ? testCase.values
            : testCase.values,
      baselineUrl,
      baselineSummary,
      applyMechanism: applyInfo.mode,
      urlMode,
      applyUrl,
      reloadUrl,
      urlChanged,
      reloadUrlStable,
      summaryChangedAfterApply,
      applyNetworkActivity,
      observedApplyEffect,
      expectsUrlChange,
      expectsReloadPersistence,
      baselineState,
      stateAfterApply,
      stateAfterReload,
      applyStateOk,
      reloadStateOk,
      summaryAfterApply,
      summaryAfterReload,
      issues,
      messages: relevantMessages,
      screenshot,
      passed: issues.length === 0,
    };
  }

  async function makeSkippedAction(id, title, reason) {
    return {
      id,
      title,
      skipped: true,
      passed: true,
      issues: [],
      reason,
    };
  }

  async function buildUnexpectedFailure(id, title, error, phase = 'unexpected') {
    return {
      id,
      title,
      passed: false,
      issues: [error?.message || String(error)],
      messages: [],
      screenshot: await captureFailureScreenshot(id, phase),
    };
  }

  async function testOverlayToggle() {
    await navigateToBase();

    const button = page
      .locator(
        '.dapfforwcpro-overlay-button:visible, [id^="dapfforwcpro-overlay-"][id$="-button"]:visible'
      )
      .first();
    if (!(await button.count())) {
      return makeSkippedAction('action-overlay-toggle', 'Overlay toggle', 'Overlay button was not found for this viewport.');
    }

    const messageStart = globalMessages.length;
    await button.click({ force: true });
    await delay(700);

    const openedState = await page.evaluate(() => {
      const bodyOpen = document.body.classList.contains('dapfforwcpro-overlay-open');
      const panel = document.querySelector('.dapfforwcpro-overlay-panel');
      if (!panel) return { bodyOpen, panelVisible: false };
      const style = window.getComputedStyle(panel);
      return {
        bodyOpen,
        panelVisible:
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (panel.offsetWidth > 0 || panel.offsetHeight > 0),
      };
    });

    const closeButton = page.locator('.filter-cancel-button:visible').first();
    if ((await closeButton.count()) && (await closeButton.isVisible().catch(() => false))) {
      await closeButton.click({ force: true });
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await delay(700);

    const closedState = await page.evaluate(() => {
      const bodyOpen = document.body.classList.contains('dapfforwcpro-overlay-open');
      const panel = document.querySelector('.dapfforwcpro-overlay-panel');
      if (!panel) return { bodyOpen, panelVisible: false };
      const style = window.getComputedStyle(panel);
      return {
        bodyOpen,
        panelVisible:
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          (panel.offsetWidth > 0 || panel.offsetHeight > 0),
      };
    });

    const messages = filterRelevantMessages(globalMessages.slice(messageStart));
    const issues = [];
    if (!(openedState.bodyOpen || openedState.panelVisible)) {
      issues.push('Overlay open action did not expose the filter panel.');
    }
    if (closedState.bodyOpen || closedState.panelVisible) {
      issues.push('Overlay close action did not hide the filter panel.');
    }
    if (messages.length) {
      issues.push('Browser console/request errors were emitted during overlay toggle.');
    }

    return {
      id: 'action-overlay-toggle',
      title: 'Overlay toggle',
      openedState,
      closedState,
      messages,
      issues,
      passed: issues.length === 0,
    };
  }

  async function testShortcodeToggle() {
    await navigateToBase();

    const toggle = page.locator('.dapfforwcpro-shortcode-collapsable-toggle:visible').first();
    if (!(await toggle.count())) {
      return makeSkippedAction(
        'action-shortcode-toggle',
        'Shortcode collapsible toggle',
        'Shortcode collapsible wrapper was not found.'
      );
    }

    const panel = page.locator('.dapfforwcpro-shortcode-collapsable-panel').first();
    const messageStart = globalMessages.length;
    const beforeExpanded = (await toggle.getAttribute('aria-expanded').catch(() => null)) || 'false';
    await toggle.click({ force: true });
    await delay(500);
    const afterOpenExpanded = (await toggle.getAttribute('aria-expanded').catch(() => null)) || 'false';
    const afterOpenVisible = await panel.isVisible().catch(() => false);
    await toggle.click({ force: true });
    await delay(500);
    const afterCloseExpanded = (await toggle.getAttribute('aria-expanded').catch(() => null)) || 'false';
    const messages = filterRelevantMessages(globalMessages.slice(messageStart));
    const issues = [];

    if (!(afterOpenExpanded === 'true' && afterOpenVisible)) {
      issues.push('Shortcode toggle did not open the filter panel correctly.');
    }
    if (beforeExpanded === 'false' && afterCloseExpanded !== 'false') {
      issues.push('Shortcode toggle did not close the filter panel correctly.');
    }
    if (messages.length) {
      issues.push('Browser console/request errors were emitted during shortcode toggle.');
    }

    return {
      id: 'action-shortcode-toggle',
      title: 'Shortcode collapsible toggle',
      beforeExpanded,
      afterOpenExpanded,
      afterCloseExpanded,
      messages,
      issues,
      passed: issues.length === 0,
    };
  }

  async function testCollapseToggle(metadata) {
    const collapseTargetRef = config.actionTargets.collapseFieldset || config.actionTargets.collapseFieldsetId;
    const collapseField = findFieldsetByRef(metadata, collapseTargetRef);
    if (!collapseTargetRef || !collapseField) {
      return makeSkippedAction(
        'action-collapse-toggle',
        'Collapse toggle',
        `Field ${collapseTargetRef || '(auto not found)'} was not found.`
      );
    }

    await navigateToBase();
    const messageStart = globalMessages.length;
    await openGroupIfCollapsed(createGroupRef(collapseField));

    const beforeState = await readCollapseState(createGroupRef(collapseField));
    await clickGroupToggle(createGroupRef(collapseField));
    await delay(400);
    const afterCollapseState = await readCollapseState(createGroupRef(collapseField));
    await clickGroupToggle(createGroupRef(collapseField));
    await delay(400);
    const afterExpandState = await readCollapseState(createGroupRef(collapseField));

    const messages = filterRelevantMessages(globalMessages.slice(messageStart));
    const issues = [];
    const toggledOnce = beforeState && afterCollapseState && beforeState.collapsed !== afterCollapseState.collapsed;
    const toggledBack = beforeState && afterExpandState && beforeState.collapsed === afterExpandState.collapsed;
    if (!(toggledOnce && toggledBack)) {
      issues.push('Collapse toggle did not consistently hide and restore items.');
    }
    if (messages.length) {
      issues.push('Browser console/request errors were emitted during collapse toggle.');
    }

    return {
      id: 'action-collapse-toggle',
      title: `Collapse toggle on ${collapseField.title || collapseField.id}`,
      beforeState,
      afterCollapseState,
      afterExpandState,
      messages,
      issues,
      passed: issues.length === 0,
    };
  }

  async function testInternalOptionSearch(metadata) {
    const optionSearchRef = config.actionTargets.optionSearchFieldset || config.actionTargets.optionSearchFieldsetId;
    const optionSearchField = findFieldsetByRef(metadata, optionSearchRef);
    if (!optionSearchRef || !optionSearchField) {
      return makeSkippedAction(
        'action-option-search',
        'Internal option search',
        `Field ${optionSearchRef || '(auto not found)'} was not found.`
      );
    }

    await navigateToBase();
    const messageStart = globalMessages.length;
    await openGroupIfCollapsed(createGroupRef(optionSearchField));
    const beforeOptions = await collectVisibleOptionTexts(createGroupRef(optionSearchField));
    const didFill = await fillFieldsetLooseInput(
      createGroupRef(optionSearchField),
      config.actionTargets.optionSearchPlaceholder,
      config.actionTargets.optionSearchText
    );

    if (!didFill || !hasValue(config.actionTargets.optionSearchText)) {
      return makeSkippedAction(
        'action-option-search',
        'Internal option search',
        `Search input or search text was not auto-detected for ${optionSearchField.title || optionSearchField.id}.`
      );
    }

    await submitGroupOptionSearch(createGroupRef(optionSearchField));
    await delay(900);
    const afterOptions = await collectVisibleOptionTexts(createGroupRef(optionSearchField));
    const token = String(config.actionTargets.optionSearchText || '').toLowerCase();
    const messages = filterRelevantMessages(globalMessages.slice(messageStart));
    const issues = [];

    const narrowed = afterOptions.length > 0 && afterOptions.length < beforeOptions.length;
    const matching = afterOptions.length > 0 && afterOptions.every((value) => value.toLowerCase().includes(token));

    if (!narrowed && !matching) {
      issues.push('Internal option search did not narrow or filter visible options as expected.');
    }
    if (messages.length) {
      issues.push('Browser console/request errors were emitted during internal option search.');
    }

    return {
      id: 'action-option-search',
      title: `Internal option search on ${optionSearchField.title || optionSearchField.id}`,
      beforeSample: beforeOptions,
      afterSample: afterOptions,
      messages,
      issues,
      passed: issues.length === 0,
    };
  }

  async function testIdleApplyAction(pluginDebug) {
    await navigateToBase();

    if (!(await hasVisibleApplyButton())) {
      return makeSkippedAction(
        'action-idle-apply',
        'Apply Filters without changes',
        'Apply button is not visible in the current filter UI.'
      );
    }

    const baselineUrl = page.url();
    const baselineSummary = await captureResultSummary();
    const baselineFormState = await captureFormControlState();
    const baselineSorting = await readSortingState(pluginDebug);
    const compareOptions = buildSemanticUrlCompareOptions(pluginDebug, {
      defaultOrderby: baselineSorting?.value || null,
    });
    const messageStart = globalMessages.length;
    const applyInfo = await applyPendingChanges(pluginDebug);
    const applyUrl = applyInfo.url;
    const applySummary = await captureResultSummary();
    const formStateAfterApply = await captureFormControlState();
    const messages = filterRelevantMessages(globalMessages.slice(messageStart));
    const issues = [];

    if (!statesEqual(formStateAfterApply, baselineFormState)) {
      issues.push('Apply Filters changed filter state even though no new filter input was provided.');
    }
    if (summariesDiffer(applySummary, baselineSummary)) {
      issues.push('Apply Filters changed the product results even though no new filter input was provided.');
    }
    if (
      !urlsEqual(applyUrl, baselineUrl, compareOptions) &&
      (summariesDiffer(applySummary, baselineSummary) || !statesEqual(formStateAfterApply, baselineFormState))
    ) {
      issues.push('Apply Filters changed the page URL unexpectedly without a matching filter-state change.');
    }
    if (messages.length) {
      issues.push('Browser console/request errors were emitted during no-op apply.');
    }

    return {
      id: 'action-idle-apply',
      title: 'Apply Filters without changes',
      applyMechanism: applyInfo.mode,
      baselineUrl,
      applyUrl,
      baselineSummary,
      applySummary,
      baselineFormState,
      formStateAfterApply,
      messages,
      issues,
      passed: issues.length === 0,
    };
  }

  async function testIdleResetAction(pluginDebug) {
    await navigateToBase();

    const baselineUrl = page.url();
    const baselineSummary = await captureResultSummary();
    const baselineFormState = await captureFormControlState();
    const baselineSorting = await readSortingState(pluginDebug);
    const compareOptions = buildSemanticUrlCompareOptions(pluginDebug, {
      defaultOrderby: baselineSorting?.value || null,
    });
    const messageStart = globalMessages.length;
    const resetInfo = await resetPendingChanges(null);

    if (resetInfo.mode === 'not-found') {
      return makeSkippedAction(
        'action-idle-reset',
        'Reset Filters without changes',
        'Reset button is not visible in the current filter UI.'
      );
    }

    const resetUrl = resetInfo.url;
    const resetSummary = await captureResultSummary();
    const formStateAfterReset = await captureFormControlState();
    const messages = filterRelevantMessages(globalMessages.slice(messageStart));
    const issues = [];

    if (!statesEqual(formStateAfterReset, baselineFormState)) {
      issues.push('Reset Filters changed filter state even though no filter was selected.');
    }
    if (summariesDiffer(resetSummary, baselineSummary)) {
      issues.push('Reset Filters changed the product results even though no filter was selected.');
    }
    if (
      !urlsEqual(resetUrl, baselineUrl, compareOptions) &&
      (summariesDiffer(resetSummary, baselineSummary) || !statesEqual(formStateAfterReset, baselineFormState))
    ) {
      issues.push('Reset Filters changed the page URL unexpectedly without a matching filter-state change.');
    }
    if (messages.length) {
      issues.push('Browser console/request errors were emitted during no-op reset.');
    }

    return {
      id: 'action-idle-reset',
      title: 'Reset Filters without changes',
      resetMechanism: resetInfo.mode,
      baselineUrl,
      resetUrl,
      baselineSummary,
      resetSummary,
      baselineFormState,
      formStateAfterReset,
      messages,
      issues,
      passed: issues.length === 0,
    };
  }

  async function testSortingAction(pluginDebug) {
    await navigateToBase();

    const beforeSort = await readSortingState(pluginDebug);
    if (!beforeSort) {
      return makeSkippedAction(
        'action-sorting',
        'Sorting action',
        'Sorting control was not found in the current storefront.'
      );
    }

    const targetOption = (beforeSort.options || []).find((option) => {
      return (
        isMeaningfulSelectOption(option) &&
        !option.disabled &&
        String(option.value) !== String(beforeSort.value)
      );
    });

    if (!targetOption) {
      return makeSkippedAction(
        'action-sorting',
        'Sorting action',
        'No alternate sorting option was available to test.'
      );
    }

    const baselineUrl = page.url();
    const baselineSummary = await captureResultSummary();
    const urlMode = normalizeUrlMode(pluginDebug?.urlMode || pluginDebug?.manage?.useUrlFilter);
    const messageStart = globalMessages.length;
    const networkCursor = markNetworkActivity();
    const didChange = await changeSortingValue(pluginDebug, targetOption.value);

    if (!didChange) {
      return makeSkippedAction(
        'action-sorting',
        'Sorting action',
        `Could not switch sorting to ${targetOption.text || targetOption.value}.`
      );
    }

    await waitForAjaxSettled(baselineUrl);
    const applyUrl = page.url();
    const summaryAfterSort = await captureResultSummary();
    const stateAfterSort = await readSortingState(pluginDebug);
    const sortingNetworkActivity = getNetworkActivitySince(networkCursor);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await ensureFilterUiReady();
    const reloadUrl = page.url();
    const summaryAfterReload = await captureResultSummary();
    const stateAfterReload = await readSortingState(pluginDebug);

    const observedEffect =
      !urlsEqual(applyUrl, baselineUrl) ||
      summariesDiffer(baselineSummary, summaryAfterSort) ||
      sortingNetworkActivity.length > 0 ||
      String(stateAfterSort?.value ?? '') !== String(beforeSort.value ?? '');
    const messages = filterRelevantMessages(globalMessages.slice(messageStart));
    const issues = [];

    if (!observedEffect) {
      issues.push('Sorting interaction did not produce an observable same-origin network, DOM, or URL change.');
    }
    if (String(stateAfterSort?.value ?? '') !== String(targetOption.value)) {
      issues.push('Sorting selection was not applied after changing the control.');
    }
    if (shouldExpectReloadPersistence(urlMode) && String(stateAfterReload?.value ?? '') !== String(targetOption.value)) {
      issues.push('Sorting selection was not preserved after page reload.');
    }
    if (shouldExpectReloadPersistence(urlMode) && !urlsEqual(reloadUrl, applyUrl)) {
      issues.push('Reload changed the sorted URL unexpectedly.');
    }
    if (messages.length) {
      issues.push('Browser console/request errors were emitted during sorting.');
    }

    return {
      id: 'action-sorting',
      title: `Sorting action to ${targetOption.text || targetOption.value}`,
      urlMode,
      baselineUrl,
      applyUrl,
      reloadUrl,
      beforeSort,
      targetOption,
      stateAfterSort,
      stateAfterReload,
      baselineSummary,
      summaryAfterSort,
      summaryAfterReload,
      sortingNetworkActivity,
      messages,
      issues,
      passed: issues.length === 0,
    };
  }

  async function testPaginationAction(pluginDebug) {
    await navigateToBase();

    const beforePagination = await readPaginationState(pluginDebug);
    if (!beforePagination) {
      return makeSkippedAction(
        'action-pagination',
        'Pagination action',
        'Pagination container was not found in the current storefront.'
      );
    }

    const baselineUrl = page.url();
    const baselineSummary = await captureResultSummary();
    const urlMode = normalizeUrlMode(pluginDebug?.urlMode || pluginDebug?.manage?.useUrlFilter);
    const preferredPage = Number.isFinite(beforePagination.currentPage)
      ? beforePagination.currentPage + 1
      : 2;
    const messageStart = globalMessages.length;
    const networkCursor = markNetworkActivity();
    const clickInfo = await clickPaginationTarget(pluginDebug, preferredPage);

    if (!clickInfo) {
      return makeSkippedAction(
        'action-pagination',
        'Pagination action',
        'No alternate pagination target was available to test.'
      );
    }

    await waitForAjaxSettled(baselineUrl);
    const applyUrl = page.url();
    const summaryAfterPagination = await captureResultSummary();
    const stateAfterPagination = await readPaginationState(pluginDebug);
    const paginationNetworkActivity = getNetworkActivitySince(networkCursor);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await ensureFilterUiReady();
    const reloadUrl = page.url();
    const summaryAfterReload = await captureResultSummary();
    const stateAfterReload = await readPaginationState(pluginDebug);

    const observedEffect =
      !urlsEqual(applyUrl, baselineUrl) ||
      summariesDiffer(baselineSummary, summaryAfterPagination) ||
      paginationNetworkActivity.length > 0 ||
      stateAfterPagination?.currentPage !== beforePagination.currentPage;
    const messages = filterRelevantMessages(globalMessages.slice(messageStart));
    const issues = [];

    if (!observedEffect) {
      issues.push('Pagination interaction did not produce an observable same-origin network, DOM, or URL change.');
    }
    if (
      Number.isFinite(clickInfo.targetPage) &&
      Number.isFinite(stateAfterPagination?.currentPage) &&
      stateAfterPagination.currentPage !== clickInfo.targetPage
    ) {
      issues.push(`Pagination did not move to the expected page ${clickInfo.targetPage}.`);
    }
    if (
      Number.isFinite(clickInfo.targetPage) &&
      shouldExpectReloadPersistence(urlMode) &&
      Number.isFinite(stateAfterReload?.currentPage) &&
      stateAfterReload.currentPage !== clickInfo.targetPage
    ) {
      issues.push('Pagination state was not preserved after page reload.');
    }
    if (shouldExpectReloadPersistence(urlMode) && !urlsEqual(reloadUrl, applyUrl)) {
      issues.push('Reload changed the paginated URL unexpectedly.');
    }
    if (messages.length) {
      issues.push('Browser console/request errors were emitted during pagination.');
    }

    return {
      id: 'action-pagination',
      title: `Pagination action to ${clickInfo.targetLabel || clickInfo.targetPage || 'next page'}`,
      urlMode,
      baselineUrl,
      applyUrl,
      reloadUrl,
      beforePagination,
      clickInfo,
      stateAfterPagination,
      stateAfterReload,
      baselineSummary,
      summaryAfterPagination,
      summaryAfterReload,
      paginationNetworkActivity,
      messages,
      issues,
      passed: issues.length === 0,
    };
  }

  async function testResetAction(metadata, pluginDebug) {
    const resetFieldRef = config.actionTargets.resetFieldset || config.actionTargets.resetFieldsetId;
    const resetTargetField = findFieldsetByRef(metadata, resetFieldRef);
    if (!resetFieldRef || !resetTargetField) {
      return makeSkippedAction(
        'action-reset-filters',
        'Reset Filters',
        `Field ${resetFieldRef || '(auto not found)'} was not found.`
      );
    }

    const checkbox = (resetTargetField.choiceOptions || []).find(
      (control) => control.value === config.actionTargets.resetValue
    );
    if (!checkbox) {
      return makeSkippedAction(
        'action-reset-filters',
        'Reset Filters',
        `Choice value ${config.actionTargets.resetValue || '(auto not found)'} was not found in ${resetTargetField.title || resetTargetField.id}.`
      );
    }

    await navigateToBase();
    const urlMode = normalizeUrlMode(pluginDebug?.urlMode || pluginDebug?.manage?.useUrlFilter);
    const baselineUrl = page.url();
    const baselineSummary = await captureResultSummary();
    const baselineSorting = await readSortingState(pluginDebug);
    const compareOptions = buildSemanticUrlCompareOptions(pluginDebug, {
      defaultOrderby: baselineSorting?.value || null,
    });
    const targetGroupRef = createGroupRef(resetTargetField);
    const baselineState = await readChoiceState(targetGroupRef);
    const messageStart = globalMessages.length;
    await activateChoiceControl(targetGroupRef, checkbox);
    await delay(200);
    const applyInfo = await submitCaseChanges(
      {
        id: resetTargetField.key || resetTargetField.id,
        fieldId: resetTargetField.id,
        groupRef: targetGroupRef,
        kind: 'checkboxes',
        values: [checkbox],
      },
      pluginDebug
    );
    const filteredUrl = applyInfo.url;
    const filteredSummary = await captureResultSummary();
    const stateBeforeReset = await readChoiceState(targetGroupRef);
    const resetInfo = await resetPendingChanges(targetGroupRef);
    if (resetInfo.mode === 'not-found' && pluginDebug?.style?.showResetButton !== 'yes') {
      return makeSkippedAction(
        'action-reset-filters',
        'Reset Filters',
        'Reset action is not enabled in the current filter UI.'
      );
    }
    const resetUrl = resetInfo.url;
    const stateAfterReset = await readChoiceState(targetGroupRef);
    const resetSummary = await captureResultSummary();
    const observedApplyEffect =
      !urlsEqual(filteredUrl, baselineUrl) ||
      summariesDiffer(filteredSummary, baselineSummary) ||
      (applyInfo.networkActivity || []).length > 0;
    const messages = filterRelevantMessages(globalMessages.slice(messageStart));
    const issues = [];

    if (!observedApplyEffect) {
      issues.push('Precondition failed because the filter interaction did not produce an observable change before reset.');
    }
    if (!stateBeforeReset.includes(config.actionTargets.resetValue)) {
      issues.push('Precondition failed because the selected option was not retained before reset.');
    }
    if (shouldExpectUrlChange(urlMode) && !urlsEqual(resetUrl, baselineUrl, compareOptions)) {
      issues.push('Reset Filters did not return the page to the initial products URL.');
    }
    if (stateAfterReset.includes(config.actionTargets.resetValue) && !baselineState.includes(config.actionTargets.resetValue)) {
      issues.push('Reset Filters did not clear the selected option state.');
    }
    if (resetInfo.mode === 'not-found') {
      issues.push('Reset action was not found in the current filter UI.');
    }
    if (messages.length) {
      issues.push('Browser console/request errors were emitted during reset.');
    }

    return {
      id: 'action-reset-filters',
      title: `Reset Filters on ${resetTargetField.title || resetTargetField.id}`,
      applyMechanism: applyInfo.mode,
      resetMechanism: resetInfo.mode,
      urlMode,
      baselineUrl,
      baselineSummary,
      filteredUrl,
      resetUrl,
      baselineState,
      stateBeforeReset,
      stateAfterReset,
      filteredSummary,
      resetSummary,
      messages,
      issues,
      passed: issues.length === 0,
    };
  }

  try {
    progress.info(`Starting ${config.deviceMode} QC on ${config.baseUrl}`);
    await inspectPluginSettings();
    const pluginDebug = summarizePluginDebug();
    applyPluginRuntimeOverrides(pluginDebug);

    await navigateToBase();
    const startedAt = new Date().toISOString();
    const baselineSummary = await captureResultSummary();
    await expandGroupsForDiscovery();
    const metadata = await getMetadata();
    let generatedConfig = null;

    if (config.runMode === 'url-auto') {
      const storeCatalog = await fetchStoreCatalog();
      generatedConfig = buildAutoDiscoveryConfig(config, metadata, storeCatalog, baselineSummary);
      config = mergeConfig(config, generatedConfig);
      config.deviceMode = devicePreset.name;
      applyPluginRuntimeOverrides(pluginDebug);
      await writeJson(generatedConfigPath, {
        generatedAt: new Date().toISOString(),
        baseUrl: config.baseUrl,
        runMode: config.runMode,
        deviceMode: config.deviceMode,
        ...generatedConfig,
      });
    }

    const filterCases = buildCases(metadata, baselineSummary);
    const actionTests = [];
    const filterTests = [];
    const actionPlans = [
      { id: 'action-overlay-toggle', title: 'Overlay toggle', label: 'Action: overlay toggle', run: () => testOverlayToggle() },
      { id: 'action-shortcode-toggle', title: 'Shortcode collapsible toggle', label: 'Action: shortcode collapsible toggle', run: () => testShortcodeToggle() },
      { id: 'action-collapse-toggle', title: 'Collapse toggle', label: 'Action: group collapse toggle', run: () => testCollapseToggle(metadata) },
      { id: 'action-option-search', title: 'Internal option search', label: 'Action: internal option search', run: () => testInternalOptionSearch(metadata) },
      { id: 'action-idle-apply', title: 'Apply Filters without changes', label: 'Action: idle apply', run: () => testIdleApplyAction(pluginDebug) },
      { id: 'action-idle-reset', title: 'Reset Filters without changes', label: 'Action: idle reset', run: () => testIdleResetAction(pluginDebug) },
      { id: 'action-sorting', title: 'Sorting action', label: 'Action: sorting', run: () => testSortingAction(pluginDebug) },
      { id: 'action-pagination', title: 'Pagination action', label: 'Action: pagination', run: () => testPaginationAction(pluginDebug) },
      { id: 'action-reset-filters', title: 'Reset Filters', label: 'Action: reset filters', run: () => testResetAction(metadata, pluginDebug) },
    ];

    progress.setTotal(actionPlans.length + filterCases.length + 1);

    for (const plan of actionPlans) {
      progress.step(plan.label);
      try {
        actionTests.push(await plan.run());
      } catch (error) {
        actionTests.push(await buildUnexpectedFailure(plan.id, plan.title, error, 'action'));
      }
    }

    for (const testCase of filterCases) {
      progress.step(`Filter: ${testCase.title || testCase.id}`);
      try {
        filterTests.push(await executeFilterCase(testCase, pluginDebug));
      } catch (error) {
        filterTests.push(
          await buildUnexpectedFailure(testCase.id, testCase.title || testCase.id, error, 'filter')
        );
      }
    }

    const failures = [...actionTests, ...filterTests].filter((test) => !test.passed);
    const uniqueMessages = [];
    const seenMessages = new Set();

    for (const message of filterRelevantMessages(globalMessages)) {
      const key = `${message.type}:${message.text}`;
      if (seenMessages.has(key)) continue;
      seenMessages.add(key);
      uniqueMessages.push(message);
    }

    const report = {
      siteLabel: config.siteLabel,
      runMode: config.runMode,
      deviceMode: config.deviceMode,
      baseUrl: config.baseUrl,
      configPath: config.configPath,
      outputDir,
      reportJsonPath,
      reportMarkdownPath,
      generatedConfigPath: generatedConfig ? generatedConfigPath : null,
      startedAt,
      finishedAt: new Date().toISOString(),
      baselineSummary,
      totalActionTests: actionTests.length,
      totalFilterTests: filterTests.length,
      passedActionTests: actionTests.filter((test) => test.passed).length,
      passedFilterTests: filterTests.filter((test) => test.passed).length,
      failedCount: failures.length,
      skippedActionTests: actionTests.filter((test) => test.skipped).length,
      actionTests,
      filterTests,
      uniqueMessages,
      pluginDebug,
      autoDiscovery: config.autoDiscovery || {
        used: false,
      },
      effectiveConfig: {
        siteLabel: config.siteLabel,
        baseUrl: config.baseUrl,
        deviceMode: config.deviceMode,
        selectors: config.selectors,
        testData: config.testData,
        fieldOverrides: config.fieldOverrides,
        actionTargets: config.actionTargets,
        skipFieldsets: config.skipFieldsets,
      },
      summary: {
        failedActionTests: summarizeIssueCounts(actionTests),
        failedFilterTests: summarizeIssueCounts(filterTests),
      },
    };

    progress.step('Writing reports');
    await writeJson(reportJsonPath, report);
    await fs.writeFile(reportMarkdownPath, buildMarkdownReport(report), 'utf8');

    console.log(`QC completed for ${config.siteLabel}`);
    console.log(`Run mode: ${config.runMode}`);
    console.log(`Device: ${config.deviceMode}`);
    console.log(`Report JSON: ${reportJsonPath}`);
    console.log(`Report MD:   ${reportMarkdownPath}`);
    if (generatedConfig) {
      console.log(`Generated config: ${generatedConfigPath}`);
    }
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
