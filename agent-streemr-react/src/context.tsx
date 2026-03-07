// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module context
 *
 * Optional React context wrapping `useAgentStream` so components throughout
 * a subtree can share a single socket connection and conversation state
 * without explicit prop drilling.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useAgentStream } from "./useAgentStream";
import type { UseAgentStreamOptions, UseAgentStreamResult } from "./types";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AgentStreamContext = createContext<UseAgentStreamResult | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type AgentStreamProviderProps = UseAgentStreamOptions & {
  children: ReactNode;
};

/**
 * Provides a shared `useAgentStream` instance to all descendant components.
 *
 * @example
 * ```tsx
 * <AgentStreamProvider url="http://localhost:8080" token={jwt}>
 *   <App />
 * </AgentStreamProvider>
 * ```
 */
export function AgentStreamProvider({
  children,
  url,
  token,
  socketOptions,
}: AgentStreamProviderProps) {
  const stream = useAgentStream({ url, token, socketOptions });

  return (
    <AgentStreamContext.Provider value={stream}>
      {children}
    </AgentStreamContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

/**
 * Returns the shared `useAgentStream` result from the nearest `AgentStreamProvider`.
 *
 * @throws if called outside of an `AgentStreamProvider`.
 *
 * @example
 * ```tsx
 * const { sendMessage, messages, status } = useAgentStreamContext();
 * ```
 */
export function useAgentStreamContext(): UseAgentStreamResult {
  const ctx = useContext(AgentStreamContext);
  if (ctx === null) {
    throw new Error(
      "useAgentStreamContext must be used inside an <AgentStreamProvider>."
    );
  }
  return ctx;
}
