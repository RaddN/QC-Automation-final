# QC Report: free-filter-plugin-local-products

- Run mode: url-auto
- Device: desktop
- Base URL: http://free-filter-plugin.local/products/
- Started: 2026-04-22T11:40:34.696Z
- Finished: 2026-04-22T11:46:58.746Z
- Action tests: 4/5 passed
- Filter tests: 5/13 passed
- Failed tests: 9
- JSON report: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174007\report.json
- Output directory: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174007
- Generated config: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174007\generated-config.json
- Auto discovery source: dom+woo-store-api
- Auto-discovered products: 50
- Sampled fieldsets: 18
- Duplicate fieldset cap: 3 per DOM id
- Plugin debug selectors: product=ul.products, resultCount=.woocommerce-result-count
- Plugin apply mode: auto
- Plugin URL mode: query_string
- Plugin mobile breakpoint: 768

## Failing Action Tests

### Collapse toggle on Rating Reset (action-collapse-toggle)

- Collapse toggle did not consistently hide and restore items.

## Failing Filter Tests

### Material (005-material-material)

- Kind: checkboxes
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/?filters=1&material=cord-fabric,cotton
- Reload URL: http://free-filter-plugin.local/products/?filters=1&material=cord-fabric,cotton
- Selected state was not preserved immediately after apply.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174007\fail-005-material-material-apply-reload.png

### Size (006-size-size)

- Kind: checkboxes
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/?filters=1&size=l,m
- Reload URL: http://free-filter-plugin.local/products/?filters=1&size=l,m
- Selected state was not preserved immediately after apply.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174007\fail-006-size-size-apply-reload.png

### Men's Trend (007-mens-trend-men-s-trend)

- Kind: checkboxes
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/?filters=1&mens-trend=nautical,office
- Reload URL: http://free-filter-plugin.local/products/?filters=1&mens-trend=nautical,office
- Selected state was not preserved immediately after apply.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174007\fail-007-mens-trend-men-s-trend-apply-reload.png

### test10 (008-test10-test10)

- Kind: checkboxes
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/?filters=1&test10=test
- Reload URL: http://free-filter-plugin.local/products/?filters=1&test10=test
- Selected state was not preserved immediately after apply.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174007\fail-008-test10-test10-apply-reload.png

### tag (009-tag-tag)

- Kind: radios
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/?filters=1&tags=10-attachments
- Reload URL: http://free-filter-plugin.local/products/?filters=1&tags=10-attachments
- Selected state was not preserved immediately after apply.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174007\fail-009-tag-tag-apply-reload.png

### brands (010-brands-brands)

- Kind: radios
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/?filters=1&brand=lenevo
- Reload URL: http://free-filter-plugin.local/products/?filters=1&brand=lenevo
- Selected state was not preserved immediately after apply.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174007\fail-010-brands-brands-apply-reload.png

### Sale Status (013-sale-status-sale-status)

- Kind: checkboxes
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/?filters=1&saleStatus=notonsale
- Reload URL: http://free-filter-plugin.local/products/?filters=1&saleStatus=notonsale
- Selected state was not preserved immediately after apply.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174007\fail-013-sale-status-sale-status-apply-reload.png

### Date Filter (017-date-filter-date-filter)

- Kind: single-select
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/?filters=1&date=today
- Reload URL: http://free-filter-plugin.local/products/?filters=1&date=today
- Selected state was not preserved immediately after apply.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174007\fail-017-date-filter-date-filter-apply-reload.png

