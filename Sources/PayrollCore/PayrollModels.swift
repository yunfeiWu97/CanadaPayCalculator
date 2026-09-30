import Foundation

/// The province of employment determines withholding. Unsupported provinces are
/// represented so adding a configuration cannot silently fall back to Manitoba.
public enum Province: String, CaseIterable, Codable, Identifiable {
    case alberta, britishColumbia, manitoba, newBrunswick, newfoundlandAndLabrador
    case northwestTerritories, novaScotia, nunavut, ontario, princeEdwardIsland
    case quebec, saskatchewan, yukon

    public var id: Self { self }
    public var isSupported: Bool { self == .manitoba }
    public static var supportedProvinces: [Self] { allCases.filter(\.isSupported) }
    public var displayName: String {
        switch self {
        case .alberta: return "Alberta"
        case .britishColumbia: return "British Columbia"
        case .manitoba: return "Manitoba"
        case .newBrunswick: return "New Brunswick"
        case .newfoundlandAndLabrador: return "Newfoundland and Labrador"
        case .northwestTerritories: return "Northwest Territories"
        case .novaScotia: return "Nova Scotia"
        case .nunavut: return "Nunavut"
        case .ontario: return "Ontario"
        case .princeEdwardIsland: return "Prince Edward Island"
        case .quebec: return "Quebec"
        case .saskatchewan: return "Saskatchewan"
        case .yukon: return "Yukon"
        }
    }
}

public enum IncomeType: String, CaseIterable, Codable, Identifiable {
    case annualSalary, hourly
    public var id: Self { self }
    public var displayName: String { self == .annualSalary ? "Annual salary" : "Hourly wage" }
}

public enum PayFrequency: String, CaseIterable, Codable, Identifiable {
    case weekly, biweekly, semiMonthly, monthly
    public var id: Self { self }
    public var periodsPerYear: Int {
        switch self {
        case .weekly: return 52
        case .biweekly: return 26
        case .semiMonthly: return 24
        case .monthly: return 12
        }
    }
    public var displayName: String {
        switch self {
        case .weekly: return "Weekly"
        case .biweekly: return "Bi-weekly"
        case .semiMonthly: return "Semi-monthly"
        case .monthly: return "Monthly"
        }
    }
    /// Unrounded conversions. Round only when an amount is actually paid.
    public func perPeriod(fromAnnual annual: Decimal) -> Decimal { annual / Decimal(periodsPerYear) }
    public func annual(fromPerPeriod amount: Decimal) -> Decimal { amount * Decimal(periodsPerYear) }
}

public enum ContributionMode: String, CaseIterable, Codable, Identifiable {
    case percentOfGross, fixedPerPeriod
    public var id: Self { self }
    public var displayName: String { self == .percentOfGross ? "% of gross" : "$ per pay" }
}

public struct Contribution: Codable, Equatable {
    public var isEnabled: Bool
    public var mode: ContributionMode
    /// A percent uses 5 for 5%, not 0.05. A fixed amount is dollars per cheque.
    public var amount: Decimal

    public init(isEnabled: Bool = false, mode: ContributionMode = .percentOfGross, amount: Decimal = 0) {
        self.isEnabled = isEnabled
        self.mode = mode
        self.amount = amount
    }

    public func perPeriod(gross: Decimal) -> Decimal {
        guard isEnabled else { return 0 }
        return Money.rounded(mode == .percentOfGross ? gross * amount / 100 : amount)
    }
}

public struct OptionalDeductions: Codable, Equatable {
    public var pension: Contribution
    public var rrsp: Contribution
    public var unionDues: Contribution
    public var health: Contribution
    /// Assumed to be an employer-authorized income-tax deduction.
    public var otherPreTax: Contribution
    public var otherAfterTax: Contribution
    /// Employer RPP contributions are savings, not employee payroll deductions.
    public var employerMatch: Contribution

    public init(
        pension: Contribution = Contribution(), rrsp: Contribution = Contribution(),
        unionDues: Contribution = Contribution(), health: Contribution = Contribution(),
        otherPreTax: Contribution = Contribution(), otherAfterTax: Contribution = Contribution(),
        employerMatch: Contribution = Contribution()
    ) {
        self.pension = pension
        self.rrsp = rrsp
        self.unionDues = unionDues
        self.health = health
        self.otherPreTax = otherPreTax
        self.otherAfterTax = otherAfterTax
        self.employerMatch = employerMatch
    }
}

public struct PayrollInput: Codable, Equatable {
    public var annualSalary: Decimal
    public var incomeType: IncomeType
    public var hourlyRate: Decimal
    public var hoursPerWeek: Decimal
    /// Recurring overtime hours per week, in addition to regular hours.
    public var overtimeHours: Decimal
    public var overtimeMultiplier: Decimal
    public var province: Province
    public var frequency: PayFrequency
    /// One-based index into the simulated full-year pay schedule.
    public var selectedPayPeriod: Int
    public var deductions: OptionalDeductions

    public init(
        annualSalary: Decimal = 65_000, incomeType: IncomeType = .annualSalary,
        hourlyRate: Decimal = 25, hoursPerWeek: Decimal = Decimal(string: "37.5")!,
        overtimeHours: Decimal = 0, overtimeMultiplier: Decimal = Decimal(string: "1.5")!,
        province: Province = .manitoba, frequency: PayFrequency = .semiMonthly,
        selectedPayPeriod: Int = 1, deductions: OptionalDeductions = OptionalDeductions()
    ) {
        self.annualSalary = annualSalary
        self.incomeType = incomeType
        self.hourlyRate = hourlyRate
        self.hoursPerWeek = hoursPerWeek
        self.overtimeHours = overtimeHours
        self.overtimeMultiplier = overtimeMultiplier
        self.province = province
        self.frequency = frequency
        self.selectedPayPeriod = selectedPayPeriod
        self.deductions = deductions
    }

