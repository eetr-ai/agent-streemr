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
  LocalToolResponseAckPayload,
  LocalToolResponsePayload,
  ServerToClientEvents,
} from "@eetr/agent-streemr";
import type { AllowList, LocalToolHandlerResult } from "./types";

type AgentSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Stores a pending response and its retry timer while waiting for an ack. */
type PendingAck = {
  timer: ReturnType<typeof setTimeout>;
  responsePayload: LocalToolResponsePayload;
};

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
  /**
   * When `true` (default), the hook automatically re-emits the last
   * `local_tool_response` once if no `local_tool_response_ack` arrives from
   * the server before the tool's `expires_at` window closes (minus a 1-second
   * safety buffer).
   *
   * Only active for `"sync"` and `"async"` tools that carry an `expires_at`
   * timestamp. Set to `false` to opt out of automatic retry.
   */
  retryOnNoAck?: boolean;
};

/**
 * Registers a handler for `local_tool` events matching `toolName`.
 *
 * The hook attaches a `local_tool` listener and a `local_tool_response_ack`
 * listener on the socket. When a `local_tool` event arrives:
 *
 * 1. If the `tool_name` doesn't match, do nothing.
 * 2. If `expires_at` is present and `Date.now() >= expires_at`, the server has
 *    already given up — skip silently.
 * 3. If an `allowList` is provided, `check()` is awaited for all tool types
 *    (including fire_and_forget). A `"denied"` or `"unknown"` decision: for
 *    sync/async emits `{ allowed: false }` and returns; for fire_and_forget
 *    just returns (no response is sent).
 * 4. If `tool_type === "fire_and_forget"`, invoke the handler for side effects
 *    and return without emitting any response.
 * 5. The `handler` is called and the result is emitted as `local_tool_response`.
 * 6. If `retryOnNoAck` is `true` (default) and `expires_at` is present, a
 *    single retry is scheduled: if no `local_tool_response_ack` arrives before
 *    `expires_at − 1 s`, the same response is re-emitted once.
 *
 * On `local_tool_response_ack`: cancels the pending retry timer for that
 * `request_id`.
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

  const retryOnNoAckRef = useRef<boolean>(options.retryOnNoAck ?? true);
  retryOnNoAckRef.current = options.retryOnNoAck ?? true;

  // Map of pending acknowledgement timers keyed by request_id.
  const pendingAcksRef = useRef<Map<string, PendingAck>>(new Map());

  useEffect(() => {
    if (!socket) return;

    const onLocalTool = async (payload: LocalToolPayload) => {
      // Only handle events for the registered tool name.
      if (payload.tool_name !== toolNameRef.current) return;

      const { request_id, tool_name, args_json } = payload;
      const isFireAndForget = payload.tool_type === "fire_and_forget";

      // Expiry gate: if the server has already moved on, skip entirely.
      if (payload.expires_at !== undefined && Date.now() >= payload.expires_at) {
        return;
      }

      // Allowlist gate (applies to all tool types, including fire_and_forget).
      const allowList = allowListRef.current;
      if (allowList) {
        const meta =
          payload.expires_at !== undefined ? { expires_at: payload.expires_at } : undefined;
        const decision = await allowList.check(tool_name, args_json, meta);
        if (decision !== "allowed") {
          // "expired" → do not emit; agent can retry. "denied" / "unknown" → emit allowed: false for sync/async.
          if (decision !== "expired" && !isFireAndForget) {
            socket.emit("local_tool_response", {
              request_id,
              tool_name,
              allowed: false,
            });
          }
          return;
        }
      }

      // Fire-and-forget: invoke the handler for side effects but never reply.
      if (isFireAndForget) {
        try {
          await handlerRef.current(args_json);
        } catch {
          // Errors are silently swallowed — there is no response channel.
        }
        return;
      }

      // Call the handler and emit the response.
      let responsePayload: LocalToolResponsePayload;
      try {
        const result = await handlerRef.current(args_json);
        responsePayload = { request_id, tool_name, ...result } as LocalToolResponsePayload;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        responsePayload = { request_id, tool_name, error: true as const, errorMessage };
      }

      socket.emit("local_tool_response", responsePayload);

      // Ack-based retry: if no ack arrives before expires_at − 1 s, re-send once.
      if (retryOnNoAckRef.current && payload.expires_at !== undefined) {
        const retryMs = payload.expires_at - Date.now() - 1_000;
        if (retryMs > 0) {
          const storedPayload = responsePayload;
          const timer = setTimeout(() => {
            pendingAcksRef.current.delete(request_id);
            socket.emit("local_tool_response", storedPayload);
          }, retryMs);
          pendingAcksRef.current.set(request_id, { timer, responsePayload });
        }
      }
    };

    const onAck = (ackPayload: LocalToolResponseAckPayload) => {
      const pending = pendingAcksRef.current.get(ackPayload.request_id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingAcksRef.current.delete(ackPayload.request_id);
      }
    };

    socket.on("local_tool", onLocalTool);
    socket.on("local_tool_response_ack", onAck);
    return () => {
      socket.off("local_tool", onLocalTool);
      socket.off("local_tool_response_ack", onAck);
      // Cancel all pending retry timers to avoid stale emissions after unmount.
      for (const { timer } of pendingAcksRef.current.values()) {
        clearTimeout(timer);
      }
      pendingAcksRef.current.clear();
    };
  }, [socket]);
}

/**
 * Registers a catch-all `local_tool` listener that auto-replies
 * `{ notSupported: true }` for **any** tool event that has no other handler.
 *
 * `"fire_and_forget"` events are silently skipped — they require no reply.
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
      // Fire-and-forget tools do not require a response — skip silently.
      if (payload.tool_type === "fire_and_forget") return;

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
