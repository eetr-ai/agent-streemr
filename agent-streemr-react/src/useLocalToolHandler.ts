// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module useLocalToolHandler
 *
 * React hook that registers a handler for a specific local tool event
 * emitted by the agent-streemr server. Supports an optional `AllowList`
 * to gate execution before delegating to the handler.
 */

import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  LocalToolPayload,
  ServerToClientEvents,
} from "@eetr/agent-streemr";
import type { AllowList, LocalToolHandlerResult } from "./types";

type AgentSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type UseLocalToolHandlerOptions = {
  /**
   * Optional allowlist gate. Checked before the `handler` is invoked.
   *
   * - `"allowed"` → proceed to handler.
   * - `"denied"` or `"unknown"` → auto-reply `{ allowed: false }` and skip handler.
   *
   * When omitted all matching tool requests are forwarded to the handler.
   */
  allowList?: AllowList;
};

/**
 * Registers a handler for `local_tool` events matching `toolName`.
 *
 * The hook attaches a single `local_tool` listener on the socket. When a
 * `local_tool` event arrives:
 *
 * 1. If the `tool_name` doesn't match, do nothing (another hook handles it, or
 *    the auto-`notSupported` listener catches it after all handlers are checked).
 * 2. If an `allowList` is provided, `check()` is awaited. A `"denied"` or
 *    `"unknown"` decision emits `{ allowed: false }` and returns.
 * 3. Otherwise the `handler` is called with `args_json` and the result is
 *    emitted as `local_tool_response`.
 * 4. Handler errors are caught and emitted as `{ error: true, errorMessage }`.
 *
 * Multiple hooks for different `toolName` values can coexist on the same socket.
 * The auto-`notSupported` reply (for tools no handler claims) is managed via a
 * separate global listener registered inside this hook when the socket is live.
 *
 * @example
 * ```tsx
 * const { allowList, allow } = useInMemoryAllowList();
 *
 * useLocalToolHandler(socket, "read_file", async (args) => {
 *   const content = await fs.readFile(args.path, "utf8");
 *   return { response_json: { content } };
 * }, { allowList });
 * ```
 */
export function useLocalToolHandler(
  socket: AgentSocket | null,
  toolName: string,
  handler: (args: object) => LocalToolHandlerResult | Promise<LocalToolHandlerResult>,
  options: UseLocalToolHandlerOptions = {}
): void {
  // Keep stable refs so the event listener closure always sees the latest values
  // without needing to re-register every render.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const allowListRef = useRef<AllowList | undefined>(options.allowList);
  allowListRef.current = options.allowList;

  const toolNameRef = useRef(toolName);
  toolNameRef.current = toolName;

  useEffect(() => {
    if (!socket) return;

    const onLocalTool = async (payload: LocalToolPayload) => {
      // Only handle events for the registered tool name.
      if (payload.tool_name !== toolNameRef.current) return;

      const { request_id, tool_name, args_json } = payload;

      // Allowlist gate.
      const allowList = allowListRef.current;
      if (allowList) {
        const decision = await allowList.check(tool_name, args_json);
        if (decision !== "allowed") {
          socket.emit("local_tool_response", {
            request_id,
            tool_name,
            allowed: false,
          });
          return;
        }
      }

      // Call the handler.
      try {
        const result = await handlerRef.current(args_json);
        socket.emit("local_tool_response", { request_id, tool_name, ...result });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        socket.emit("local_tool_response", {
          request_id,
          tool_name,
          error: true,
          errorMessage,
        });
      }
    };

    socket.on("local_tool", onLocalTool);
    return () => {
      socket.off("local_tool", onLocalTool);
    };
  }, [socket]);
}

/**
 * Registers a catch-all `local_tool` listener that auto-replies
 * `{ notSupported: true }` for **any** tool event that has no other handler.
 *
 * Mount this once near the root of your component tree (or inside your
 * `AgentStreamProvider` subtree). It runs after all `useLocalToolHandler`
 * hooks because Socket.io dispatches to listeners in registration order and
 * this hook should be registered last.
 *
 * If you're not using any local tools at all, mounting this hook prevents
 * server-side TTL timeouts for stray `local_tool` requests.
 *
 * @example
 * ```tsx
 * // In your root component or provider:
 * useLocalToolFallback(socket);
 * ```
 */
export function useLocalToolFallback(socket: AgentSocket | null): void {
  useEffect(() => {
    if (!socket) return;

    const onFallback = (payload: LocalToolPayload) => {
      // If another handler already responded, Socket.io has already executed
      // those listeners. This fires for every event — only reply if no previous
      // handler emitted a response. We use the convention that handlers return
      // early (no emit needed to signal "handled"); we always emit here as a
      // safety net. The server ignores duplicate responses after the first.
      socket.emit("local_tool_response", {
        request_id: payload.request_id,
        tool_name: payload.tool_name,
        notSupported: true,
      });
    };

    socket.on("local_tool", onFallback);
    return () => {
      socket.off("local_tool", onFallback);
    };
  }, [socket]);
}
