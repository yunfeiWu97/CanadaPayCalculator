import Foundation
import XCTest
@testable import PayrollCore

final class PayrollCalculatorTests: XCTestCase {
    private func d(_ value: String) -> Decimal { Decimal(string: value, locale: Locale(identifier: "en_US_POSIX"))! }

    // Expected values were independently calculated with a Decimal CRA T4127
    // worksheet. The supplied real stub is a reference, never an engine branch.
    func testManitoba65000SemiMonthlyMatchesReferencePaycheque() throws {
        let result = try PayrollCalculator.calculate(PayrollInput())
        let pay = result.currentPeriod
        XCTAssertEqual(result.taxYear, 2026)
        XCTAssertEqual(result.periods.count, 24)
        XCTAssertEqual(pay.gross, d("2708.33"))
        XCTAssertEqual(pay.cpp, d("152.47"))
        XCTAssertEqual(pay.cpp2, 0)
        XCTAssertEqual(pay.ei, d("44.15"))
        XCTAssertEqual(pay.federalTax, d("262.79"))
        XCTAssertEqual(pay.provincialTax, d("214.36"))
        XCTAssertEqual(pay.incomeTax, d("477.15"))
        XCTAssertEqual(pay.net, d("2034.56"))
        XCTAssertEqual(result.annual.gross, 65_000)
        XCTAssertEqual(result.annual.cpp, d("3659.28"))
        XCTAssertEqual(result.annual.ei, d("1059.60"))
        XCTAssertEqual(result.annual.incomeTax, d("11451.62"))
        XCTAssertEqual(result.annual.net, d("48829.50"))
        XCTAssertEqual(result.monthlyNet, d("4069.13"))
    }

    func testReferenceSalaryIsNotSpecialCased() throws {
        var input = PayrollInput()
        let reference = try PayrollCalculator.calculate(input)
        input.annualSalary = 65_001
        let changed = try PayrollCalculator.calculate(input)
        XCTAssertNotEqual(changed.currentPeriod.gross, reference.currentPeriod.gross)
        XCTAssertNotEqual(changed.currentPeriod.net, reference.currentPeriod.net)
        XCTAssertEqual(changed.annual.gross, 65_001)
    }

    func testManitoba65000BiweeklyHas26DifferentCheques() throws {
        let result = try PayrollCalculator.calculate(PayrollInput(frequency: .biweekly))
        XCTAssertEqual(result.periods.count, 26)
        XCTAssertEqual(result.currentPeriod.gross, 2_500)
        XCTAssertEqual(result.currentPeriod.cpp, d("140.74"))
        XCTAssertEqual(result.currentPeriod.ei, d("40.75"))
        XCTAssertEqual(result.currentPeriod.federalTax, d("242.58"))
        XCTAssertEqual(result.currentPeriod.provincialTax, d("197.87"))
        XCTAssertEqual(result.currentPeriod.incomeTax, d("440.45"))
        XCTAssertEqual(result.currentPeriod.net, d("1878.06"))
        XCTAssertEqual(result.annual.cpp, d("3659.24"))
        XCTAssertEqual(result.annual.ei, d("1059.50"))
        XCTAssertEqual(result.annual.incomeTax, d("11451.70"))
        XCTAssertEqual(result.annual.net, d("48829.56"))
    }

    func testHourly25At37Point5HoursBiweekly() throws {
        let input = PayrollInput(incomeType: .hourly, frequency: .biweekly)
        let result = try PayrollCalculator.calculate(input)
        XCTAssertEqual(result.annual.regularGross, 48_750)
        XCTAssertEqual(result.currentPeriod.gross, 1_875)
        XCTAssertEqual(result.currentPeriod.cpp, d("103.55"))
        XCTAssertEqual(result.currentPeriod.ei, d("30.56"))
        XCTAssertEqual(result.currentPeriod.incomeTax, d("270.48"))
        XCTAssertEqual(result.currentPeriod.net, d("1470.41"))
        XCTAssertEqual(result.annual.net, d("38230.66"))
    }

