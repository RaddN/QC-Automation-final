# QC Report: free-filter-plugin-local-products

- Run mode: url-auto
- Device: desktop
- Base URL: http://free-filter-plugin.local/products/
- Started: 2026-04-22T10:21:25.747Z
- Finished: 2026-04-22T10:29:46.395Z
- Action tests: 5/5 passed
- Filter tests: 14/17 passed
- Failed tests: 3
- JSON report: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-162059\report.json
- Output directory: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-162059
- Generated config: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-162059\generated-config.json
- Auto discovery source: dom+woo-store-api
- Auto-discovered products: 50
- Plugin debug selectors: product=ul.products, resultCount=.woocommerce-result-count
- Plugin apply mode: auto
- Plugin URL mode: query_string
- Plugin mobile breakpoint: 768

## Failing Action Tests

All action tests passed.

## Failing Filter Tests

### Price Range (price-range)

- Kind: inputs
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/?filters=1&price=169900-500000
- Reload URL: http://free-filter-plugin.local/products/?filters=1&price=169900-500000
- Selected state was not preserved immediately after apply.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-162059\fail-price-range-apply-reload.png

### sku (sku)

- Kind: text
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/
- Reload URL: http://free-filter-plugin.local/products/
- Filter interaction did not produce an observable same-origin network, DOM, or URL change.
- Filtered URL did not change in query_string mode.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-162059\fail-sku-apply-reload.png

### discount (discount)

- Kind: text
- URL mode: query_string
- Apply URL: http://free-filter-plugin.local/products/
- Reload URL: http://free-filter-plugin.local/products/
- Filter interaction did not produce an observable same-origin network, DOM, or URL change.
- Filtered URL did not change in query_string mode.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-162059\fail-discount-apply-reload.png

