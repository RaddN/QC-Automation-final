# QC Report: free-filter-plugin-local-products

- Run mode: url-auto
- Device: desktop
- Base URL: http://free-filter-plugin.local/products/
- Started: 2026-04-22T10:00:00.043Z
- Finished: 2026-04-22T10:08:52.228Z
- Action tests: 4/5 passed
- Filter tests: 13/17 passed
- Failed tests: 5
- JSON report: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-155926\report.json
- Output directory: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-155926
- Generated config: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-155926\generated-config.json
- Auto discovery source: dom+woo-store-api
- Auto-discovered products: 50
- Plugin debug selectors: product=ul.products, resultCount=.woocommerce-result-count
- Plugin apply mode: auto
- Plugin mobile breakpoint: 768

## Failing Action Tests

### Collapse toggle on plugincy_rating (action-collapse-toggle)

- Collapse toggle did not consistently hide and restore items.

## Failing Filter Tests

### Search Product (search_text)

- Kind: text
- Apply URL: http://free-filter-plugin.local/products/
- Reload URL: http://free-filter-plugin.local/products/
- Filtered URL did not change after the filter interaction.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-155926\fail-search-text-apply-reload.png

### Price Range (price-range)

- Kind: inputs
- Apply URL: http://free-filter-plugin.local/products/
- Reload URL: http://free-filter-plugin.local/products/
- Filtered URL did not change after the filter interaction.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-155926\fail-price-range-apply-reload.png

### sku (sku)

- Kind: text
- Apply URL: http://free-filter-plugin.local/products/
- Reload URL: http://free-filter-plugin.local/products/
- Filtered URL did not change after the filter interaction.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-155926\fail-sku-apply-reload.png

### discount (discount)

- Kind: text
- Apply URL: http://free-filter-plugin.local/products/
- Reload URL: http://free-filter-plugin.local/products/
- Filtered URL did not change after the filter interaction.
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\free-filter-plugin-local-products-desktop-20260422-155926\fail-discount-apply-reload.png

