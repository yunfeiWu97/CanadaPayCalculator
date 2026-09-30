# CanadaPayCalculator

A native SwiftUI iPhone utility for estimating Canadian employment take-home pay. Manitoba is the first supported province. The app starts with **$65,000 annual salary and semi-monthly pay (24 paycheques)** and recalculates as you edit inputs.

## What is included

- Salary or hourly income, regular hours, and additional weekly overtime with a configurable multiplier.
- Weekly (52), bi-weekly (26), semi-monthly (24), and monthly (12) payroll. Bi-weekly means every two weeks; semi-monthly means twice a month.
- A prominent take-home result, separate federal/Manitoba withholding, CPP, CPP2, EI, and optional deductions.
- A paycheque selector and full-year forecast, including changes when CPP/EI limits are reached.
- Average monthly net pay, annual income and deductions, retirement contributions, employer pension contributions, and effective deduction rate.
- Optional RPP, payroll RRSP, union dues, health/dental premiums, and other deductions before or after income tax. Each can be a percentage of gross or a fixed **per-paycheque** amount.
- Local input persistence, native numeric controls, light/dark appearance, Dynamic Type, VoiceOver labels, and an explanation/reference sheet. No account, analytics, network requests, or third-party runtime dependencies.

## Build and test

Requires **macOS, Xcode 16 or newer, and iOS 17 or newer**.

1. Open `CanadaPayCalculator.xcodeproj` in Xcode. The local `PayrollCore` Swift package resolves from this repository.
2. Select the shared **CanadaPayCalculator** scheme and an iPhone simulator. Run with **Command-R**.
3. Run the payroll unit tests with **Command-U**. For a physical iPhone, choose your development team in Signing & Capabilities and use an appropriate unique bundle identifier.

The standalone Foundation-only engine also runs on a Swift host without Xcode:

```sh
swift test
```

The checked-in GitHub Actions workflow runs Swift package tests, simulator tests, and a Release simulator build on macOS. It will execute after the repository is pushed to GitHub; creating the workflow does not mean it has already passed.

Portable structural checks (Python 3.9+, no additional packages):

```sh
python Scripts/verify_repository.py
```

These checks validate the Xcode project graph and source membership, shared scheme, plist/privacy syntax, local package references, and app icon. They do **not** compile Swift or exercise the iPhone UI.

## Tax year and sources

**2026 parameters, verified September 30, 2026.** The current CRA July edition confirms Manitoba has no mid-year changes, and refers unchanged formulas to the January edition.

- [CRA T4127, January 2026, 122nd edition](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html): rounding; Chapters 2 and 4 for personal amounts and Option 1 withholding; Chapters 6–8 for CPP, CPP2, EI, rates and constants.
- [CRA T4127, July 2026, 123rd edition](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jul/t4127-jul-payroll-deductions-formulas.html): current edition and confirmation of unchanged Manitoba parameters.
- [CRA Manitoba payroll deductions tables, 2026](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032mb-jan/t4032mb-january-general-information.html): corroborating rates, personal amounts, CPP and EI. T4127 governs implementation; table-range midpoint examples can differ from exact remuneration calculations.
- [CRA Payroll Deductions Online Calculator](https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/payroll-deductions-online-calculator.html): useful for independent checks against an actual employer payroll situation.

| Parameter | 2026 value |
| --- | --- |
| Federal bands | 14%, 20.5%, 26%, 29%, 33% |
| Federal thresholds | $58,523; $117,045; $181,440; $258,482 |
| Federal basic personal amount | $16,452, reduced to $14,829 over the prescribed income range |
| Canada employment amount | Up to $1,501 |
| Manitoba bands | 10.8%, 12.75%, 17.4% |
| Manitoba thresholds | $47,000; $100,000 |
| Manitoba basic personal amount | $15,780; reduced above $200,000, zero at $400,000 |
| CPP exemption / YMPE | $3,500 / $74,600 |
| CPP employee rate / maximum | 5.95% / $4,230.45 (includes 1% first additional CPP) |
| CPP2 YAMPE / rate / maximum | $85,000 / 4% / $416 |
| EI insurable maximum / rate / maximum | $68,900 / 1.63% / $1,123.07 |

## Methodology

The payroll engine uses `Decimal` amounts and CRA **Option 1 annualized regular-pay withholding**. It computes federal and provincial tax using the published bracket rates and payroll constants, basic personal credits, base CPP and EI credits, and the federal employment credit. Published rounded payroll constants are retained, rather than substituting the slightly different constants from a continuous annual tax-band calculation.

For every pay period, CPP uses gross pensionable earnings less the period exemption, limited by remaining annual contributions. The exemption is truncated to cents as CRA requires. CPP2 uses year-to-date pensionable earnings crossing the YMPE and stops at its annual maximum. EI uses insurable gross and its remaining annual premium limit. Contribution payments round to cents. Base CPP generates a non-refundable tax credit; first additional CPP and CPP2 generate income deductions. Enhanced CPP deductions track the current cheque, and maximum CPP/EI tax credits continue after contribution caps are reached.

