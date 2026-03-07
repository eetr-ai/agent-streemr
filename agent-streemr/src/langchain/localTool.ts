// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module langchain/localTool
 *
 * `createLocalTool` — factory that produces a LangChain `DynamicStructuredTool`
 * wired for the agent-streemr local-tool protocol, eliminating the per-tool
 * `config.configurable` boilerplate found in the reference implementation.
 *
 * Dependency tier: `@langchain/core` (peer) + `protocol/` (types only).
 *
 * ### Keys injected via `config.configurable`
 *
 * The listener and your agent setup must inject these keys into
 * `config.configurable` before calling `agent.stream(...)`:
 *
 * | Key constant                       | Type                         | Required for        |
 * |------------------------------------|------------------------------|---------------------|
 * | `EMIT_LOCAL_TOOL_KEY`              | `EmitLocalToolFn`            | `async`, `sync`     |
 * | `EMIT_LOCAL_TOOL_FIRE_FORGET_KEY`  | `EmitFireAndForgetFn`        | `fire_and_forget`   |
 * | `SYNC_REGISTRY_KEY`                | `SyncAwaitable`              | `sync`              |
 *
 * In `createAgentSocketListener`, these are injected automatically.
 * When building a custom runner, inject them yourself:
 *
 * ```ts
 * const config = {
 *   configurable: {
 *     thread_id: threadId,
 *     [EMIT_LOCAL_TOOL_KEY]: emitLocalTool,
 *     [EMIT_LOCAL_TOOL_FIRE_FORGET_KEY]: emitLocalToolFireAndForget,
 *     [SYNC_REGISTRY_KEY]: localToolRegistry,
 *   },
 * };
 * ```
 *
 * @example Async tool (default)
 * ```ts
 * const myTool = createLocalTool({
 *   tool_name: "get_prefs",
 *   schema: z.object({ fields: z.array(z.string()) }),
 *   buildRequest: (args) => ({ fields: args.fields }),
 *   description: "Fetch user preferences from the client.",
 * });
 * ```
 *
 * @example Sync tool (awaits client response before returning to LangChain)
 * ```ts
 * const syncTool = createLocalTool({
 *   tool_name: "confirm_action",
 *   schema: z.object({ action: z.string() }),
 *   buildRequest: (args) => ({ action: args.action }),
 *   description: "Ask the user to confirm an action and wait for their reply.",
 *   mode: "sync",
 *   ttlMs: 20_000,
 * });
 * ```
 *
 * @example Fire-and-forget tool
 * ```ts
 * const notifyTool = createLocalTool({
 *   tool_name: "notify_client",
 *   schema: z.object({ message: z.string() }),
 *   buildRequest: (args) => ({ message: args.message }),
 *   description: "Push a one-way notification to the client.",
 *   mode: "fire_and_forget",
 * });
 * ```
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { ZodSchema } from "zod";

// ---------------------------------------------------------------------------
// Configurable keys (must match the keys injected by the listener / runner)
// ---------------------------------------------------------------------------

/**
 * Key in `RunnableConfig.configurable` for the tracked `local_tool` emitter.
 * Value type: `EmitLocalToolFn` (returns `request_id`).
 * Required for `async` and `sync` modes.
 */
export const EMIT_LOCAL_TOOL_KEY = "__emitLocalTool" as const;

/**
 * Key in `RunnableConfig.configurable` for the **fire-and-forget** `local_tool` emitter.
 * Value type: `EmitFireAndForgetFn` (returns `void`).
 * Required for `fire_and_forget` mode.
 */
export const EMIT_LOCAL_TOOL_FIRE_FORGET_KEY = "__emitLocalToolFireAndForget" as const;

/**
 * Key in `RunnableConfig.configurable` for the `LocalToolRegistry` instance.
 * Typed as `SyncAwaitable` to avoid a hard dependency on `server/registry`.
 * Required for `sync` mode.
 */
export const SYNC_REGISTRY_KEY = "__syncRegistry" as const;

// ---------------------------------------------------------------------------
// Minimal interface for sync-mode registry access (duck typing)
// Keeps `langchain/` free of a hard dependency on `server/`.
// ---------------------------------------------------------------------------