    func testRecurringOvertimeIsAdditionalWeeklyIncome() throws {
        let result = try PayrollCalculator.calculate(PayrollInput(
            incomeType: .hourly, overtimeHours: 5, frequency: .biweekly
        ))
        XCTAssertEqual(result.annual.regularGross, 48_750)
        XCTAssertEqual(result.annual.overtimeGross, 9_750)
        XCTAssertEqual(result.annual.gross, 58_500)
        XCTAssertEqual(result.currentPeriod.regularGross, 1_875)
        XCTAssertEqual(result.currentPeriod.overtimeGross, 375)
        XCTAssertEqual(result.currentPeriod.gross, 2_250)
    }

    func test120000SalaryReachesEveryStatutoryMaximum() throws {
        let result = try PayrollCalculator.calculate(PayrollInput(annualSalary: 120_000))
        XCTAssertEqual(result.annual.cpp, d("4230.45"))
        XCTAssertEqual(result.annual.cpp2, 416)
        XCTAssertEqual(result.annual.ei, d("1123.07"))
        XCTAssertEqual(result.annual.incomeTax, d("30422.28"))
        XCTAssertEqual(result.annual.net, d("83808.20"))
        XCTAssertEqual(result.periods.first(where: { $0.cpp2 > 0 })?.periodNumber, 15)
        XCTAssertEqual(result.periods.last?.cpp, 0)
        XCTAssertEqual(result.periods.last?.cpp2, 0)
        XCTAssertEqual(result.periods.last?.ei, 0)
        XCTAssertNotEqual(result.periods[0].net, result.periods[23].net)
    }

    func testCPP2TimingMatchesCRAT4127WorkedExample() throws {
        // CRA example: $4,200 semi-monthly; $71,400 earned before period 18.
        let result = try PayrollCalculator.calculate(PayrollInput(annualSalary: 100_800))
        XCTAssertEqual(result.periods[16].cpp, d("241.22"))
        XCTAssertEqual(result.periods[16].cpp2, 0)
        XCTAssertEqual(result.periods[17].cpp, d("129.71"))
        XCTAssertEqual(result.periods[17].cpp2, 40)
        XCTAssertEqual(result.periods[17].cppEnhancedTaxDeduction, d("61.80"))
        XCTAssertEqual(result.periods[18].cpp, 0)
        XCTAssertEqual(result.periods[18].cpp2, 168)
        XCTAssertEqual(result.periods[20].cpp2, 40)
        XCTAssertEqual(result.periods[21].cpp2, 0)
        XCTAssertEqual(result.annual.cpp2, 416)
    }

    func testCPP2StartsOnlyAfterYearlyPensionableEarningsThreshold() throws {
        let below = try PayrollCalculator.calculate(PayrollInput(annualSalary: 74_600))
        let above = try PayrollCalculator.calculate(PayrollInput(annualSalary: 74_700))
        XCTAssertEqual(below.annual.cpp2, 0)
        XCTAssertEqual(above.annual.cpp2, 4)
        XCTAssertTrue(above.periods.dropLast().allSatisfy { $0.cpp2 == 0 })
    }

    func testSelectedChequeUsesScheduleInsteadOfAnnualAverage() throws {
        var input = PayrollInput(annualSalary: 120_000)
        let first = try PayrollCalculator.calculate(input)
        input.selectedPayPeriod = 24
        let last = try PayrollCalculator.calculate(input)
        XCTAssertEqual(last.currentPeriod, last.periods[23])
        XCTAssertEqual(last.annual, first.annual)
        XCTAssertEqual(last.currentPeriod.cpp, 0)
        XCTAssertGreaterThan(first.currentPeriod.cpp, 0)
        XCTAssertNotEqual(first.currentPeriod.cpp, Money.rounded(first.annual.cpp / 24))
    }

    func testRPPPercentReducesTaxAndTakeHomeButNotCPPOrEI() throws {
        let baseline = try PayrollCalculator.calculate(PayrollInput())
        var input = PayrollInput()
        input.deductions.pension = Contribution(isEnabled: true, amount: 5)
        let result = try PayrollCalculator.calculate(input)
        XCTAssertEqual(result.currentPeriod.pension, d("135.42"))
        XCTAssertEqual(result.currentPeriod.net, d("1944.17"))
        XCTAssertEqual(result.annual.net, d("46660.13"))
        XCTAssertLessThan(result.annual.incomeTax, baseline.annual.incomeTax)
        XCTAssertEqual(result.annual.cpp, baseline.annual.cpp)
        XCTAssertEqual(result.annual.ei, baseline.annual.ei)
    }

