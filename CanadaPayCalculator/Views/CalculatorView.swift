import SwiftUI
import UIKit
import PayrollCore

@MainActor
struct CalculatorView: View {
    @StateObject private var model = CalculatorViewModel()
    @State private var isShowingAbout = false
    @State private var isShowingReset = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    introduction
                    IncomeSection(model: model)
                    PayFrequencySection(model: model)

                    if let result = model.result {
                        TakeHomeCard(result: result, frequency: model.input.frequency)
                        PayBreakdownCard(period: result.currentPeriod)
                    } else {
                        validationCard
                    }

                    DeductionsSection(model: model)

                    if let result = model.result {
                        AnnualSummaryCard(result: result)
                        if !result.warnings.isEmpty {
                            Card(title: "Estimate notes") {
                                ForEach(Array(result.warnings.enumerated()), id: \.offset) { _, warning in
                                    Text(warning)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }
                    footer
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 20)
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(AppTheme.background)
            .navigationTitle("Canada Pay Calculator")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("How estimates work", systemImage: "info.circle") {
                            isShowingAbout = true
                        }
                        Button("Reset inputs", systemImage: "arrow.counterclockwise") {
                            isShowingReset = true
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Calculator options")
                }
            }
            .sheet(isPresented: $isShowingAbout) {
                AboutSheet()
            }
            .confirmationDialog("Reset all inputs to the default example?", isPresented: $isShowingReset, titleVisibility: .visible) {
                Button("Reset inputs", role: .destructive) {
                    model.reset()
                }
            }
        }
        .tint(AppTheme.accent)
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Make sense of your pay.")
                .font(.title2.weight(.bold))
                .accessibilityAddTraits(.isHeader)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Picker("Province of employment", selection: model.binding(\.province)) {
                    ForEach(Province.supportedProvinces) { province in
                        Text(province.displayName).tag(province)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .accessibilityLabel("Province of employment")
                .accessibilityHint("Manitoba is the currently supported province")
                Spacer(minLength: 8)
                Text("\(TaxYear.current.year) tax year")
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline.weight(.medium))
            Text("Manitoba is currently supported. All amounts are Canadian dollars.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var validationCard: some View {
        Card(title: "Check your inputs") {
            Label {
                Text(model.errorMessage ?? "Enter valid amounts to see your take-home estimate.")
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.circle")
                    .foregroundStyle(.orange)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("An estimate of payroll withholding. Your employer's TD1 amounts, benefits, year-to-date earnings and rounding can change your actual pay. Final annual income tax may differ.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                isShowingAbout = true
            } label: {
                Label("Methodology & reference paycheque", systemImage: "info.circle")
                    .font(.footnote.weight(.medium))
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 8)
    }
}



#Preview {
    CalculatorView()
}
