// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module server/listener
 *
 * `createAgentSocketListener` — wires Socket.io events to an agent runner
 * with full per-thread queueing, local-tool dispatch, and follow-up logic.
 *
 * Dependency tier: `protocol/*` + `server/queue` + `server/registry` + `server/adapter`,
 * plus `socket.io` (peer dependency) and `node:crypto`.
 *
 * @example
 * ```ts
 * import { Server } from "socket.io";
 * import { createAgentSocketListener, LocalToolRegistry } from "@eetr/agent-streemr";
 *
 * const io = new Server(httpServer);
 * const registry = new LocalToolRegistry<MyCtx>();
 * registry.register("my_tool", { onSuccess: (ctx, json) => { ... } });
 *
 * createAgentSocketListener({
 *   io,
 *   authenticate: async (socket) => {
 *     const token = socket.handshake.auth?.token;
 *     if (!await verify(token)) return null;
 *     const threadId = socket.handshake.auth?.installation_id;
 *     return { threadId };
 *   },
 *   createContext: (_threadId) => ({ userId: "unknown" }),
 *   localToolRegistry: registry,
 *   getAgentRunner: (_threadId) => myAgentStream,
 * });
 * ```
 */

import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import type { AgentStreamEvent } from "../protocol/stream.js";
import type { Attachment, ProtocolVersion } from "../protocol/events.js";
import { parseLocalToolResponseEnvelope } from "../protocol/localTool.js";
import { AgentStreamAdapter } from "./adapter.js";
import { ThreadQueue } from "./queue.js";
import type { LocalToolRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------

/**
 * The protocol version implemented by this build of the server.
 * Exported so consumer code can surface it in health endpoints or logs.
 */
export const PROTOCOL_VERSION: ProtocolVersion = { major: 1, minor: 0 };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Returned by `authenticate`. Must carry at minimum a `threadId` which is used as:
 * - The LangChain/LangGraph checkpoint key (conversation history key).
 * - The Socket.io room name for broadcasts (e.g. `context_cleared`).
 *
 * Additional fields (e.g. `userId`, `role`) are passed through to `getAgentRunner`
 * and are available on `socket.data.auth`.
 */
export type AuthResult = {
  threadId: string;
  [key: string]: unknown;
};

/**
 * Local tool emission mode, forwarded verbatim as `tool_type` in the
 * `local_tool` socket event so the client knows whether a reply is required.
 *
 * - `"sync"` — server is blocking until the client responds (or TTL fires).
 * - `"async"` — server is not blocking; expects a `local_tool_response` later.
 * - `"fire_and_forget"` — no response expected; client executes for side-effects only.
 */
export type LocalToolEmitType = "sync" | "async" | "fire_and_forget";

/**
 * Unified local tool emitter injected into the agent runner.
 *
 * - `"sync"` / `"async"` — registers the request in the registry and returns
 *   the server-generated `request_id`. In sync mode pass this to
 *   `LocalToolRegistry.awaitResponse()`.
 * - `"fire_and_forget"` — emits without registry tracking; returns `null`
 *   (callers should ignore the return value).
 */
export type EmitLocalToolFn = (payload: {
  tool_name: string;
  args_json: object;
  toolType: LocalToolEmitType;
}) => string | null;

/**
 * An async generator factory that the consumer implements. Called once per
 * agent run; must return an `AsyncIterable<AgentStreamEvent>`.
 *
 * The options object provides everything the agent needs:
 * - `threadId` — for history keying and room broadcasting.
 * - `context` — the current per-thread context (application-defined `TContext`).
 * - `emitLocalTool` — unified emitter; pass `toolType: "tracked"` for async/sync tools
 *   or `toolType: "fire_and_forget"` for untracked tools. Returns `request_id | null`.
 * - `localToolRegistry` — the `LocalToolRegistry` instance; inject into
 *   `config.configurable` (via `SYNC_REGISTRY_KEY`) for sync-mode tools.
 */
export type AgentRunner<TContext> = (
  message: string,
  options: {
    threadId: string;
    /** Agent identifier forwarded from the client's `client_hello.agent_id`. */
    agent_id?: string;
    context?: TContext;
    /** Staged attachments uploaded before this message, ordered by `seq`. */
    attachments?: Attachment[];
    emitLocalTool: EmitLocalToolFn;
    localToolRegistry: LocalToolRegistry<TContext>;
  }
) => AsyncIterable<AgentStreamEvent>;

/**
 * Options for `createAgentSocketListener`.
 */
export type CreateAgentSocketListenerOptions<TContext> = {
  /** The Socket.io `Server` instance to attach listeners to. */
  io: Server;

  /**
   * Called for every new socket connection attempt (inside `io.use`).
   * Return an `AuthResult` to accept, or `null` to reject with "Unauthorized".
   */
  authenticate: (socket: Socket) => Promise<AuthResult | null> | AuthResult | null;

  /**
   * Factory for per-thread context objects. Called the first time a thread is
   * seen (lazy, on the first message). Must return a mutable object — processors
   * in the `localToolRegistry` receive and mutate it.
   */
  createContext: (threadId: string) => TContext;

  /**
   * Returns the `AgentRunner` function to use for `threadId`.
   * Called once per agent run (inside the queue). May return the same function
   * for all threads or vary per thread.
   *
   * `agentId` is forwarded from the client's `client_hello.agent_id` field and
   * may be used to route different threads to different agent implementations.
   */
  getAgentRunner: (threadId: string, agentId?: string) => AgentRunner<TContext>;

  /** The `LocalToolRegistry` instance shared between the listener and tools. */
  localToolRegistry: LocalToolRegistry<TContext>;

  /**
   * Hook to customise the follow-up message injected into the conversation thread
   * after a `local_tool_response` is received.
   *
   * The default produces a markdown table summarising the tool result.
   *
   * @param args.toolName - The tool that responded.
   * @param args.requestId - The `request_id` (abbreviated).
   * @param args.status - The response status.
   * @param args.responseJson - Present when `status === "success"`.
   * @param args.errorMessage - Present when `status === "error"`.
   * @param args.isLast - `true` when this is the last pending tool for the thread;
   *                      use to decide whether to ask the agent to reply or hold.
   */
  buildFollowUpMessage?: (args: {
    toolName: string;
    requestId: string;
    status: string;
    responseJson?: object;
    errorMessage?: string;
    isLast: boolean;
  }) => string;

  /**
   * Called whenever a client emits `set_context` for a given thread.
   * Receives the existing per-thread context object (already created if absent)
   * and the raw JSON sent by the client, allowing the application to merge or
   * replace fields on the context in-place.
   *
   * @param context - The mutable per-thread context for `threadId`.
   * @param data    - The `data` field from the `SetContextPayload`.
   * @param threadId - The thread identifier.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onContextUpdate?: (context: TContext, data: Record<string, any>, threadId: string) => void;

  /**
   * Called when an unhandled error occurs during an agent run or event handling.
   * The default emits `error` to the socket.
   */
  onError?: (err: unknown, socket: Socket, threadId?: string) => void;

  /**
   * TTL in milliseconds for in-flight `local_tool` requests.
   * Defaults to 30 000 (30 s).
   */
  localToolTtlMs?: number;

  /**
   * Maximum byte length for a single attachment `body` field.
   * Reported to clients in `welcome.capabilities.max_message_size_bytes`.
   * Defaults to `5_242_880` (5 MiB).
   */
  maxMessageSizeBytes?: number;

  /**
   * Server-side cap on the inactivity timeout (in ms).
   * When a client requests a timeout via `client_hello.inactivity_timeout_ms`,
   * the effective timeout is `min(clientRequested, serverMax)`.
   * When the client does not request a timeout but this is set, the server
   * imposes the timeout unilaterally.
   * `undefined` (default) means no cap / no unilateral timeout.
   */
  inactivityTimeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Default follow-up message builder (matches current app behaviour)
// ---------------------------------------------------------------------------

function defaultBuildFollowUpMessage(args: {
  toolName: string;
  requestId: string;
  status: string;
  responseJson?: object;
  errorMessage?: string;
  isLast: boolean;
}): string {
  const { toolName, requestId, status, responseJson, errorMessage, isLast } = args;
  const abbrevId = requestId.slice(0, 8) + "…";

  let result: string;
  if (status === "denied") {
    result = "User declined.";
  } else if (status === "not_supported") {
    result = "Not supported by client.";
  } else if (status === "error") {
    result = errorMessage ? `Error: ${errorMessage}` : "Error (no detail).";
  } else if (responseJson && typeof responseJson === "object") {
    result = JSON.stringify(responseJson);
  } else {
    result = "—";
  }
  const cell = result.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const table = `| Tool | Request ID | Result |\n|------|------------|--------|\n| ${toolName} | ${abbrevId} | ${cell} |`;

  if (!isLast) {
    return `Processed one user tool response.\n\n**User tools result:**\n\n${table}\n\nMore local tool responses are still pending. Consume this as context only and wait. Do not answer the user's request yet; do not give a full response or start new tasks.`;
  }
  return `Processed user responses.\n\n**User tools result:**\n\n${table}\n\n**Reply rule:** Acknowledge very briefly that you received the info (e.g. one short sentence). You may suggest next steps. Do **not** give a full response, analysis, or advice unless the user explicitly asked for it. If the user did not ask a specific question, keep your reply to a brief acknowledgment plus optional next-step suggestions only.`;
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

/**
 * Wires all agent-streemr Socket.io listeners onto `options.io`.
 *
 * Handles:
 * - Socket authentication via `io.use` middleware.
 * - Room joining (per `threadId`).
 * - `message` → per-thread serialised agent run → `AgentStreamAdapter`.
 * - `local_tool_response` → parse + TTL sweep + registry dispatch + follow-up run.
 * - `clear_context` → full thread reset + `context_cleared` broadcast.
 */
export function createAgentSocketListener<TContext>(
  options: CreateAgentSocketListenerOptions<TContext>
): void {
  const {
    io,
    authenticate,
    createContext,
    getAgentRunner,
    localToolRegistry,
    buildFollowUpMessage = defaultBuildFollowUpMessage,
    onContextUpdate,
    onError,
    localToolTtlMs = 30_000,
    maxMessageSizeBytes = 5_242_880,
    inactivityTimeoutMs: serverInactivityTimeoutMs,
  } = options;

  const queue = new ThreadQueue();
  /** Per-thread mutable context objects. Processors mutate these in-place. */
  const contextStore = new Map<string, TContext>();
  /** Fire-and-forget request IDs emitted per thread (used to classify stray responses). */
  const fireAndForgetByThread = new Map<string, Map<string, number>>();

  const defaultOnError = (err: unknown, socket: Socket) => {
    socket.emit("error", { message: String(err) });
  };
  const handleError = onError ?? defaultOnError;

  function contextKey(threadId: string, agentId?: string): string {
    return agentId ? `${agentId}:${threadId}` : threadId;
  }

  function getOrCreateContext(threadId: string, agentId?: string): TContext {
    const key = contextKey(threadId, agentId);
    let ctx = contextStore.get(key);
    if (!ctx) {
      ctx = createContext(threadId);
      contextStore.set(key, ctx);
    }
    return ctx;
  }

  function makeEmitLocalTool(socket: Socket, threadId: string): EmitLocalToolFn {
    return ({ tool_name, args_json, toolType }) => {
      const nowMs = Date.now();
      const request_id = randomUUID();

      if (toolType === "sync" || toolType === "async") {
        localToolRegistry.clearExpired(threadId, nowMs);
        const tracked = localToolRegistry.trackEmit({ threadId, request_id, tool_name, nowMs, ttlMs: localToolTtlMs });
        socket.emit("local_tool", {
          tool_name,
          args_json,
          request_id,
          tool_type: toolType,
          expires_at: tracked?.expiresAtMs,
        });
        return request_id;
      } else {
        rememberFireAndForget(threadId, request_id, nowMs);
        socket.emit("local_tool", { tool_name, args_json, request_id, tool_type: "fire_and_forget" });
        return null;
      }
    };
  }

  function rememberFireAndForget(threadId: string, requestId: string, nowMs: number): void {
    let threadMap = fireAndForgetByThread.get(threadId);
    if (!threadMap) {
      threadMap = new Map();
      fireAndForgetByThread.set(threadId, threadMap);
    }

    for (const [rid, expiresAtMs] of threadMap.entries()) {
      if (expiresAtMs <= nowMs) threadMap.delete(rid);
    }

    threadMap.set(requestId, nowMs + localToolTtlMs);
  }

  function consumeKnownFireAndForget(threadId: string, requestId: string, nowMs: number): boolean {
    const threadMap = fireAndForgetByThread.get(threadId);
    if (!threadMap) return false;

    for (const [rid, expiresAtMs] of threadMap.entries()) {
      if (expiresAtMs <= nowMs) threadMap.delete(rid);
    }

    const known = threadMap.delete(requestId);
    if (threadMap.size === 0) fireAndForgetByThread.delete(threadId);
    return known;
  }

  function enqueueRun(
    socket: Socket,
    threadId: string,
    message: string,
    agentId?: string,
    attachments?: Attachment[]
  ): void {
    // Emit working=true the first time the queue becomes active for this thread.
    const isFirst = !queue.has(threadId);
    if (isFirst) socket.emit("agent_working", { working: true });

    queue.enqueue(threadId, async () => {
      const context = getOrCreateContext(threadId, agentId);
      const runner = getAgentRunner(threadId, agentId);
      const stream = runner(message, {
        threadId,
        agent_id: agentId,
        context,
        attachments,
        emitLocalTool: makeEmitLocalTool(socket, threadId),
        localToolRegistry,
      });

      const adapter = new AgentStreamAdapter(socket);
      try {
        await adapter.run(stream);
      } catch (err) {
        handleError(err, socket, threadId);
      }
    }).then(() => {
      // Emit working=false only when the queue has fully drained for this thread.
      if (!queue.has(threadId)) socket.emit("agent_working", { working: false });
    });
  }

  // -------------------------------------------------------------------------
  // Auth middleware
  // -------------------------------------------------------------------------

  io.use(async (socket, next) => {
    try {
      const result = await authenticate(socket);
      if (!result) return next(new Error("Unauthorized"));
      socket.data.auth = result;
      socket.data.threadId = result.threadId;
      next();
    } catch (err) {
      next(new Error("Authentication error: " + String(err)));
    }
  });

  // -------------------------------------------------------------------------
  // Connection handler
  // -------------------------------------------------------------------------

  io.on("connection", (socket) => {
    const threadId = socket.data.threadId as string | undefined;
    if (threadId) socket.join(threadId);

    // -----------------------------------------------------------------------
    // Per-socket mutable state
    // -----------------------------------------------------------------------
    let socketAgentId: string | undefined;
    let effectiveTimeoutMs = 0;
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    type StagingState = { correlationId: string; count: number; staged: Map<number, Attachment> };
    let staging: StagingState | null = null;

    function resetInactivityTimer(): void {
      if (effectiveTimeoutMs <= 0) return;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        socket.emit("inactive_close", { reason: "Inactivity timeout" });
        socket.disconnect();
      }, effectiveTimeoutMs);
    }

    socket.on("disconnect", () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = null;
    });

    // -----------------------------------------------------------------------
    // client_hello — version handshake
    // -----------------------------------------------------------------------
    socket.on("client_hello", (payload: { version?: ProtocolVersion; agent_id?: string; inactivity_timeout_ms?: number }) => {
      const clientVersion = payload?.version;
      if (
        !clientVersion ||
        typeof clientVersion.major !== "number" ||
        typeof clientVersion.minor !== "number"
      ) {
        socket.emit("version_not_supported", {
          server_version: PROTOCOL_VERSION,
          client_version: { major: 0, minor: 0 },
        });
        socket.disconnect();
        return;
      }

      const compatible =
        clientVersion.major === PROTOCOL_VERSION.major &&
        clientVersion.minor <= PROTOCOL_VERSION.minor;

      if (compatible) {
        socketAgentId = typeof payload.agent_id === "string" ? payload.agent_id : undefined;
        // Compute the effective inactivity timeout.
        const clientTimeoutMs =
          typeof payload.inactivity_timeout_ms === "number" && payload.inactivity_timeout_ms > 0
            ? payload.inactivity_timeout_ms
            : 0;
        if (clientTimeoutMs > 0) {
          effectiveTimeoutMs =
            serverInactivityTimeoutMs !== undefined
              ? Math.min(clientTimeoutMs, serverInactivityTimeoutMs)
              : clientTimeoutMs;
        } else if (serverInactivityTimeoutMs !== undefined && serverInactivityTimeoutMs > 0) {
          effectiveTimeoutMs = serverInactivityTimeoutMs;
        }
        socket.emit("welcome", {
          server_version: PROTOCOL_VERSION,
          capabilities: {
            max_message_size_bytes: maxMessageSizeBytes,
            inactivity_timeout_ms: effectiveTimeoutMs,
          },
        });
        if (effectiveTimeoutMs > 0) resetInactivityTimer();
      } else {
        socket.emit("version_not_supported", {
          server_version: PROTOCOL_VERSION,
          client_version: clientVersion,
        });
        socket.disconnect();
      }
    });

    // -----------------------------------------------------------------------
    // start_attachments
    // -----------------------------------------------------------------------
    socket.on("start_attachments", (payload: { correlation_id?: string; count?: number }) => {
      const correlationId = typeof payload?.correlation_id === "string" ? payload.correlation_id : "";
      const count = typeof payload?.count === "number" ? Math.floor(payload.count) : 0;
      if (!correlationId || count < 1) {
        socket.emit("error", { message: "start_attachments: invalid payload" });
        return;
      }
      // Replace any previous staging session.
      staging = { correlationId, count, staged: new Map() };
      resetInactivityTimer();
    });

    // -----------------------------------------------------------------------
    // attachment
    // -----------------------------------------------------------------------
    socket.on(
      "attachment",
      (payload: { correlation_id?: string; seq?: number; type?: string; body?: string; name?: string }) => {
        const correlationId = typeof payload?.correlation_id === "string" ? payload.correlation_id : "";
        const seq = typeof payload?.seq === "number" ? payload.seq : -1;
        const type = payload?.type;
        const body = typeof payload?.body === "string" ? payload.body : "";
        if (!staging || staging.correlationId !== correlationId) {
          socket.emit("error", { message: "attachment: no active attachment sequence for this correlation_id" });
          return;
        }
        if (seq < 0 || seq >= staging.count) {
          socket.emit("error", { message: "attachment: seq out of range" });
          return;
        }
        if (type !== "image" && type !== "markdown") {
          socket.emit("error", { message: "attachment: invalid type" });
          return;
        }
        if (body.length > maxMessageSizeBytes) {
          socket.emit("error", { message: "attachment: body exceeds max_message_size_bytes" });
          return;
        }
        // Idempotent: re-ack without double-storing.
        if (!staging.staged.has(seq)) {
          staging.staged.set(seq, {
            type: type as "image" | "markdown",
            body,
            name: typeof payload.name === "string" ? payload.name : undefined,
          });
        }
        socket.emit("attachment_ack", { correlation_id: correlationId, seq });
        resetInactivityTimer();
      }
    );

    // -----------------------------------------------------------------------
    // message
    // -----------------------------------------------------------------------
    socket.on(
      "message",
      (payload: { text?: string; context?: Record<string, unknown>; attachment_correlation_id?: string }) => {
        if (!threadId) {
          socket.emit("error", { message: "Missing threadId" });
          return;
        }
        const text = typeof payload?.text === "string" ? payload.text.trim() : "";
        if (!text) return;

        // Ensure context exists before the run; apply inline context if provided.
        const ctx = getOrCreateContext(threadId, socketAgentId);
        if (
          onContextUpdate &&
          payload?.context !== null &&
          payload?.context !== undefined &&
          typeof payload.context === "object"
        ) {
          onContextUpdate(ctx, payload.context, threadId);
        }

        // Resolve attachment correlation if present.
        let attachments: Attachment[] | undefined;
        const correlationId =
          typeof payload?.attachment_correlation_id === "string"
            ? payload.attachment_correlation_id
            : undefined;
        if (correlationId && staging && staging.correlationId === correlationId) {
          if (staging.staged.size === staging.count) {
            // Order by seq and consume the staging session.
            attachments = Array.from({ length: staging.count }, (_, i) => staging!.staged.get(i)!);
          } else {
            socket.emit("error", { message: "Attachment sequence incomplete" });
            staging = null;
            return;
          }
        }
        staging = null; // consume regardless of correlation match
        resetInactivityTimer();
        enqueueRun(socket, threadId, text, socketAgentId, attachments);
      }
    );

    // -----------------------------------------------------------------------
    // local_tool_response
    // -----------------------------------------------------------------------
    socket.on("local_tool_response", (rawPayload: unknown) => {
      if (!threadId) return;

      const nowMs = Date.now();
      resetInactivityTimer();
      const expired = localToolRegistry.clearExpired(threadId, nowMs);
      if (expired.removedCount > 0) {
        console.log("[agent-streemr] expired local_tool entries cleared", {
          threadId,
          ...expired,
        });
      }

      const parsed = parseLocalToolResponseEnvelope(rawPayload);
      if (!parsed) {
        console.warn("[agent-streemr] invalid local_tool_response envelope — ignored", {
          threadId,
          rawPayload,
        });
        return;
      }

      const { requestId, toolName, status, responseJson, errorMessage } = parsed;
      const ctx = getOrCreateContext(threadId, socketAgentId);

      const result = localToolRegistry.handleResponse({
        ctx,
        threadId,
        request_id: requestId,
        tool_name: toolName,
        status,
        responseJson,
        errorMessage,
      });

      if (result === null) {
        if (consumeKnownFireAndForget(threadId, requestId, nowMs)) {
          return;
        }
        console.log("[agent-streemr] local_tool_response for unknown/expired request_id — ignored", {
          threadId,
          requestId,
          toolName,
        });
        return;
      }

      // Acknowledge receipt so the client can cancel any pending retry timer.
      socket.emit("local_tool_response_ack", { request_id: requestId, tool_name: toolName });

      const [toolKind, { remainingCount }] = result;
      if (toolKind === "sync") {
        return;
      }

      const followUp = buildFollowUpMessage({
        toolName,
        requestId,
        status,
        responseJson: status === "success" ? responseJson : undefined,
        errorMessage: status === "error" ? errorMessage : undefined,
        isLast: remainingCount === 0,
      });

      enqueueRun(socket, threadId, followUp);
    });

    // -----------------------------------------------------------------------
    // set_context
    // -----------------------------------------------------------------------
    socket.on("set_context", (payload: { data?: Record<string, unknown> }) => {
      if (!threadId) {
        socket.emit("error", { message: "Missing threadId" });
        return;
      }
      if (!payload || typeof payload.data !== "object" || payload.data === null) {
        socket.emit("error", { message: "set_context: payload.data must be a non-null object" });
        return;
      }
      if (onContextUpdate) {
        const ctx = getOrCreateContext(threadId, socketAgentId);
        onContextUpdate(ctx, payload.data, threadId);
      }
    });

    // -----------------------------------------------------------------------
    // clear_context
    // -----------------------------------------------------------------------
    socket.on("clear_context", async () => {
      if (!threadId) {
        socket.emit("error", { message: "Missing threadId" });
        return;
      }

      // Let any active run finish, then clear
      queue.enqueue(threadId, async () => {
        contextStore.delete(contextKey(threadId, socketAgentId));
        fireAndForgetByThread.delete(threadId);
        localToolRegistry.clearThread(threadId);
        queue.clear(threadId);

        try {
          // Notify all sockets in the room (broadcast)
          io.to(threadId).emit("context_cleared", { message: "Context cleared." });
        } catch (err) {
          socket.emit("error", { message: "Failed to clear context: " + String(err) });
        }
      });
    });
  });
}
