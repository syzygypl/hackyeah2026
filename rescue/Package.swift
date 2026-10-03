// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "rescue",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "RescueKit", targets: ["RescueKit"]),
        .executable(name: "rescue-demo", targets: ["rescue-demo"]),
        .executable(name: "rescue-server", targets: ["rescue-server"]),
    ],
    targets: [
        .target(name: "RescueKit"),
        .executableTarget(name: "rescue-demo", dependencies: ["RescueKit"]),
        // Story Studio state + narrative parsing, used by rescue-server
        .target(name: "RescueStudioKit", dependencies: ["RescueKit"]),
        // one backend for everything (frontends, live engine, field reports, Studio, assessment, metrics), also on Vercel
        .executableTarget(name: "rescue-server", dependencies: ["RescueKit", "RescueStudioKit"]),
    ]
)
