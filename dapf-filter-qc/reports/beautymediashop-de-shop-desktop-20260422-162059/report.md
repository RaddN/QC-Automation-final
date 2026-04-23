# QC Report: beautymediashop-de-shop

- Run mode: url-auto
- Device: desktop
- Base URL: https://beautymediashop.de/shop/
- Started: 2026-04-22T10:21:27.508Z
- Finished: 2026-04-22T10:32:04.472Z
- Action tests: 4/5 passed
- Filter tests: 16/18 passed
- Failed tests: 3
- JSON report: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\beautymediashop-de-shop-desktop-20260422-162059\report.json
- Output directory: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\beautymediashop-de-shop-desktop-20260422-162059
- Generated config: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\beautymediashop-de-shop-desktop-20260422-162059\generated-config.json
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

- Kind: undefined
- URL mode: unknown
- Apply URL: n/a
- Reload URL: n/a
- locator.fill: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for locator('#product-filter .plugincy-filter-group#price-range [name="mn_price"]').first()[22m
[2m    - locator resolved to <input min="0" max="99" value="0" type="number" id="min-price" name="mn_price" class="input-min"/>[22m
[2m    - fill("419")[22m
[2m  - attempting fill action[22m
[2m    2 × waiting for element to be visible, enabled and editable[22m
[2m      - element is not visible[22m
[2m    - retrying fill action[22m
[2m    - waiting 20ms[22m
[2m    2 × waiting for element to be visible, enabled and editable[22m
[2m      - element is not visible[22m
[2m    - retrying fill action[22m
[2m      - waiting 100ms[22m
[2m    59 × waiting for element to be visible, enabled and editable[22m
[2m       - element is not visible[22m
[2m     - retrying fill action[22m
[2m       - waiting 500ms[22m

- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\beautymediashop-de-shop-desktop-20260422-162059\fail-price-range-filter.png

### Übungsblätter (category-with-child)

- Kind: checkboxes
- URL mode: ajax
- Apply URL: https://beautymediashop.de/shop/
- Reload URL: https://beautymediashop.de/shop/
- Filter interaction did not produce an observable same-origin network, DOM, or URL change.
- Selected state was not preserved immediately after apply.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\beautymediashop-de-shop-desktop-20260422-162059\fail-category-with-child-apply-reload.png

