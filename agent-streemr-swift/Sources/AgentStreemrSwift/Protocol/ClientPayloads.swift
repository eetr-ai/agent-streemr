import Foundation

// MARK: - client_hello

struct ClientHelloPayload {
    let version: ProtocolVersion
    let agentId: String?
    let inactivityTimeoutMs: Int?

    func toSocketData() -> [String: Any] {
        var dict: [String: Any] = [
            "version": ["major": version.major, "minor": version.minor]
        ]
        if let agentId {
            dict["agent_id"] = agentId
        }
        if let inactivityTimeoutMs, inactivityTimeoutMs > 0 {
            dict["inactivity_timeout_ms"] = inactivityTimeoutMs
        }
        return dict
    }
}

// MARK: - message

struct MessagePayload {
    let text: String
    let context: [String: Any]?
    let attachmentCorrelationId: String?

    init(text: String, context: [String: Any]? = nil, attachmentCorrelationId: String? = nil) {
        self.text = text
        self.context = context
        self.attachmentCorrelationId = attachmentCorrelationId
    }

    func toSocketData() -> [String: Any] {
        var dict: [String: Any] = ["text": text]
        if let context {
            dict["context"] = context
        }
        if let attachmentCorrelationId {
            dict["attachment_correlation_id"] = attachmentCorrelationId
        }
        return dict
    }
}

// MARK: - Attachment

/// An attachment content object carried by the multi-step upload protocol.
public struct Attachment: Sendable {
    /// `"image"` for raster images or `"markdown"` for Markdown text files.
    public let type: String
    /// The file content encoded as a Base64 string.
    public let body: String
    /// Optional filename or human-readable label.
    public let name: String?

    public init(type: String, body: String, name: String? = nil) {
        self.type = type
        self.body = body
        self.name = name
    }
}

// MARK: - start_attachments

struct StartAttachmentsPayload {
    let correlationId: String
    let count: Int

    func toSocketData() -> [String: Any] {
        return ["correlation_id": correlationId, "count": count]
    }
}

// MARK: - attachment (individual upload)

struct AttachmentUploadPayload {
    let correlationId: String
    let seq: Int
    let type: String
    let body: String
    let name: String?

    func toSocketData() -> [String: Any] {
        var dict: [String: Any] = [
            "correlation_id": correlationId,
            "seq": seq,
            "type": type,
            "body": body
        ]
        if let name {
            dict["name"] = name
        }
        return dict
    }
}

// MARK: - set_context

struct SetContextPayload {
    let data: [String: Any]

    func toSocketData() -> [String: Any] {
        return ["data": data]
    }
}

// MARK: - local_tool_response

/// Discriminated-union response sent back to the server for a local tool invocation.
public enum LocalToolResponsePayload: Sendable {
    case success(requestId: String, toolName: String, responseJSON: [String: Any])
    case denied(requestId: String, toolName: String)
    case notSupported(requestId: String, toolName: String)
    case error(requestId: String, toolName: String, errorMessage: String?)

    func toSocketData() -> [String: Any] {
        var dict: [String: Any]
        switch self {
        case .success(let requestId, let toolName, let responseJSON):
            dict = ["request_id": requestId, "tool_name": toolName, "response_json": responseJSON]
        case .denied(let requestId, let toolName):
            dict = ["request_id": requestId, "tool_name": toolName, "allowed": false]
        case .notSupported(let requestId, let toolName):
            dict = ["request_id": requestId, "tool_name": toolName, "notSupported": true]
        case .error(let requestId, let toolName, let errorMessage):
            dict = ["request_id": requestId, "tool_name": toolName, "error": true]
            if let errorMessage {
                dict["errorMessage"] = errorMessage
            }
        }
        return dict
    }
}
