# QC Report: beautymediashop-de-shop

- Run mode: url-auto
- Device: desktop
- Base URL: https://beautymediashop.de/shop/
- Started: 2026-04-22T10:35:56.265Z
- Finished: 2026-04-22T10:38:41.399Z
- Action tests: 4/5 passed
- Filter tests: 1/3 passed
- Failed tests: 3
- JSON report: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\beautymediashop-de-shop-desktop-20260422-163529\report.json
- Output directory: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\beautymediashop-de-shop-desktop-20260422-163529
- Generated config: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\beautymediashop-de-shop-desktop-20260422-163529\generated-config.json
- Auto discovery source: dom+woo-store-api
- Auto-discovered products: 50
- Plugin debug selectors: product=ul.products, resultCount=.woocommerce-result-count
- Plugin apply mode: auto
- Plugin URL mode: ajax
- Plugin mobile breakpoint: 1024

## Failing Action Tests

### Collapse toggle on plugincy_rating (action-collapse-toggle)

- Collapse toggle did not consistently hide and restore items.

## Failing Filter Tests

### Preisspanne (price-range)

- Kind: inputs
- URL mode: ajax
- Apply URL: https://beautymediashop.de/shop/
- Reload URL: https://beautymediashop.de/shop/
- Selected state was not preserved immediately after apply.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\beautymediashop-de-shop-desktop-20260422-163529\fail-price-range-apply-reload.png

### Übungsblätter (category-with-child)

- Kind: checkboxes
- URL mode: ajax
- Apply URL: https://beautymediashop.de/shop/
- Reload URL: https://beautymediashop.de/shop/
- Filter interaction did not produce an observable same-origin network, DOM, or URL change.
- Selected state was not preserved immediately after apply.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\beautymediashop-de-shop-desktop-20260422-163529\fail-category-with-child-apply-reload.png

