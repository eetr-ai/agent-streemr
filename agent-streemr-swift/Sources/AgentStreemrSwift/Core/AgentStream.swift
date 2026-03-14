import Foundation
import Combine
import Observation

/// The central class for interacting with an agent-streemr server.
///
/// `AgentStream` manages the full Socket.IO lifecycle, protocol handshake,
/// conversation state, and local tool dispatch. It is equivalent to the React
/// library's `useAgentStream` hook.
///
/// ## Usage
/// ```swift
/// let config = AgentStreamConfiguration(url: serverURL, token: bearerToken)
/// let stream = AgentStream(configuration: config)
/// stream.connect(threadId: installationId)
///
/// // In SwiftUI (iOS 17+):
/// @Environment(AgentStream.self) private var stream
/// ```
///
/// ## Thread Safety
/// All public state is `@MainActor`-isolated. Socket.IO callbacks are marshaled
/// to the main actor via `Task { @MainActor in ... }`.
@Observable
@MainActor
public final class AgentStream {

    // MARK: - Observable State

    /// All messages in the current conversation, in chronological order.
    public private(set) var messages: [AgentMessage] = []

    /// The current connection lifecycle state.
    public private(set) var status: ConnectionStatus = .disconnected

    /// Accumulated reasoning tokens from `internal_token` events, reset on each `sendMessage` call.
    public private(set) var internalThought: String = ""

    /// `true` while the server is actively streaming an `agent_response`.
    public private(set) var isStreaming: Bool = false

    /// `true` while the server's per-thread queue is processing work (includes tool invocations).
    public private(set) var isWorking: Bool = false

    /// The protocol version reported by the server after a successful handshake.
    public private(set) var serverVersion: ProtocolVersion? = nil

    /// Server-reported capabilities received in the `welcome` event. `nil` before the handshake.
    public private(set) var serverCapabilities: WelcomeCapabilities? = nil

    /// When set, the server closed the connection due to inactivity.
    /// Contains the reason string from the `inactive_close` event.
    public private(set) var inactiveCloseReason: String? = nil

    // MARK: - Combine Publishers

    private let _statusSubject = PassthroughSubject<ConnectionStatus, Never>()
    private let _messagesSubject = PassthroughSubject<[AgentMessage], Never>()
    private let _isStreamingSubject = PassthroughSubject<Bool, Never>()
    private let _internalThoughtSubject = PassthroughSubject<String, Never>()
    private let _protocolEventSubject = PassthroughSubject<ProtocolEventRecord, Never>()

    /// Publishes every `status` change.
    public var statusPublisher: AnyPublisher<ConnectionStatus, Never> {
        _statusSubject.eraseToAnyPublisher()
    }

    /// Publishes the full `messages` array after every mutation.
    public var messagesPublisher: AnyPublisher<[AgentMessage], Never> {
        _messagesSubject.eraseToAnyPublisher()
    }

    /// Publishes every `isStreaming` change.
    public var isStreamingPublisher: AnyPublisher<Bool, Never> {
        _isStreamingSubject.eraseToAnyPublisher()
    }

    /// Publishes the accumulated `internalThought` after every token.
    public var internalThoughtPublisher: AnyPublisher<String, Never> {
        _internalThoughtSubject.eraseToAnyPublisher()
    }

    /// Publishes every raw Socket.IO protocol event as it is processed.
    ///
    /// Each value carries the event name, direction (S→C or C→S), a timestamp,
    /// and an optional pretty-printed JSON string of the first payload object.
    /// Subscribe to this to build a live protocol log or debugging UI.
    public var protocolEventPublisher: AnyPublisher<ProtocolEventRecord, Never> {
        _protocolEventSubject.eraseToAnyPublisher()
    }

    // MARK: - Private

    private let configuration: AgentStreamConfiguration
    /// Stored as a nonisolated reference; mutated only from the main actor.
    private var socket: (any AgentSocketProtocol)?
    private var localToolCoordinator: LocalToolCoordinator?
    /// Pending attachment ack waiters: correlationId → (remainingSeqs, resolve, reject).
    private var pendingAttachmentAcks: [String: (pending: Set<Int>, resolve: () -> Void, reject: (Error) -> Void)] = [:]

