// swift-tools-version: 5.9
import PackageDescription

/// The payroll engine is deliberately usable without SwiftUI or an Apple SDK.
/// Run `swift test` on any supported Swift host; the native app consumes this product.
let package = Package(
    name: "CanadaPayCalculator",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "PayrollCore", targets: ["PayrollCore"])
    ],
    targets: [
        .target(name: "PayrollCore", path: "Sources/PayrollCore"),
        .testTarget(
            name: "PayrollCoreTests",
            dependencies: ["PayrollCore"],
            path: "Tests/PayrollCoreTests"
        )
    ],
    swiftLanguageVersions: [.v5]
)
