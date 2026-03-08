import Foundation

// MARK: - Registration

/// Internal record holding a registered tool handler and its options.
struct LocalToolRegistration: Sendable {
    let toolName: String
    let allowList: (any AllowListProtocol)?
    let retryOnNoAck: Bool
    let handler: LocalToolHandler
}

// MARK: - Coordinator

/// Manages local tool handler registrations, dispatches incoming `local_tool` events,
/// enforces allow-list decisions, and handles reliability retries.
///
/// This is the Swift equivalent of the React library's `useLocalToolHandler` hook.
///
/// ## Usage
/// ```swift
/// let coordinator = LocalToolCoordinator()
/// coordinator.register("read_file") { args in
///     let path = args["path"] as? String ?? ""
///     let content = try String(contentsOfFile: path)
///     return .success(responseJSON: ["content": content])
/// }
/// stream.setLocalToolCoordinator(coordinator)
/// ```
public actor LocalToolCoordinator {
    private var registrations: [String: LocalToolRegistration] = [:]
    /// Pending ack entries keyed by `request_id`. Each holds the retry `Task` and
    /// the serialized response dictionary to re-emit if the ack never arrives.
    private var pendingAcks: [String: PendingAck] = [:]
    private let enableFallback: Bool

    private struct PendingAck {
        let task: Task<Void, Never>
        let responseDict: [String: Any]
    }

    /// - Parameter enableFallback: When `true` (default), any `local_tool` event
    ///   for an unregistered tool name automatically receives a `notSupported` response,
    ///   preventing server-side TTL timeouts.
    public init(enableFallback: Bool = true) {
        self.enableFallback = enableFallback
    }

    // MARK: - Registration

    /// Register a handler for a specific tool name.
    ///
    /// - Parameters:
    ///   - toolName: The `tool_name` to handle, must match the server's tool name exactly.
    ///   - allowList: Optional permission gate. `nil` means always allow.
    ///   - retryOnNoAck: Re-emit the response once if no `local_tool_response_ack` arrives
    ///     within 1 second of the deadline. Defaults to `true`.
    ///   - handler: Async closure invoked when the tool is requested.
    public func register(
        _ toolName: String,
        allowList: (any AllowListProtocol)? = nil,
        retryOnNoAck: Bool = true,
        handler: @escaping LocalToolHandler
    ) {
        registrations[toolName] = LocalToolRegistration(
            toolName: toolName,
            allowList: allowList,
            retryOnNoAck: retryOnNoAck,
            handler: handler
        )
    }

    // MARK: - Dispatch

    /// Handle an incoming `local_tool` event from the server.
    ///
    /// Called by `AgentStream` when a `local_tool` socket event is received.
    public func handle(_ payload: LocalToolPayload, socket: any AgentSocketProtocol) async {
        // Fire-and-forget: call handler for side effects, never send a response
        if payload.toolType == .fireAndForget {
            if let reg = registrations[payload.toolName] {
                _ = try? await reg.handler(payload.argsJson)
            }
            return
        }

        // Expiry gate: if the server's deadline has already passed, skip silently
        if let expiresAt = payload.expiresAt, Date() >= expiresAt {
            return
        }

        // Look up registration
        guard let reg = registrations[payload.toolName] else {
            if enableFallback {
                let responseDict = buildResponseDict(
                    .notSupported,
                    requestId: payload.requestId,
                    toolName: payload.toolName
                )
                socket.emit(SocketEvent.localToolResponse, with: [responseDict])
            }
            return
        }

        // Allow-list gate
        if let allowList = reg.allowList {
            let decision = await allowList.check(toolName: payload.toolName, args: payload.argsJson)
            if decision != .allowed {
                let responseDict = buildResponseDict(
                    .denied,
                    requestId: payload.requestId,
                    toolName: payload.toolName
                )
                socket.emit(SocketEvent.localToolResponse, with: [responseDict])
                return
            }
        }

        // Execute handler
        let result: LocalToolHandlerResult
        do {
            result = try await reg.handler(payload.argsJson)
        } catch {
            result = .error(message: error.localizedDescription)
        }

        let responseDict = buildResponseDict(result, requestId: payload.requestId, toolName: payload.toolName)
        socket.emit(SocketEvent.localToolResponse, with: [responseDict])

        // Schedule a retry if retryOnNoAck is enabled and a deadline exists
        if reg.retryOnNoAck, let expiresAt = payload.expiresAt {
            let retryDelay = expiresAt.timeIntervalSinceNow - 1.0
            if retryDelay > 0 {
                let requestId = payload.requestId
                let task = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: UInt64(retryDelay * 1_000_000_000))
                    guard !Task.isCancelled else { return }
                    await self?.retryIfPending(requestId: requestId, socket: socket)
                }
                pendingAcks[payload.requestId] = PendingAck(task: task, responseDict: responseDict)
            }
        }
    }

    // MARK: - Acknowledgement

    /// Handle an incoming `local_tool_response_ack` event.
    ///
    /// Cancels the pending retry timer for the acknowledged request.
    public func handleAck(_ payload: LocalToolResponseAckPayload) {
        if let pending = pendingAcks.removeValue(forKey: payload.requestId) {
            pending.task.cancel()
        }
    }

    // MARK: - Private

    private func retryIfPending(requestId: String, socket: any AgentSocketProtocol) {
        if let pending = pendingAcks.removeValue(forKey: requestId) {
            pending.task.cancel()
            socket.emit(SocketEvent.localToolResponse, with: [pending.responseDict])
        }
    }

    private func buildResponseDict(
        _ result: LocalToolHandlerResult,
        requestId: String,
        toolName: String
    ) -> [String: Any] {
        var dict: [String: Any] = ["request_id": requestId, "tool_name": toolName]
        switch result {
        case .success(let responseJSON):
            dict["response_json"] = responseJSON
        case .denied:
            dict["allowed"] = false
        case .notSupported:
            dict["notSupported"] = true
        case .error(let message):
            dict["error"] = true
            if let message {
                dict["errorMessage"] = message
            }
        }
        return dict
    }
}
