// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module types
 *
 * Public TypeScript types for @eetr/agent-streemr-react.
 */

import type { ManagerOptions, SocketOptions } from "socket.io-client";

// Re-export protocol types consumers might need without a direct dependency
// on the server-side @eetr/agent-streemr package.
export type {
  ProtocolVersion,
  MessagePayload,
  LocalToolPayload,
  LocalToolResponseAckPayload,
  LocalToolResponsePayload,
  AgentResponsePayload,
  InternalTokenPayload,
  ContextClearedPayload,
  ErrorPayload,
  SetContextPayload,
  ClientHelloPayload,
  WelcomePayload,
  VersionNotSupportedPayload,
  AgentWorkingPayload,
  Attachment,
  InactiveClosePayload,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@eetr/agent-streemr";

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Role of a message in the conversation history. */
export type AgentMessageRole = "user" | "assistant";

/**
 * A single message in the local conversation history.
 * Assistant messages accumulate chunks while `streaming` is `true`;
 * `streaming` is set to `false` on the final `done: true` emission.
 */
export type AgentMessage = {
  /** Stable client-generated unique ID. */
  id: string;
  role: AgentMessageRole;
  /** Full accumulated text content. */
  content: string;
  /** `true` while the server is still streaming this message. */
  streaming: boolean;
};

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/** Lifecycle state of the underlying Socket.io connection. */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

// ---------------------------------------------------------------------------
// Hook options / result
// ---------------------------------------------------------------------------

/** Options passed to `useAgentStream`. */
export type UseAgentStreamOptions = {
  /** Full URL of the agent-streemr Socket.io server, e.g. `"http://localhost:8080"`. */
  url: string;
  /** Bearer JWT passed as `auth.token` in the Socket.io handshake. */
  token: string;
  /**
   * Optional Socket.io client options merged into the `io()` call.
   * `auth` is reserved — set `url` and `token` above instead.
   */
  socketOptions?: Partial<Omit<ManagerOptions & SocketOptions, "auth">>;
  /**
   * Optional agent identifier forwarded to the server in `client_hello.agent_id`.
   * The server's `getAgentRunner` callback receives this value and can use it to
   * route threads to different agent implementations.
   */
  agentId?: string;
  /**
   * Requested inactivity timeout in milliseconds sent in `client_hello.inactivity_timeout_ms`.
   * The server may cap this value; the negotiated effective timeout is reflected in
   * `serverCapabilities.inactivity_timeout_ms`. Omit or set to `0` to request no timeout.
   */
  inactivityTimeoutMs?: number;
  /**
   * How long (in ms) to wait for an `attachment_ack` from the server before
   * treating an attachment upload as failed. Defaults to `10_000` (10 s).
   */
  attachmentAckTimeoutMs?: number;
};

/** Full return value of `useAgentStream`. */
export type UseAgentStreamResult = {
  /**
   * Open the socket connection for the given thread.
   * Maps `threadId` to `auth.installation_id` in the handshake.
   * Safe to call multiple times — subsequent calls reconnect with the new threadId.
   */
  connect: (threadId: string) => void;
  /** Disconnect the socket and reset all state. */
  disconnect: () => void;
  /**
   * Optimistically push a user message and emit `message` to the server.
   * Also clears the current `internalThought`.
   * When `attachments` are provided, performs the multi-step upload handshake
   * (`start_attachments` → N×`attachment` → wait for acks → `message`).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendMessage: (text: string, context?: Record<string, any>, attachments?: import("@eetr/agent-streemr").Attachment[]) => void;
  /** Emit `clear_context`; on `context_cleared` confirmation messages are wiped locally too. */
  clearContext: () => void;
  /**
   * Emit `set_context` with an arbitrary JSON object.
   * The server will invoke `onContextUpdate` with the data, allowing the
   * application to update its per-thread context before the next agent run.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setContext: (data: Record<string, any>) => void;
  /** Local conversation history (user + assistant turns). */
  messages: AgentMessage[];
  /** Current socket connection status. */
  status: ConnectionStatus;
  /**
   * Accumulated agent reasoning/thinking tokens for the current turn.
   * Reset to `""` at the start of each `sendMessage` call.
   */
  internalThought: string;
  /** `true` while an assistant message is being streamed. */
  isStreaming: boolean;
  /** Last server error message, if any. `null` when no error is present. */
  error: string | null;
  /**
   * `true` while the server's run queue for this thread is active.
   * Transitions to `false` when the queue fully drains.
   * Use this to show a global "thinking" indicator independent of streaming state.
   */
  isWorking: boolean;
  /**
   * The protocol version reported by the server in the `welcome` event.
   * `undefined` before the handshake completes.
   */
  serverVersion?: import("@eetr/agent-streemr").ProtocolVersion;
  /**
   * Server-reported capabilities received in the `welcome` event.
   * `undefined` before the handshake completes.
   */
  serverCapabilities?: {
    max_message_size_bytes: number;
    inactivity_timeout_ms: number;
  };
  /**
   * When set, the server closed the connection due to inactivity.
   * Contains the reason string from the `inactive_close` event.
   * Cleared on the next successful `connect()` call.
   */
  inactiveCloseReason: string | null;
  /**
   * The raw typed Socket.io socket instance, or `null` before `connect()` is called.
   * Pass this to `useLocalToolHandler` to compose tool handling.
   */
  socket: import("socket.io-client").Socket<
    import("@eetr/agent-streemr").ServerToClientEvents,
    import("@eetr/agent-streemr").ClientToServerEvents
  > | null;
};

// ---------------------------------------------------------------------------
// Local tool handler
// ---------------------------------------------------------------------------

/**
 * The value your handler function must return to resolve a local tool request.
 * Matches the discriminated union on `LocalToolResponsePayload`.
 */
export type LocalToolHandlerResult =
  | { response_json: object }
  | { allowed: false }
  | { notSupported: true }
  | { error: true; errorMessage?: string };

// ---------------------------------------------------------------------------
// AllowList
// ---------------------------------------------------------------------------

/**
 * Decision returned by an `AllowList.check()` call.
 *
 * - `"allowed"` — proceed with tool execution.
 * - `"denied"` — suppress and reply `{ allowed: false }` to the server.
 * - `"unknown"` — not in the list; treated as `"denied"` by default.
 * - `"expired"` — request TTL expired before user decided; do not call handler
 *   and do not emit a response (agent can retry).
 */
export type AllowListDecision = "allowed" | "denied" | "unknown" | "expired";

/**
 * Optional metadata passed to `AllowList.check()` by the hook (e.g. from the
 * local_tool payload). Use it to implement TTL-based expiry of approval prompts.
 */
export interface AllowListCheckMeta {
  /** Server-side expiry timestamp (Unix ms). When past, the request is stale. */
  expires_at?: number;
}

/**
 * Pluggable allowlist interface.
 * Implement this to supply your own persistence- or policy-backed allow logic.
 *
 * @example
 * const myList: AllowList = {
 *   check: (toolName, args) => myDb.isAllowed(toolName) ? "allowed" : "denied",
 * };
 */
export interface AllowList {
  /**
   * Check whether the given tool invocation is permitted.
   * Receives `args` so decisions can be argument-aware
   * (e.g. allowlisting a file-read tool only for certain paths).
   * The optional `meta` object may include `expires_at` (Unix ms) so the
   * allowlist can hide the approval UI when the request has expired and
   * resolve with `"expired"` (no response is sent to the server; agent can retry).
   *
   * May be synchronous or asynchronous.
   */
  check(
    toolName: string,
    args: object,
    meta?: AllowListCheckMeta
  ): AllowListDecision | Promise<AllowListDecision>;
}

/** Return value of `useInMemoryAllowList`. */
export type InMemoryAllowListResult = {
  /** The `AllowList` instance to pass to `useLocalToolHandler`. */
  allowList: AllowList;
  /** Mark a tool as explicitly allowed. */
  allow: (toolName: string) => void;
  /** Mark a tool as explicitly denied. */
  deny: (toolName: string) => void;
  /** Remove a tool from the list entirely (reverts to `"unknown"`). */
  remove: (toolName: string) => void;
  /** Clear all entries — all tools revert to `"unknown"`. */
  clear: () => void;
  /**
   * Current snapshot of the list for UI rendering.
   * `true` = allowed, `false` = denied.
   */
  entries: Record<string, boolean>;
};
