import SwiftUI
import PayrollCore

@MainActor
struct IncomeSection: View {
    @ObservedObject var model: CalculatorViewModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Card(title: "Income") {
            if dynamicTypeSize.isAccessibilitySize {
                incomeTypePicker.pickerStyle(.menu)
            } else {
                incomeTypePicker.pickerStyle(.segmented)
            }

            if model.input.incomeType == .annualSalary {
                NumericInput(
                    title: "Annual salary",
                    value: model.binding(\.annualSalary),
                    prefix: "$",
                    suffix: "CAD / year"
                )
            } else {
                NumericInput(
                    title: "Hourly rate",
                    value: model.binding(\.hourlyRate),
                    prefix: "$",
                    suffix: "CAD / hour"
                )
                NumericInput(
                    title: "Regular hours per week",
                    value: model.binding(\.hoursPerWeek),
                    suffix: "hours"
                )
                Divider()
                NumericInput(
                    title: "Overtime hours per week",
                    value: model.binding(\.overtimeHours),
                    suffix: "hours",
                    footnote: "Optional hours in addition to your regular weekly hours."
                )
                if model.input.overtimeHours > 0 {
                    NumericInput(
                        title: "Overtime multiplier",
                        value: model.binding(\.overtimeMultiplier),
                        suffix: "× regular rate",
                        footnote: "For example, 1.5 means time and a half."
                    )
                }
                Text("Hourly estimates assume the same hours each week for 52 weeks. Overtime is shown separately in your pay breakdown.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var incomeTypePicker: some View {
        Picker("Pay type", selection: model.binding(\.incomeType)) {
            ForEach(IncomeType.allCases) { type in
                Text(type.displayName).tag(type)
            }
        }
        .accessibilityHint("Choose an annual salary or an hourly wage")
    }
}
