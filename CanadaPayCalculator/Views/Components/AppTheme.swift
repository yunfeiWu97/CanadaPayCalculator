import SwiftUI
import Foundation

enum AppTheme {
    static var accent: Color { Color.accentColor }
    static var background: Color { Color(uiColor: .systemGroupedBackground) }
    static var surface: Color { Color(uiColor: .secondarySystemGroupedBackground) }
}

enum PayrollFormat {
    static func currency(_ value: Decimal) -> String {
        value.formatted(.currency(code: "CAD").locale(Locale(identifier: "en_CA")))
    }

    /// PayrollResult supplies a fraction, so 0.25 is displayed as 25%.
    static func percent(_ value: Decimal) -> String {
        value.formatted(.percent.precision(.fractionLength(1)).locale(Locale(identifier: "en_CA")))
    }
}
