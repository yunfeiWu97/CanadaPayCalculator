import Foundation
import SwiftUI
import PayrollCore

@MainActor
struct AboutSheet: View {
    @Environment(\.dismiss) private var dismiss
    private let estimate = try? PayrollCalculator.calculate(PayrollInput())

    var body: some View {
        NavigationStack {
            Form {
                Section("Payroll rules") {
                    LabeledContent("Tax year", value: String(TaxYear.current.year))
                    LabeledContent("Province of employment", value: "Manitoba")
                    Text("Rates checked September 30, 2026. CRA's July update leaves Manitoba's January payroll rules in place.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    Text("Each cheque uses CRA's annualized withholding formulas, federal and Manitoba brackets, basic personal amounts, the Canada employment amount, and CPP and EI tax credits.")
                    Text("A full year of cheques is calculated in order. CPP, CPP2, and EI change as annual limits are reached. The selected pay period shows that cheque's estimate.")
                    Text("Annual take-home is the sum of those cheques. Monthly take-home is that total divided by 12.")
                } header: {
                    Text("How estimates work")
                } footer: {
                    Text("Payroll withholding can differ from your final income-tax assessment. Employer rounding and payroll settings may also change the amount paid.")
                }
                Section {
                    Text("The forecast assumes one employer, regular pensionable and insurable wages, and CPP eligibility throughout the year. Basic personal amounts are adjusted for higher incomes.")
                    Text("Hourly earnings assume 52 paid weeks. Overtime hours are additional weekly hours and repeat throughout the year.")
                    Text("Employee RPP, payroll RRSP, union dues, and authorized pre-tax deductions reduce income-tax withholding. CPP and EI still use gross wages.")
                    Text("Health and dental benefits and after-tax deductions reduce take-home. Employer RPP contributions appear separately as retirement savings.")
                } header: {
                    Text("Assumptions")
                } footer: {
                    Text("RRSP and pension contribution room is not checked. Other pre-tax deductions assume employer authorization. Employer matching uses the configured contribution amount; individual plan rules may differ.")
                }
                referenceSection
                Section {
                    ForEach(TaxYear.current.sourceURLs, id: \.self) { source in
                        if let url = URL(string: source) {
                            Link(sourceTitle(source), destination: url)
                        }
                    }
                    Link("CRA Payroll Deductions Online Calculator", destination: URL(string: "https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/payroll-deductions-online-calculator.html")!)
                } header: {
                    Text("Official sources")
                } footer: {
                    Text("Calculations run on your iPhone. Use CRA's calculator and your employer's records when checking an actual payment.")
                }
            }
            .navigationTitle("About the estimate")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder private var referenceSection: some View {
        Section {
            Text("$65,000 annual salary in Manitoba, paid semi-monthly: 24 cheques per year with no optional deductions.")
                .font(.subheadline)
            if let pay = estimate?.currentPeriod {
                referenceRow("Gross", reference: "2708.33", amount: pay.gross)
                referenceRow("CPP", reference: "152.47", amount: pay.cpp)
                referenceRow("EI", reference: "44.15", amount: pay.ei)
                referenceRow("Income tax", reference: "477.15", amount: pay.incomeTax)
                referenceRow("Take-home", reference: "2034.56", amount: pay.net)
            }
        } header: {
            Text("Reference paycheque")
        } footer: {
            Text("Each row shows the supplied reference followed by a fresh estimate from the tax configuration. Results are derived from payroll rules.")
        }
    }

    private func referenceRow(_ title: String, reference: String, amount: Decimal) -> some View {
        LabeledContent(title) {
            VStack(alignment: .trailing, spacing: 3) {
                Text("Reference: \(PayrollFormat.currency(Decimal(string: reference)!))")
                Text("Estimate: \(PayrollFormat.currency(amount))")
            }
            .font(.caption).monospacedDigit()
            .multilineTextAlignment(.trailing)
        }
    }

    private func sourceTitle(_ source: String) -> String {
        if source.contains("t4127-jan") { return "T4127 payroll formulas - January \(TaxYear.current.year)" }
        if source.contains("t4127-jul") { return "T4127 payroll formulas - July \(TaxYear.current.year)" }
        if source.contains("t4032") { return "T4032 Manitoba payroll tables" }
        return "CRA payroll source"
    }
}

#Preview { AboutSheet() }