/** Minimal interface the sync tool needs from `LocalToolRegistry`. */
interface SyncAwaitable {
  awaitResponse(args: {
    threadId: string;
    request_id: string;
    tool_name: string;
    ttlMs: number;
  }): Promise<{
    status: string;
    responseJson?: object;
    errorMessage?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Callback type aliases (must match the listener's function signatures)
// ---------------------------------------------------------------------------

/** Tracked `local_tool` emitter — returns the `request_id`. */
type EmitLocalToolFn = (payload: { tool_name: string; args_json: object }) => string;
/** Untracked `local_tool` emitter — no response expected. */
type EmitFireAndForgetFn = (payload: { tool_name: string; args_json: object }) => void;

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/** Execution mode for the local tool. */
export type LocalToolMode = "async" | "sync" | "fire_and_forget";

/** Options for `createLocalTool`. */
export type CreateLocalToolOptions<TArgs, TRequest extends object> = {
  /**
   * The single canonical tool name used in both the LangChain tool registry
   * and the socket protocol (`tool_name` field in `local_tool` / `local_tool_response`).
   */
  tool_name: string;
  /** Zod schema describing the tool's input arguments as LangChain sees them. */
  schema: ZodSchema<TArgs>;
  /**
   * Maps the validated LangChain input `args` to the `args_json` object sent
   * to the client inside the `local_tool` socket event.
   */
  buildRequest: (args: TArgs) => TRequest;
  /** Human-readable description shown to the LLM in the tool list. */
  description: string;
  /**
   * Execution mode. Defaults to `"async"`.
   *
   * - `"async"` — emit request, return placeholder immediately; the listener
   *   processes the `local_tool_response` and re-enqueues a follow-up turn.
   * - `"sync"` — emit request, then `await` the client response before returning
   *   to LangChain. Requires `SYNC_REGISTRY_KEY` and `EMIT_LOCAL_TOOL_KEY` in
   *   `config.configurable`. Timeout resolves as `{ status: "error" }`.
   * - `"fire_and_forget"` — emit request with no response tracking. Requires
   *   `EMIT_LOCAL_TOOL_FIRE_FORGET_KEY` in `config.configurable`.
   */
  mode?: LocalToolMode;
  /**
   * TTL in milliseconds for sync mode. If the client does not respond within
   * this window the awaited promise resolves with `{ status: "error", errorMessage: "timeout" }`.
   * Defaults to 30 000 (30 s). Ignored for other modes.
   */
  ttlMs?: number;
  /**
   * Placeholder string returned to LangChain in async mode while waiting for
   * the client response. The LLM sees this value; make it instructive.
   * Defaults to a generic "waiting" message.
   */
  asyncPlaceholder?: string;
  /**
   * String returned to LangChain in fire-and-forget mode.
   * Defaults to `"Request sent to client."`.
   */
  fireAndForgetPlaceholder?: string;
};

/**
 * Creates a `DynamicStructuredTool` that delegates execution to the client
 * over the agent-streemr socket protocol.
 *
 * @see {@link CreateLocalToolOptions} for full option documentation.
 */
export function createLocalTool<TArgs, TRequest extends object>(
  options: CreateLocalToolOptions<TArgs, TRequest>
): DynamicStructuredTool {
  const {
    tool_name,
    schema,
    buildRequest,
    description,
    mode = "async",
    ttlMs = 30_000,
    asyncPlaceholder = "This is a local tool call. Wait for the client reply before continuing — say you will look into it and come back.",
    fireAndForgetPlaceholder = "Request sent to client.",
  } = options;

  const name = tool_name.trim();
  if (!name) throw new Error("tool_name must be a non-empty string");

  return new DynamicStructuredTool({
    name,
    description,
    schema,
    func: async (args: TArgs, _runManager?: unknown, config?: RunnableConfig): Promise<string> => {
      const configurable = (config?.configurable ?? {}) as Record<string, unknown>;
      const threadId = (configurable.thread_id as string | undefined) ?? "";
      const argsJson = buildRequest(args);

      switch (mode) {
        // -------------------------------------------------------------------
        case "async": {
          const emit = configurable[EMIT_LOCAL_TOOL_KEY] as EmitLocalToolFn | undefined;
          if (typeof emit !== "function") {
            console.warn(
              `[agent-streemr] createLocalTool "${name}": EMIT_LOCAL_TOOL_KEY not found in config.configurable. ` +
              "Ensure the tool is used inside a createAgentSocketListener runner."
            );
            return asyncPlaceholder;
          }
          emit({ tool_name: name, args_json: argsJson });
          return asyncPlaceholder;
        }

        // -------------------------------------------------------------------
        case "sync": {
          const emit = configurable[EMIT_LOCAL_TOOL_KEY] as EmitLocalToolFn | undefined;
          const registry = configurable[SYNC_REGISTRY_KEY] as SyncAwaitable | undefined;

          if (typeof emit !== "function" || !registry) {
            console.warn(
              `[agent-streemr] createLocalTool "${name}" (sync): EMIT_LOCAL_TOOL_KEY or SYNC_REGISTRY_KEY ` +
              "not found in config.configurable. Ensure the tool is used inside a createAgentSocketListener runner."
            );
            return JSON.stringify({ status: "error", errorMessage: "registry not available" });
          }
          if (!threadId) {
            console.warn(`[agent-streemr] createLocalTool "${name}" (sync): thread_id not found in config.configurable.`);
            return JSON.stringify({ status: "error", errorMessage: "threadId not available" });
          }

          const request_id = emit({ tool_name: name, args_json: argsJson });
          const result = await registry.awaitResponse({ threadId, request_id, tool_name: name, ttlMs });
          return JSON.stringify(result);
        }

        // -------------------------------------------------------------------
        case "fire_and_forget": {
          const emit = configurable[EMIT_LOCAL_TOOL_FIRE_FORGET_KEY] as EmitFireAndForgetFn | undefined;
          if (typeof emit !== "function") {
            console.warn(
              `[agent-streemr] createLocalTool "${name}" (fire_and_forget): EMIT_LOCAL_TOOL_FIRE_FORGET_KEY ` +
              "not found in config.configurable. Ensure the tool is used inside a createAgentSocketListener runner."
            );
            return fireAndForgetPlaceholder;
          }
          emit({ tool_name: name, args_json: argsJson });
          return fireAndForgetPlaceholder;
        }

        // -------------------------------------------------------------------
        default: {
          const exhaustive: never = mode;
          throw new Error(`[agent-streemr] createLocalTool: unknown mode "${exhaustive as string}"`);
        }
      }
    },
  });
}
