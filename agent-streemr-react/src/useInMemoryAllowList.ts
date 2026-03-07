// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module useInMemoryAllowList
 *
 * A React hook that maintains an in-memory allowlist for local tool requests.
 * Pass the returned `allowList` object to `useLocalToolHandler` to gate tool
 * execution based on user-configured permissions.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { AllowList, AllowListDecision, InMemoryAllowListResult } from "./types";

/**
 * Manages an in-memory per-tool allowlist backed by React state.
 *
 * Tools not present in the list resolve as `"unknown"` (treated as denied by
 * `useLocalToolHandler`). Tools explicitly set with `allow()` resolve as
 * `"allowed"`, and tools explicitly set with `deny()` resolve as `"denied"`.
 *
 * The `entries` field can be used to render a live permissions UI.
 *
 * @example
 * ```tsx
 * const { allowList, allow, entries } = useInMemoryAllowList();
 *
 * // Grant the user a chance to approve before any tool runs:
 * // useLocalToolHandler(socket, "read_file", handler, { allowList });
 * ```
 */
export function useInMemoryAllowList(): InMemoryAllowListResult {
  // Map: toolName → true (allowed) | false (denied)
  const [entries, setEntries] = useState<Record<string, boolean>>({});

  // Keep a stable ref to entries so the AllowList.check method sees current
  // values without needing to be recreated every render.
  const entriesRef = useRef<Record<string, boolean>>(entries);
  entriesRef.current = entries;

  const allow = useCallback((toolName: string) => {
    setEntries((prev) => ({ ...prev, [toolName]: true }));
  }, []);

  const deny = useCallback((toolName: string) => {
    setEntries((prev) => ({ ...prev, [toolName]: false }));
  }, []);

  const remove = useCallback((toolName: string) => {
    setEntries((prev) => {
      const next = { ...prev };
      delete next[toolName];
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries({});
  }, []);

  // The AllowList object is stable across renders (useMemo with no deps that
  // change) — it reads live values via entriesRef.
  const allowList = useMemo<AllowList>(
    () => ({
      check(toolName: string): AllowListDecision {
        const value = entriesRef.current[toolName];
        if (value === undefined) return "unknown";
        return value ? "allowed" : "denied";
      },
    }),
    []
  );

  return { allowList, allow, deny, remove, clear, entries };
}
