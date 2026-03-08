/// AgentStreemrSwift — Swift client library for agent-streemr servers.
///
/// This module provides a complete Swift implementation of the agent-streemr
/// client protocol, equivalent to the `@eetr/agent-streemr-react` library.
///
/// ## Installation
///
/// Add the package via Swift Package Manager (Xcode → File → Add Package
/// Dependencies, or in `Package.swift`):
///
/// ```swift
/// // Package.swift
/// dependencies: [
///     .package(url: "https://github.com/your-org/agent-streemr", from: "1.0.0"),
/// ],
/// targets: [
///     .target(name: "MyApp", dependencies: [
///         .product(name: "AgentStreemrSwift", package: "agent-streemr"),
///     ]),
/// ]
/// ```
///
/// For local development with the monorepo checked out alongside your app:
///
/// ```swift
/// .package(path: "../agent-streemr/agent-streemr-swift")
/// ```
///
/// ## Quick Start
///
/// ```swift
/// import AgentStreemrSwift
///
/// // 1. Configure
/// let config = AgentStreamConfiguration(
///     url: URL(string: "https://api.example.com")!,
///     token: bearerToken
/// )
///
/// // 2. Create stream (typically in your App or a root @State)
/// let stream = AgentStream(configuration: config)
///
/// // 3. Register local tools (optional)
/// await stream.registerTool("get_location") { _ in
///     let loc = try await LocationService.shared.current()
///     return .success(responseJSON: ["lat": loc.latitude, "lon": loc.longitude])
/// }
///
/// // 4. Connect (deferred — call after resolving the user's identity)
/// stream.connect(threadId: installationId)
///
/// // 5. In SwiftUI — inject via environment (iOS 17+)
/// WindowGroup { ContentView().environment(stream) }
///
/// // 6. In a view
/// @Environment(AgentStream.self) private var stream
/// stream.sendMessage("Hello!")
/// ```
///
/// ## Observable State
///
/// All properties on ``AgentStream`` are `@MainActor`-isolated and `@Observable`:
///
/// | Property | Type | Description |
/// |----------|------|-------------|
/// | `messages` | `[AgentMessage]` | Full conversation history |
/// | `status` | `ConnectionStatus` | Socket lifecycle state |
/// | `isStreaming` | `Bool` | `true` while the agent is mid-response |
/// | `isWorking` | `Bool` | `true` while the server queue is active |
/// | `internalThought` | `String` | Accumulated reasoning tokens |
/// | `serverVersion` | `ProtocolVersion?` | Reported after handshake |
///
/// ## Combine Publishers
///
/// Every observable property also exposes an `AnyPublisher` for UIKit / Combine:
///
/// ```swift
/// stream.statusPublisher
///     .receive(on: DispatchQueue.main)
///     .sink { print("Status:", $0) }
///     .store(in: &cancellables)
/// ```
///
/// Available publishers: `statusPublisher`, `messagesPublisher`,
/// `isStreamingPublisher`, `internalThoughtPublisher`.
///
/// ## Context Management
///
/// ```swift
/// // Push arbitrary data into the server's per-thread context
/// stream.setContext(["user_plan": "pro", "locale": "es-AR"])
///
/// // Clear thread history and context on the server
/// stream.clearContext()
/// ```
///
/// ## Local Tools
///
/// Local tools let the server invoke device-side code (location, calendar, etc.).
///
/// ```swift
/// // Simple registration
/// await stream.registerTool("get_location") { _ in
///     let loc = try await LocationService.shared.current()
///     return .success(responseJSON: ["lat": loc.latitude, "lon": loc.longitude])
/// }
///
/// // With an allow-list
/// let allowList = InMemoryAllowList()
/// await allowList.allow("get_location")
/// await stream.registerTool("get_location", allowList: allowList) { _ in ... }
///
/// // For prompt-the-user gating, implement AllowListProtocol
/// ```
///
/// ### Handler result values
///
/// | Case | When to use |
/// |------|-------------|
/// | `.success(responseJSON:)` | Tool completed successfully |
/// | `.denied` | User or policy rejected the request |
/// | `.notSupported` | This client doesn't implement the tool |
/// | `.error(message:)` | Execution failed |
///
/// ## Key Types
///
/// | Type | Purpose |
/// |------|---------|
/// | ``AgentStream`` | Central `@Observable` class — connection, state, and messaging |
/// | ``AgentStreamConfiguration`` | URL + token + optional SocketIO config |
/// | ``AgentMessage`` | A single message in the conversation |
/// | ``ConnectionStatus`` | Enum describing the socket lifecycle state |
/// | ``LocalToolCoordinator`` | Actor that manages local tool handler registrations |
/// | ``InMemoryAllowList`` | Actor-backed allow/deny registry for local tools |
/// | ``AllowListProtocol`` | Protocol for custom permission gates |
/// | ``LocalToolHandlerResult`` | Discriminated union returned by tool handlers |
/// | ``ProtocolVersion`` | Wire protocol version struct |

// The protocol version implemented by this client library.
public let agentStreemrClientVersion: ProtocolVersion = .client
