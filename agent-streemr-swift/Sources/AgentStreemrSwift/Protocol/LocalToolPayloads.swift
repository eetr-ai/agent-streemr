import Foundation

// MARK: - local_tool payload

/// Payload received from the server when it wants the client to execute a local tool.
public struct LocalToolPayload: @unchecked Sendable {
    public let requestId: String
    public let toolName: String
    public let argsJson: [String: Any]
    public let toolType: ToolType
    /// The deadline by which the client must respond (nil for fire_and_forget).
    public let expiresAt: Date?

    public enum ToolType: String, Sendable {
        case sync
        case asyncTool = "async"
        case fireAndForget = "fire_and_forget"
    }
}

// MARK: - Custom decoding from Socket.IO data

extension LocalToolPayload {
    /// Decode from Socket.IO callback data (`[Any]`).
    static func decode(from data: [Any]) -> LocalToolPayload? {
        guard let dict = data.first as? [String: Any] else { return nil }
        guard let requestId = dict["request_id"] as? String,
              let toolName = dict["tool_name"] as? String,
              let argsJson = dict["args_json"] as? [String: Any],
              let toolTypeRaw = dict["tool_type"] as? String,
              let toolType = ToolType(rawValue: toolTypeRaw)
        else { return nil }

        var expiresAt: Date? = nil
        if let expiresAtMs = dict["expires_at"] as? Double {
            expiresAt = Date(timeIntervalSince1970: expiresAtMs / 1000.0)
        } else if let expiresAtMs = dict["expires_at"] as? Int {
            expiresAt = Date(timeIntervalSince1970: Double(expiresAtMs) / 1000.0)
        }

        return LocalToolPayload(
            requestId: requestId,
            toolName: toolName,
            argsJson: argsJson,
            toolType: toolType,
            expiresAt: expiresAt
        )
    }
}

// MARK: - Handler result

/// The result returned by a local tool handler closure.
public enum LocalToolHandlerResult: @unchecked Sendable {
    /// Tool executed successfully; carry the result JSON to the server.
    case success(responseJSON: [String: Any])
    /// The user (or app logic) denied this request.
    case denied
    /// This client does not implement the requested tool.
    case notSupported
    /// An error occurred during execution.
    case error(message: String?)
}

/// Async tool handler closure type.
public typealias LocalToolHandler = @Sendable (_ args: [String: Any]) async throws -> LocalToolHandlerResult
