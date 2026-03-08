import Foundation

// MARK: - client_hello

struct ClientHelloPayload: Encodable {
    let version: ProtocolVersion
}

// MARK: - message

struct MessagePayload {
    let text: String
    let context: [String: Any]?

    func toSocketData() -> [String: Any] {
        var dict: [String: Any] = ["text": text]
        if let context {
            dict["context"] = context
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
