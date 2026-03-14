import Foundation
import SocketIO

/// Configuration needed to connect an `AgentStream` to an agent-streemr server.
public struct AgentStreamConfiguration: @unchecked Sendable {
    /// Base URL of the agent-streemr server (e.g. `https://api.example.com`).
    public let url: URL
    /// Bearer JWT used to authenticate the Socket.IO handshake.
    public let token: String
    /// Additional Socket.IO client options (transport policy, TLS, reconnect behaviour, etc.).
    /// The `auth` / `connectParams` keys are managed internally and should not be set here.
    public var socketConfiguration: SocketIOClientConfiguration
    /// Optional agent identifier forwarded in `client_hello.agent_id`.
    /// The server can use this to route threads to different agent implementations.
    public var agentId: String?
    /// Requested inactivity timeout in milliseconds sent in `client_hello.inactivity_timeout_ms`.
    /// The server may cap this value. `nil` or `0` requests no inactivity timeout.
    public var inactivityTimeoutMs: Int?
    /// How long to wait (in seconds) for an `attachment_ack` from the server.
    /// Defaults to `10.0`.
    public var attachmentAckTimeoutSeconds: Double

    public init(
        url: URL,
        token: String,
        socketConfiguration: SocketIOClientConfiguration = [],
        agentId: String? = nil,
        inactivityTimeoutMs: Int? = nil,
        attachmentAckTimeoutSeconds: Double = 10.0
    ) {
        self.url = url
        self.token = token
        self.socketConfiguration = socketConfiguration
        self.agentId = agentId
        self.inactivityTimeoutMs = inactivityTimeoutMs
        self.attachmentAckTimeoutSeconds = attachmentAckTimeoutSeconds
    }
}
