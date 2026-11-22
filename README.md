# WaterWatch

A fully offline field notebook that screens single-tap drinking-water lab results
against federal screening benchmarks. It reads a strict CSV of measurements,
shows which readings sit above their reference levels, models simple what-if
scenarios, and prints a bilingual (English/Spanish) tap-safety one-pager.

Everything runs in the browser. There are no dependencies, no build step, and
no network calls: the page's Content-Security-Policy forbids connections, and
every computation happens in local JavaScript.

**Live demo:** [https://aariv.me/waterwatch/](https://aariv.me/waterwatch/)

## Run it

```sh
npm run serve
```

Then open `http://127.0.0.1:8000/` (the script is `python3 -m http.server 8000
--bind 127.0.0.1`). Any static file server works; the app only needs `index.html`,
`styles.css`, and the ES modules in `src/`. No background network requests. Serve
these files locally to run without internet.

## Test it

```sh
npm test
```

Node 18 or newer, no packages to install.

## What it does and does not claim

- Each result is one sample from one tap. The screen is educational and is not a
  compliance determination, a 90th-percentile calculation, or a potability
  clearance.
- The four presets (school, private well, post-storm, municipal baseline) are
  synthetic teaching data, not measurements from real systems. The baseline
  preset only means "within the screened benchmarks".
- The 2024 PFAS rule judges quarterly monitoring by running annual average and
  applies significant-figure rounding. This screen shows rounding as context
  only and never rounds or discards a reading before comparing.
- The Hazard Index term covers only PFHxS, PFNA, GenX, and PFBS. The mixture
  benchmark needs at least two positive constituents; the screen still flags
  any summed index above 1, PFBS alone is not an MCL, and unreported
  constituents stay visible as unknowns.
- The lead benchmark shown is the 10 ppb action level with its November 1, 2027
  compliance date; the legacy 15 ppb 90th-percentile system action level is
  shown alongside. There is no known safe level of lead exposure.
- A positive E. coli lab result warrants urgent contact with the water system
  and health officials. An actual Total Coliform Rule violation depends on
  routine and repeat sample combinations this tool does not model.
- Evaporation, first-draw flush, and filter cost panels are idealized teaching
  models with their assumptions labeled. Scenario filter removal fractions are
  illustrative; certification is per product and standard, no household filter
  is presented as an advisory fix, and arsenic coverage is not implied where a
  product's test data does not verify it.
- EPA proposed changes in 2026; this catalog is a 2024 snapshot, not a live
  regulatory feed.
- Every export is tagged with its origin: `synthetic` for the bundled presets
  and `unverified-input` for anything the user typed, pasted, or uploaded.

## Import format

`src/import.js` exports `CSV_HEADERS`, `parseCsv(text)`, and
`decodeUpload(buffer)`. Uploads are capped at 1 MB and 500 data rows, require a
`tap` column plus at least one advisory, E. coli, or measurement column, and
fail closed on structural or field errors with row and field detail. Empty
cells are unreported values; `ND` and `<` results must not be converted to zero.

Columns:

```
tap, advisory, ecoli,
lead_ppb, copper_ppb, nitrate_mg_l_as_n, arsenic_ppb,
pfoa_ppt, pfos_ppt, pfhxs_ppt, pfna_ppt, genx_ppt, pfbs_ppt
```

`advisory` is `none`, `boil`, `do-not-drink`, `do-not-use`, or `unknown`.
`ecoli` is `present`, `absent`, or `unknown`.

## File map

- `index.html`, `styles.css`: the field-notebook surface and print sheet.
- `src/engine.js`: benchmarks, normalization, screening, and the three models.
- `src/import.js`: strict CSV tokenizer, decoder, and record normalizer.
- `src/app.js`: UI state, rendering, exports, print sheet, keyboard shortcuts.
- `src/shortcuts.js`: guarded `i`/`p` keyboard actions, off by default.
- `src/presets.js`: the four synthetic preset CSVs.
- `src/exports.js`: audit CSV and fingerprinted JSON bundle writers, each
  flagged `synthetic` or `unverified-input` from where the data came.
- `test/`: node:test suites for the parser, shortcuts, engine, and exports.
- `scripts/browser-smoke.mjs`: headless-Chrome smoke run that captures the
  screenshots in `docs/`.
- `docs/REGULATORY.md`: the regulatory reference notes behind the benchmarks.

## Sources

- EPA, PFAS National Primary Drinking Water Regulation (final rule, 2024):
  https://www.federalregister.gov/documents/2024/04/26/2024-07773/pfas-national-primary-drinking-water-regulation
- EPA, significant-figure rounding for the PFAS rule (Dec 2024):
  https://www.epa.gov/system/files/documents/2024-12/pfas-sigfigs-rounding-dec24.pdf
- EPA, proposed PFAS rescission rule (proposed 2026):
  https://www.epa.gov/sdwa/proposed-pfas-rescission-rule
- EPA, Lead and Copper Rule Improvements:
  https://www.epa.gov/ground-water-and-drinking-water/lead-and-copper-rule-improvements
- EPA, National Primary Drinking Water Regulations table:
  https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations
- E. coli maximum contaminant level, 40 CFR 141.63:
  https://www.ecfr.gov/current/title-40/part-141/section-141.63
- CDC, Drinking Water Advisories overview:
  https://www.cdc.gov/water-emergency/about/drinking-water-advisories-an-overview.html
- CDC, feeding your child safely during a disaster (ready-to-feed formula):
  https://www.cdc.gov/breastfeeding/php/guidelines-recommendations/feeding-your-child-safely-during-a-disaster.html
- EPA, identifying drinking-water filters certified to reduce PFAS:
  https://www.epa.gov/water-research/identifying-drinking-water-filters-certified-reduce-pfas
