import SwiftUI
import PayrollCore

/// The selected cheque is the primary result; annual totals are shown separately.
@MainActor
struct TakeHomeCard: View {
    let result: PayrollResult
    let frequency: PayFrequency

    @ScaledMetric(relativeTo: .largeTitle) private var amountFontSize: CGFloat = 46
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Estimated take-home", systemImage: "checkmark.circle.fill")
                .font(.headline)
                .foregroundStyle(.white.opacity(0.92))

            Text(PayrollFormat.currency(result.currentPeriod.net))
                .font(.system(size: amountFontSize, weight: .bold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.55)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.15), value: result.currentPeriod.net)
                .accessibilityLabel("Estimated take-home pay")
                .accessibilityValue(PayrollFormat.currency(result.currentPeriod.net))

            VStack(alignment: .leading, spacing: 4) {
                Text("per paycheque")
                    .font(.subheadline)
                Text("\(frequency.displayName) · Paycheque \(result.currentPeriod.periodNumber) of \(frequency.periodsPerYear)")
                    .font(.footnote)
            }
            .foregroundStyle(.white.opacity(0.88))

            Rectangle()
                .fill(.white.opacity(0.22))
                .frame(height: 1)
                .accessibilityHidden(true)

            Text("After income tax, CPP/CPP2, EI and your selected deductions.")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
        .background {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(LinearGradient(
                    colors: [Color(red: 0.035, green: 0.42, blue: 0.45),
                             Color(red: 0.025, green: 0.28, blue: 0.34)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
        }
        .accessibilityElement(children: .contain)
    }
}
