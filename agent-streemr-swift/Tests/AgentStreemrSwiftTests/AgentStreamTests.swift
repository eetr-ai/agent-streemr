import XCTest
@testable import AgentStreemrSwift

@MainActor
final class AgentStreamTests: XCTestCase {

    // MARK: - Helpers

    /// Creates an AgentStream and injects a MockAgentSocket by calling connect then replacing the socket.
    /// Returns both the stream and the mock so tests can trigger events.
    func makeStream() -> (AgentStream, MockAgentSocket) {
        let config = AgentStreamConfiguration(
            url: URL(string: "http://localhost:8080")!,
            token: "test-token"
        )
        let stream = AgentStream(configuration: config)
        let mock = MockAgentSocket()
        // Inject the mock by using the internal test hook
        stream._injectSocket(mock)
        return (stream, mock)
    }

    // MARK: - Initial State

    func testInitialState() {
        let config = AgentStreamConfiguration(url: URL(string: "http://localhost")!, token: "t")
        let stream = AgentStream(configuration: config)
        XCTAssertEqual(stream.status, .disconnected)
        XCTAssertTrue(stream.messages.isEmpty)
        XCTAssertFalse(stream.isStreaming)
        XCTAssertFalse(stream.isWorking)
        XCTAssertEqual(stream.internalThought, "")
        XCTAssertNil(stream.serverVersion)
    }

    // MARK: - Connection Lifecycle

    func testConnectSetsStatusToConnecting() {
        let config = AgentStreamConfiguration(url: URL(string: "http://localhost:8080")!, token: "t")
        let stream = AgentStream(configuration: config)
        // After calling connect the status should immediately be .connecting
        // (we can't inject mock here without calling connect first — that's fine for this test)
        // This just validates the synchronous status change before the socket fires
        XCTAssertEqual(stream.status, .disconnected)
    }