    func testRRSPFixedPayrollContributionReducesWithholding() throws {
        var input = PayrollInput()
        input.deductions.rrsp = Contribution(isEnabled: true, mode: .fixedPerPeriod, amount: 100)
        let result = try PayrollCalculator.calculate(input)
        XCTAssertEqual(result.currentPeriod.rrsp, 100)
        XCTAssertEqual(result.currentPeriod.net, d("1967.81"))
        XCTAssertEqual(result.annual.rrsp, 2_400)
        XCTAssertEqual(result.annual.net, d("47227.50"))
        XCTAssertFalse(result.warnings.isEmpty)
    }

    func testNoOptionalDeductionsByDefault() throws {
        let result = try PayrollCalculator.calculate(PayrollInput())
        XCTAssertEqual(result.currentPeriod.optionalDeductions, 0)
        XCTAssertEqual(result.annual.employeeRetirementContributions, 0)
        XCTAssertEqual(result.annual.employerMatch, 0)
        XCTAssertEqual(result.annual.gross, result.annual.net + result.annual.statutoryDeductions)
    }

    func testEmployerPensionMatchingNeverReducesEmployeeNet() throws {
        var input = PayrollInput()
        input.deductions.pension = Contribution(isEnabled: true, amount: 5)
        let withoutMatch = try PayrollCalculator.calculate(input)
        input.deductions.employerMatch = Contribution(isEnabled: true, amount: 5)
        let withMatch = try PayrollCalculator.calculate(input)
        XCTAssertEqual(withMatch.annual.net, withoutMatch.annual.net)
        XCTAssertEqual(withMatch.annual.incomeTax, withoutMatch.annual.incomeTax)
        XCTAssertEqual(withMatch.annual.employerMatch, withMatch.annual.pension)
        XCTAssertGreaterThan(withMatch.currentPeriod.employerMatch, 0)
    }

    func testEmployerContributionDoesNotRequireEmployeeContribution() throws {
        let baseline = try PayrollCalculator.calculate(PayrollInput())
        var input = PayrollInput()
        input.deductions.employerMatch = Contribution(isEnabled: true, amount: 5)
        let result = try PayrollCalculator.calculate(input)
        XCTAssertEqual(result.currentPeriod.employerMatch, d("135.42"))
        XCTAssertEqual(result.annual.pension, 0)
        XCTAssertEqual(result.annual.net, baseline.annual.net)
        XCTAssertEqual(result.annual.incomeTax, baseline.annual.incomeTax)
    }

    func testHealthAndOtherAfterTaxDeductWithoutReducingTax() throws {
        let baseline = try PayrollCalculator.calculate(PayrollInput())
        var input = PayrollInput()
        input.deductions.health = Contribution(isEnabled: true, mode: .fixedPerPeriod, amount: 50)
        input.deductions.otherAfterTax = Contribution(isEnabled: true, mode: .fixedPerPeriod, amount: 20)
        let result = try PayrollCalculator.calculate(input)
        XCTAssertEqual(result.currentPeriod.incomeTax, baseline.currentPeriod.incomeTax)
        XCTAssertEqual(result.currentPeriod.net, baseline.currentPeriod.net - 70)
        XCTAssertEqual(result.annual.afterTaxDeductions, 1_680)
    }

    func testUnionAndAuthorizedPreTaxReduceTaxableIncomeOnly() throws {
        let baseline = try PayrollCalculator.calculate(PayrollInput())
        var input = PayrollInput()
        input.deductions.unionDues = Contribution(isEnabled: true, mode: .fixedPerPeriod, amount: 30)
        input.deductions.otherPreTax = Contribution(isEnabled: true, mode: .fixedPerPeriod, amount: 20)
        let result = try PayrollCalculator.calculate(input)
        XCTAssertEqual(result.currentPeriod.annualizedTaxableIncome,
            baseline.currentPeriod.annualizedTaxableIncome - 1_200)
        XCTAssertLessThan(result.currentPeriod.incomeTax, baseline.currentPeriod.incomeTax)
        XCTAssertEqual(result.annual.cpp, baseline.annual.cpp)
        XCTAssertEqual(result.annual.ei, baseline.annual.ei)
        XCTAssertEqual(result.annual.preTaxDeductions, 1_200)
    }

