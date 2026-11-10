// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "AgendaDCG",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "AgendaDCG", path: "Sources/AgendaDCG")
    ]
)
