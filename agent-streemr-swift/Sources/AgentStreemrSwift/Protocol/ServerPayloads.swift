import Foundation

// MARK: - Decoding helper

/// Decodes a `Decodable` type from Socket.IO's `[Any]` callback data.
/// Socket.IO delivers data as `[Any]` where `data[0]` is the event payload object.
func decodeSocketData<T: Decodable>(_ type: T.Type, from data: [Any]) -> T? {
    guard let dict = data.first as? [String: Any],
          let jsonData = try? JSONSerialization.data(withJSONObject: dict) else {
        return nil
    }
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try? decoder.decode(type, from: jsonData)
}

// MARK: - welcome

public struct WelcomeCapabilities: Decodable, Sendable {
    public let maxMessageSizeBytes: Int
    public let inactivityTimeoutMs: Int
}

struct WelcomePayload: Decodable {
    let serverVersion: ProtocolVersion
    let capabilities: WelcomeCapabilities
}

// MARK: - version_not_supported

struct VersionNotSupportedPayload: Decodable {
    let serverVersion: ProtocolVersion
    let clientVersion: ProtocolVersion
}

// MARK: - agent_working

struct AgentWorkingPayload: Decodable {
    let working: Bool
}

// MARK: - internal_token

struct InternalTokenPayload: Decodable {
    let token: String
}

// MARK: - agent_response

struct AgentResponsePayload: Decodable {
    let chunk: String?
    let done: Bool
}

// MARK: - local_tool_response_ack

public struct LocalToolResponseAckPayload: Decodable, Sendable {
    public let requestId: String
    public let toolName: String
}

// MARK: - context_cleared

struct ContextClearedPayload: Decodable {
    let message: String
}

// MARK: - inactive_close

struct InactiveClosePayload: Decodable {
    let reason: String
}

// MARK: - attachment_ack

struct AttachmentAckPayload: Decodable {
    let correlationId: String
    let seq: Int
}

// MARK: - error

struct ErrorPayload: Decodable {
    let message: String
}
