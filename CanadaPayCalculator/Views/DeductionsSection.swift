import SwiftUI
import PayrollCore

@MainActor
struct DeductionsSection: View {
    @ObservedObject var model: CalculatorViewModel
    @State private var isExpanded = false

    var body: some View {
        Card {
            DisclosureGroup(isExpanded: $isExpanded) {
                VStack(alignment: .leading, spacing: 20) {
                    Text("All contributions are optional. Employee deductions reduce take-home pay; employer contributions are shown separately.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    ContributionEditor(
                        title: "Registered Pension Plan",
                        subtitle: "Employee RPP contribution · pre-tax",
                        contribution: model.binding(\.deductions.pension)
                    )
                    Divider()
                    ContributionEditor(
                        title: "Employer pension match",
                        subtitle: "Employer savings contribution · does not reduce take-home pay",
                        contribution: model.binding(\.deductions.employerMatch)
                    )
                    Divider()
                    ContributionEditor(
                        title: "Payroll RRSP",
                        subtitle: "Employee RRSP contribution · pre-tax",
                        contribution: model.binding(\.deductions.rrsp)
                    )
                    Divider()
                    ContributionEditor(
                        title: "Union dues",
                        subtitle: "Income-tax deductible dues",
                        contribution: model.binding(\.deductions.unionDues)
                    )
                    Divider()
                    ContributionEditor(
                        title: "Health & dental benefits",
                        subtitle: "Employee premium · after-tax",
                        contribution: model.binding(\.deductions.health)
                    )
                    Divider()
                    ContributionEditor(
                        title: "Other pre-tax deduction",
                        subtitle: "Employer-authorized income-tax deduction",
                        contribution: model.binding(\.deductions.otherPreTax)
                    )
                    Divider()
                    ContributionEditor(
                        title: "Other after-tax deduction",
                        subtitle: "Deducted from take-home pay",
                        contribution: model.binding(\.deductions.otherAfterTax)
                    )
                    Text("Pre-tax deductions here reduce income-tax withholding, not CPP or EI. Confirm eligibility and any RRSP or pension limits with your employer.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 16)
            } label: {
                Label("Pension & Other Deductions", systemImage: "leaf")
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityHint("Expand to add optional employee deductions and employer savings")
        }
    }
}

@MainActor
private struct ContributionEditor: View {
    let title: String
    let subtitle: String
    @Binding var contribution: Contribution
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle(isOn: $contribution.isEnabled) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityLabel(title)
            .accessibilityHint(subtitle)

            if contribution.isEnabled {
                if dynamicTypeSize.isAccessibilitySize {
                    amountTypePicker.pickerStyle(.menu)
                } else {
                    amountTypePicker.pickerStyle(.segmented)
                }

                NumericInput(
                    title: title + " amount",
                    value: $contribution.amount,
                    prefix: contribution.mode == .fixedPerPeriod ? "$" : nil,
                    suffix: contribution.mode == .percentOfGross ? "% of gross" : "CAD / cheque",
                    footnote: contribution.mode == .percentOfGross
                        ? "Calculated from each paycheque's gross pay."
                        : "This amount is deducted or contributed on every paycheque."
                )
            }
        }
    }

    private var amountTypePicker: some View {
        Picker("\(title) amount type", selection: $contribution.mode) {
            Text("% of gross").tag(ContributionMode.percentOfGross)
            Text("Fixed per cheque").tag(ContributionMode.fixedPerPeriod)
        }
    }
}
