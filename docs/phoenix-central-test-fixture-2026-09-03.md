# Phoenix Central real-world test fixture — 2026-09-03 morning

Source: manager-provided district performance screen for PHX / PhoenixCentral. Use this as the first-real-test reference after authenticated workspace bootstrap. Do not seed production before the owner account/workspace exists.

## Month context
- Month: September 2026
- Selling/work days in month: 25
- Days left shown: 23
- Completed selling days: 2

## Current monthly statistics
| Store | MTD Sales | CC | CC Zero | CC Goal | CC Proj | Avg Ticket | Projected | Parts % | Labor % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 122-Thomas | 8,401 | 24 | 1 | 1 | 300 | 350.03 | 105,008 | 25.04 | 28.38 |
| 128-Ray Rd. | 3,803 | 23 | 5 | 1 | 288 | 165.35 | 47,538 | 25.77 | 25.49 |
| 146-Hayden | 7,187 | 20 | 2 | 1 | 250 | 359.35 | 89,837 | 19.53 | 32.48 |
| 148-Scottsdale | 7,346 | 29 | 3 | 1 | 362 | 253.30 | 91,820 | 25.91 | 20.95 |
| 236-Lower Buckeye | 6,223 | 25 | 6 | 1 | 312 | 248.91 | 77,785 | 27.90 | 34.39 |
| 240-24th | 8,270 | 39 | 7 | 1 | 488 | 212.06 | 103,381 | 24.87 | 35.85 |
| 244-Baseline | 6,413 | 44 | 13 | 1 | 550 | 145.76 | 80,166 | 21.44 | 28.93 |
| Total Market | 47,643 | 204 | 37 | 7 | 2,550 | 233.54 | 595,535 | 24.26 | 29.78 |

Projection check: MTD sales / 2 completed selling days * 25 total selling days. Example Store 122: 8,401 / 2 * 25 = 105,012.50; source display shows 105,008, likely due to underlying unrounded sales/timing. App should continue using its deterministic stored-value formula rather than copying displayed projection.

## Prior-year completed September
| Store | LY Sales | LY CC | LY Avg Ticket |
|---|---:|---:|---:|
| 122-Thomas | 112,052 | 280 | 133.40 |
| 128-Ray Rd. | 85,630 | 299 | 95.46 |
| 146-Hayden | 102,060 | 223 | 305.32 |
| 148-Scottsdale | 77,011 | 293 | 87.61 |
| 236-Lower Buckeye | 99,734 | 329 | 101.05 |
| 240-24th | 114,825 | 524 | 73.04 |
| 244-Baseline | 100,828 | 420 | 80.02 |
| Total Market | 692,140 | 2,468 | 96.56 |

## Daily actual shown that morning
| Store | Daily Sales | Daily CC | Daily CC Zero | Daily Avg Ticket |
|---|---:|---:|---:|---:|
| 122-Thomas | 3,383 | 12 | 1 | 281.94 |
| 128-Ray Rd. | 1,099 | 9 | 2 | 122.06 |
| 146-Hayden | 4,345 | 11 | 1 | 395.00 |
| 148-Scottsdale | 4,423 | 14 | 2 | 315.96 |
| 236-Lower Buckeye | 1,124 | 9 | 1 | 124.85 |
| 240-24th | 4,495 | 17 | 2 | 264.42 |
| 244-Baseline | 3,205 | 25 | 12 | 128.20 |
| Total Market | 22,074 | 97 | 21 | 227.57 |

## Weekly actual shown
| Store | Weekly Sales | Weekly CC | Weekly CC Zero | Weekly Avg Ticket |
|---|---:|---:|---:|---:|
| 122-Thomas | 10,781 | 38 | 4 | 283.72 |
| 128-Ray Rd. | 5,912 | 32 | 7 | 184.74 |
| 146-Hayden | 8,093 | 26 | 2 | 311.27 |
| 148-Scottsdale | 10,024 | 35 | 3 | 286.40 |
| 236-Lower Buckeye | 7,357 | 36 | 13 | 204.35 |
| 240-24th | 12,461 | 57 | 8 | 218.61 |
| 244-Baseline | 12,348 | 52 | 13 | 237.46 |
| Total Market | 66,975 | 276 | 50 | 242.66 |

## Important fixture rules
- The screenshot's Goal and % of Goal cells are visually truncated/invalid and must NOT be inferred from the image.
- Keep app sales goals configurable; do not fabricate monthly goals from this fixture.
- Treat CC as car count and Avg Ticket as sales / car count where applicable.
- CC Zero is useful future KPI input, but current production schema does not yet have a dedicated core field; model it later as a custom KPI if desired.
- Current app labor/parts cost fields store MTD dollars. When creating fixture rows after bootstrap, derive cost dollars from MTD sales * percentage / 100 so the app reproduces the shown percentages.
- Prior-year daily same-selling-day data is not present here. This fixture supports projected month-end vs LY final, but not same-selling-day TY/LY unless additional historical daily data is supplied.
