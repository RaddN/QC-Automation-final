# QC Report: demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing

- Run mode: url-auto
- Device: mobile
- Base URL: https://demo.plugincy.com/dynamic-ajax-product-filters-for-woocommerce/men-clothing/
- Started: 2026-04-22T11:28:05.451Z
- Finished: 2026-04-22T11:29:46.048Z
- Action tests: 4/5 passed
- Filter tests: 1/2 passed
- Failed tests: 2
- JSON report: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-mobile-20260422-172719\report.json
- Output directory: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-mobile-20260422-172719
- Generated config: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-mobile-20260422-172719\generated-config.json
- Auto discovery source: dom-only
- Auto-discovered products: 0
- Auto discovery API error: HTTP 404
- Plugin debug selectors: product=ul.products, resultCount=.woocommerce-result-count
- Plugin apply mode: auto
- Plugin URL mode: query_string
- Plugin mobile breakpoint: 768

## Failing Action Tests

### Reset Filters on Rating Reset (action-reset-filters)

- Reset Filters did not return the page to the initial products URL.

## Failing Filter Tests

### Price Range (002-price-range-price-range)

- Kind: inputs
- URL mode: query_string
- Apply URL: https://demo.plugincy.com/dynamic-ajax-product-filters-for-woocommerce/men-clothing/?filters=1&orderby=date
- Reload URL: https://demo.plugincy.com/dynamic-ajax-product-filters-for-woocommerce/men-clothing/?filters=1&orderby=date
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-mobile-20260422-172719\fail-002-price-range-price-range-apply-reload.png

## Unique Browser Messages

- response:error: GET https://demo.plugincy.com/wp-json/wc/store/v1/products?per_page=50 :: HTTP 404

