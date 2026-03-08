import XCTest
@testable import AgentStreemrSwift

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

    // MARK: - Ack Cancellation

    func testHandleAckCancelsRetryTask() async throws {
        let coordinator = LocalToolCoordinator()
        let socket = MockAgentSocket()

        await coordinator.register("test_tool", retryOnNoAck: true) { _ in .success(responseJSON: [:]) }

        // Use a short deadline to trigger retry scheduling
        let payload = makePayload(expiresAt: Date().addingTimeInterval(5))
        await coordinator.handle(payload, socket: socket)

        // Immediately ack — retry task should be cancelled
        let ack = LocalToolResponseAckPayload(requestId: "req-1", toolName: "test_tool")
        await coordinator.handleAck(ack)

        // Wait longer than the retry would have fired (if not cancelled)
        try await Task.sleep(nanoseconds: 200_000_000)

        // Should have been emitted exactly once (not twice)
        let count = socket.emittedEvents.filter { $0.event == SocketEvent.localToolResponse }.count
        XCTAssertEqual(count, 1)
    }
}
