// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "rescue",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "RescueKit", targets: ["RescueKit"]),
        .executable(name: "rescue-demo", targets: ["rescue-demo"]),
    ],
    targets: [
        .target(name: "RescueKit"),
        .executableTarget(name: "rescue-demo", dependencies: ["RescueKit"]),
    ]
)
