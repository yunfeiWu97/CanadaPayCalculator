import Foundation

public enum PayrollError: Error, Equatable, LocalizedError {
    case unsupportedProvince(Province)
    case invalidValue(String)
    case invalidPayPeriod
    case excessiveDeductions
    case invalidConfiguration

    public var errorDescription: String? {
        switch self {
        case .unsupportedProvince(let province): return "\(province.displayName) payroll rules are not available yet. Select Manitoba."
        case .invalidValue(let field): return "Enter a valid, nonnegative value for \(field)."
        case .invalidPayPeriod: return "Select a pay period within the selected frequency's annual schedule."
        case .excessiveDeductions: return "Optional deductions exceed the pay available after taxes. Reduce the contributions."
        case .invalidConfiguration: return "The tax configuration is incomplete or invalid."
        }
    }
}

/// Regular salary/wages, CRA T4127 Option 1 withholding, one employer for a full
/// year. Every cheque is simulated so statutory annual caps apply when reached.
public enum PayrollCalculator {
    public static func calculate(_ input: PayrollInput, taxYear: TaxYear = .current) throws -> PayrollResult {
        guard let province = taxYear.provinces[input.province] else {
            throw PayrollError.unsupportedProvince(input.province)
        }
        try validate(input)
        try validate(taxYear, province: province)

        let count = input.frequency.periodsPerYear
        let p = Decimal(count)
        let annualRegular = Money.rounded(input.annualRegularGross)
        let annualOvertime = Money.rounded(input.annualOvertimeGross)
        let regular = Money.rounded(annualRegular / p)
        let overtime = Money.rounded(annualOvertime / p)
        let cppParameters = taxYear.cpp
        // CRA payroll exemptions discard fractional cents; never round up.
        let exemption = Money.truncated(cppParameters.annualBasicExemption / p)
        var cppYTD: Decimal = 0
        var cpp2YTD: Decimal = 0
        var eiYTD: Decimal = 0
        var earningsYTD: Decimal = 0
        var periods: [PayrollPeriodResult] = []
        periods.reserveCapacity(count)

        for index in 1...count {
            // Reconcile the final cheque to the salary's exact cents. This avoids
            // presenting annual gross that differs from the entered salary.
            let periodRegular = scheduledAmount(annual: annualRegular, regular: regular, index: index, count: count)
            let periodOvertime = scheduledAmount(annual: annualOvertime, regular: overtime, index: index, count: count)
            let gross = periodRegular + periodOvertime
            let cpp = max(0, min(cppParameters.maximumContribution - cppYTD,
                Money.rounded(max(0, gross - exemption) * cppParameters.totalRate)))
            let cpp2Earnings = max(0, earningsYTD + gross
                - max(earningsYTD, cppParameters.yearlyMaximumPensionableEarnings))
            let cpp2 = max(0, min(cppParameters.maximumSecondAdditionalContribution - cpp2YTD,
                Money.rounded(cpp2Earnings * cppParameters.secondAdditionalRate)))
            let ei = max(0, min(taxYear.ei.maximumPremium - eiYTD,
                Money.rounded(gross * taxYear.ei.rate)))

            let options = input.deductions
            let pension = options.pension.perPeriod(gross: gross)
            let rrsp = options.rrsp.perPeriod(gross: gross)
            let unionDues = options.unionDues.perPeriod(gross: gross)
            let health = options.health.perPeriod(gross: gross)
            let otherPreTax = options.otherPreTax.perPeriod(gross: gross)
            let otherAfterTax = options.otherAfterTax.perPeriod(gross: gross)
            let employerMatch = options.employerMatch.perPeriod(gross: gross)
            let preTax = pension + rrsp + unionDues + otherPreTax
            let afterTax = health + otherAfterTax
            guard preTax + afterTax <= gross else { throw PayrollError.excessiveDeductions }

            // Only enhanced CPP is deductible from taxable income. Base CPP and
            // EI receive nonrefundable credits. CPP2 has no base tax credit.
            let enhancedCPP = Money.rounded(cpp * (cppParameters.firstAdditionalRate / cppParameters.totalRate) + cpp2)
            let taxableIncome = max(0, p * (gross - preTax - enhancedCPP))

            // Preserve annual credits on the cap-crossing cheque and thereafter;
            // using zero CPP/EI once capped must not erase their tax credits.
            let annualBaseCPP: Decimal
            if cppYTD + cpp >= cppParameters.maximumContribution {
                annualBaseCPP = cppParameters.maximumBaseContribution
            } else {
                annualBaseCPP = min(cppParameters.maximumBaseContribution,
                    max(p * cpp, cppYTD) * (cppParameters.baseRate / cppParameters.totalRate))
            }
            let annualEI: Decimal
            if eiYTD + ei >= taxYear.ei.maximumPremium {
                annualEI = taxYear.ei.maximumPremium
            } else {
                annualEI = min(taxYear.ei.maximumPremium, max(p * ei, eiYTD))
            }

            let federalBPA = taxYear.federal.basicPersonalAmount.amount(netIncome: taxableIncome)
            let provincialBPA = province.basicPersonalAmount.amount(netIncome: taxableIncome)
            let federalCredits = taxYear.federal.creditRate * (federalBPA + annualBaseCPP + annualEI
                + min(p * gross, taxYear.federal.employmentAmount))
            let provincialCredits = province.creditRate * (provincialBPA + annualBaseCPP + annualEI)
            let annualFederal = max(0, bracketTax(taxableIncome, brackets: taxYear.federal.brackets) - federalCredits)
            let annualProvincial = max(0, bracketTax(taxableIncome, brackets: province.brackets) - provincialCredits)

            // T4127 rounds the combined withholding T to cents. Allocate its
            // residual cent to provincial tax so the displayed breakdown agrees.
            let incomeTax = Money.rounded((annualFederal + annualProvincial) / p)
            let federalTax = Money.rounded(annualFederal / p)
            let provincialTax = incomeTax - federalTax
            let net = gross - incomeTax - cpp - cpp2 - ei - preTax - afterTax
            guard net >= 0 else { throw PayrollError.excessiveDeductions }

            periods.append(PayrollPeriodResult(
                periodNumber: index, gross: gross, regularGross: periodRegular, overtimeGross: periodOvertime,
                federalTax: federalTax, provincialTax: provincialTax, cpp: cpp, cpp2: cpp2, ei: ei,
                pension: pension, rrsp: rrsp, unionDues: unionDues, health: health,
                otherPreTax: otherPreTax, otherAfterTax: otherAfterTax, employerMatch: employerMatch,
                net: net, annualizedTaxableIncome: taxableIncome, cppEnhancedTaxDeduction: enhancedCPP
            ))
            cppYTD += cpp
            cpp2YTD += cpp2
            eiYTD += ei
            earningsYTD += gross
        }

        let annual = PayrollAnnualResult(periods: periods)
        var warnings: [String] = []
        if optionsEnabled(input.deductions.otherPreTax) {
            warnings.append("Other pre-tax deductions assume employer authorization to reduce income-tax withholding.")
        }
        if input.deductions.rrsp.isEnabled {
            warnings.append("RRSP contributions assume available contribution room and direct payroll remittance.")
        }
        return PayrollResult(
            currentPeriod: periods[input.selectedPayPeriod - 1], annual: annual,
            monthlyNet: Money.rounded(annual.net / 12),
            effectiveDeductionRate: annual.gross > 0 ? annual.totalDeductions / annual.gross : 0,
            periods: periods, taxYear: taxYear.year, warnings: warnings
        )
    }

