// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * ToolApprovalContext
 *
 * Provides an interactive AllowList whose check() suspends each tool call
 * until the user clicks Allow or Deny in the chat UI.
 *
 * Usage:
 *   - Wrap the app in <ToolApprovalProvider>
 *   - Call useToolApproval() to access allowList, pendingApprovals, approve, deny
 *   - Pass allowList to useLocalToolHandler (via useRecipeTools)
 *   - Render <ToolApprovalCard> for each pendingApprovals entry in the chat
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AllowList, AllowListDecision } from "@eetr/agent-streemr-react";

const LS_KEY = "agent-streemr:allowlist";

function loadRemembered(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRemembered(tools: string[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(tools));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingApproval {
  /** Stable ID used to resolve the specific pending promise. */
  id: string;
  /** The tool being requested. */
  toolName: string;
  /** Arguments the agent is passing to the tool. */
  args: object;
}

interface ToolApprovalContextValue {
  /** Pass this to useLocalToolHandler options.allowList */
  allowList: AllowList;
  /** Current pending approvals waiting for user action */
  pendingApprovals: PendingApproval[];
  /** Resolve a pending approval as allowed (optionally persist the tool name) */
  approve: (id: string, remember?: boolean) => void;
  /** Resolve a pending approval as denied */
  deny: (id: string) => void;
  /** Tool names the user has permanently allowed */
  rememberedTools: string[];
  /** Add a tool name to the persistent allow list */
  rememberTool: (toolName: string) => void;
  /** Remove a tool name from the persistent allow list */
  forgetTool: (toolName: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToolApprovalContext = createContext<ToolApprovalContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToolApprovalProvider({ children }: { children: ReactNode }) {
  // Renderable pending list (React state)
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);

  // Persistent remembered tools (localStorage-backed state)
  const [rememberedTools, setRememberedTools] = useState<string[]>(loadRemembered);

  const rememberTool = useCallback((toolName: string) => {
    setRememberedTools((prev) => {
      if (prev.includes(toolName)) return prev;
      const next = [...prev, toolName];
      saveRemembered(next);
      return next;
    });
  }, []);

  const forgetTool = useCallback((toolName: string) => {
    setRememberedTools((prev) => {
      const next = prev.filter((t) => t !== toolName);
      saveRemembered(next);
      return next;
    });
  }, []);

  // Resolver functions keyed by approval id (ref — not state, avoids re-renders)
  const resolversRef = useRef<Map<string, (decision: AllowListDecision) => void>>(new Map());

  // Keep a ref to the latest rememberedTools so the stable allowList closure can read it
  const rememberedToolsRef = useRef<string[]>(rememberedTools);
  useEffect(() => {
    rememberedToolsRef.current = rememberedTools;
  }, [rememberedTools]);

  const resolve = useCallback((id: string, decision: AllowListDecision) => {
    const fn = resolversRef.current.get(id);
    if (!fn) return;
    resolversRef.current.delete(id);
    setPendingApprovals((prev) => prev.filter((p) => p.id !== id));
    fn(decision);
  }, []);

  const approve = useCallback(
    (id: string, remember?: boolean) => {
      if (remember) {
        // Find tool name from pending list before resolving
        setPendingApprovals((prev) => {
          const entry = prev.find((p) => p.id === id);
          if (entry) rememberTool(entry.toolName);
          return prev; // actual removal happens in resolve()
        });
      }
      resolve(id, "allowed");
    },
    [resolve, rememberTool]
  );

  const deny = useCallback((id: string) => resolve(id, "denied"), [resolve]);

  // The AllowList instance is stable — check() closes over refs so it always
  // sees the latest state without being recreated per render.
  const allowList = useMemo<AllowList>(
    () => ({
      check(toolName: string, args: object): Promise<AllowListDecision> {
        // Auto-approve remembered tools without showing a card
        if (rememberedToolsRef.current.includes(toolName)) {
          return Promise.resolve("allowed" as AllowListDecision);
        }
        return new Promise((resolveFn) => {
          const id = crypto.randomUUID();
          resolversRef.current.set(id, resolveFn);
          setPendingApprovals((prev) => [...prev, { id, toolName, args }]);
        });
      },
    }),
    []
  );

  const value = useMemo(
    () => ({ allowList, pendingApprovals, approve, deny, rememberedTools, rememberTool, forgetTool }),
    [allowList, pendingApprovals, approve, deny, rememberedTools, rememberTool, forgetTool]
  );

  return (
    <ToolApprovalContext.Provider value={value}>
      {children}
    </ToolApprovalContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToolApproval(): ToolApprovalContextValue {
  const ctx = useContext(ToolApprovalContext);
  if (!ctx) {
    throw new Error("useToolApproval must be used inside <ToolApprovalProvider>");
  }
  return ctx;
}
