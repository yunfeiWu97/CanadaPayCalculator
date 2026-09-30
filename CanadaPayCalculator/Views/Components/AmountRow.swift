import SwiftUI
import Foundation

struct AmountRow: View {
    let title: String
    let amount: Decimal
    var isDeduction = false
    var isEmphasized = false

    private var displayedAmount: String {
        (isDeduction && amount > 0 ? "−" : "") + PayrollFormat.currency(amount)
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(title)
                Spacer(minLength: 12)
                Text(displayedAmount).monospacedDigit().fixedSize()
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                Text(displayedAmount).monospacedDigit()
            }
        }
        .font(isEmphasized ? .headline : .subheadline)
        .foregroundStyle(isEmphasized ? Color.primary : Color.secondary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue((isDeduction ? "Deduction " : "") + PayrollFormat.currency(amount))
    }
}