    func testAllFrequenciesPreserveAnnualSalaryAndReconcileEachCheque() throws {
        for frequency in PayFrequency.allCases {
            let result = try PayrollCalculator.calculate(PayrollInput(annualSalary: d("65123.45"), frequency: frequency))
            XCTAssertEqual(result.periods.count, frequency.periodsPerYear)
            XCTAssertEqual(result.annual.gross, d("65123.45"))
            XCTAssertEqual(result.annual.net, result.periods.reduce(0) { $0 + $1.net })
            for pay in result.periods {
                XCTAssertEqual(pay.gross, pay.net + pay.totalDeductions)
                XCTAssertEqual(pay.gross, pay.regularGross + pay.overtimeGross)
                XCTAssertGreaterThanOrEqual(pay.net, 0)
            }
        }
    }

    func testAnnualPerPeriodConversionsRoundTripForEveryFrequency() {
        for frequency in PayFrequency.allCases {
            let cheque: Decimal = 1_234
            let annual = frequency.annual(fromPerPeriod: cheque)
            XCTAssertEqual(frequency.perPeriod(fromAnnual: annual), cheque)
            XCTAssertEqual(annual, cheque * Decimal(frequency.periodsPerYear))
        }
        XCTAssertNotEqual(PayFrequency.biweekly.periodsPerYear, PayFrequency.semiMonthly.periodsPerYear)
    }

    func testLastChequeReconcilesRoundingInsteadOfInventingGrossIncome() throws {
        let result = try PayrollCalculator.calculate(PayrollInput())
        XCTAssertEqual(result.periods[0].gross, d("2708.33"))
        XCTAssertEqual(result.periods[23].gross, d("2708.41"))
        XCTAssertEqual(result.periods[23].incomeTax, d("477.17"))
        XCTAssertEqual(result.periods[23].net, d("2034.62"))
    }

    func testZeroIncomeHasZeroTaxesAndDeductions() throws {
        let result = try PayrollCalculator.calculate(PayrollInput(annualSalary: 0))
        XCTAssertEqual(result.annual.gross, 0)
        XCTAssertEqual(result.annual.totalDeductions, 0)
        XCTAssertEqual(result.monthlyNet, 0)
        XCTAssertEqual(result.effectiveDeductionRate, 0)
    }

    func testSubDollarSalaryNeverCreatesNegativeLastCheque() throws {
        let result = try PayrollCalculator.calculate(PayrollInput(annualSalary: d("0.26"), frequency: .weekly))
        XCTAssertEqual(result.annual.gross, d("0.26"))
        XCTAssertTrue(result.periods.allSatisfy { $0.gross >= 0 && $0.net >= 0 })
    }

    func testIncomeBelowCPPAnnualExemptionHasNoCPPAndNoIncomeTax() throws {
        let result = try PayrollCalculator.calculate(PayrollInput(annualSalary: 3_000))
        XCTAssertEqual(result.annual.cpp, 0)
        XCTAssertEqual(result.annual.cpp2, 0)
        XCTAssertEqual(result.annual.incomeTax, 0)
        XCTAssertGreaterThan(result.annual.ei, 0)
    }

    func testFederalBPAPhaseoutUsesCurrentCRAIncomeLimits() {
        let bpa = TaxYear.canada2026.federal.basicPersonalAmount
        XCTAssertEqual(bpa.amount(netIncome: 181_440), 16_452)
        XCTAssertEqual(bpa.amount(netIncome: 219_961), d("15640.50"))
        XCTAssertEqual(bpa.amount(netIncome: 258_482), 14_829)
        XCTAssertEqual(bpa.amount(netIncome: 400_000), 14_829)
    }

    func testManitobaBPAPhasesOutAbove200000AndVanishesAt400000() throws {
        let bpa = try XCTUnwrap(TaxYear.canada2026.provinces[.manitoba]).basicPersonalAmount
        XCTAssertEqual(bpa.amount(netIncome: 200_000), 15_780)
        XCTAssertEqual(bpa.amount(netIncome: 300_000), 7_890)
        XCTAssertEqual(bpa.amount(netIncome: 400_000), 0)
        XCTAssertEqual(bpa.amount(netIncome: 500_000), 0)
        let high = try PayrollCalculator.calculate(PayrollInput(annualSalary: 300_000))
        XCTAssertGreaterThan(high.currentPeriod.provincialTax, 1_000)
    }

