// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module protocol/stream
 *
 * `AgentStreamEvent` union type and its constituent event types.
 * These are the typed events yielded by an agent's async generator and
 * consumed by `AgentStreamAdapter` to emit the corresponding socket events.
 *
 * Dependency tier: NONE — pure TypeScript types, no runtime code.
 */

/**
 * One token of the agent's reasoning stream.
 * Should be displayed in a "thinking" or "reasoning" panel — not as part
 * of the final reply shown to the user.
 */
export type InternalTokenEvent = {
  type: "internal_token";
  /** A chunk of the agent's internal reasoning. */
  token: string;
};

/**
 * One chunk (or the final completion) of the assistant's reply to the user.
 *
 * Streaming convention:
 * - Zero or more emissions with `chunk` set and `done: false`.
 * - Exactly one final emission with `done: true` (may also carry the last `chunk`).
 *
 * Note: the current reference implementation emits a single `done: true` event
 * containing the full accumulated reply rather than streaming chunks. Both
 * patterns are valid consumers of this type.
 */
export type AgentResponseEvent = {
  type: "agent_response";
  /** A chunk of the assistant's reply. May be absent on the final `done: true` emission. */
  chunk?: string;
  /** `true` on the last emission for this turn. */
  done: boolean;
};

/**
 * Discriminated union of all events an agent async generator may yield.
 *
 * Consumed by `AgentStreamAdapter.run()` which maps each variant to the
 * corresponding Socket.io emission:
 *
 * | Event type           | Socket.io event emitted   |
 * |----------------------|---------------------------|
 * | `internal_token`     | `internal_token`          |
 * | `agent_response`     | `agent_response`          |
 */
export type AgentStreamEvent =
  | InternalTokenEvent
  | AgentResponseEvent;