RPP, payroll RRSP, eligible union dues, and the configured other pre-tax amount reduce income used for **income tax**. They do not reduce ordinary pensionable/insurable employment earnings used for CPP/EI. Health/dental premiums and other after-tax deductions reduce net pay without reducing withholding. Employer pension contributions are displayed separately and never subtracted from employee net pay. They can be entered independently of employee contributions. The employer amount represents the contribution you enter, without automatically inferring a plan's matching cap.

The schedule assumes the same recurring earnings and deductions all year, starting at zero year-to-date balances with one employer. Rounded regular cheques are reconciled in the final cheque so annual gross matches the entered salary. Annual net and income tax are **sums of forecast paycheques**; average monthly net is annual net divided by 12. The deduction rate includes tax, statutory contributions, and employee optional deductions. Employer contributions are excluded.

## Reference pay stub

The supplied Manitoba reference has $2,708.33 gross, $152.47 CPP, $44.15 EI, $477.15 income tax and $2,034.56 net. An independent CRA 2026 Option 1 worksheet **reproduces all five amounts to the cent** for the default salary/frequency and basic personal claims. Federal withholding is $262.79 and Manitoba withholding is $214.36. The app and regression tests compare these reference amounts with the calculated estimate; they are never used as engine rates or tax constants. Matching this example does not establish the employer's actual tax year or TD1 details.

| Default scenario, first paycheque | Gross | Income tax | CPP | EI | Net |
| --- | ---: | ---: | ---: | ---: | ---: |
| $65,000 salary, semi-monthly | $2,708.33 | $477.15 | $152.47 | $44.15 | **$2,034.56** |
| $65,000 salary, bi-weekly | $2,500.00 | $440.45 | $140.74 | $40.75 | **$1,878.06** |
| $25/hour × 37.5 hours, bi-weekly | $1,875.00 | $270.48 | $103.55 | $30.56 | **$1,470.41** |

The default semi-monthly full-year forecast is $48,829.50 net, with $11,451.62 income tax withheld. Rounding reconciles annual salary on the final cheque, so multiplying the first net cheque by 24 can differ by a few cents from the annual forecast.

## Assumptions and limits

This is an estimate of employment payroll withholding, **not a tax return or payroll remittance system**. It assumes an employee subject to CPP and EI for all 12 months, ordinary fully pensionable/insurable earnings, and only basic federal/Manitoba personal claims. Other provinces are not currently calculated.

It does not model age-based CPP exemptions/elections, part-year employment, manual year-to-date balances, multiple employers, extra TD1 claims or tax requests, bonuses, irregular/accumulated overtime, taxable benefits, vacation accrual, commissions, nonresident rules, annual tax-return credits, or calendars with 53 weekly/27 bi-weekly pay periods. Weekly regular and overtime hours repeat for 52 weeks. You enter overtime hours **in addition to** regular hours; the app does not determine overtime eligibility under employment standards.

The app cannot verify RPP/RRSP contribution room or plan rules. Use other pre-tax deductions only where payroll is entitled/authorized to reduce income-tax withholding. Employer RRSP matches and taxable benefit treatment are outside the employer **RPP** contribution field. Invalid negative inputs or deductions leaving negative net pay produce a validation message.

Inputs stay in on-device preferences. The privacy manifest declares the UserDefaults required-reason use for app-owned settings. Before App Store submission, validate signing, bundle identity, accessibility and device layouts, and complete Apple's distribution/privacy declarations.

## Structure and future tax updates

```text
CanadaPayCalculator/           SwiftUI app, focused views, and view model
Sources/PayrollCore/          Models, pure payroll engine, structured tax parameters
Tests/PayrollCoreTests/        Payroll and conversion XCTest coverage
CanadaPayCalculator.xcodeproj/ Shared application/test scheme
Scripts/verify_repository.py  Portable project/resource checks
.github/workflows/            macOS build and test workflow
```

Add a new configuration in the tax-data layer, covering federal and provincial rates **and payroll constants**, personal-amount phaseouts, employment amount, CPP exemption/rates/earnings maxima, and EI rate/maximum. Register/select the new configuration and update the displayed year/source metadata. Keep older data intact if supporting historical years. Add independently checked expected results and cap/phaseout boundary tests before changing the default. Adding a province also requires its provincial rules and credits; Quebec needs QPP/QPIP-specific logic and cannot reuse Manitoba parameters.

## Validation on the creation host

The repository was created on Windows. Validation performed September 30, 2026:

- Portable project/resource/architecture verification passed, including the shared scheme and all source membership.
- A temporary Tree-sitter Swift parser checked all **19 Swift files** without syntax error/missing nodes. This is a syntax check, not Swift compiler/type checking.
- Six independent Python `Decimal` CRA worksheets checked salary, frequency, hourly pay, high-income caps, RPP, and RRSP examples; the default matched every supplied stub amount. These are independent arithmetic checks, not execution of the app's Swift engine.
- **38 XCTest methods** were added and reviewed. `swift test` was attempted but could not execute: no Swift compiler is installed. Xcode is also unavailable.

**Swift compilation, XCTest execution, and simulator/device UI validation remain unverified and require the macOS/Swift checks above.** Before distribution, check the simulator/device layouts, keyboard behavior, accessibility sizes, VoiceOver, appearance modes, signing, and the Release archive.
