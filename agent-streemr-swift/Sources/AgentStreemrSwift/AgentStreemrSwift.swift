/// AgentStreemrSwift — Swift client library for agent-streemr servers.
///
/// This module provides a complete Swift implementation of the agent-streemr
/// client protocol, equivalent to the `@eetr/agent-streemr-react` library.
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
/// // 2. Create stream (typically in your App or ViewModel)
/// let stream = AgentStream(configuration: config)
///
/// // 3. Register local tools (optional)
/// stream.registerTool("get_location") { _ in
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
/// ## Key Types
///
/// | Type | Purpose |
/// |------|---------|
/// | ``AgentStream`` | Central `@Observable` class — manages connection, state, and messaging |
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
