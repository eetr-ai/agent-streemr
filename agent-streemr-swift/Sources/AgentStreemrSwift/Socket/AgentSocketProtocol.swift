/// Abstraction over a Socket.IO connection.
///
/// Using a protocol here allows `AgentStream` to be tested with `MockAgentSocket`
/// without spinning up a real network connection.
public protocol AgentSocketProtocol: AnyObject, Sendable {
    /// Whether the socket is currently in a connected state.
    var isConnected: Bool { get }

    /// Register a callback for a named event.
    /// The callback receives Socket.IO's raw `[Any]` data array.
    func on(_ event: String, callback: @escaping @Sendable ([Any]) -> Void)

    /// Remove all callbacks registered for the named event.
    func off(_ event: String)

    /// Emit an event with a single dictionary payload.
    func emit(_ event: String, with items: [[String: Any]])

    /// Emit an event with no payload (e.g., `clear_context`).
    func emitEmpty(_ event: String)

    /// Open the connection.
    func connect()

    /// Close the connection.
    func disconnect()

    /// Remove all registered event handlers.
    func removeAllHandlers()
}
