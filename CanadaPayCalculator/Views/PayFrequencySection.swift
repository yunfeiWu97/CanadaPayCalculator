import SwiftUI
import PayrollCore

@MainActor
struct PayFrequencySection: View {
    @ObservedObject var model: CalculatorViewModel

    private var frequencyBinding: Binding<PayFrequency> {
        Binding(
            get: { model.input.frequency },
            set: { frequency in
                var updated = model.input
                updated.frequency = frequency
                updated.selectedPayPeriod = min(max(1, updated.selectedPayPeriod), frequency.periodsPerYear)
                model.input = updated
            }
        )
    }

    var body: some View {
        Card(title: "Pay frequency") {
            Picker("Paid", selection: frequencyBinding) {
                ForEach(PayFrequency.allCases) { frequency in
                    Text("\(frequency.displayName) · \(frequency.periodsPerYear) / year")
                        .tag(frequency)
                }
            }
            .pickerStyle(.menu)
            .accessibilityHint("The number of paycheques received in a full year")

            Text(frequencyExplanation)
                .font(.footnote)
                .foregroundStyle(.secondary)

            Divider()

            Stepper(value: model.binding(\.selectedPayPeriod), in: 1...model.input.frequency.periodsPerYear) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Paycheque \(model.input.selectedPayPeriod) of \(model.input.frequency.periodsPerYear)")
                        .font(.subheadline.weight(.medium))
                    Text("Within the calendar year")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityLabel("Paycheque within the calendar year")
            .accessibilityValue("\(model.input.selectedPayPeriod) of \(model.input.frequency.periodsPerYear)")
            .accessibilityHint("Later paycheques can have different CPP, CPP2 and EI deductions when annual limits are reached")

            Text("CPP, CPP2 and EI change when annual limits are reached. This estimate starts with no earlier earnings on January 1.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var frequencyExplanation: String {
        switch model.input.frequency {
        case .weekly:
            return "Once each week: 52 paycheques per year."
        case .biweekly:
            return "Every two weeks: 26 paycheques per year. Some months have three paycheques."
        case .semiMonthly:
            return "Twice each month: 24 paycheques per year. Bi-weekly pay has 26, so each cheque is a different amount."
        case .monthly:
            return "Once each month: 12 paycheques per year."
        }
    }
}
