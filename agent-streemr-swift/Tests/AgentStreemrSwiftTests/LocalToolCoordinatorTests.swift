import XCTest
@testable import AgentStreemrSwift

private actor StubAllowList: AllowListProtocol {
    var decision: AllowListDecision
    private(set) var calls: [(toolName: String, args: [String: Any], meta: AllowListCheckMeta?)] = []

    init(decision: AllowListDecision) {
        self.decision = decision
    }

    func check(toolName: String, args: [String: Any], meta: AllowListCheckMeta?) async -> AllowListDecision {
        calls.append((toolName: toolName, args: args, meta: meta))
        return decision
    }

    func callCount() -> Int { calls.count }
    func lastCall() -> (toolName: String, args: [String: Any], meta: AllowListCheckMeta?)? { calls.last }
}

final class LocalToolCoordinatorTests: XCTestCase {

    // MARK: - Helpers

    func makePayload(
        toolName: String = "test_tool",
        toolType: LocalToolPayload.ToolType = .sync,
        expiresAt: Date? = Date().addingTimeInterval(30)
    ) -> LocalToolPayload {
        LocalToolPayload(
            requestId: "req-1",
            toolName: toolName,
            argsJson: ["key": "value"],
            toolType: toolType,
            expiresAt: expiresAt
        )
    }

    // MARK: - Basic Dispatch

    func testRegisteredHandlerIsCalledAndResponseEmitted() async throws {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()
        var handlerCalled = false

        await coordinator.register("test_tool") { args in
            handlerCalled = true
            XCTAssertEqual(args["key"] as? String, "value")
            return .success(responseJSON: ["result": "ok"])
        }

        await coordinator.handle(makePayload(), socket: socket)

        XCTAssertTrue(handlerCalled)
        XCTAssertTrue(socket.wasEmitted(event: SocketEvent.localToolResponse))
        let emitted = socket.emissions(for: SocketEvent.localToolResponse).first
        XCTAssertNotNil(emitted?["response_json"])
        XCTAssertEqual(emitted?["request_id"] as? String, "req-1")
    }

    // MARK: - Fallback

    func testUnknownToolWithFallbackEmitsNotSupported() async {
        let coordinator = LocalToolCoordinator(enableFallback: true)
        let socket = MockAgentSocket()

        await coordinator.handle(makePayload(toolName: "unknown_tool"), socket: socket)

        let emitted = socket.emissions(for: SocketEvent.localToolResponse).first
        XCTAssertEqual(emitted?["notSupported"] as? Bool, true)
    }

    func testUnknownToolWithFallbackDisabledEmitsNothing() async {
        let coordinator = LocalToolCoordinator(enableFallback: false)
        let socket = MockAgentSocket()

        await coordinator.handle(makePayload(toolName: "unknown_tool"), socket: socket)

        XCTAssertFalse(socket.wasEmitted(event: SocketEvent.localToolResponse))
    }

    func testUnknownFireAndForgetWithFallbackEnabledEmitsNothing() async {
        let coordinator = LocalToolCoordinator(enableFallback: true)
        let socket = MockAgentSocket()

        let payload = makePayload(toolName: "unknown_tool", toolType: .fireAndForget, expiresAt: nil)
        await coordinator.handle(payload, socket: socket)

        XCTAssertFalse(socket.wasEmitted(event: SocketEvent.localToolResponse))
    }

    // MARK: - Allow List

    func testDeniedByAllowListEmitsDenied() async {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()
        let allowList = InMemoryAllowList()
        await allowList.deny("test_tool")

        await coordinator.register("test_tool", allowList: allowList) { _ in .success(responseJSON: [:]) }
        await coordinator.handle(makePayload(), socket: socket)

        let emitted = socket.emissions(for: SocketEvent.localToolResponse).first
        XCTAssertEqual(emitted?["allowed"] as? Bool, false)
    }

    func testUnknownAllowListDecisionEmitsDenied() async {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()
        let allowList = InMemoryAllowList()
        // tool_not_registered → .unknown

        await coordinator.register("test_tool", allowList: allowList) { _ in .success(responseJSON: [:]) }
        await coordinator.handle(makePayload(), socket: socket)

        let emitted = socket.emissions(for: SocketEvent.localToolResponse).first
        XCTAssertEqual(emitted?["allowed"] as? Bool, false)
    }

    func testAllowedDecisionCallsHandler() async {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()
        let allowList = InMemoryAllowList()
        await allowList.allow("test_tool")
        var handlerCalled = false

        await coordinator.register("test_tool", allowList: allowList) { _ in
            handlerCalled = true
            return .success(responseJSON: [:])
        }
        await coordinator.handle(makePayload(), socket: socket)

        XCTAssertTrue(handlerCalled)
    }

    func testAllowListCheckReceivesExpiresAtMeta() async {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()
        let allowList = StubAllowList(decision: .allowed)
        let expiry = Date().addingTimeInterval(30)

        await coordinator.register("test_tool", allowList: allowList) { _ in .success(responseJSON: [:]) }
        await coordinator.handle(makePayload(expiresAt: expiry), socket: socket)

        let lastCall = await allowList.lastCall()
        XCTAssertEqual(lastCall?.toolName, "test_tool")
        XCTAssertNotNil(lastCall?.meta?.expiresAt)
        let observedExpiry = lastCall?.meta?.expiresAt?.timeIntervalSince1970 ?? 0
        XCTAssertEqual(observedExpiry, expiry.timeIntervalSince1970, accuracy: 0.001)
    }