    func testFederalAndManitobaBracketBoundariesUsePublishedPayrollConstants() throws {
        let fed = TaxYear.canada2026.federal.brackets
        let mb = try XCTUnwrap(TaxYear.canada2026.provinces[.manitoba]).brackets
        XCTAssertEqual(PayrollCalculator.bracketTax(58_523, brackets: fed), d("8193.22"))
        XCTAssertEqual(PayrollCalculator.bracketTax(d("58523.01"), brackets: fed), d("8193.21705"))
        XCTAssertEqual(PayrollCalculator.bracketTax(117_045, brackets: fed), d("20190.225"))
        XCTAssertEqual(PayrollCalculator.bracketTax(d("117045.01"), brackets: fed), d("20190.7026"))
        XCTAssertEqual(PayrollCalculator.bracketTax(181_440, brackets: fed), d("36933.40"))
        XCTAssertEqual(PayrollCalculator.bracketTax(258_482, brackets: fed), d("59274.78"))
        XCTAssertEqual(PayrollCalculator.bracketTax(47_000, brackets: mb), 5_076)
        XCTAssertEqual(PayrollCalculator.bracketTax(d("47000.01"), brackets: mb), d("5075.501275"))
        XCTAssertEqual(PayrollCalculator.bracketTax(100_000, brackets: mb), 11_833)
        XCTAssertEqual(PayrollCalculator.bracketTax(46_999, brackets: mb), d("5075.892"))
    }

    func testAllStatutoryMaximaRemainCappedAcrossFrequencies() throws {
        for frequency in PayFrequency.allCases {
            let result = try PayrollCalculator.calculate(PayrollInput(annualSalary: 500_000, frequency: frequency))
            XCTAssertEqual(result.annual.cpp, d("4230.45"))
            XCTAssertEqual(result.annual.cpp2, 416)
            XCTAssertEqual(result.annual.ei, d("1123.07"))
            XCTAssertTrue(result.periods.allSatisfy { $0.cpp >= 0 && $0.cpp2 >= 0 && $0.ei >= 0 })
        }
    }

    func testCentRoundingUsesHalfUp() {
        XCTAssertEqual(Money.rounded(d("1.004")), d("1.00"))
        XCTAssertEqual(Money.rounded(d("1.005")), d("1.01"))
        XCTAssertEqual(Money.rounded(d("1.015")), d("1.02"))
        XCTAssertEqual(Money.truncated(d("145.833333")), d("145.83"))
        XCTAssertEqual(Money.truncated(d("291.666666")), d("291.66"))
    }

    func testEnhancedCPPIsDeductionAndBaseCPPReceivesTaxCredit() throws {
        let result = try PayrollCalculator.calculate(PayrollInput())
        XCTAssertEqual(result.currentPeriod.cppEnhancedTaxDeduction, d("25.63"))
        XCTAssertEqual(result.currentPeriod.annualizedTaxableIncome, d("64384.80"))
        XCTAssertNotEqual(result.currentPeriod.annualizedTaxableIncome,
            (result.currentPeriod.gross - result.currentPeriod.cpp) * 24)
    }

    func testSavedInactiveValuesDoNotAffectCalculation() throws {
        let baseline = try PayrollCalculator.calculate(PayrollInput())
        var input = PayrollInput()
        input.hourlyRate = -100
        input.deductions.pension.amount = -20
        input.deductions.rrsp.amount = .nan
        input.deductions.employerMatch = Contribution(isEnabled: false, amount: -1)
        XCTAssertEqual(try PayrollCalculator.calculate(input), baseline)
    }

    func testNegativeAndNaNActiveIncomeAreRejected() {
        XCTAssertThrowsError(try PayrollCalculator.calculate(PayrollInput(annualSalary: -1)))
        XCTAssertThrowsError(try PayrollCalculator.calculate(PayrollInput(annualSalary: .nan)))
        XCTAssertThrowsError(try PayrollCalculator.calculate(PayrollInput(incomeType: .hourly, hourlyRate: -1)))
    }

