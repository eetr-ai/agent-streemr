import Foundation

/// Errors thrown by the AgentStreemrSwift library.
public enum AgentStreemrError: Error, LocalizedError, Sendable {
    /// An operation was attempted while the socket was not connected.
    case notConnected
    /// The server rejected the client's protocol version.
    case protocolVersionNotSupported(clientVersion: ProtocolVersion, serverVersion: ProtocolVersion)
    /// The TCP/WebSocket connection could not be established.
    case connectionFailed(String)
    /// The server sent an application-level error event.
    case serverError(String)
    /// A local tool handler threw an unexpected error.
    case toolHandlerError(String)
    /// Server did not acknowledge all attachments within the configured timeout.
    case attachmentAckTimeout

    public var errorDescription: String? {
        switch self {
        case .notConnected:
            return "AgentStream is not connected. Call connect(threadId:) first."
        case .protocolVersionNotSupported(let client, let server):
            return "Protocol version not supported: client=\(client.major).\(client.minor), server=\(server.major).\(server.minor)"
        case .connectionFailed(let reason):
            return "Connection failed: \(reason)"
        case .serverError(let message):
            return "Server error: \(message)"
        case .toolHandlerError(let message):
            return "Tool handler error: \(message)"
        case .attachmentAckTimeout:
            return "Attachment upload timed out: server did not acknowledge all attachments in time."
        }
    }
}
