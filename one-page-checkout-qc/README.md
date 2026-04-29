# One Page Checkout QC

Reusable Playwright QC automation for storefronts using **One Page Quick Checkout for WooCommerce Pro**.

## What It Tests

- Opens the site with `?plugincydebug=true` and reads the plugin debug payload.
- Discovers required QC targets:
  shop, parent/child category, brand, tag, attribute term, simple product, variable product, and public product taxonomy term archives.
- Verifies basic page health:
  HTTP status, visible PHP/runtime errors, duplicate critical IDs, console errors, and failed same-page requests.
- Verifies plugin runtime exposure:
  localized cart params, settings payload, quick view params, and plugin DOM.
- Verifies archive behavior:
  product cards, direct checkout buttons, quick view buttons/modal, archive quantity inputs, and archive variation controls when enabled.
- Verifies simple and variable product behavior:
  add-to-cart controls, direct checkout buttons, one-page checkout container, and variation forms.
- Tests direct checkout based on active settings:
  allowed pages/types, button text, placement, confirmation dialog, clear-cart request, and the configured method outcome:
  checkout redirect, cart redirect, AJAX add, popup checkout, or side cart.
- Runs safe interactions by default:
  quick view open, cart drawer open, variable selection, and archive variation selection.
- Saves JSON and Markdown reports plus failure screenshots.

Direct checkout tests add products to the cart by default because that is the feature behavior. Generic add-to-cart-only checks stay disabled unless `includeAddToCartInteractions` is enabled in config.

## First Run

```powershell
cd "C:\Users\GM Team\OneDrive\Desktop\QC Automation\one-page-checkout-qc"
npm install
```

## Run With Local Config

```powershell
.\run-qc.ps1
```

or:

```powershell
.\run-qc.cmd
```

## Run Against A Client Site

```powershell
.\run-qc.ps1 -Url "https://client-site.com/shop/" -Device both -Headless
```

The client site must have the updated plugin code that renders `#plugincy-qc-debug-data` when `?plugincydebug=true` is present.

## Output

Each run writes a timestamped folder under `reports/` containing:

- `report.json`: machine-readable result
- `report.md`: readable summary
- `generated-config.json`: discovered targets/settings snapshot
- `fail-*.png`: screenshots for failures

The script exits with code `1` when it finds QC failures.
