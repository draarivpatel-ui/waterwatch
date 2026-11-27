# WaterWatch

A fully offline field notebook that screens single-tap drinking-water lab results
against federal screening benchmarks. It reads a strict CSV of measurements,
shows which readings sit above their reference levels, compares the inorganic
readings with WHO guideline values, points to likely contamination sources,
models simple what-if scenarios, and prints a bilingual (English/Spanish)
one-page community water field audit sheet.
A mixture and sensitivity lab compares all four presets against every
benchmark, runs deterministic self-tests in the page, and exports a
SHA-256-stamped lab brief that a `#ww=` bookmark link restores. An SDG 6
clean-water equity lab models the 6.1.1 service ladder, the 6.3.2 exceedance
profile and an illustrative 6.4.2 stress index, and plans low-cost
interventions against a grant budget.

Everything runs in the browser. There are no dependencies, no build step, and
no network calls: the page's Content-Security-Policy forbids connections, and
every computation happens in local JavaScript.

**Live demo:** [https://aariv.xyz/waterwatch/](https://aariv.xyz/waterwatch/)

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

Node 18 or newer, no packages to install. The suite has 784 tests:
diagnostic 52, engine 222, exports 57, hygiene 3, import 73, mixture-lab 187,
pfas-signal 7, SDG 6 equity 151, script-safety 13, shortcuts 19; lab modules 338; page self-tests 32.

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
- The Hazard Index term covers only PFHxS, PFNA, GenX, and PFBS. EPA
  multi-constituent mixture applicability needs at least two constituents at or
  above their practical quantitation levels; the screen still flags any exact
  summed index above 1 as a screening signal, PFBS alone is not an MCL, and
  unreported constituents stay visible as unknowns.
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
- WHO guideline values (lead, copper, nitrate, arsenic) come from the 2026
  Guidelines for drinking-water quality, fourth edition incorporating the
  first, second and third addenda, and are shown for comparison only;
  every finding uses the EPA benchmark. WHO sets no final guideline value for
  these PFAS, so PFAS rows compare to EPA alone.
- "Likely sources and field steps" are screening hints built from the EPA
  drinking water regulations table and simple patterns in the loaded taps
  (for example a first-draw tap far above its flushed pair). They point to
  where to look; they never prove a source.
- Every export is tagged with its origin: `synthetic` for the bundled presets
  and `unverified-input` for anything the user typed, pasted, or uploaded.
- The lab's scenario matrices are teaching models. During a reported advisory
  (boil, do-not-drink, do-not-use) or a positive E. coli result every modeled
  reduction is withheld; a household filter or flush model is never presented
  as an advisory fix.

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
pfoa_ppt, pfos_ppt, pfhxs_ppt, pfna_ppt, genx_ppt, pfbs_ppt,
pair_id, draw_type
```

`advisory` is `none`, `boil`, `do-not-drink`, `do-not-use`, or `unknown`.
`ecoli` is `present`, `absent`, or `unknown`. `pair_id` and `draw_type` are
optional paired-draw provenance columns; `draw_type` is `first-draw`,
`flushed`, `other`, or `unknown`.

## File map

- `index.html`, `styles.css`: the field-notebook surface and print sheet.
- `src/engine.js`: benchmarks, normalization, screening, and the three models.
- `src/import.js`: strict CSV tokenizer, decoder, and record normalizer.
- `src/app.js`: UI state, rendering, exports, print sheet, keyboard shortcuts.
- `src/shortcuts.js`: guarded `i`/`p` keyboard actions, off by default.
- `src/presets.js`: the four synthetic preset CSVs.
- `src/diagnostic.js`: WHO guideline comparison, the contamination-source
  diagnostic, and the scenario summaries on the preset cards.
- `src/exports.js`: audit CSV and fingerprinted JSON bundle writers, each
  flagged `synthetic` or `unverified-input` from where the data came.
- `src/mixture-lab.js`: pure-JS SHA-256, the `#ww=` bookmark codec, the preset
  comparator, scenario matrices, the digest-stamped lab brief, the in-page
  self-tests, and the English/Spanish lab mount.
- `src/sdg6-equity.js`: the SDG 6 equity lab: indicator engines for 6.1.1,
  6.3.2 and 6.4.2, the intervention planner and fit model, and its own
  in-page self-tests.
- `test/`: node:test suites for the parser, shortcuts, engine, exports,
  hygiene, the source diagnostic, and both lab modules.
- `scripts/browser-smoke.mjs`: headless-Chrome smoke run that captures the
  screenshots in scratch by default and refreshes the `docs/` images with
  `--update-artifacts`.
- `scripts/sdg6-audit.mjs`: headless-Chrome audit of the SDG 6 lab: real
  pointer and keyboard input, `#ww=` reload-restore, and a routed JSON
  download.
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
- WHO, Guidelines for drinking-water quality, fourth edition incorporating the
  first, second and third addenda (2026):
  https://www.who.int/publications/i/item/9789240121225
