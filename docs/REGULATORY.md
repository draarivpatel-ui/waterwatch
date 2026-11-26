# Regulatory references and limits

WaterWatch compares each supplied sample to a fixed U.S. benchmark catalog. It cannot establish legal compliance, determine whether a private well is regulated, certify drinking water as safe, or issue or lift a public health advisory.

## PFAS benchmarks

[EPA 2024 final rule, 89 FR 32532, 40 CFR Part 141](https://www.federalregister.gov/documents/2024/04/26/2024-07773/pfas-national-primary-drinking-water-regulation), § 141.61(c)(2) and Subpart Z.

| Substance | MCL in the cited final rule | Significant figures |
| --- | --- | --- |
| PFOA | 4.0 ppt (ng/L) | 2 |
| PFOS | 4.0 ppt (ng/L) | 2 |
| PFHxS | 10 ppt (ng/L) | 1 |
| PFNA | 10 ppt (ng/L) | 1 |
| HFPO-DA (GenX) | 10 ppt (ng/L) | 1 |
| PFBS | No individual MCL in the cited rule | Not applicable |
| Hazard Index, mixture of two or more | 1 (unitless) | 1 |

The 2024 rule states on page 32533: "A PFAS mixture Hazard Index greater than 1 (unitless) indicates an exceedance of the health protective level." Its health-based water concentrations are 10 ng/L each for PFHxS, PFNA and HFPO-DA, and 2,000 ng/L for PFBS. The index adds the four individual concentration-to-reference ratios.

WaterWatch's primary number compares the reported decimal exactly, without intermediate rounding. For example, 4.001 ppt of PFOA is above 4.0 in this screen. The adjacent two-significant-figure display is 4.0. An HI of 1.0001 is likewise above 1 in the screen, while it displays as 1 at one significant figure. The [EPA Hazard Index guide](https://www.epa.gov/system/files/documents/2024-12/hazard-index-qrg-dec24.pdf) says: "Rounding only occurs at the end of the overall calculation." The [EPA significant figures guide](https://www.epa.gov/system/files/documents/2024-12/pfas-sigfigs-rounding-dec24.pdf) explains rounding for actual compliance. This workbench shows single-sample rounding context only. It does not apply practical quantitation limit substitutions, a running annual average, regulatory monitoring frequency, or sampling-point eligibility rules. See [EPA's compliance determination guide](https://www.epa.gov/system/files/documents/2025-01/pfas-compliance-determination-qrg-jan25.pdf).

If mixture measurements are missing, the sum of reported concentrations is only a lower bound, not a pass. The workbench flags that lower bound as above whenever the partial sum already exceeds 1. Blank and reported zero are distinct. EPA mixture applicability uses practical quantitation levels: PFHxS 3.0 ppt, PFNA 4.0 ppt, HFPO-DA (GenX) 5.0 ppt, and PFBS 3.0 ppt. At least two constituents must be at or above those levels before the result is labeled the EPA multi-constituent Hazard Index mixture. The workbench still shows every exact reported value in the screening sum and labels a lone high PFBS reading a single-compound screening signal rather than a multi-PFAS mixture. When fewer than two constituents are quantified and the exact sum is not already above 1, the mixture benchmark is not applicable.

In May 2026 EPA [proposed rescinding](https://www.epa.gov/sdwa/proposed-pfas-rescission-rule) portions of the 2024 rule and separately proposed an optional PFOA/PFOS compliance extension. WaterWatch intentionally retains the 2024 snapshot, not a live federal or state regulation feed.

## Other benchmarks and advisory sources

- [EPA's 2024 Lead and Copper Rule Improvements](https://www.federalregister.gov/documents/2024/10/30/2024-23549/national-primary-drinking-water-regulations-for-lead-and-copper-improvements-lcri) refer to a lead action level of 0.010 mg/L (10 ppb); EPA lists November 1, 2027 as the revised lead action level compliance date. The legacy comparison is 0.015 mg/L (15 ppb). These are public-system treatment technique action levels, not single-tap MCLs or safe exposure thresholds.
- [EPA National Primary Drinking Water Regulations](https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations) lists copper at 1.3 mg/L (1,300 ppb) as an action level, nitrate at 10 mg/L measured as nitrogen and arsenic at 0.010 mg/L (10 ppb) as MCLs. The health goal for lead is zero.

For the WHO nitrate comparison, the guideline is 50 mg/L as the nitrate ion. WaterWatch uses the exact molar-mass conversion 50 * 14.0067 / 62.0049 = 11.294833... mg/L as N, displayed as about 11.3 mg/L as N.

- The E. coli maximum contaminant level goal is zero. Actual system MCL criteria depend on routine and repeat tests and, in some cases, missing follow-up. See [40 CFR § 141.63(c)](https://www.ecfr.gov/current/title-40/part-141/section-141.63).
- The [CDC advisory overview](https://www.cdc.gov/water-emergency/about/drinking-water-advisories-an-overview.html) distinguishes boil-water, do-not-drink, and do-not-use notices. Chemical and microbial co-occurrence warrants an alternative source approved by public health officials, not simply boiling or relying on household filtration. See [CDC guidance on infant feeding during disasters](https://www.cdc.gov/breastfeeding/php/guidelines-recommendations/feeding-your-child-safely-during-a-disaster.html).
- [EPA guidance on PFAS filter certification](https://www.epa.gov/water-research/identifying-drinking-water-filters-certified-reduce-pfas) explains why certification is product- and contaminant-claim-specific. The workbench's assumed reduction percentages are not taken from NSF/ANSI standards or a tested product. Its arsenic scenario assumes pentavalent arsenic; total measured arsenic alone cannot validate that assumption. Neither modeled option estimates microbial risk reduction.
