// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module protocol/events
 *
 * Zero-dependency socket event payload types for the agent-streemr protocol.
 * Import these on both client and server to stay in sync with no duplication.
 *
 * Dependency tier: NONE — pure TypeScript types, no runtime code.
 */

// ---------------------------------------------------------------------------
// Protocol versioning
// ---------------------------------------------------------------------------

/**
 * Represents a semantic protocol version with a major and minor component.
 *
 * Compatibility rule (as evaluated by the server):
 * - `welcome` is emitted when `client.major === server.major && client.minor <= server.minor`.
 * - Any other combination results in `version_not_supported` followed by disconnection.
 *
 * Minor version bumps are backward-compatible; clients are expected to lag behind servers.
 */
export type ProtocolVersion = {
  /** Breaking-change counter. Clients and servers must agree on this. */
  major: number;
  /** Non-breaking feature counter. Clients may be behind the server's minor version. */
  minor: number;
};

// ---------------------------------------------------------------------------
// Client → Server events
// ---------------------------------------------------------------------------

/**
 * Sent by the client to trigger an agent run.
 *
 * Event name: `message`
 */
export type MessagePayload = {
  /** The user's message text. */
  text: string;
  /**
   * Optional inline context sent alongside the message.
   * This is the preferred alternative to a prior standalone `set_context` call.
   * When present the server applies it (via `onContextUpdate`) before running the agent.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: Record<string, any>;
};

/**
 * Sent by the client in reply to a `local_tool` request from the server.
 * Exactly one of `response_json`, `allowed: false`, `notSupported: true`,
 * or `error: true` must be present. The server validates this strictly via
 * `parseLocalToolResponseEnvelope`.
 *
 * Event name: `local_tool_response`
 */
export type LocalToolResponsePayload<TResponse = object> = {
  /** Echoes the `request_id` from the originating `LocalToolPayload`. */
  request_id: string;
  /** The single canonical tool name, echoed from the originating `LocalToolPayload`. */
  tool_name: string;
} & (
  | { response_json: TResponse; allowed?: never; notSupported?: never; error?: never; errorMessage?: never }
  | { response_json?: never; allowed: false; notSupported?: never; error?: never; errorMessage?: never }
  | { response_json?: never; allowed?: never; notSupported: true; error?: never; errorMessage?: never }
  | { response_json?: never; allowed?: never; notSupported?: never; error: true; errorMessage?: string }
);

/**
 * Sent by the client to reset the agent's conversation history for the current thread.
 *
 * Event name: `clear_context`
 *
 * Payload: none (emit with no data or an empty object).
 */
export type ClearContextPayload = Record<string, never>;

/**
 * Sent by the client to provide or update structured context for the agent.
 * The server will invoke `onContextUpdate` with the deserialized JSON object,
 * giving the application an opportunity to mutate its per-thread context.
 *
 * Event name: `set_context`
 */
export type SetContextPayload = {
  /** Arbitrary JSON the client wants to surface to the agent. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
};

/**
 * Sent by the client immediately after the socket connects to initiate the
 * protocol version handshake. The server replies with `welcome` (accepted) or
 * `version_not_supported` (rejected) and then disconnects.
 *
 * Event name: `client_hello`
 */
export type ClientHelloPayload = {
  /** The protocol version the client is implementing. */
  version: ProtocolVersion;
};

// ---------------------------------------------------------------------------
// Server → Client events
// ---------------------------------------------------------------------------

/**
 * Agent reasoning token emitted while the agent is thinking.
 * These should be displayed in a "thinking" or "reasoning" panel, not as
 * part of the final reply.
 *
 * Event name: `internal_token`
 */
export type InternalTokenPayload = {
  /** One chunk of the agent's reasoning stream. */
  token: string;
};

/**
 * Delegate a tool execution to the client.
 * The client must reply with `local_tool_response` echoing the `request_id`
 * unless `tool_type` is `"fire_and_forget"`.
 *
 * Event name: `local_tool`
 */
export type LocalToolPayload = {
  /** Server-generated UUID uniquely identifying this tool request. */
  request_id: string;
  /** The single canonical tool name. */
  tool_name: string;
  /** Tool arguments as a serialisable object. */
  args_json: object;
  /**
   * Execution mode of this tool on the server.
   *
   * - `"sync"` — the server is blocking, awaiting the client reply before
   *   returning a result to the LLM. Reply as fast as possible.
   * - `"async"` — the server is not blocking; it will resume the conversation
   *   when the `local_tool_response` arrives.
   * - `"fire_and_forget"` — no reply is expected or required; the client
   *   should execute the tool for side effects only and **not** emit
   *   `local_tool_response`.
   */
  tool_type: "sync" | "async" | "fire_and_forget";
  /**
   * Unix epoch milliseconds when the server will give up waiting for a
   * response. Present for `"sync"` and `"async"` tools; absent for
   * `"fire_and_forget"`. The client must not send `local_tool_response`
   * after this timestamp.
   */
  expires_at?: number;
};

/**
 * Sent by the server to confirm that a `local_tool_response` was received
 * and processed successfully. The client can use this to cancel any pending
 * retry timer it set up for the corresponding `request_id`.
 *
 * Event name: `local_tool_response_ack`
 */
export type LocalToolResponseAckPayload = {
  /** Echoes the `request_id` from the originating `LocalToolPayload`. */
  request_id: string;
  /** Echoes the `tool_name` from the originating `LocalToolPayload`. */
  tool_name: string;
};

/**
 * Final assistant reply. Multiple emissions are possible for streaming
 * (each with a `chunk`); the last emission carries `done: true`.
 *
 * Event name: `agent_response`
 */
export type AgentResponsePayload = {
  /** A chunk of the assistant's reply. May be omitted on a `done: true` emission. */
  chunk?: string;
  /** `true` on the final emission for this turn. */
  done: boolean;
};

/**
 * Broadcast to all sockets sharing the same `threadId` room when context is cleared.
 *
 * Event name: `context_cleared`
 */
export type ContextClearedPayload = {
  message: string;
};

/**
 * Emitted when any server-side error occurs during event processing.
 *
 * Event name: `error`
 */
export type ErrorPayload = {
  message: string;
};

/**
 * Emitted by the server in response to a `client_hello` when the client's
 * protocol version is compatible with the server's.
 *
 * Event name: `welcome`
 */
export type WelcomePayload = {
  /** The protocol version the server is running. */
  server_version: ProtocolVersion;
};

/**
 * Emitted by the server when the client's protocol version is incompatible.
 * The server will disconnect the socket immediately after emitting this event.
 *
 * Incompatibility is defined as: `client.major !== server.major || client.minor > server.minor`.
 *
 * Event name: `version_not_supported`
 */
export type VersionNotSupportedPayload = {
  /** The version the server supports. */
  server_version: ProtocolVersion;
  /** The version the client reported. */
  client_version: ProtocolVersion;
};

/**
 * Emitted by the server whenever the processing state of the thread's run
 * queue changes. `working: true` is sent when the queue transitions from idle
 * to active; `working: false` when it fully drains back to idle.
 *
 * Use this to show/hide a global "thinking" indicator in the UI.
 *
 * Event name: `agent_working`
 */
export type AgentWorkingPayload = {
  /** `true` while the server is processing at least one task for this thread. */
  working: boolean;
};

// ---------------------------------------------------------------------------
// Convenience maps (for typed socket.io usage)
// ---------------------------------------------------------------------------

/**
 * Typed map of all events the **server listens** for (client → server).
 *
 * Usage with socket.io-typed sockets:
 * ```ts
 * import type { ClientToServerEvents } from "@eetr/agent-streemr/protocol/events";
 * const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
 * ```
 */
export interface ClientToServerEvents {
  /**
   * Initiates the protocol version handshake.
   * Must be the first event the client emits after the socket connects.
   */
  client_hello: (payload: ClientHelloPayload) => void;
  message: (payload: MessagePayload) => void;
  local_tool_response: (payload: LocalToolResponsePayload) => void;
  clear_context: () => void;
  set_context: (payload: SetContextPayload) => void;
}

/**
 * Typed map of all events the **server emits** (server → client).
 *
 * Usage with socket.io-typed sockets:
 * ```ts
 * import type { ServerToClientEvents } from "@eetr/agent-streemr/protocol/events";
 * const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
 * ```
 */
export interface ServerToClientEvents {
  /** Response to a successful `client_hello` — protocol versions are compatible. */
  welcome: (payload: WelcomePayload) => void;
  /** Response to an incompatible `client_hello` — server will disconnect immediately after. */
  version_not_supported: (payload: VersionNotSupportedPayload) => void;
  /** Signals that the thread's run queue became active (`working: true`) or fully drained (`working: false`). */
  agent_working: (payload: AgentWorkingPayload) => void;
  internal_token: (payload: InternalTokenPayload) => void;
  local_tool: (payload: LocalToolPayload) => void;
  /** Acknowledges a received and processed `local_tool_response`. The client can use this to cancel retry timers. */
  local_tool_response_ack: (payload: LocalToolResponseAckPayload) => void;
  agent_response: (payload: AgentResponsePayload) => void;
  context_cleared: (payload: ContextClearedPayload) => void;
  error: (payload: ErrorPayload) => void;
}
