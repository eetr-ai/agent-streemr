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
   * Optional topic name for the conversation.
   * When absent the server derives a topic from the first 80 chars of `text`.
   */
  topic_name?: string;
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
 * The client must reply with `local_tool_response` echoing the `request_id`.
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
  message: (payload: MessagePayload) => void;
  local_tool_response: (payload: LocalToolResponsePayload) => void;
  clear_context: () => void;
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
  internal_token: (payload: InternalTokenPayload) => void;
  local_tool: (payload: LocalToolPayload) => void;
  agent_response: (payload: AgentResponsePayload) => void;
  context_cleared: (payload: ContextClearedPayload) => void;
  error: (payload: ErrorPayload) => void;
}
