// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module agent-streemr
 *
 * Public API barrel for `@eetr/agent-streemr`.
 *
 * You can import directly from sub-paths for tree-shaking / dependency-tier
 * clarity, or import everything from this barrel when convenience matters more.
 *
 * ```ts
 * // Barrel (everything)
 * import { createAgentSocketListener, createLocalTool, parseLocalToolResponseEnvelope } from "@eetr/agent-streemr";
 *
 * // Sub-path (tree-shaking / strict dependency tiers)
 * import { parseLocalToolResponseEnvelope } from "@eetr/agent-streemr/protocol/localTool";
 * ```
 */

// ---------------------------------------------------------------------------
// protocol/events — socket payload types (no runtime deps)
// ---------------------------------------------------------------------------
export type {
  MessagePayload,
  LocalToolResponsePayload,
  ClearContextPayload,
  InternalTokenPayload,
  LocalToolPayload,
  AgentResponsePayload,
  ContextClearedPayload,
  ErrorPayload,
  ClientToServerEvents,
  ServerToClientEvents,
} from "./protocol/events";

// ---------------------------------------------------------------------------
// protocol/localTool — envelope types + parser (no runtime deps)
// ---------------------------------------------------------------------------
export type {
  LocalToolResponseStatus,
  LocalToolResponseEnvelope,
  ParsedLocalToolResponseEnvelope,
} from "./protocol/localTool";
export { parseLocalToolResponseEnvelope } from "./protocol/localTool";

// ---------------------------------------------------------------------------
// protocol/stream — AgentStreamEvent union (no runtime deps)
// ---------------------------------------------------------------------------
export type {
  AgentStreamEvent,
  TopicNameEvent,
  InternalTokenEvent,
  AgentResponseEvent,
  ResponseReferenceEvent,
} from "./protocol/stream";

// ---------------------------------------------------------------------------
// server/queue — per-thread task serialisation
// ---------------------------------------------------------------------------
export { ThreadQueue } from "./server/queue";

// ---------------------------------------------------------------------------
// server/registry — LocalToolRegistry + processor type
// ---------------------------------------------------------------------------
export type {
  LocalToolResponseProcessor,
  TrackEmitResult,
  HandledToolKind,
  HandleResponseResult,
  HandleResponseOutcome,
} from "./server/registry";
export { LocalToolRegistry } from "./server/registry";

// ---------------------------------------------------------------------------
// server/adapter — AgentStreamEvent → socket.emit bridge
// ---------------------------------------------------------------------------
export { AgentStreamAdapter } from "./server/adapter";

// ---------------------------------------------------------------------------
// server/listener — main wiring factory
// ---------------------------------------------------------------------------
export type {
  AuthResult,
  LocalToolEmitType,
  EmitLocalToolFn,
  AgentRunner,
  CreateAgentSocketListenerOptions,
} from "./server/listener";
export { createAgentSocketListener } from "./server/listener";

// ---------------------------------------------------------------------------
// langchain/localTool — createLocalTool factory + configurable key constants
// ---------------------------------------------------------------------------
export type {
  LocalToolMode,
  CreateLocalToolOptions,
} from "./langchain/localTool";
export {
  createLocalTool,
  EMIT_LOCAL_TOOL_KEY,
  SYNC_REGISTRY_KEY,
} from "./langchain/localTool";
