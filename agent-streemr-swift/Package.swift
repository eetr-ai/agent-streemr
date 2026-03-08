// swift-tools-version: 5.9
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
            ]
        ),
        .testTarget(
            name: "AgentStreemrSwiftTests",
            dependencies: ["AgentStreemrSwift"]
        ),
    ]
)
