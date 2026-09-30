import SwiftUI
import PayrollCore

@MainActor
struct PayBreakdownCard: View {
    let period: PayrollPeriodResult

    var body: some View {
        Card(title: "Paycheque breakdown") {
            VStack(spacing: 12) {
                AmountRow(title: "Gross pay", amount: period.gross, isEmphasized: true)
                if period.overtimeGross > 0 {
                    VStack(spacing: 8) {
                        AmountRow(title: "Regular earnings", amount: period.regularGross)
                        AmountRow(title: "Overtime earnings", amount: period.overtimeGross)
                    }
                    .padding(.leading, 12)
                    .foregroundStyle(.secondary)
                }

                Divider()
                sectionLabel("Taxes & statutory deductions")
                AmountRow(title: "Income tax", amount: period.incomeTax, isDeduction: true)
                VStack(spacing: 8) {
                    AmountRow(title: "Federal income tax", amount: period.federalTax, isDeduction: true)
                    AmountRow(title: "Provincial income tax", amount: period.provincialTax, isDeduction: true)
                }
                .padding(.leading, 12)
                .foregroundStyle(.secondary)

                AmountRow(title: "CPP", amount: period.cpp, isDeduction: true)
                if period.cpp2 > 0 {
                    AmountRow(title: "CPP2", amount: period.cpp2, isDeduction: true)
                }
                AmountRow(title: "EI", amount: period.ei, isDeduction: true)

                if period.optionalDeductions > 0 {
                    Divider()
                    sectionLabel("Your optional deductions")
                    if period.pension > 0 {
                        AmountRow(title: "Employee pension (RPP)", amount: period.pension, isDeduction: true)
                    }
                    if period.rrsp > 0 {
                        AmountRow(title: "Payroll RRSP", amount: period.rrsp, isDeduction: true)
                    }
                    if period.unionDues > 0 {
                        AmountRow(title: "Union dues", amount: period.unionDues, isDeduction: true)
                    }
                    if period.health > 0 {
                        AmountRow(title: "Health & dental", amount: period.health, isDeduction: true)
                    }
                    if period.otherPreTax > 0 {
                        AmountRow(title: "Other pre-tax deduction", amount: period.otherPreTax, isDeduction: true)
                    }
                    if period.otherAfterTax > 0 {
                        AmountRow(title: "Other after-tax deduction", amount: period.otherAfterTax, isDeduction: true)
                    }
                }

                Divider()
                AmountRow(title: "Take-home pay", amount: period.net, isEmphasized: true)

                if period.employerMatch > 0 {
                    Divider()
                    sectionLabel("Employer contribution")
                    AmountRow(title: "Employer pension", amount: period.employerMatch)
                    Text("Added to your pension. This does not reduce your take-home pay.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}
