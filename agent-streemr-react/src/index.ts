// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @package @eetr/agent-streemr-react
 *
 * React bindings for @eetr/agent-streemr.
 *
 * Provides hooks and context for connecting a Socket.io agent-streemr server
 * to a React application: managing the socket connection, streaming messages,
 * handling local tool requests, and tracking conversation state.
 *
 * ## Planned exports
 *
 * ### `useAgentSocket(options)`
 * Core hook that manages the socket lifecycle (connect, authenticate, reconnect).
 * Returns send/clear functions and the current stream state.
 *
 * ### `useAgentStream(socket, options?)`
 * Subscribes to `agent_response`, `internal_token`, `local_tool`, and
 * `context_cleared` events on an existing socket. Returns typed state:
 * `{ messages, internalTokens, pendingLocalTool, status }`.
 *
 * ### `AgentSocketProvider` + `useAgentSocketContext()`
 * React context wrapping a shared socket instance so all components in a
 * subtree share the same connection.
 *
 * ### `useLocalToolHandler(socket, tool_name, handler)`
 * Registers a per-tool handler that receives `local_tool` events for
 * `tool_name`, runs the provided `handler` function, and automatically
 * sends the `local_tool_response` back over the socket.
 *
 * @status SCAFFOLD — implementation pending
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type {
  AgentMessageRole,
  AgentMessage,
  ConnectionStatus,
  UseAgentStreamOptions,
  UseAgentStreamResult,
  LocalToolHandlerResult,
  AllowListDecision,
  AllowList,
  AllowListCheckMeta,
  InMemoryAllowListResult,
  // Protocol re-exports
  MessagePayload,
  LocalToolPayload,
  LocalToolResponsePayload,
  AgentResponsePayload,
  InternalTokenPayload,
  ContextClearedPayload,
  ErrorPayload,
  ClientToServerEvents,
  ServerToClientEvents,
} from "./types";

// ---------------------------------------------------------------------------
// Core hook
// ---------------------------------------------------------------------------
export { useAgentStream } from "./useAgentStream";

// ---------------------------------------------------------------------------
// Local tool hooks
// ---------------------------------------------------------------------------
export {
  useLocalToolHandler,
  useLocalToolFallback,
  type UseLocalToolHandlerOptions,
} from "./useLocalToolHandler";

// ---------------------------------------------------------------------------
// AllowList
// ---------------------------------------------------------------------------
export { useInMemoryAllowList } from "./useInMemoryAllowList";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
export {
  AgentStreamProvider,
  useAgentStreamContext,
  type AgentStreamProviderProps,
} from "./context";