    // MARK: - Tool Approval Integration

    private let _localToolSubject = PassthroughSubject<LocalToolPayload, Never>()
    /// Publishes every incoming local tool request for UI approval.
    public var localToolPublisher: AnyPublisher<LocalToolPayload, Never> {
        _localToolSubject.eraseToAnyPublisher()
    }

    // MARK: - Init

    public init(configuration: AgentStreamConfiguration) {
        self.configuration = configuration
    }

    // MARK: - Public API

    /// Open the socket connection scoped to `threadId`.
    ///
    /// Maps to `auth.installation_id` in the Socket.IO handshake, which the server
    /// uses as the room / thread identifier. Safe to call multiple times — subsequent
    /// calls disconnect any existing socket and reconnect with the new `threadId`.
    public func connect(threadId: String) {
        detachSocket()
        status = .connecting
        _statusSubject.send(status)

        let newSocket = LiveAgentSocket(
            url: configuration.url,
            token: configuration.token,
            threadId: threadId,
            extraConfig: configuration.socketConfiguration
        )
        socket = newSocket
        attachListeners(to: newSocket)
        newSocket.connect()
    }

    /// Disconnect the socket and reset all conversation state.
    public func disconnect() {
        detachSocket()
        resetState()
        status = .disconnected
        publishAll()
    }

    /// Optimistically push a user message and send it to the server.
    ///
    /// - Parameters:
    ///   - text: The message text.
    ///   - context: Optional inline context merged into the server's per-thread context for this turn.
    ///   - attachments: Optional attachments to upload before sending the message.
    ///     Performs the multi-step `start_attachments` → N×`attachment` → wait-for-acks → `message` handshake.
    public func sendMessage(_ text: String, context: [String: Any]? = nil, attachments: [Attachment]? = nil) {
        guard let socket, socket.isConnected else { return }
        let userMsg = AgentMessage(role: .user, content: text)
        messages.append(userMsg)
        internalThought = ""
        isStreaming = true
        publishAll()

        let hasAttachments = attachments?.isEmpty == false
        if hasAttachments, let attachments {
            let capturedSocket = socket
            Task { @MainActor [weak self] in
                guard let self else { return }
                do {
                    let correlationId = try await self.uploadAttachments(attachments: attachments, to: capturedSocket)
                    guard self.socket === capturedSocket else { return } // socket replaced
                    let payload = MessagePayload(text: text, context: context, attachmentCorrelationId: correlationId)
                    let socketData = payload.toSocketData()
                    capturedSocket.emit(SocketEvent.message, with: [socketData])
                    self.emitProtocolEvent(SocketEvent.message, direction: .outgoing, rawData: [socketData])
                } catch {
                    self.status = .error(error.localizedDescription)
                    self.isStreaming = false
                    self.publishAll()
                }
            }
        } else {
            let payload = MessagePayload(text: text, context: context)
            socket.emit(SocketEvent.message, with: [payload.toSocketData()])
            emitProtocolEvent(SocketEvent.message, direction: .outgoing, rawData: [payload.toSocketData()])
        }
    }

    /// Uploads a sequence of attachments and returns the correlation ID once all acks are received.
    private func uploadAttachments(attachments: [Attachment], to socket: any AgentSocketProtocol) async throws -> String {
        let correlationId = UUID().uuidString
        let timeoutSeconds = configuration.attachmentAckTimeoutSeconds
        try await withCheckedThrowingContinuation { continuation in
            var resolved = false
            var timeoutTask: Task<Void, Never>?

            self.pendingAttachmentAcks[correlationId] = (
                pending: Set(0 ..< attachments.count),
                resolve: {
                    guard !resolved else { return }
                    resolved = true
                    timeoutTask?.cancel()
                    continuation.resume(returning: ())
                },
                reject: { err in
                    guard !resolved else { return }
                    resolved = true
                    timeoutTask?.cancel()
                    continuation.resume(throwing: err)
                }
            )

            timeoutTask = Task { @MainActor [weak self] in
                do {
                    try await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
                } catch { return } // cancelled
                guard let self, !resolved,
                      let entry = self.pendingAttachmentAcks.removeValue(forKey: correlationId) else { return }
                entry.reject(AgentStreemrError.attachmentAckTimeout)
            }

            let startPayload = StartAttachmentsPayload(correlationId: correlationId, count: attachments.count)
            socket.emit(SocketEvent.startAttachments, with: [startPayload.toSocketData()])
            self.emitProtocolEvent(
                SocketEvent.startAttachments,
                direction: .outgoing,
                rawData: [startPayload.toSocketData()]
            )
            for (i, attachment) in attachments.enumerated() {
                let attPayload = AttachmentUploadPayload(
                    correlationId: correlationId, seq: i,
                    type: attachment.type.rawValue, body: attachment.body, name: attachment.name
                )
                socket.emit(SocketEvent.attachment, with: [attPayload.toSocketData()])
                self.emitProtocolEvent(
                    SocketEvent.attachment,
                    direction: .outgoing,
                    rawData: [attPayload.toSocketData()]
                )
            }
        }
        return correlationId
    }