    /// Public for inspecting and testing the configured CRA rates and constants.
    public static func bracketTax(_ income: Decimal, brackets: [TaxBracket]) -> Decimal {
        // CRA T4032 charts keep the exact threshold in the preceding bracket
        // (e.g. 58,523.00 at 14%; 58,523.01 at 20.5%). The rounded constants
        // make this boundary observable, unlike a continuous marginal-band sum.
        guard let bracket = brackets.last(where: { income > $0.lowerBound }) else { return 0 }
        return max(0, income * bracket.rate - bracket.payrollConstant)
    }

    private static func optionsEnabled(_ contribution: Contribution) -> Bool { contribution.isEnabled && contribution.amount > 0 }

    private static func scheduledAmount(annual: Decimal, regular: Decimal, index: Int, count: Int) -> Decimal {
        if regular * Decimal(count - 1) > annual {
            // A sub-dollar salary can otherwise leave a negative last cheque.
            // Spread its pennies by rounding cumulative earnings instead.
            return Money.rounded(annual * Decimal(index) / Decimal(count))
                - Money.rounded(annual * Decimal(index - 1) / Decimal(count))
        }
        return index == count ? annual - regular * Decimal(count - 1) : regular
    }

    private static func validate(_ input: PayrollInput) throws {
        func nonnegative(_ value: Decimal, _ label: String) throws {
            guard !value.isNaN, value >= 0, value <= 100_000_000 else { throw PayrollError.invalidValue(label) }
        }
        guard (1...input.frequency.periodsPerYear).contains(input.selectedPayPeriod) else { throw PayrollError.invalidPayPeriod }
        if input.incomeType == .annualSalary {
            try nonnegative(input.annualSalary, "annual salary")
        } else {
            try nonnegative(input.hourlyRate, "hourly rate")
            try nonnegative(input.hoursPerWeek, "hours per week")
            try nonnegative(input.overtimeHours, "overtime hours")
            guard input.hoursPerWeek + input.overtimeHours <= 168 else { throw PayrollError.invalidValue("weekly hours (maximum 168)") }
            if input.overtimeHours > 0 {
                guard !input.overtimeMultiplier.isNaN, input.overtimeMultiplier >= 1,
                    input.overtimeMultiplier <= 10 else { throw PayrollError.invalidValue("overtime multiplier (1 to 10)") }
            }
            try nonnegative(input.annualGross, "annual earnings")
        }
        let options = input.deductions
        let contributions: [(String, Contribution)] = [
            ("pension contribution", options.pension), ("RRSP contribution", options.rrsp),
            ("union dues", options.unionDues), ("health benefits", options.health),
            ("other pre-tax deduction", options.otherPreTax), ("other after-tax deduction", options.otherAfterTax),
            ("employer pension contribution", options.employerMatch)
        ]
        for (label, contribution) in contributions where contribution.isEnabled {
            try nonnegative(contribution.amount, label)
            if contribution.mode == .percentOfGross && contribution.amount > 100 {
                throw PayrollError.invalidValue("\(label) percentage (0 to 100)")
            }
        }
    }

