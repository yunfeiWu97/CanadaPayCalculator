import Foundation

/// CRA's payroll formula uses R × A − K, not a reconstructed marginal-band sum.
/// The published K constants are rounded and must be preserved for withholding.
public struct TaxBracket: Equatable {
    /// The income threshold above which this bracket starts (exclusive).
    public let lowerBound: Decimal
    public let rate: Decimal
    public let payrollConstant: Decimal

    public init(lowerBound: Decimal, rate: Decimal, payrollConstant: Decimal) {
        self.lowerBound = lowerBound
        self.rate = rate
        self.payrollConstant = payrollConstant
    }
}

public struct BasicPersonalAmount: Equatable {
    public let maximum: Decimal
    public let minimum: Decimal
    public let phaseoutStart: Decimal
    public let phaseoutEnd: Decimal

    public init(maximum: Decimal, minimum: Decimal, phaseoutStart: Decimal, phaseoutEnd: Decimal) {
        self.maximum = maximum
        self.minimum = minimum
        self.phaseoutStart = phaseoutStart
        self.phaseoutEnd = phaseoutEnd
    }

    public func amount(netIncome: Decimal) -> Decimal {
        if netIncome <= phaseoutStart { return maximum }
        if netIncome >= phaseoutEnd { return minimum }
        // T4127 requires no rounding of the ratio and cent rounding of the BPA.
        return Money.rounded(maximum - (netIncome - phaseoutStart)
            * ((maximum - minimum) / (phaseoutEnd - phaseoutStart)))
    }
}

public struct FederalTaxParameters: Equatable {
    public let brackets: [TaxBracket]
    public let basicPersonalAmount: BasicPersonalAmount
    public let employmentAmount: Decimal
    public var creditRate: Decimal { brackets[0].rate }

    public init(brackets: [TaxBracket], basicPersonalAmount: BasicPersonalAmount, employmentAmount: Decimal) {
        self.brackets = brackets
        self.basicPersonalAmount = basicPersonalAmount
        self.employmentAmount = employmentAmount
    }
}

public struct ProvincialTaxParameters: Equatable {
    public let brackets: [TaxBracket]
    public let basicPersonalAmount: BasicPersonalAmount
    public var creditRate: Decimal { brackets[0].rate }

    public init(brackets: [TaxBracket], basicPersonalAmount: BasicPersonalAmount) {
        self.brackets = brackets
        self.basicPersonalAmount = basicPersonalAmount
    }
}

public struct CPPParameters: Equatable {
    public let annualBasicExemption: Decimal
    public let yearlyMaximumPensionableEarnings: Decimal
    public let yearlyAdditionalMaximumPensionableEarnings: Decimal
    public let baseRate: Decimal
    public let firstAdditionalRate: Decimal
    public let secondAdditionalRate: Decimal
    public let maximumBaseContribution: Decimal
    public let maximumFirstAdditionalContribution: Decimal
    public let maximumSecondAdditionalContribution: Decimal
    public var totalRate: Decimal { baseRate + firstAdditionalRate }
    public var maximumContribution: Decimal { maximumBaseContribution + maximumFirstAdditionalContribution }

    public init(
        annualBasicExemption: Decimal, yearlyMaximumPensionableEarnings: Decimal,
        yearlyAdditionalMaximumPensionableEarnings: Decimal, baseRate: Decimal,
        firstAdditionalRate: Decimal, secondAdditionalRate: Decimal,
        maximumBaseContribution: Decimal, maximumFirstAdditionalContribution: Decimal,
        maximumSecondAdditionalContribution: Decimal
    ) {
        self.annualBasicExemption = annualBasicExemption
        self.yearlyMaximumPensionableEarnings = yearlyMaximumPensionableEarnings
        self.yearlyAdditionalMaximumPensionableEarnings = yearlyAdditionalMaximumPensionableEarnings
        self.baseRate = baseRate
        self.firstAdditionalRate = firstAdditionalRate
        self.secondAdditionalRate = secondAdditionalRate
        self.maximumBaseContribution = maximumBaseContribution
        self.maximumFirstAdditionalContribution = maximumFirstAdditionalContribution
        self.maximumSecondAdditionalContribution = maximumSecondAdditionalContribution
    }
}