    /// Ask the server to clear the current thread's context and conversation history.
    ///
    /// When the server confirms, the `context_cleared` event is received and local
    /// state is reset accordingly.
    public func clearContext() {
        socket?.emitEmpty(SocketEvent.clearContext)
        emitProtocolEvent(SocketEvent.clearContext, direction: .outgoing)
    }

    /// Push arbitrary JSON data into the server's per-thread context.
    public func setContext(_ data: [String: Any]) {
        let payload = SetContextPayload(data: data)
        socket?.emit(SocketEvent.setContext, with: [payload.toSocketData()])
        emitProtocolEvent(SocketEvent.setContext, direction: .outgoing, rawData: [payload.toSocketData()])
    }

    /// Replace the active `LocalToolCoordinator`.
    ///
    /// Use this to inject a coordinator with custom handlers and allow-list before connecting.
    public func setLocalToolCoordinator(_ coordinator: LocalToolCoordinator) {
        self.localToolCoordinator = coordinator
    }

    /// Register a single local tool handler directly on the stream.
    ///
    /// Convenience wrapper around `LocalToolCoordinator.register(...)`.
    /// Lazily creates a coordinator with fallback enabled if one doesn't exist yet.
    ///
    /// - Parameters:
    ///   - name: The `tool_name` to handle.
    ///   - allowList: Optional permission gate. Defaults to `nil` (always allowed).
    ///   - retryOnNoAck: Re-emit the response once if no ack arrives before the deadline. Defaults to `true`.
    ///   - handler: The async closure to invoke when the tool is requested.
    public func registerTool(
        _ name: String,
        allowList: (any AllowListProtocol)? = nil,
        retryOnNoAck: Bool = true,
        handler: @escaping LocalToolHandler
    ) async {
        if localToolCoordinator == nil {
            localToolCoordinator = LocalToolCoordinator()
        }
        await localToolCoordinator?.register(
            name,
            allowList: allowList,
            retryOnNoAck: retryOnNoAck,
            handler: handler
        )
    }

    /// Respond to a local tool request (approval/denial).
    public func respondToLocalTool(requestId: String, toolName: String, approved: Bool) {
        var dict: [String: Any] = ["request_id": requestId, "tool_name": toolName]
        if approved {
            dict["response_json"] = [:]
        } else {
            dict["allowed"] = false
        }
        socket?.emit(SocketEvent.localToolResponse, with: [dict])
        emitProtocolEvent(SocketEvent.localToolResponse, direction: .outgoing, rawData: [dict])
    }

    /// Run the registered handler for an approved tool request and send the result to the server.
    /// Call this when the user (or allowlist) has approved a `local_tool` request.
    public func executeApprovedTool(requestId: String, toolName: String, args: [String: Any]) async {
        guard let coordinator = localToolCoordinator else { return }
        let responseDict = await coordinator.runHandlerAndBuildResponse(
            toolName: toolName,
            args: args,
            requestId: requestId
        )
        guard let responseDict else { return }
        socket?.emit(SocketEvent.localToolResponse, with: [responseDict])
        emitProtocolEvent(SocketEvent.localToolResponse, direction: .outgoing, rawData: [responseDict])
    }

    // MARK: - Protocol Event Helper

