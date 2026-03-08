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
 *
 * State management uses @eetr/react-reducer-utils (bootstrapProvider).
 * The reducer owns the serializable state (pendingApprovals, rememberedTools);
 * promise resolvers and the AllowList instance live in refs in ToolApprovalInner.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type {
  AllowList,
  AllowListCheckMeta,
  AllowListDecision,
} from "@eetr/agent-streemr-react";
import { bootstrapProvider, type ReducerAction } from "@eetr/react-reducer-utils";

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
// Public types
// ---------------------------------------------------------------------------

export interface PendingApproval {
  /** Stable ID used to resolve the specific pending promise. */
  id: string;
  /** The tool being requested. */
  toolName: string;
  /** Arguments the agent is passing to the tool. */
  args: object;
  /** Server-side expiry (Unix ms). When past, the approval card is hidden and no response is sent (agent can retry). */
  expires_at?: number;
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
// Reducer
// ---------------------------------------------------------------------------

interface ToolApprovalState {
  pendingApprovals: PendingApproval[];
  rememberedTools: string[];
}

export enum ToolApprovalActionType {
  ADD_PENDING    = "ADD_PENDING",
  REMOVE_PENDING = "REMOVE_PENDING",
  REMEMBER_TOOL  = "REMEMBER_TOOL",
  FORGET_TOOL    = "FORGET_TOOL",
}

const initialState: ToolApprovalState = {
  pendingApprovals: [],
  rememberedTools: loadRemembered(),
};

function reducer(
  state: ToolApprovalState,
  action: ReducerAction<ToolApprovalActionType>,
): ToolApprovalState {
  switch (action.type) {
    case ToolApprovalActionType.ADD_PENDING:
      return { ...state, pendingApprovals: [...state.pendingApprovals, action.data as PendingApproval] };

    case ToolApprovalActionType.REMOVE_PENDING:
      return { ...state, pendingApprovals: state.pendingApprovals.filter((p) => p.id !== action.data) };

    case ToolApprovalActionType.REMEMBER_TOOL: {
      if (state.rememberedTools.includes(action.data as string)) return state;
      const next = [...state.rememberedTools, action.data as string];
      saveRemembered(next);
      return { ...state, rememberedTools: next };
    }

    case ToolApprovalActionType.FORGET_TOOL: {
      const next = state.rememberedTools.filter((t) => t !== action.data);
      saveRemembered(next);
      return { ...state, rememberedTools: next };
    }

    default:
      return state;
  }
}

const { Provider: StateProvider, useContextAccessors: useToolApprovalState } =
  bootstrapProvider<ToolApprovalState, ReducerAction<ToolApprovalActionType>>(reducer, initialState);

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToolApprovalContext = createContext<ToolApprovalContextValue | null>(null);

// ---------------------------------------------------------------------------
// Inner component — builds the full context value on top of reducer state
// ---------------------------------------------------------------------------

function ToolApprovalInner({ children }: { children: ReactNode }) {
  const { state, dispatch } = useToolApprovalState();

  // Promise resolvers keyed by approval id — not state, avoids re-renders
  const resolversRef = useRef<Map<string, (decision: AllowListDecision) => void>>(new Map());

  // Stable ref so the allowList closure always sees the latest remembered tools
  const rememberedToolsRef = useRef<string[]>(state.rememberedTools);
  useEffect(() => {
    rememberedToolsRef.current = state.rememberedTools;
  }, [state.rememberedTools]);

  const resolve = useCallback((id: string, decision: AllowListDecision) => {
    const fn = resolversRef.current.get(id);
    if (!fn) return;
    resolversRef.current.delete(id);
    dispatch({ type: ToolApprovalActionType.REMOVE_PENDING, data: id });
    fn(decision);
  }, [dispatch]);

  const approve = useCallback(
    (id: string, remember?: boolean) => {
      if (remember) {
        const entry = state.pendingApprovals.find((p) => p.id === id);
        if (entry) dispatch({ type: ToolApprovalActionType.REMEMBER_TOOL, data: entry.toolName });
      }
      resolve(id, "allowed");
    },
    [resolve, dispatch, state.pendingApprovals],
  );

  const deny = useCallback((id: string) => resolve(id, "denied"), [resolve]);

  const rememberTool = useCallback(
    (toolName: string) => dispatch({ type: ToolApprovalActionType.REMEMBER_TOOL, data: toolName }),
    [dispatch],
  );

  const forgetTool = useCallback(
    (toolName: string) => dispatch({ type: ToolApprovalActionType.FORGET_TOOL, data: toolName }),
    [dispatch],
  );

  // Keep a ref so the expiry interval always sees the latest pending list.
  const pendingApprovalsRef = useRef<PendingApproval[]>(state.pendingApprovals);
  pendingApprovalsRef.current = state.pendingApprovals;

  // When a pending approval passes its expires_at, resolve with "expired" and remove from UI (no response sent; agent can retry).
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      pendingApprovalsRef.current.forEach((p) => {
        if (p.expires_at != null && now >= p.expires_at) {
          resolve(p.id, "expired" as AllowListDecision);
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [resolve]);

  // Stable AllowList — check() reads refs so it never needs to be recreated
  const allowList = useMemo<AllowList>(
    () => ({
      check(
        toolName: string,
        args: object,
        meta?: AllowListCheckMeta
      ): Promise<AllowListDecision> {
        // Auto-approve remembered tools without showing a card
        if (rememberedToolsRef.current.includes(toolName)) {
          return Promise.resolve("allowed" as AllowListDecision);
        }
        return new Promise((resolveFn) => {
          const id = crypto.randomUUID();
          resolversRef.current.set(id, resolveFn);
          dispatch({
            type: ToolApprovalActionType.ADD_PENDING,
            data: { id, toolName, args, expires_at: meta?.expires_at },
          });
        });
      },
    }),
    [dispatch],
  );

  const value = useMemo(
    () => ({
      allowList,
      pendingApprovals: state.pendingApprovals,
      approve,
      deny,
      rememberedTools: state.rememberedTools,
      rememberTool,
      forgetTool,
    }),
    [allowList, state.pendingApprovals, approve, deny, state.rememberedTools, rememberTool, forgetTool],
  );

  return (
    <ToolApprovalContext.Provider value={value}>
      {children}
    </ToolApprovalContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToolApprovalProvider({ children }: { children: ReactNode }) {
  return (
    <StateProvider>
      <ToolApprovalInner>
        {children}
      </ToolApprovalInner>
    </StateProvider>
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