public struct EIParameters: Equatable {
    public let rate: Decimal
    public let maximumInsurableEarnings: Decimal
    public let maximumPremium: Decimal

    public init(rate: Decimal, maximumInsurableEarnings: Decimal, maximumPremium: Decimal) {
        self.rate = rate
        self.maximumInsurableEarnings = maximumInsurableEarnings
        self.maximumPremium = maximumPremium
    }
}

public struct TaxYear: Equatable {
    public let year: Int
    public let federal: FederalTaxParameters
    public let provinces: [Province: ProvincialTaxParameters]
    public let cpp: CPPParameters
    public let ei: EIParameters
    public let sourceURLs: [String]

    public init(
        year: Int, federal: FederalTaxParameters, provinces: [Province: ProvincialTaxParameters],
        cpp: CPPParameters, ei: EIParameters, sourceURLs: [String]
    ) {
        self.year = year
        self.federal = federal
        self.provinces = provinces
        self.cpp = cpp
        self.ei = ei
        self.sourceURLs = sourceURLs
    }

    /// Verified 2026-09-30. July 2026 T4127 confirms no Manitoba changes.
    public static let current = canada2026

    public static let canada2026: TaxYear = {
        func d(_ string: String) -> Decimal { Decimal(string: string, locale: Locale(identifier: "en_US_POSIX"))! }
        return TaxYear(
            year: 2026,
            federal: FederalTaxParameters(
                brackets: [
                    TaxBracket(lowerBound: 0, rate: d("0.14"), payrollConstant: 0),
                    TaxBracket(lowerBound: 58_523, rate: d("0.205"), payrollConstant: 3_804),
                    TaxBracket(lowerBound: 117_045, rate: d("0.26"), payrollConstant: 10_241),
                    TaxBracket(lowerBound: 181_440, rate: d("0.29"), payrollConstant: 15_685),
                    TaxBracket(lowerBound: 258_482, rate: d("0.33"), payrollConstant: 26_024)
                ],
                basicPersonalAmount: BasicPersonalAmount(
                    maximum: 16_452, minimum: 14_829, phaseoutStart: 181_440, phaseoutEnd: 258_482
                ),
                employmentAmount: 1_501
            ),
            provinces: [
                .manitoba: ProvincialTaxParameters(
                    brackets: [
                        TaxBracket(lowerBound: 0, rate: d("0.108"), payrollConstant: 0),
                        TaxBracket(lowerBound: 47_000, rate: d("0.1275"), payrollConstant: 917),
                        TaxBracket(lowerBound: 100_000, rate: d("0.174"), payrollConstant: 5_567)
                    ],
                    basicPersonalAmount: BasicPersonalAmount(
                        maximum: 15_780, minimum: 0, phaseoutStart: 200_000, phaseoutEnd: 400_000
                    )
                )
            ],
            cpp: CPPParameters(
                annualBasicExemption: 3_500,
                yearlyMaximumPensionableEarnings: 74_600,
                yearlyAdditionalMaximumPensionableEarnings: 85_000,
                baseRate: d("0.0495"), firstAdditionalRate: d("0.01"), secondAdditionalRate: d("0.04"),
                maximumBaseContribution: d("3519.45"), maximumFirstAdditionalContribution: 711,
                maximumSecondAdditionalContribution: 416
            ),
            ei: EIParameters(rate: d("0.0163"), maximumInsurableEarnings: 68_900, maximumPremium: d("1123.07")),
            sourceURLs: [
                "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html",
                "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jul/t4127-jul-payroll-deductions-formulas.html",
                "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032mb-jan/t4032mb-january-general-information.html"
            ]
        )
    }()
}
