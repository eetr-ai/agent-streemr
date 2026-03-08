import Foundation
import SocketIO

/// Configuration needed to connect an `AgentStream` to an agent-streemr server.
public struct AgentStreamConfiguration: Sendable {
    /// Base URL of the agent-streemr server (e.g. `https://api.example.com`).
    public let url: URL
    /// Bearer JWT used to authenticate the Socket.IO handshake.
    public let token: String
    /// Additional Socket.IO client options (transport policy, TLS, reconnect behaviour, etc.).
    /// The `auth` / `connectParams` keys are managed internally and should not be set here.
    public var socketConfiguration: SocketIOClientConfiguration

    public init(
        url: URL,
        token: String,
        socketConfiguration: SocketIOClientConfiguration = []
    ) {
        self.url = url
        self.token = token
        self.socketConfiguration = socketConfiguration
    }
}
