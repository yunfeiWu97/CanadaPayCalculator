import SwiftUI

@main
@MainActor
struct CanadaPayCalculatorApp: App {
    var body: some Scene {
        WindowGroup {
            CalculatorView()
                .tint(AppTheme.accent)
        }
    }
}
