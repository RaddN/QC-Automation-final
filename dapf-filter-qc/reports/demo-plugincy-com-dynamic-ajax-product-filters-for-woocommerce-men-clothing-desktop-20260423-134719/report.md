# QC Report: demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing

- Run mode: url-auto
- Device: desktop
- Base URL: https://demo.plugincy.com/dynamic-ajax-product-filters-for-woocommerce/men-clothing/
- Started: 2026-04-23T07:47:42.950Z
- Finished: 2026-04-23T07:53:28.809Z
- Action tests: 9/9 passed
- Filter tests: 8/9 passed
- Failed tests: 1
- JSON report: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-desktop-20260423-134719\report.json
- Output directory: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-desktop-20260423-134719
- Generated config: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-desktop-20260423-134719\generated-config.json
- Auto discovery source: dom-only
- Auto-discovered products: 0
- Sampled fieldsets: 16
- Duplicate fieldset cap: 3 per DOM id
- Auto discovery API error: HTTP 404
- Plugin selectors: product=ul.products, pagination=.woocommerce-pagination, sorting=form.woocommerce-ordering select, resultCount=.woocommerce-result-count
- Plugin features: apply=auto, url=query_string, overlay=on, ajax pagination=on, ajax sorting=on
- Plugin filters: search=on, categories=on, attributes=on, tags=on, price=on, rating=on
- Plugin mobile: style=style_1, breakpoint=768

## Failing Action Tests

All action tests passed.

## Failing Filter Tests

### Brands Reset (008-brands-brands-reset)

- Kind: radios
- URL mode: query_string
- Apply URL: https://demo.plugincy.com/dynamic-ajax-product-filters-for-woocommerce/men-clothing/?filters=1&brand=crocodile&orderby=menu_order
- Reload URL: https://demo.plugincy.com/dynamic-ajax-product-filters-for-woocommerce/men-clothing/?filters=1&brand=crocodile&orderby=menu_order
- Selected state was not preserved after page reload.
- Screenshot: C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc\reports\demo-plugincy-com-dynamic-ajax-product-filters-for-woocommerce-men-clothing-desktop-20260423-134719\fail-008-brands-brands-reset-apply-reload.png

## Unique Browser Messages

- response:error: GET https://demo.plugincy.com/wp-json/wc/store/v1/products?per_page=50 :: HTTP 404

