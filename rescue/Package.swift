// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "rescue",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "RescueKit", targets: ["RescueKit"]),
        .executable(name: "rescue-demo", targets: ["rescue-demo"]),
        .executable(name: "rescue-field", targets: ["rescue-field"]),
        .executable(name: "rescue-studio", targets: ["rescue-studio"]),
        .executable(name: "rescue-server", targets: ["rescue-server"]),
    ],
    targets: [
        .target(name: "RescueKit"),
        .executableTarget(name: "rescue-demo", dependencies: ["RescueKit"]),
        .executableTarget(name: "rescue-field", dependencies: ["RescueKit"]),
        // Story Studio state + narrative parsing, shared by rescue-studio and rescue-server
        .target(name: "RescueStudioKit", dependencies: ["RescueKit"]),
        .executableTarget(name: "rescue-studio", dependencies: ["RescueKit", "RescueStudioKit"]),
        // one backend for everything (frontends, live engine, field reports, Studio, assessment, metrics)
        .executableTarget(name: "rescue-server", dependencies: ["RescueKit", "RescueStudioKit"]),
    ]
)
