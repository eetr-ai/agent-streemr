// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module useAgentStream
 *
 * Core React hook for managing a Socket.io connection to an agent-streemr server.
 * Owns the full connection lifecycle and exposes a deferred `connect(threadId)`
 * so callers can wait until auth/identity is resolved before opening the socket.
 */

import { useCallback, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@eetr/agent-streemr";
import type {
  AgentMessage,
  ConnectionStatus,
  UseAgentStreamOptions,
  UseAgentStreamResult,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type AgentSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Core hook for connecting a React application to an agent-streemr server.
 *
 * @example
 * ```tsx
 * const { connect, sendMessage, messages, status, internalThought } = useAgentStream({
 *   url: "http://localhost:8080",
 *   token: authToken,
 * });
 *
 * useEffect(() => { connect(deviceId); }, [deviceId]);
 * ```
 */
export function useAgentStream(options: UseAgentStreamOptions): UseAgentStreamResult {
  const { url, token, socketOptions } = options;

  // Stable ref — changes do NOT trigger re-renders.
  const socketRef = useRef<AgentSocket | null>(null);

  // React state that drives UI updates.
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [internalThought, setInternalThought] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Attach all server-event listeners to a freshly created socket.
  // ---------------------------------------------------------------------------
  const attachListeners = useCallback((socket: AgentSocket) => {
    socket.on("connect", () => {
      setStatus("connected");
      setError(null);
    });

    socket.on("disconnect", () => {
      setStatus("disconnected");
      setIsStreaming(false);
    });

    socket.on("connect_error", (err) => {
      setStatus("error");
      setError(err.message);
      setIsStreaming(false);
    });

    socket.on("internal_token", ({ token: chunk }) => {
      setInternalThought((prev) => prev + chunk);
    });

    socket.on("agent_response", ({ chunk, done }) => {
      setIsStreaming(!done);

      setMessages((prev) => {
        // Find the last assistant message that is still streaming.
        const lastIdx = prev.length - 1;
        const last = prev[lastIdx];

        if (last && last.role === "assistant" && last.streaming) {
          // Append chunk to existing streaming message.
          const updated: AgentMessage = {
            ...last,
            content: last.content + (chunk ?? ""),
            streaming: !done,
          };
          return [...prev.slice(0, lastIdx), updated];
        }

        // No in-flight assistant message — start a new one.
        const newMsg: AgentMessage = {
          id: randomId(),
          role: "assistant",
          content: chunk ?? "",
          streaming: !done,
        };
        return [...prev, newMsg];
      });
    });

    socket.on("context_cleared", () => {
      setMessages([]);
      setInternalThought("");
      setIsStreaming(false);
      setError(null);
    });

    socket.on("error", ({ message }) => {
      setError(message);
      setIsStreaming(false);
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Tear down the current socket (if any) without resetting conversation state.
  // ---------------------------------------------------------------------------
  const detachSocket = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.removeAllListeners();
    socket.disconnect();
    socketRef.current = null;
  }, []);

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const connect = useCallback(
    (threadId: string) => {
      // Tear down any existing socket first (allows reconnect with new threadId).
      detachSocket();
      setStatus("connecting");
      setError(null);

      const socket: AgentSocket = io(url, {
        ...socketOptions,
        auth: {
          token,
          installation_id: threadId,
        },
      });

      socketRef.current = socket;
      attachListeners(socket);
    },
    [url, token, socketOptions, attachListeners, detachSocket]
  );

  const disconnect = useCallback(() => {
    detachSocket();
    setMessages([]);
    setInternalThought("");
    setIsStreaming(false);
    setError(null);
    setStatus("disconnected");
  }, [detachSocket]);

  const sendMessage = useCallback((text: string, topicName?: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    // Optimistic user message.
    const userMsg: AgentMessage = {
      id: randomId(),
      role: "user",
      content: text,
      streaming: false,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInternalThought("");

    socket.emit("message", topicName ? { text, topic_name: topicName } : { text });
  }, []);

  const clearContext = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit("clear_context");
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setContext = useCallback((data: Record<string, any>) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit("set_context", { data });
  }, []);

  return {
    connect,
    disconnect,
    sendMessage,
    clearContext,
    setContext,
    messages,
    status,
    internalThought,
    isStreaming,
    error,
    socket: socketRef.current,
  };
}
