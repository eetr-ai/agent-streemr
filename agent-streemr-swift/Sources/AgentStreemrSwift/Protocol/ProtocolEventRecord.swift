import Foundation

/// A single raw protocol event, either received from the server (S→C)
/// or emitted by the client (C→S).
///
/// `AgentStream` fires these via `protocolEventPublisher` for every socket
/// event it processes. Subscribers can use this to build protocol logs,
/// debugging UIs, or analytics pipelines.
public struct ProtocolEventRecord: Sendable {

    // MARK: - Direction

    public enum Direction: String, Sendable {
        case incoming = "S→C"
        case outgoing = "C→S"
    }

    // MARK: - Properties

    /// The Socket.IO event name (e.g. `"agent_response"`, `"message"`).
    public let name: String

    /// Whether this event was received from the server or sent by the client.
    public let direction: Direction

    /// Wall-clock time the event was observed.
    public let timestamp: Date

    /// Pretty-printed JSON representation of the first payload object, if
    /// one was present and serialisable. `nil` for events with no payload
    /// (e.g. `connect`, `clear_context`).
    public let payloadJSON: String?

    // MARK: - Init

    public init(
        name: String,
        direction: Direction,
        timestamp: Date = Date(),
        payloadJSON: String? = nil
    ) {
        self.name = name
        self.direction = direction
        self.timestamp = timestamp
        self.payloadJSON = payloadJSON
    }
}
