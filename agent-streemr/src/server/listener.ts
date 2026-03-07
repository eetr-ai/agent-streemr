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
import type { AgentStreamEvent } from "../protocol/stream";
import { parseLocalToolResponseEnvelope } from "../protocol/localTool";
import { AgentStreamAdapter } from "./adapter";
import { ThreadQueue } from "./queue";
import type { LocalToolRegistry } from "./registry";

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

/** Local tool emission mode. */
export type LocalToolEmitType = "tracked" | "fire_and_forget";

/**
 * Unified local tool emitter injected into the agent runner.
 *
 * - `"tracked"` (async / sync modes) — registers the request in the registry
 *   and returns the server-generated `request_id`. In sync mode pass this to
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
 * - `topicName` / `currentTopicName` — for dynamic system prompt injection.
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
    topicName?: string;
    currentTopicName?: string;
    context?: TContext;
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
   */
  getAgentRunner: (threadId: string) => AgentRunner<TContext>;

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
  } = options;

  const queue = new ThreadQueue();
  /** Per-thread mutable context objects. Processors mutate these in-place. */
  const contextStore = new Map<string, TContext>();
  /** Last emitted topic name per thread, for follow-up turns. */
  const lastTopicByThread = new Map<string, string>();
  /** Fire-and-forget request IDs emitted per thread (used to classify stray responses). */
  const fireAndForgetByThread = new Map<string, Map<string, number>>();

  const defaultOnError = (err: unknown, socket: Socket) => {
    socket.emit("error", { message: String(err) });
  };
  const handleError = onError ?? defaultOnError;

  function getOrCreateContext(threadId: string): TContext {
    let ctx = contextStore.get(threadId);
    if (!ctx) {
      ctx = createContext(threadId);
      contextStore.set(threadId, ctx);
    }
    return ctx;
  }

  function makeEmitLocalTool(socket: Socket, threadId: string): EmitLocalToolFn {
    return ({ tool_name, args_json, toolType }) => {
      const nowMs = Date.now();
      const request_id = randomUUID();

      if (toolType === "tracked") {
        localToolRegistry.clearExpired(threadId, nowMs);
        localToolRegistry.trackEmit({ threadId, request_id, tool_name, nowMs, ttlMs: localToolTtlMs });
      } else {
        rememberFireAndForget(threadId, request_id, nowMs);
      }

      socket.emit("local_tool", { tool_name, args_json, request_id });
      return toolType === "tracked" ? request_id : null;
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
    opts: { topicName?: string; currentTopicName?: string }
  ): void {
    queue.enqueue(threadId, async () => {
      const context = contextStore.get(threadId);
      const runner = getAgentRunner(threadId);
      const stream = runner(message, {
        threadId,
        topicName: opts.topicName,
        currentTopicName: opts.currentTopicName,
        context,
        emitLocalTool: makeEmitLocalTool(socket, threadId),
        localToolRegistry,
      });

      const adapter = new AgentStreamAdapter(socket);
      try {
        await adapter.run(stream);
      } catch (err) {
        handleError(err, socket, threadId);
      }
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
    // message
    // -----------------------------------------------------------------------
    socket.on("message", (payload: { text?: string; topic_name?: string }) => {
      if (!threadId) {
        socket.emit("error", { message: "Missing threadId" });
        return;
      }
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";
      if (!text) return;

      const currentTopicName =
        typeof payload?.topic_name === "string" ? payload.topic_name.trim() || undefined : undefined;
      const topicName = currentTopicName ?? (text.slice(0, 80).trim() || "Chat");

      // Ensure context exists before the run
      getOrCreateContext(threadId);

      enqueueRun(socket, threadId, text, { topicName, currentTopicName });
    });

    // -----------------------------------------------------------------------
    // local_tool_response
    // -----------------------------------------------------------------------
    socket.on("local_tool_response", (rawPayload: unknown) => {
      if (!threadId) return;

      const nowMs = Date.now();
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
      const ctx = getOrCreateContext(threadId);

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

      const [toolKind, { remainingCount }] = result;
      if (toolKind === "sync") {
        return;
      }

      const topicName = lastTopicByThread.get(threadId);
      const followUp = buildFollowUpMessage({
        toolName,
        requestId,
        status,
        responseJson: status === "success" ? responseJson : undefined,
        errorMessage: status === "error" ? errorMessage : undefined,
        isLast: remainingCount === 0,
      });

      enqueueRun(socket, threadId, followUp, {
        topicName,
        currentTopicName: topicName,
      });
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
        const ctx = getOrCreateContext(threadId);
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
        contextStore.delete(threadId);
        lastTopicByThread.delete(threadId);
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
