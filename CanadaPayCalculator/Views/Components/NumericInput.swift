import SwiftUI
import Foundation

/// A decimal text draft preserves editing states and never silently reuses a
/// previously valid amount after invalid pasted text. No Double payroll values.
struct NumericInput: View {
    let title: String
    @Binding var value: Decimal
    var prefix: String? = nil
    var suffix: String? = nil
    var footnote: String? = nil
    @State private var draft: String
    @FocusState private var isFocused: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(title: String, value: Binding<Decimal>, prefix: String? = nil,
         suffix: String? = nil, footnote: String? = nil) {
        self.title = title
        self._value = value
        self.prefix = prefix
        self.suffix = suffix
        self.footnote = footnote
        self._draft = State(initialValue: Self.editableText(value.wrappedValue))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.medium))
            HStack(spacing: 8) {
                if let prefix { Text(prefix).foregroundStyle(.secondary) }
                TextField("0", text: $draft)
                    .keyboardType(.decimalPad)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($isFocused)
                    .monospacedDigit()
                    .accessibilityLabel(title)
                    .accessibilityHint(footnote ?? suffix ?? "")
                if !dynamicTypeSize.isAccessibilitySize, let suffix {
                    Text(suffix).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .padding(12)
            .background(AppTheme.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(value.isNaN ? Color.red : Color.clear, lineWidth: 1)
            }
            if dynamicTypeSize.isAccessibilitySize, let suffix {
                Text(suffix).font(.caption).foregroundStyle(.secondary)
            }
            if let footnote {
                Text(footnote).font(.caption).foregroundStyle(.secondary)
            }
        }
        .onChange(of: draft) { _, newValue in
            let parsed = Self.parse(newValue)
            if let parsed {
                if value.isNaN || value != parsed { value = parsed }
            } else if !value.isNaN {
                value = .nan
            }
        }
        .onChange(of: value) { _, newValue in
            guard !newValue.isNaN else { return }
            if !isFocused || Self.parse(draft) != newValue {
                draft = Self.editableText(newValue)
            }
        }
        .onChange(of: isFocused) { _, focused in
            if !focused && !value.isNaN { draft = Self.editableText(value) }
        }
    }

    private static func editableText(_ value: Decimal) -> String {
        guard !value.isNaN else { return "" }
        let separator = Locale.current.decimalSeparator ?? "."
        return NSDecimalNumber(decimal: value).stringValue.replacingOccurrences(of: ".", with: separator)
    }

    private static func parse(_ draft: String) -> Decimal? {
        var normalized = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let locale = Locale.current
        if let grouping = locale.groupingSeparator, grouping != locale.decimalSeparator {
            if normalized.contains(grouping) {
                // Accept pasted grouped amounts, but reject "1,5" rather than
                // silently interpreting a misplaced separator as fifteen.
                let decimal = locale.decimalSeparator ?? "."
                let parts = normalized.components(separatedBy: decimal)
                guard parts.count <= 2 else { return nil }
                let escaped = NSRegularExpression.escapedPattern(for: grouping)
                let groupedInteger = "^-?[0-9]{1,3}(?:" + escaped + "[0-9]{3})+$"
                guard parts[0].range(of: groupedInteger, options: .regularExpression) != nil,
                      parts.count == 1 || !parts[1].contains(grouping) else { return nil }
            }
            normalized = normalized.replacingOccurrences(of: grouping, with: "")
        }
        if let separator = locale.decimalSeparator, separator != "." {
            normalized = normalized.replacingOccurrences(of: separator, with: ".")
        }
        if normalized.isEmpty || normalized == "." { return 0 }
        guard normalized.range(of: #"^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$"#,
                               options: .regularExpression) != nil else { return nil }
        return Decimal(string: normalized, locale: Locale(identifier: "en_US_POSIX"))
    }
}