    /// Fires a `ProtocolEventRecord` on `_protocolEventSubject`.
    /// Must be called from the main actor.
    private func emitProtocolEvent(
        _ name: String,
        direction: ProtocolEventRecord.Direction,
        rawData: [Any] = []
    ) {
        let payloadJSON: String?
        if let dict = rawData.first as? [String: Any],
           let data = try? JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted, .sortedKeys]),
           let str = String(data: data, encoding: .utf8) {
            payloadJSON = str
        } else {
            payloadJSON = nil
        }
        _protocolEventSubject.send(
            ProtocolEventRecord(name: name, direction: direction, payloadJSON: payloadJSON)
        )
    }

    // MARK: - Event Listener Setup

    private func attachListeners(to socket: any AgentSocketProtocol) {
        socket.on(SocketEvent.connect) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.emitProtocolEvent(SocketEvent.connect, direction: .incoming)
                self?.handleConnect()
            }
        }
        socket.on(SocketEvent.disconnect) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.emitProtocolEvent(SocketEvent.disconnect, direction: .incoming)
                self?.handleDisconnect()
            }
        }
        socket.on(SocketEvent.connectError) { [weak self] data in
            Task { @MainActor [weak self] in
                // connect_error delivers an Error object as the first element
                let message: String
                if let err = data.first as? Error {
                    message = err.localizedDescription
                } else if let str = data.first as? String {
                    message = str
                } else {
                    message = "Unknown connection error"
                }
                self?.handleConnectError(message)
            }
        }
        socket.on(SocketEvent.inactiveClose) { [weak self] data in
            guard let payload = decodeSocketData(InactiveClosePayload.self, from: data) else { return }
            Task { @MainActor [weak self] in
                self?.inactiveCloseReason = payload.reason
                self?.status = .disconnected
                self?.isStreaming = false
                self?.isWorking = false
                self?.socket?.disconnect()
                self?.emitProtocolEvent(SocketEvent.inactiveClose, direction: .incoming, rawData: data)
                self?.publishAll()
            }
        }
        socket.on(SocketEvent.attachmentAck) { [weak self] data in
            guard let payload = decodeSocketData(AttachmentAckPayload.self, from: data) else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.emitProtocolEvent(SocketEvent.attachmentAck, direction: .incoming, rawData: data)
                guard var entry = self.pendingAttachmentAcks[payload.correlationId] else { return }
                entry.pending.remove(payload.seq)
                if entry.pending.isEmpty {
                    self.pendingAttachmentAcks.removeValue(forKey: payload.correlationId)
                    entry.resolve()
                } else {
                    self.pendingAttachmentAcks[payload.correlationId] = entry
                }
            }
        }
        socket.on(SocketEvent.versionNotSupported) { [weak self] data in
            Task { @MainActor [weak self] in
                guard let payload = decodeSocketData(VersionNotSupportedPayload.self, from: data) else { return }
                let msg = AgentStreemrError.protocolVersionNotSupported(
                    clientVersion: payload.clientVersion,
                    serverVersion: payload.serverVersion
                ).errorDescription ?? "Protocol version not supported"
                self?.emitProtocolEvent(SocketEvent.versionNotSupported, direction: .incoming, rawData: data)
                self?.status = .error(msg)
                self?.publishAll()
            }
        }
        socket.on(SocketEvent.agentWorking) { [weak self] data in
            Task { @MainActor [weak self] in
                guard let payload = decodeSocketData(AgentWorkingPayload.self, from: data) else { return }
                self?.isWorking = payload.working
                self?.emitProtocolEvent(SocketEvent.agentWorking, direction: .incoming, rawData: data)
                self?.publishAll()
            }
        }
        socket.on(SocketEvent.internalToken) { [weak self] data in
            Task { @MainActor [weak self] in
                guard let payload = decodeSocketData(InternalTokenPayload.self, from: data) else { return }
                self?.internalThought += payload.token
                self?.emitProtocolEvent(SocketEvent.internalToken, direction: .incoming, rawData: data)
                self?._internalThoughtSubject.send(self?.internalThought ?? "")
            }
        }
        socket.on(SocketEvent.agentResponse) { [weak self] data in
            Task { @MainActor [weak self] in
                guard let payload = decodeSocketData(AgentResponsePayload.self, from: data) else { return }
                self?.emitProtocolEvent(SocketEvent.agentResponse, direction: .incoming, rawData: data)
                self?.handleAgentResponse(payload)
            }
        }
        socket.on(SocketEvent.contextCleared) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.messages = []
                self?.internalThought = ""
                self?.isStreaming = false
                self?.emitProtocolEvent(SocketEvent.contextCleared, direction: .incoming)
                self?.publishAll()
            }
        }
        socket.on(SocketEvent.error) { [weak self] data in
            Task { @MainActor [weak self] in
                guard let payload = decodeSocketData(ErrorPayload.self, from: data) else { return }
                self?.status = .error(payload.message)
                self?.isStreaming = false
                self?.emitProtocolEvent(SocketEvent.error, direction: .incoming, rawData: data)
                self?.publishAll()
            }
        }
        socket.on(SocketEvent.localTool) { [weak self] data in
            guard let payload = LocalToolPayload.decode(from: data) else { return }
            Task { @MainActor [weak self] in
                self?._localToolSubject.send(payload)
                self?.emitProtocolEvent(SocketEvent.localTool, direction: .incoming, rawData: data)
            }
        }
        socket.on(SocketEvent.localToolResponseAck) { [weak self] data in
            guard let payload = decodeSocketData(LocalToolResponseAckPayload.self, from: data) else { return }
            Task { @MainActor [weak self] in
                self?.emitProtocolEvent(SocketEvent.localToolResponseAck, direction: .incoming, rawData: data)
                guard let coordinator = self?.localToolCoordinator else { return }
                await coordinator.handleAck(payload)
            }
        }
    }

    // MARK: - Event Handlers

    private func handleConnect() {
        inactiveCloseReason = nil
        status = .connected
        // Immediately emit client_hello to initiate protocol version negotiation
        let hello = ClientHelloPayload(
            version: ProtocolVersion.client,
            agentId: configuration.agentId,
            inactivityTimeoutMs: configuration.inactivityTimeoutMs
        )
        socket?.emit(SocketEvent.clientHello, with: [hello.toSocketData()])
        emitProtocolEvent(SocketEvent.clientHello, direction: .outgoing, rawData: [hello.toSocketData()])
        publishAll()
    }

    private func handleDisconnect() {
        status = .disconnected
        isStreaming = false
        isWorking = false
        publishAll()
    }

    private func handleConnectError(_ message: String) {
        status = .error(message)
        isStreaming = false
        publishAll()
    }

    private func handleAgentResponse(_ payload: AgentResponsePayload) {
        let chunk = payload.chunk ?? ""
        let isDone = payload.done

        // Find the last message. If it's an assistant message currently streaming,
        // append the chunk to it. Otherwise start a new assistant message.
        if let lastIndex = messages.indices.last,
           messages[lastIndex].role == .assistant,
           messages[lastIndex].isStreaming {
            messages[lastIndex].content += chunk
            messages[lastIndex].isStreaming = !isDone
        } else {
            let newMsg = AgentMessage(
                role: .assistant,
                content: chunk,
                isStreaming: !isDone
            )
            messages.append(newMsg)
        }

        isStreaming = !isDone
        if isDone {
            internalThought = ""
        }
        publishAll()
    }

    // MARK: - Testing Support

    /// Injects a pre-built socket implementation and attaches listeners.
    /// **For testing only.** Production code uses `connect(threadId:)`.
    func _injectSocket(_ socket: any AgentSocketProtocol) {
        detachSocket()
        self.socket = socket
        attachListeners(to: socket)
    }

    // MARK: - Helpers

    private func detachSocket() {
        socket?.removeAllHandlers()
        socket?.disconnect()
        socket = nil
    }

    private func resetState() {
        messages = []
        internalThought = ""
        isStreaming = false
        isWorking = false
        serverVersion = nil
        serverCapabilities = nil
        inactiveCloseReason = nil
        pendingAttachmentAcks.removeAll()
    }

    private func publishAll() {
        _statusSubject.send(status)
        _messagesSubject.send(messages)
        _isStreamingSubject.send(isStreaming)
        _internalThoughtSubject.send(internalThought)
    }
}