    private static func validate(_ year: TaxYear, province: ProvincialTaxParameters) throws {
        let cpp = year.cpp
        func validBrackets(_ brackets: [TaxBracket]) -> Bool {
            guard let first = brackets.first, first.lowerBound == 0, first.payrollConstant == 0 else { return false }
            guard brackets.allSatisfy({ bracket in
                !bracket.lowerBound.isNaN && !bracket.rate.isNaN && !bracket.payrollConstant.isNaN
                    && bracket.lowerBound >= 0 && bracket.rate >= 0 && bracket.rate <= 1
                    && bracket.payrollConstant >= 0
            }) else { return false }
            return zip(brackets, brackets.dropFirst()).allSatisfy { pair in
                pair.0.lowerBound < pair.1.lowerBound
            }
        }
        func validBPA(_ amount: BasicPersonalAmount) -> Bool {
            [amount.maximum, amount.minimum, amount.phaseoutStart, amount.phaseoutEnd]
                .allSatisfy { !$0.isNaN && $0 >= 0 }
                && amount.maximum >= amount.minimum && amount.phaseoutEnd > amount.phaseoutStart
        }
        let amounts = [cpp.annualBasicExemption, cpp.yearlyMaximumPensionableEarnings,
            cpp.yearlyAdditionalMaximumPensionableEarnings, cpp.maximumBaseContribution,
            cpp.maximumFirstAdditionalContribution, cpp.maximumSecondAdditionalContribution,
            year.ei.maximumInsurableEarnings, year.ei.maximumPremium, year.federal.employmentAmount]
        let rates = [cpp.baseRate, cpp.firstAdditionalRate, cpp.secondAdditionalRate, year.ei.rate]
        guard year.year > 0, validBrackets(year.federal.brackets), validBrackets(province.brackets),
            validBPA(year.federal.basicPersonalAmount), validBPA(province.basicPersonalAmount),
            amounts.allSatisfy({ !$0.isNaN && $0 >= 0 }),
            rates.allSatisfy({ !$0.isNaN && $0 >= 0 && $0 <= 1 }),
            cpp.totalRate > 0, cpp.totalRate <= 1,
            cpp.yearlyMaximumPensionableEarnings >= cpp.annualBasicExemption,
            cpp.yearlyAdditionalMaximumPensionableEarnings >= cpp.yearlyMaximumPensionableEarnings,
            cpp.maximumBaseContribution == Money.rounded((cpp.yearlyMaximumPensionableEarnings
                - cpp.annualBasicExemption) * cpp.baseRate),
            cpp.maximumFirstAdditionalContribution == Money.rounded((cpp.yearlyMaximumPensionableEarnings
                - cpp.annualBasicExemption) * cpp.firstAdditionalRate),
            cpp.maximumSecondAdditionalContribution == Money.rounded((cpp.yearlyAdditionalMaximumPensionableEarnings
                - cpp.yearlyMaximumPensionableEarnings) * cpp.secondAdditionalRate),
            year.ei.maximumPremium == Money.rounded(year.ei.maximumInsurableEarnings * year.ei.rate)
        else { throw PayrollError.invalidConfiguration }
    }
}
