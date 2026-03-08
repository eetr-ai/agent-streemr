/// The lifecycle state of the agent stream connection.
public enum ConnectionStatus: Sendable, Equatable {
    /// No active socket connection.
    case disconnected
    /// `connect(threadId:)` was called; waiting for the socket handshake to complete.
    case connecting
    /// Socket is connected and the protocol handshake succeeded.
    case connected
    /// A connection or protocol error occurred. The associated value carries a human-readable message.
    case error(String)

    /// Convenience accessor for the error message when `self == .error(...)`.
    public var errorMessage: String? {
        if case .error(let msg) = self { return msg }
        return nil
    }

    /// `true` when the socket is ready to send messages.
    public var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }
}
