import Foundation
import SwiftUI
import Combine
import PayrollCore

/// UI state and on-device preferences only. Payroll arithmetic stays in PayrollCore.
@MainActor
final class CalculatorViewModel: ObservableObject {
    @Published var input: PayrollInput {
        didSet { recalculate() }
    }
    @Published private(set) var result: PayrollResult?
    @Published private(set) var errorMessage: String?

    private let preferences: UserDefaults
    private static let settingsKey = "CanadaPayCalculator.payrollInput.v1"

    init(preferences: UserDefaults = .standard) {
        self.preferences = preferences
        if let data = preferences.data(forKey: Self.settingsKey),
           let saved = try? JSONDecoder().decode(PayrollInput.self, from: data) {
            var restored = saved
            restored.selectedPayPeriod = min(max(1, restored.selectedPayPeriod), restored.frequency.periodsPerYear)
            input = restored
        } else {
            input = PayrollInput()
        }
        recalculate()
    }

    func binding<Value>(_ keyPath: WritableKeyPath<PayrollInput, Value>) -> Binding<Value> {
        Binding(
            get: { self.input[keyPath: keyPath] },
            set: { value in
                var updated = self.input
                updated[keyPath: keyPath] = value
                updated.selectedPayPeriod = min(max(1, updated.selectedPayPeriod), updated.frequency.periodsPerYear)
                self.input = updated
            }
        )
    }

    func reset() {
        input = PayrollInput()
    }

    private func recalculate() {
        do {
            let calculated = try PayrollCalculator.calculate(input)
            result = calculated
            errorMessage = nil
            // Persist only a valid scenario; a half-edited number should not
            // replace the user's last usable settings when the app is closed.
            if let data = try? JSONEncoder().encode(persistableInput()) {
                preferences.set(data, forKey: Self.settingsKey)
            }
        } catch {
            result = nil
            errorMessage = error.localizedDescription
        }
    }

    private func persistableInput() -> PayrollInput {
        var saved = input
        // Invalid drafts in inactive controls must not prevent an otherwise
        // valid scenario from being saved (JSON cannot encode Decimal NaN).
        if saved.annualSalary.isNaN { saved.annualSalary = 65_000 }
        if saved.hourlyRate.isNaN { saved.hourlyRate = 25 }
        if saved.hoursPerWeek.isNaN { saved.hoursPerWeek = Decimal(string: "37.5")! }
        if saved.overtimeHours.isNaN { saved.overtimeHours = 0 }
        if saved.overtimeMultiplier.isNaN { saved.overtimeMultiplier = Decimal(string: "1.5")! }
        let contributionPaths: [WritableKeyPath<OptionalDeductions, Contribution>] = [
            \.pension, \.rrsp, \.unionDues, \.health, \.otherPreTax, \.otherAfterTax, \.employerMatch
        ]
        for path in contributionPaths {
            if saved.deductions[keyPath: path].amount.isNaN {
                saved.deductions[keyPath: path].amount = 0
            }
        }
        return saved
    }
}
