import Foundation
import SocketIO

/// Production `AgentSocketProtocol` implementation backed by Socket.IO-Client-Swift.
public final class LiveAgentSocket: AgentSocketProtocol, @unchecked Sendable {
    private let manager: SocketManager
    private let socket: SocketIOClient

    /// - Parameters:
    ///   - url: Base URL of the agent-streemr server (e.g. `https://api.example.com`).
    ///   - token: Bearer JWT token passed in the Socket.IO handshake `auth` object.
    ///   - threadId: Conversation thread identifier, sent as `installation_id` in the handshake.
    ///   - extraConfig: Additional Socket.IO client configuration options.
    public init(
        url: URL,
        token: String,
        threadId: String,
        extraConfig: SocketIOClientConfiguration = []
    ) {
        // The token is sent both ways for maximum server compatibility:
        //   1. HTTP header: Authorization: Bearer <token>  (socket.handshake.headers["authorization"])
        //   2. Query/auth param: token=<token>             (socket.handshake.auth.token / handshake.query.token)
        // The thread identifier is also included in connectParams.
        var config: SocketIOClientConfiguration = [
            .extraHeaders(["Authorization": "Bearer \(token)"]),
            .connectParams(["token": token, "installation_id": threadId]),
            .log(false),
            .reconnects(true),
            .reconnectAttempts(-1),
        ]
        for option in extraConfig {
            config.insert(option)
        }
        manager = SocketManager(socketURL: url, config: config)
        socket = manager.defaultSocket
    }

    public var isConnected: Bool {
        socket.status == .connected
    }

    public func on(_ event: String, callback: @escaping @Sendable ([Any]) -> Void) {
        socket.on(event) { data, _ in callback(data) }
    }

    public func off(_ event: String) {
        socket.off(event)
    }

    public func emit(_ event: String, with items: [[String: Any]]) {
        if let first = items.first {
            socket.emit(event, first)
        } else {
            socket.emit(event)
        }
    }

    public func emitEmpty(_ event: String) {
        socket.emit(event)
    }

    public func connect() {
        socket.connect(withPayload: [
            "installation_id": threadId,
            "token": token,
        ])
    }

    public func disconnect() {
        socket.disconnect()
    }

    public func removeAllHandlers() {
        socket.removeAllHandlers()
    }
}
