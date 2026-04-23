# QC Report: demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing

- Run mode: url-auto
- Device: desktop
- Base URL: https://demo.plugincy.com/dynamic-ajax-product-filters-for-woocommerce/men-clothing/
- Started: 2026-04-23T07:03:35.560Z
- Finished: 2026-04-23T07:08:05.417Z
- Action tests: 4/5 passed
- Filter tests: 8/9 passed
- Failed tests: 2
- JSON report: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-desktop-20260423-130313\report.json
- Output directory: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-desktop-20260423-130313
- Generated config: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-desktop-20260423-130313\generated-config.json
- Auto discovery source: dom-only
- Auto-discovered products: 0
- Sampled fieldsets: 16
- Duplicate fieldset cap: 3 per DOM id
- Auto discovery API error: HTTP 404
- Plugin debug selectors: product=ul.products, resultCount=.woocommerce-result-count
- Plugin apply mode: auto
- Plugin URL mode: query_string
- Plugin mobile breakpoint: 768

## Failing Action Tests

### Reset Filters on Rating Reset (action-reset-filters)

- Reset Filters did not return the page to the initial products URL.

## Failing Filter Tests

### Brands Reset (008-brands-brands-reset)

- Kind: radios
- URL mode: query_string
- Apply URL: https://demo.plugincy.com/dynamic-ajax-product-filters-for-woocommerce/men-clothing/?filters=1&brand=crocodile&orderby=menu_order
- Reload URL: https://demo.plugincy.com/dynamic-ajax-product-filters-for-woocommerce/men-clothing/?filters=1&brand=crocodile&orderby=menu_order
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-desktop-20260423-130313\fail-008-brands-brands-reset-apply-reload.png

## Unique Browser Messages

- response:error: GET https://demo.plugincy.com/wp-json/wc/store/v1/products?per_page=50 :: HTTP 404

