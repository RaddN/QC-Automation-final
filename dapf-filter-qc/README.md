# DAPF Filter QC

Reusable Playwright QC automation for storefronts that use Dynamic AJAX Product Filters for WooCommerce.

## What It Tests

- Apply one pass across detected filter groups.
- Verify filtered URL changes after apply.
- Verify the selected state is still present immediately after apply.
- Reload the filtered URL and verify the selected state again.
- Test idle apply behavior when an Apply button is visible.
- Test idle reset behavior when a Reset button is visible.
- Test sorting actions and reload persistence.
- Test pagination actions and reload persistence.
- Test reset behavior after a real filter selection.
- Test one collapse toggle interaction.
- Test one internal option-search interaction.
- Inspect plugin runtime settings and include selector/mode/toggle context in the report.
- Save JSON and Markdown reports plus failure screenshots.
- In URL-only mode, auto-discover test data, filter option values, and action targets from the live site.

## Folder Layout

- `src/run-qc.js`: main runner
- `run-qc.ps1`: Windows entrypoint
- `configs/example.config.json`: template config
- `configs/dynamic-local.config.json`: current local-site config
- `reports/`: generated reports

## First Run

```powershell
cd "C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc"
npm install
```

## Run With The Current Local Config

```powershell
cd "C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc"
.\run-qc.ps1
```

When you run without arguments, the launcher now accepts either:

- a config file name/path such as `beautymediashop.config.json`
- a direct site URL such as `https://client-site.com/shop/`

If `.ps1` files open in Notepad on your PC, use the batch wrapper instead:

```powershell
cd "C:\Users\GM Team\OneDrive\Desktop\QC Automation\dapf-filter-qc"
.\run-qc.cmd
```

## Run Against Another Site

### Fastest: URL-only mode

```powershell
.\run-qc.cmd "https://client-site.com/shop/"
```

or:

```powershell
.\run-qc.ps1 -Url "https://client-site.com/shop/"
```

In this mode the runner will try to auto-discover:

- search text
- price range
- sku
- discount
- dimensions
- checkbox/select option values
- collapse target
- reset target
- internal option-search target

It also writes a generated config file into the report folder so you can reuse or refine it later.

### Controlled: config mode

1. Copy `configs/example.config.json`.
2. Update only the parts you want to lock down:
   - `siteLabel`
   - `baseUrl`
   - `testData`
   - `fieldOverrides`
   - `actionTargets`
3. Run:

```powershell
.\run-qc.ps1 -Config ".\configs\my-client-site.config.json"
```

Or override the URL directly:

```powershell
.\run-qc.ps1 -Config ".\configs\my-client-site.config.json" -Url "https://client-site.com/products/"
```

You can swap `run-qc.ps1` with `run-qc.cmd` in the same commands if PowerShell scripts are associated with Notepad.

If you use the prompt, you can type either:

- just the file name, for example `beautymediashop.config.json`
- a site URL, for example `https://client-site.com/shop/`
- a relative path
- a full absolute path

## Output

Each run writes a timestamped folder under `reports/` containing:

- `report.json`: full machine-readable result
- `report.md`: readable summary
- `generated-config.json`: auto-discovered config snapshot for URL-only runs
- `fail-*.png`: screenshots for failing flows

## Notes

- This runner is designed for sites that use the same filter markup pattern as your plugin output.
- The report now summarizes plugin-aware context such as URL mode, overlay state, sorting/pagination selectors, AJAX toggles, and the main filter visibility flags exposed by the plugin debug data.
- URL-only mode is best-effort. If a site hides useful data, the runner will skip the unsupported filter types rather than guessing fake values.
- For client sites you test often, start with URL-only mode once, then promote the generated config into `configs/` if you want a stricter repeatable setup.
- The script exits with code `1` when it finds QC failures. That is useful for CI or batch runs.
