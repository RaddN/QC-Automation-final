# QC Report: free-filter-plugin-local-products

- Run mode: url-auto
- Device: desktop
- Base URL: http://free-filter-plugin.local/products/
- Started: 2026-04-22T11:48:42.518Z
- Finished: 2026-04-22T11:55:33.975Z
- Action tests: 4/5 passed
- Filter tests: 11/13 passed
- Failed tests: 3
- JSON report: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174815\report.json
- Output directory: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174815
- Generated config: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174815\generated-config.json
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

### tag (009-tag-tag)

- Kind: radios
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/
- Reload URL: http://free-filter-plugin.local/products/
- Filter interaction did not produce an observable same-origin network, DOM, or URL change.
- Filtered URL did not change in query_string mode.
- Selected state was not preserved immediately after apply.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174815\fail-009-tag-tag-apply-reload.png

### brands (010-brands-brands)

- Kind: radios
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/
- Reload URL: http://free-filter-plugin.local/products/
- Filter interaction did not produce an observable same-origin network, DOM, or URL change.
- Filtered URL did not change in query_string mode.
- Selected state was not preserved immediately after apply.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-174815\fail-010-brands-brands-apply-reload.png