    public var annualRegularGross: Decimal {
        incomeType == .annualSalary ? annualSalary : hourlyRate * hoursPerWeek * 52
    }
    public var annualOvertimeGross: Decimal {
        incomeType == .hourly && overtimeHours > 0 ? hourlyRate * overtimeHours * overtimeMultiplier * 52 : 0
    }
    public var annualGross: Decimal { annualRegularGross + annualOvertimeGross }
}

public protocol PayrollBreakdown {
    var gross: Decimal { get }
    var regularGross: Decimal { get }
    var overtimeGross: Decimal { get }
    var federalTax: Decimal { get }
    var provincialTax: Decimal { get }
    var cpp: Decimal { get }
    var cpp2: Decimal { get }
    var ei: Decimal { get }
    var pension: Decimal { get }
    var rrsp: Decimal { get }
    var unionDues: Decimal { get }
    var health: Decimal { get }
    var otherPreTax: Decimal { get }
    var otherAfterTax: Decimal { get }
    var employerMatch: Decimal { get }
    var net: Decimal { get }
}

public extension PayrollBreakdown {
    var incomeTax: Decimal { federalTax + provincialTax }
    var statutoryDeductions: Decimal { incomeTax + cpp + cpp2 + ei }
    var preTaxDeductions: Decimal { pension + rrsp + unionDues + otherPreTax }
    var afterTaxDeductions: Decimal { health + otherAfterTax }
    var optionalDeductions: Decimal { preTaxDeductions + afterTaxDeductions }
    var totalDeductions: Decimal { statutoryDeductions + optionalDeductions }
    var employeeRetirementContributions: Decimal { pension + rrsp }
}

public struct PayrollPeriodResult: Equatable, PayrollBreakdown, Identifiable {
    public var id: Int { periodNumber }
    public let periodNumber: Int
    public let gross: Decimal
    public let regularGross: Decimal
    public let overtimeGross: Decimal
    public let federalTax: Decimal
    public let provincialTax: Decimal
    /// Combined base and first additional CPP contributions, excluding CPP2.
    public let cpp: Decimal
    public let cpp2: Decimal
    public let ei: Decimal
    public let pension: Decimal
    public let rrsp: Decimal
    public let unionDues: Decimal
    public let health: Decimal
    public let otherPreTax: Decimal
    public let otherAfterTax: Decimal
    public let employerMatch: Decimal
    public let net: Decimal
    /// CRA factor A for this cheque, not a prediction of final assessed income.
    public let annualizedTaxableIncome: Decimal
    public let cppEnhancedTaxDeduction: Decimal
}

public struct PayrollAnnualResult: Equatable, PayrollBreakdown {
    public let gross: Decimal
    public let regularGross: Decimal
    public let overtimeGross: Decimal
    public let federalTax: Decimal
    public let provincialTax: Decimal
    public let cpp: Decimal
    public let cpp2: Decimal
    public let ei: Decimal
    public let pension: Decimal
    public let rrsp: Decimal
    public let unionDues: Decimal
    public let health: Decimal
    public let otherPreTax: Decimal
    public let otherAfterTax: Decimal
    public let employerMatch: Decimal
    public let net: Decimal

    init(periods: [PayrollPeriodResult]) {
        func sum(_ keyPath: KeyPath<PayrollPeriodResult, Decimal>) -> Decimal {
            periods.reduce(0) { $0 + $1[keyPath: keyPath] }
        }
        gross = sum(\.gross)
        regularGross = sum(\.regularGross)
        overtimeGross = sum(\.overtimeGross)
        federalTax = sum(\.federalTax)
        provincialTax = sum(\.provincialTax)
        cpp = sum(\.cpp)
        cpp2 = sum(\.cpp2)
        ei = sum(\.ei)
        pension = sum(\.pension)
        rrsp = sum(\.rrsp)
        unionDues = sum(\.unionDues)
        health = sum(\.health)
        otherPreTax = sum(\.otherPreTax)
        otherAfterTax = sum(\.otherAfterTax)
        employerMatch = sum(\.employerMatch)
        net = sum(\.net)
    }
}

public struct PayrollResult: Equatable {
    public let currentPeriod: PayrollPeriodResult
    public let annual: PayrollAnnualResult
    /// The annual schedule's net divided by 12; months need not contain equal pay.
    public let monthlyNet: Decimal
    /// Fraction of gross deducted from employee pay, including elected deductions.
    public let effectiveDeductionRate: Decimal
    public let periods: [PayrollPeriodResult]
    public let taxYear: Int
    public let warnings: [String]
}

public enum Money {
    /// CRA nearest-cent rounding: half a cent rounds up for nonnegative amounts.
    public static func rounded(_ amount: Decimal) -> Decimal {
        var input = amount
        var result = Decimal()
        NSDecimalRound(&result, &input, 2, .plain)
        return result
    }

    static func truncated(_ amount: Decimal) -> Decimal {
        var input = amount
        var result = Decimal()
        NSDecimalRound(&result, &input, 2, .down)
        return result
    }
}