    func testExpiredAllowListDecisionSkipsWithoutEmitting() async {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()
        let allowList = StubAllowList(decision: .expired)
        var handlerCalled = false

        await coordinator.register("test_tool", allowList: allowList) { _ in
            handlerCalled = true
            return .success(responseJSON: [:])
        }
        await coordinator.handle(makePayload(), socket: socket)

        XCTAssertFalse(handlerCalled)
        XCTAssertFalse(socket.wasEmitted(event: SocketEvent.localToolResponse))
    }

    // MARK: - Error Handling

    func testHandlerThrowingEmitsError() async {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()

        struct TestError: Error, LocalizedError {
            var errorDescription: String? { "boom" }
        }

        await coordinator.register("test_tool") { _ in throw TestError() }
        await coordinator.handle(makePayload(), socket: socket)

        let emitted = socket.emissions(for: SocketEvent.localToolResponse).first
        XCTAssertEqual(emitted?["error"] as? Bool, true)
        XCTAssertEqual(emitted?["errorMessage"] as? String, "boom")
    }

    // MARK: - Fire and Forget

    func testFireAndForgetCallsHandlerButEmitsNothing() async {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()
        var handlerCalled = false

        await coordinator.register("test_tool") { _ in
            handlerCalled = true
            return .success(responseJSON: [:])
        }

        let payload = makePayload(toolType: .fireAndForget, expiresAt: nil)
        await coordinator.handle(payload, socket: socket)

        XCTAssertTrue(handlerCalled)
        XCTAssertFalse(socket.wasEmitted(event: SocketEvent.localToolResponse))
    }

    func testFireAndForgetDeniedByAllowListDoesNotCallHandlerOrEmit() async {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()
        let allowList = StubAllowList(decision: .denied)
        var handlerCalled = false

        await coordinator.register("test_tool", allowList: allowList) { _ in
            handlerCalled = true
            return .success(responseJSON: [:])
        }

        let payload = makePayload(toolType: .fireAndForget, expiresAt: nil)
        await coordinator.handle(payload, socket: socket)

        XCTAssertFalse(handlerCalled)
        let count = await allowList.callCount()
        XCTAssertEqual(count, 1)
        XCTAssertFalse(socket.wasEmitted(event: SocketEvent.localToolResponse))
    }

    // MARK: - Expiry

    func testExpiredPayloadIsSkipped() async {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()
        var handlerCalled = false

        await coordinator.register("test_tool") { _ in
            handlerCalled = true
            return .success(responseJSON: [:])
        }

        let expiredPayload = makePayload(expiresAt: Date().addingTimeInterval(-1))
        await coordinator.handle(expiredPayload, socket: socket)

        XCTAssertFalse(handlerCalled)
        XCTAssertFalse(socket.wasEmitted(event: SocketEvent.localToolResponse))
    }

    func testFutureExpiryProcessesNormally() async {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()

        await coordinator.register("test_tool") { _ in .success(responseJSON: ["x": 1]) }

        let futurePayload = makePayload(expiresAt: Date().addingTimeInterval(60))
        await coordinator.handle(futurePayload, socket: socket)

        XCTAssertTrue(socket.wasEmitted(event: SocketEvent.localToolResponse))
    }

    // MARK: - Retry / Ack

    func testHandleAckCancelsRetryTask() async throws {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()

        await coordinator.register("test_tool", retryOnNoAck: true) { _ in .success(responseJSON: [:]) }

        // Retry should fire in ~250ms if not acknowledged.
        let payload = makePayload(expiresAt: Date().addingTimeInterval(1.25))
        await coordinator.handle(payload, socket: socket)

        // Immediately ack — retry task should be cancelled
        let ack = LocalToolResponseAckPayload(requestId: "req-1", toolName: "test_tool")
        await coordinator.handleAck(ack)

        // Wait longer than the retry would have fired (if not cancelled)
        try await Task.sleep(nanoseconds: 700_000_000)

        // Should have been emitted exactly once (not twice)
        let count = socket.emittedEvents.filter { $0.event == SocketEvent.localToolResponse }.count
        XCTAssertEqual(count, 1)
    }

    func testRetryOnNoAckEmitsOnceMore() async throws {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()

        await coordinator.register("test_tool", retryOnNoAck: true) { _ in .success(responseJSON: [:]) }
        let payload = makePayload(expiresAt: Date().addingTimeInterval(1.25))
        await coordinator.handle(payload, socket: socket)

        try await Task.sleep(nanoseconds: 700_000_000)

        let count = socket.emittedEvents.filter { $0.event == SocketEvent.localToolResponse }.count
        XCTAssertEqual(count, 2)
    }

    func testRetryDisabledEmitsOnlyOnce() async throws {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()

        await coordinator.register("test_tool", retryOnNoAck: false) { _ in .success(responseJSON: [:]) }
        let payload = makePayload(expiresAt: Date().addingTimeInterval(1.25))
        await coordinator.handle(payload, socket: socket)

        try await Task.sleep(nanoseconds: 700_000_000)

        let count = socket.emittedEvents.filter { $0.event == SocketEvent.localToolResponse }.count
        XCTAssertEqual(count, 1)
    }
}
