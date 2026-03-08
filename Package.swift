// swift-tools-version: 5.9
// Root-level Package.swift so Xcode can resolve AgentStreemrSwift directly
// from the repository URL. The actual sources live in agent-streemr-swift/.
import PackageDescription

let package = Package(
    name: "AgentStreemrSwift",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
        .watchOS(.v10),
        .tvOS(.v17),
    ],
    products: [
        .library(
            name: "AgentStreemrSwift",
            targets: ["AgentStreemrSwift"]
        ),
    ],
    dependencies: [
        .package(
            url: "https://github.com/socketio/socket.io-client-swift",
            from: "16.0.0"
        ),
    ],
    targets: [
        .target(
            name: "AgentStreemrSwift",
            dependencies: [
                .product(name: "SocketIO", package: "socket.io-client-swift"),
            ],
            path: "agent-streemr-swift/Sources/AgentStreemrSwift"
        ),
        .testTarget(
            name: "AgentStreemrSwiftTests",
            dependencies: ["AgentStreemrSwift"],
            path: "agent-streemr-swift/Tests/AgentStreemrSwiftTests"
        ),
    ]
)
