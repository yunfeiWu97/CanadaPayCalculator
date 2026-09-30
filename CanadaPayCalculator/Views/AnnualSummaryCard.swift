import SwiftUI
import PayrollCore

@MainActor
struct AnnualSummaryCard: View {
    let result: PayrollResult
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Card(title: "Your year at a glance") {
            VStack(spacing: 12) {
                AmountRow(title: "Average monthly take-home", amount: result.monthlyNet, isEmphasized: true)
                Text("Annual take-home divided by 12. The number of paycheques in a month can vary.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)

                Divider()
                AmountRow(title: "Annual gross income", amount: result.annual.gross)
                AmountRow(title: "Estimated annual take-home", amount: result.annual.net, isEmphasized: true)

                Divider()
                Text("Estimated annual deductions")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                AmountRow(title: "Income tax withheld", amount: result.annual.incomeTax, isDeduction: true)
                AmountRow(title: "CPP", amount: result.annual.cpp, isDeduction: true)
                if result.annual.cpp2 > 0 {
                    AmountRow(title: "CPP2", amount: result.annual.cpp2, isDeduction: true)
                }
                AmountRow(title: "EI", amount: result.annual.ei, isDeduction: true)
                AmountRow(title: "Employee retirement contributions", amount: result.annual.employeeRetirementContributions, isDeduction: true)
                if result.annual.unionDues + result.annual.health + result.annual.otherPreTax + result.annual.otherAfterTax > 0 {
                    AmountRow(
                        title: "Other employee deductions",
                        amount: result.annual.unionDues + result.annual.health + result.annual.otherPreTax + result.annual.otherAfterTax,
                        isDeduction: true
                    )
                }

                Divider()
                deductionRate
                Text("Includes income tax, statutory contributions and your optional employee deductions.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)

                AmountRow(title: "Employer pension contribution", amount: result.annual.employerMatch)
                Text("Employer contributions are separate from your employee deductions.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Forecast for \(result.taxYear), assuming the same earnings and selections all year. Income tax is payroll withholding and may differ from your final tax return.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
        }
    }

    private var deductionRate: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Effective deduction rate")
                        .foregroundStyle(.secondary)
                    Text(PayrollFormat.percent(result.effectiveDeductionRate))
                        .fontWeight(.semibold)
                        .monospacedDigit()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Effective deduction rate")
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 12)
                        Text(PayrollFormat.percent(result.effectiveDeductionRate))
                            .fontWeight(.semibold)
                            .monospacedDigit()
                            .fixedSize()
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Effective deduction rate")
                            .foregroundStyle(.secondary)
                        Text(PayrollFormat.percent(result.effectiveDeductionRate))
                            .fontWeight(.semibold)
                            .monospacedDigit()
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