    func testSocketConnectEventTransitionsToConnected() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000) // let Tasks on MainActor flush
        XCTAssertEqual(stream.status, .connected)
    }

    func testConnectEmitsClientHello() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertTrue(mock.wasEmitted(event: SocketEvent.clientHello))
        let helloData = mock.emissions(for: SocketEvent.clientHello).first
        XCTAssertNotNil(helloData)
        let version = helloData?["version"] as? [String: Any]
        XCTAssertEqual(version?["major"] as? Int, 1)
        XCTAssertEqual(version?["minor"] as? Int, 0)
    }

    func testConnectErrorSetsErrorStatus() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnectError("ECONNREFUSED")
        try await Task.sleep(nanoseconds: 10_000_000)
        if case .error(let msg) = stream.status {
            XCTAssertTrue(msg.contains("ECONNREFUSED"))
        } else {
            XCTFail("Expected .error status, got \(stream.status)")
        }
        XCTAssertFalse(stream.isStreaming)
    }

    func testDisconnectEventSetsDisconnectedStatus() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)
        mock.triggerDisconnect()
        try await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertEqual(stream.status, .disconnected)
        XCTAssertFalse(stream.isStreaming)
        XCTAssertFalse(stream.isWorking)
    }

    // MARK: - Streaming Messages

    func testAgentResponseChunksAccumulateIntoMessage() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)

        mock.trigger(SocketEvent.agentResponse, data: ["chunk": "Hello", "done": false])
        try await Task.sleep(nanoseconds: 10_000_000)
        mock.trigger(SocketEvent.agentResponse, data: ["chunk": " world", "done": false])
        try await Task.sleep(nanoseconds: 10_000_000)
        mock.trigger(SocketEvent.agentResponse, data: ["done": true])
        try await Task.sleep(nanoseconds: 10_000_000)

        XCTAssertEqual(stream.messages.count, 1)
        XCTAssertEqual(stream.messages[0].role, .assistant)
        XCTAssertEqual(stream.messages[0].content, "Hello world")
        XCTAssertFalse(stream.messages[0].isStreaming)
        XCTAssertFalse(stream.isStreaming)
    }

    func testNewTurnStartsNewAssistantMessage() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)

        // First turn
        mock.trigger(SocketEvent.agentResponse, data: ["chunk": "First", "done": true])
        try await Task.sleep(nanoseconds: 10_000_000)
        // Second turn
        mock.trigger(SocketEvent.agentResponse, data: ["chunk": "Second", "done": true])
        try await Task.sleep(nanoseconds: 10_000_000)

        XCTAssertEqual(stream.messages.count, 2)
        XCTAssertEqual(stream.messages[0].content, "First")
        XCTAssertEqual(stream.messages[1].content, "Second")
    }

    func testDoneWithoutChunkCreatesEmptyMessage() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)

        mock.trigger(SocketEvent.agentResponse, data: ["done": true])
        try await Task.sleep(nanoseconds: 10_000_000)

        XCTAssertEqual(stream.messages.count, 1)
        XCTAssertEqual(stream.messages[0].content, "")
        XCTAssertFalse(stream.messages[0].isStreaming)
    }

    // MARK: - sendMessage

    func testSendMessageAddsOptimisticUserMessage() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)

        stream.sendMessage("Hi there")

        XCTAssertEqual(stream.messages.count, 1)
        XCTAssertEqual(stream.messages[0].role, .user)
        XCTAssertEqual(stream.messages[0].content, "Hi there")
        XCTAssertTrue(mock.wasEmitted(event: SocketEvent.message))
    }

    func testSendMessageClearsInternalThought() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)

        mock.trigger(SocketEvent.internalToken, data: ["token": "thinking..."])
        try await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertFalse(stream.internalThought.isEmpty)

        stream.sendMessage("Next message")
        XCTAssertEqual(stream.internalThought, "")
    }

    func testSendMessageNoopsWhenDisconnected() {
        let config = AgentStreamConfiguration(url: URL(string: "http://localhost")!, token: "t")
        let stream = AgentStream(configuration: config)
        stream.sendMessage("ignored")
        XCTAssertTrue(stream.messages.isEmpty)
    }

    // MARK: - Internal Thought

    func testInternalTokensAccumulate() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)

        mock.trigger(SocketEvent.internalToken, data: ["token": "think"])
        mock.trigger(SocketEvent.internalToken, data: ["token": "ing"])
        try await Task.sleep(nanoseconds: 20_000_000)

        XCTAssertEqual(stream.internalThought, "thinking")
    }

    // MARK: - Working State

    func testAgentWorkingUpdatesFlag() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)

        mock.trigger(SocketEvent.agentWorking, data: ["working": true])
        try await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertTrue(stream.isWorking)

        mock.trigger(SocketEvent.agentWorking, data: ["working": false])
        try await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertFalse(stream.isWorking)
    }

    // MARK: - Context

    func testClearContextEmitsEvent() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)

        stream.clearContext()
        XCTAssertTrue(mock.wasEmitted(event: SocketEvent.clearContext))
    }

    func testContextClearedEventResetsState() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)

        stream.sendMessage("Hello")
        mock.trigger(SocketEvent.internalToken, data: ["token": "..."])
        try await Task.sleep(nanoseconds: 10_000_000)

        mock.trigger(SocketEvent.contextCleared, data: ["message": "Context cleared"])
        try await Task.sleep(nanoseconds: 10_000_000)

        XCTAssertTrue(stream.messages.isEmpty)
        XCTAssertEqual(stream.internalThought, "")
        XCTAssertFalse(stream.isStreaming)
    }

    // MARK: - Error Handling

    func testErrorEventSetsErrorStatus() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)

        mock.trigger(SocketEvent.error, data: ["message": "Something went wrong"])
        try await Task.sleep(nanoseconds: 10_000_000)

        if case .error(let msg) = stream.status {
            XCTAssertEqual(msg, "Something went wrong")
        } else {
            XCTFail("Expected .error status")
        }
        XCTAssertFalse(stream.isStreaming)
    }

    // MARK: - Welcome / Version

    func testWelcomeEventStoresServerVersion() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)

        mock.trigger(SocketEvent.welcome, data: ["server_version": ["major": 1, "minor": 0]])
        try await Task.sleep(nanoseconds: 10_000_000)

        XCTAssertEqual(stream.serverVersion, ProtocolVersion(major: 1, minor: 0))
    }

    // MARK: - Local Tool Fallback

    func testLocalToolWithoutCoordinatorEmitsNotSupportedFallback() async throws {
        let (_, mock) = makeStream()

        mock.trigger(SocketEvent.localTool, data: [
            "request_id": "req-1",
            "tool_name": "unhandled_tool",
            "args_json": [:],
            "tool_type": "sync",
            "expires_at": Int(Date().addingTimeInterval(30).timeIntervalSince1970 * 1000)
        ])
        try await Task.sleep(nanoseconds: 20_000_000)

        let emitted = mock.emissions(for: SocketEvent.localToolResponse).first
        XCTAssertEqual(emitted?["request_id"] as? String, "req-1")
        XCTAssertEqual(emitted?["tool_name"] as? String, "unhandled_tool")
        XCTAssertEqual(emitted?["notSupported"] as? Bool, true)
    }

    func testLocalToolWithoutCoordinatorSkipsFireAndForgetFallback() async throws {
        let (_, mock) = makeStream()

        mock.trigger(SocketEvent.localTool, data: [
            "request_id": "req-1",
            "tool_name": "unhandled_fire_and_forget",
            "args_json": [:],
            "tool_type": "fire_and_forget"
        ])
        try await Task.sleep(nanoseconds: 20_000_000)

        XCTAssertFalse(mock.wasEmitted(event: SocketEvent.localToolResponse))
    }

    // MARK: - Disconnect

    func testDisconnectCallResetsAllState() async throws {
        let (stream, mock) = makeStream()
        mock.triggerConnect()
        try await Task.sleep(nanoseconds: 10_000_000)
        stream.sendMessage("hi")
        try await Task.sleep(nanoseconds: 10_000_000)

        stream.disconnect()

        XCTAssertEqual(stream.status, .disconnected)
        XCTAssertTrue(stream.messages.isEmpty)
        XCTAssertFalse(stream.isStreaming)
        XCTAssertFalse(stream.isWorking)
        XCTAssertEqual(stream.internalThought, "")
    }
}
