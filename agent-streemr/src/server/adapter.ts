// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module server/adapter
 *
 * `AgentStreamAdapter` — maps `AgentStreamEvent` values from an async generator
 * to the corresponding Socket.io emissions on a connected socket.
 *
 * Dependency tier: `protocol/stream` (types), `socket.io` (Server-side Socket).
 *
 * @example
 * ```ts
 * import { AgentStreamAdapter } from "@eetr/agent-streemr/server/adapter";
 *
 * async function runAgent(socket: Socket, stream: AsyncIterable<AgentStreamEvent>) {
 *   const adapter = new AgentStreamAdapter(socket);
 *   await adapter.run(stream);
 * }
 * ```
 */

import type { Socket } from "socket.io";
import type { AgentStreamEvent } from "../protocol/stream";

/**
 * Bridges an `AsyncIterable<AgentStreamEvent>` (from any LangChain/LangGraph
 * agent organised around the `AgentStreamEvent` union) to the agent-streemr
 * Socket.io protocol.
 *
 * ### Event mapping
 *
 * | `AgentStreamEvent.type` | Socket.io event emitted |
 * |-------------------------|-------------------------|
 * | `topic_name`            | `topic_name`            |
 * | `internal_token`        | `internal_token`        |
 * | `agent_response`        | `agent_response`        |
 * | `response_reference`    | `response_reference`    |
 *
 * All emissions are point-to-point (`socket.emit`) — no broadcasts.
 */
export class AgentStreamAdapter {
  private readonly _socket: Socket;

  /**
   * @param socket The connected Socket.io socket for the current client.
   */
  constructor(socket: Socket) {
    this._socket = socket;
  }

  /**
   * Iterates `stream` and emits the corresponding Socket.io event for each
   * `AgentStreamEvent` yielded.
   *
   * Runs to completion. Any error thrown by the stream propagates to the caller
   * so it can be caught and emitted as a socket `error` event.
   *
   * @example
   * ```ts
   * try {
   *   await adapter.run(agentStream);
   * } catch (err) {
   *   socket.emit("error", { message: String(err) });
   * }
   * ```
   */
  async run(stream: AsyncIterable<AgentStreamEvent>): Promise<void> {
    for await (const event of stream) {
      switch (event.type) {
        case "topic_name":
          this._socket.emit("topic_name", { name: event.name });
          break;
        case "internal_token":
          this._socket.emit("internal_token", { token: event.token });
          break;
        case "agent_response":
          this._socket.emit("agent_response", { chunk: event.chunk, done: event.done });
          break;
        case "response_reference":
          this._socket.emit("response_reference", {
            refType: event.refType,
            slug: event.slug,
            title: event.title,
          });
          break;
      }
    }
  }
}
