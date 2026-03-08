import Foundation
@testable import AgentStreemrSwift

/// Test double for `AgentSocketProtocol`.
///
/// - Call `trigger(_:data:)` to simulate server→client events.
/// - Read `emittedEvents` to assert client→server emissions.
/// - Use `triggerConnect()` / `triggerDisconnect()` for lifecycle events.
final class MockAgentSocket: AgentSocketProtocol, @unchecked Sendable {
    var isConnected: Bool = true

    private var listeners: [String: [([Any]) -> Void]] = [:]
    private let lock = NSLock()

    private(set) var emittedEvents: [(event: String, data: [[String: Any]])] = []

    func on(_ event: String, callback: @escaping @Sendable ([Any]) -> Void) {
        lock.withLock {
            listeners[event, default: []].append(callback)
        }
    }

    func off(_ event: String) {
        lock.withLock { listeners.removeValue(forKey: event) }
    }

    func emit(_ event: String, with items: [[String: Any]]) {
        lock.withLock { emittedEvents.append((event: event, data: items)) }
    }

    func emitEmpty(_ event: String) {
        lock.withLock { emittedEvents.append((event: event, data: [])) }
    }

    func connect() {}

    func disconnect() {
        lock.withLock { isConnected = false }
    }

    func removeAllHandlers() {
        lock.withLock { listeners.removeAll() }
    }

    // MARK: - Test Helpers

    /// Simulate a server→client event with a dictionary payload.
    func trigger(_ event: String, data: [String: Any] = [:]) {
        let callbacks = lock.withLock { listeners[event] ?? [] }
        callbacks.forEach { $0([data]) }
    }

    /// Simulate the Socket.IO `connect` lifecycle event (no payload).
    func triggerConnect() {
        let callbacks = lock.withLock { listeners[SocketEvent.connect] ?? [] }
        callbacks.forEach { $0([]) }
    }

    /// Simulate the Socket.IO `disconnect` lifecycle event.
    func triggerDisconnect() {
        isConnected = false
        let callbacks = lock.withLock { listeners[SocketEvent.disconnect] ?? [] }
        callbacks.forEach { $0([]) }
    }

    /// Simulate a `connect_error` event.
    func triggerConnectError(_ message: String) {
        struct FakeError: Error, LocalizedError {
            let msg: String
            var errorDescription: String? { msg }
        }
        let callbacks = lock.withLock { listeners[SocketEvent.connectError] ?? [] }
        callbacks.forEach { $0([FakeError(msg: message)]) }
    }

    // MARK: - Assertion Helpers

    /// Reset the recorded emission history between test assertions.
    func resetEmissions() {
        lock.withLock { emittedEvents.removeAll() }
    }

    /// The most recently emitted event, if any.
    var lastEmitted: (event: String, data: [[String: Any]])? {
        lock.withLock { emittedEvents.last }
    }

    /// Whether an event with the given name has been emitted.
    func wasEmitted(event: String) -> Bool {
        lock.withLock { emittedEvents.contains { $0.event == event } }
    }

    /// All emission records for a given event name.
    func emissions(for event: String) -> [[String: Any]] {
        lock.withLock { emittedEvents.filter { $0.event == event }.flatMap(\.data) }
    }
}