    func testInvalidActiveContributionAndExcessiveDeductionsAreRejected() {
        var input = PayrollInput()
        input.deductions.rrsp = Contribution(isEnabled: true, amount: -1)
        XCTAssertThrowsError(try PayrollCalculator.calculate(input))
        input.deductions.rrsp.amount = 101
        XCTAssertThrowsError(try PayrollCalculator.calculate(input))
        input.deductions.rrsp = Contribution(isEnabled: true, mode: .fixedPerPeriod, amount: 2_700)
        XCTAssertThrowsError(try PayrollCalculator.calculate(input))
    }

    func testUnsupportedProvinceIsRejectedInsteadOfUsingManitoba() {
        XCTAssertThrowsError(try PayrollCalculator.calculate(PayrollInput(province: .ontario))) { error in
            XCTAssertEqual(error as? PayrollError, .unsupportedProvince(.ontario))
        }
        XCTAssertEqual(Province.supportedProvinces, [.manitoba])
    }

    func testInvalidPayPeriodIsRejected() {
        for selected in [0, 25] {
            XCTAssertThrowsError(try PayrollCalculator.calculate(PayrollInput(selectedPayPeriod: selected))) { error in
                XCTAssertEqual(error as? PayrollError, .invalidPayPeriod)
            }
        }
    }

    func testUnrealisticHoursAndInvalidOvertimeMultiplierAreRejected() {
        XCTAssertThrowsError(try PayrollCalculator.calculate(PayrollInput(incomeType: .hourly, hoursPerWeek: 169)))
        XCTAssertThrowsError(try PayrollCalculator.calculate(PayrollInput(incomeType: .hourly, overtimeHours: 1, overtimeMultiplier: d("0.5"))))
        XCTAssertThrowsError(try PayrollCalculator.calculate(PayrollInput(incomeType: .hourly, overtimeHours: -1)))
    }

    func testInputPersistenceRoundTripsDecimalsAndOptionalSettings() throws {
        var input = PayrollInput(annualSalary: d("65001.27"), selectedPayPeriod: 12)
        input.deductions.pension = Contribution(isEnabled: true, amount: d("4.25"))
        input.deductions.otherAfterTax = Contribution(isEnabled: true, mode: .fixedPerPeriod, amount: d("20.13"))
        let encoded = try JSONEncoder().encode(input)
        XCTAssertEqual(try JSONDecoder().decode(PayrollInput.self, from: encoded), input)
    }

    func testTaxYearConfigurationIsInjectedRatherThanHardcoded() throws {
        let current = TaxYear.current
        let custom = TaxYear(year: 2030, federal: current.federal, provinces: current.provinces,
            cpp: current.cpp, ei: EIParameters(rate: 0, maximumInsurableEarnings: 0, maximumPremium: 0), sourceURLs: [])
        let result = try PayrollCalculator.calculate(PayrollInput(), taxYear: custom)
        XCTAssertEqual(result.taxYear, 2030)
        XCTAssertEqual(result.annual.ei, 0)
    }

    func testInvalidTaxConfigurationIsRejectedBeforeCalculation() {
        let current = TaxYear.current
        let unsorted = FederalTaxParameters(brackets: Array(current.federal.brackets.reversed()),
            basicPersonalAmount: current.federal.basicPersonalAmount, employmentAmount: current.federal.employmentAmount)
        let invalid = TaxYear(year: 2026, federal: unsorted, provinces: current.provinces,
            cpp: current.cpp, ei: current.ei, sourceURLs: [])
        XCTAssertThrowsError(try PayrollCalculator.calculate(PayrollInput(), taxYear: invalid)) { error in
            XCTAssertEqual(error as? PayrollError, .invalidConfiguration)
        }
    }

    func testMixedYearRateAndMaximumConfigurationIsRejected() {
        let current = TaxYear.current
        let staleMaximum = TaxYear(year: 2030, federal: current.federal, provinces: current.provinces,
            cpp: current.cpp,
            ei: EIParameters(rate: d("0.01"), maximumInsurableEarnings: 68_900, maximumPremium: d("1123.07")),
            sourceURLs: [])
        XCTAssertThrowsError(try PayrollCalculator.calculate(PayrollInput(), taxYear: staleMaximum)) { error in
            XCTAssertEqual(error as? PayrollError, .invalidConfiguration)
        }
    }
}
