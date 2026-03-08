// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module server/registry
 *
 * `LocalToolRegistry<TContext>` — central hub for local-tool processor
 * registration, in-flight request tracking, and sync-mode promise resolution.
 *
 * Dependency tier: `protocol/localTool` (types only), Node.js built-ins.
 *
 * @example Basic setup
 * ```ts
 * type MyCtx = { userId: string; prefs?: Record<string, unknown> };
 *
 * const registry = new LocalToolRegistry<MyCtx>();
 *
 * registry.register("get_prefs", {
 *   onSuccess: (ctx, json) => { ctx.prefs = json as Record<string, unknown>; },
 *   onDenied:  (ctx)       => { ctx.prefs = {}; },
 * });
 * ```
 */

import type { LocalToolResponseStatus } from "../protocol/localTool.js";

// ---------------------------------------------------------------------------
// Processor type
// ---------------------------------------------------------------------------

/**
 * Callbacks invoked when a `local_tool_response` is received for a particular
 * `tool_name`. All callbacks are optional; omitted callbacks are silently skipped.
 *
 * `TContext` is application-defined — users supply their own context shape
 * instead of the app-specific `LocalContext` used in the reference app.
 */
export type LocalToolResponseProcessor<TContext> = {
  /** Client returned data. `responseJson` is the `response_json` object from the envelope. */
  onSuccess?: (ctx: TContext, responseJson: object) => void;
  /** User explicitly denied the tool request (`allowed: false`). */
  onDenied?: (ctx: TContext) => void;
  /** Client does not support this tool (`notSupported: true`). */
  onNotSupported?: (ctx: TContext) => void;
  /** Client encountered an error executing the tool (`error: true`). */
  onError?: (ctx: TContext, errorMessage?: string) => void;
};

// ---------------------------------------------------------------------------
// Internal awaiting-state types
// ---------------------------------------------------------------------------

type SyncToolResult = {
  status: LocalToolResponseStatus;
  responseJson?: object;
  errorMessage?: string;
};

type SyncAwaiterEntry = {
  resolve: (result: SyncToolResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

type AwaitingEntry = {
  toolName: string;
  requestedAtMs: number;
  expiresAtMs: number;
};

// ---------------------------------------------------------------------------
// Track-emit result
// ---------------------------------------------------------------------------

export type TrackEmitResult = {
  requestedAtMs: number;
  expiresAtMs: number;
};

// ---------------------------------------------------------------------------
// Handle-response result
// ---------------------------------------------------------------------------

export type HandleResponseResult = {
  /** Number of awaiting requests remaining for this thread after handling this response. */
  remainingCount: number;
};

/** Tool execution kind inferred while handling a response. */
export type HandledToolKind = "async" | "sync";

/**
 * Tuple returned by `handleResponse`.
 *
 * - index `0`: inferred tool kind (`"sync"` if a sync awaiter was resolved, otherwise `"async"`).
 * - index `1`: handling metadata.
 */
export type HandleResponseOutcome = [HandledToolKind, HandleResponseResult];

// ---------------------------------------------------------------------------
// LocalToolRegistry
// ---------------------------------------------------------------------------

/**
 * Central registry for local-tool processors and in-flight request tracking.
 *
 * Generic over `TContext` so consumers define their own context shape (e.g. a
 * user profile, session metadata, etc.) instead of being coupled to any
 * application-specific type.
 *
 * ### Modes
 *
 * The registry supports three execution modes for local tools:
 *
 * **async** (default)
 * - `trackEmit()` registers the in-flight request (so `getAwaitingCount` is accurate).
 * - `handleResponse()` dispatches to the processor and decrements the count.
 * - No promise is involved.
 *
 * **sync**
 * - `trackEmit()` registers the in-flight request.
 * - `awaitResponse()` attaches a promise resolver + TTL timer. If the response
 *   already arrived before `awaitResponse` was called (race), it resolves immediately.
 * - `handleResponse()` resolves the promise (or noop if TTL already fired).
 *
 * **fire-and-forget**
 * - Do NOT call `trackEmit()` — the client will never send `local_tool_response`.
 * - The request is invisible to `getAwaitingCount` and is never awaited.
 */
export class LocalToolRegistry<TContext> {
  private readonly _processors = new Map<string, LocalToolResponseProcessor<TContext>>();
  /** threadId → requestId → AwaitingEntry */
  private readonly _awaiting = new Map<string, Map<string, AwaitingEntry>>();
  /** threadId → requestId → SyncAwaiterEntry */
  private readonly _syncAwaiters = new Map<string, Map<string, SyncAwaiterEntry>>();
  /**
   * Stores results that arrived via `handleResponse` before `awaitResponse` was
   * called (sync-mode race condition). Keyed by threadId → requestId.
   */
  private readonly _earlyResults = new Map<string, Map<string, SyncToolResult>>();

  // -------------------------------------------------------------------------
  // Processor registration
  // -------------------------------------------------------------------------

  /**
   * Registers a response processor for `tool_name`.
   * Overwrites any previously registered processor for the same name.
   */
  register(tool_name: string, processor: LocalToolResponseProcessor<TContext>): void {
    const name = tool_name.trim();
    if (!name) throw new Error("tool_name must be a non-empty string");
    this._processors.set(name, processor);
  }

  /** Returns the registered processor for `tool_name`, or `undefined` if none. */
  getProcessor(tool_name: string): LocalToolResponseProcessor<TContext> | undefined {
    return this._processors.get(tool_name.trim());
  }

  // -------------------------------------------------------------------------
  // Awaiting tracking (async + sync modes)
  // -------------------------------------------------------------------------

  /**
   * Registers an in-flight `local_tool` request so it is counted by
   * `getAwaitingCount` and can be swept by `clearExpired`.
   *
   * Call this immediately after emitting `local_tool` to the client (both
   * async and sync modes). Do NOT call for fire-and-forget tools.
   *
   * @returns Registration metadata, or `null` if `threadId` / `request_id` /
   *          `tool_name` are blank.
   */
  trackEmit(args: {
    threadId: string;
    request_id: string;
    tool_name: string;
    nowMs: number;
    ttlMs: number;
  }): TrackEmitResult | null {
    const { threadId, request_id, tool_name, nowMs, ttlMs } = args;
    const tid = threadId.trim();
    const rid = request_id.trim();
    const tname = tool_name.trim();
    if (!tid || !rid || !tname) return null;

    let threadMap = this._awaiting.get(tid);
    if (!threadMap) {
      threadMap = new Map();
      this._awaiting.set(tid, threadMap);
    }
    const entry: AwaitingEntry = {
      toolName: tname,
      requestedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
    };
    threadMap.set(rid, entry);
    return { requestedAtMs: entry.requestedAtMs, expiresAtMs: entry.expiresAtMs };
  }

  // -------------------------------------------------------------------------
  // Sync-mode promise resolution
  // -------------------------------------------------------------------------

  /**
   * Registers a promise that resolves when the client responds to `request_id`
   * (or when `ttlMs` elapses, in which case it resolves with `status: "error"`).
   *
   * Also handles the race where the response already arrived before this call:
   * if `handleResponse` was called first, the promise resolves immediately with
   * the stored early result.
   *
   * @param args.ttlMs Milliseconds before the promise resolves with
   *   `{ status: "error", errorMessage: "timeout" }`.
   */
  awaitResponse(args: {
    threadId: string;
    request_id: string;
    tool_name: string;
    ttlMs: number;
  }): Promise<SyncToolResult> {
    const tid = args.threadId.trim();
    const rid = args.request_id.trim();

    // Check for early result (response arrived before awaitResponse was registered)
    const earlyThreadMap = this._earlyResults.get(tid);
    const earlyResult = earlyThreadMap?.get(rid);
    if (earlyResult) {
      earlyThreadMap!.delete(rid);
      if (earlyThreadMap!.size === 0) this._earlyResults.delete(tid);
      return Promise.resolve(earlyResult);
    }

    return new Promise<SyncToolResult>((resolve) => {
      const timer = setTimeout(() => {
        this._removeSyncAwaiter(tid, rid);
        // Also remove from _awaiting if still present
        const tm = this._awaiting.get(tid);
        if (tm) {
          tm.delete(rid);
          if (tm.size === 0) this._awaiting.delete(tid);
        }
        resolve({ status: "error", errorMessage: "timeout" });
      }, args.ttlMs);

      let syncMap = this._syncAwaiters.get(tid);
      if (!syncMap) {
        syncMap = new Map();
        this._syncAwaiters.set(tid, syncMap);
      }
      syncMap.set(rid, { resolve, timer });
    });
  }

  // -------------------------------------------------------------------------
  // Response handling
  // -------------------------------------------------------------------------

  /**
   * Processes an incoming `local_tool_response` from the client:
   *
   * 1. Removes the request from `_awaiting` (returns `null` if the request is
   *    unknown or already expired — caller should ignore the response).
   * 2. Dispatches to the registered processor (if any) for side-effects on `ctx`.
   * 3. Resolves the sync awaiter promise (if any).
   *
  * @returns `[toolKind, { remainingCount }]` indicating how many requests are
  *          still pending for this thread and whether this response resolved a
  *          sync awaiter (`"sync"`) or not (`"async"`). Returns `null` if the
  *          `request_id` was not found.
   */
  handleResponse(args: {
    ctx: TContext;
    threadId: string;
    request_id: string;
    tool_name: string;
    status: LocalToolResponseStatus;
    responseJson?: object;
    errorMessage?: string;
  }): HandleResponseOutcome | null {
    const { ctx, threadId, request_id, tool_name, status, responseJson, errorMessage } = args;
    const tid = threadId.trim();
    const rid = request_id.trim();

    const threadMap = this._awaiting.get(tid);
    if (!threadMap) return null;

    const entry = threadMap.get(rid);

    // Dispatch to processor (regardless of whether a sync awaiter exists)
    const processor = this._processors.get(tool_name.trim());
    if (processor) {
      this._dispatch(processor, ctx, status, responseJson, errorMessage);
    }

    const result: SyncToolResult = { status, responseJson, errorMessage };

    // Resolve sync awaiter if one is registered
    const syncAwaiter = this._getSyncAwaiter(tid, rid);
    if (syncAwaiter) {
      clearTimeout(syncAwaiter.timer);
      this._removeSyncAwaiter(tid, rid);
      // Remove from _awaiting and resolve
      threadMap.delete(rid);
      if (threadMap.size === 0) this._awaiting.delete(tid);
      syncAwaiter.resolve(result);
      return ["sync", { remainingCount: threadMap.size }];
    }

    if (!entry) {
      // Request not found — may have already been consumed or expired
      return null;
    }

    // No sync awaiter yet — store as early result in case awaitResponse is
    // called shortly after (sync-mode race condition).
    let earlyMap = this._earlyResults.get(tid);
    if (!earlyMap) {
      earlyMap = new Map();
      this._earlyResults.set(tid, earlyMap);
    }
    earlyMap.set(rid, result);

    threadMap.delete(rid);
    if (threadMap.size === 0) this._awaiting.delete(tid);
    return ["async", { remainingCount: threadMap.size }];
  }

  // -------------------------------------------------------------------------
  // Count & TTL cleanup
  // -------------------------------------------------------------------------

  /**
   * Returns the number of in-flight `local_tool` requests for `threadId`.
   * Use this to decide whether a follow-up agent run should be passive (wait)
   * or active (respond to the user).
   */
  getAwaitingCount(threadId: string): number {
    return this._awaiting.get(threadId.trim())?.size ?? 0;
  }

  /**
   * Sweeps expired awaiting entries for `threadId`, resolving any attached
   * sync awaiters with `{ status: "error", errorMessage: "timeout" }`.
   *
   * Call this at the start of both `local_tool` emission and `local_tool_response`
   * handling to keep the map tidy.
   */
  clearExpired(
    threadId: string,
    nowMs: number
  ): { removedCount: number; remainingCount: number } {
    const tid = threadId.trim();
    const threadMap = this._awaiting.get(tid);
    if (!threadMap) return { removedCount: 0, remainingCount: 0 };

    let removedCount = 0;
    for (const [rid, entry] of threadMap.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        threadMap.delete(rid);
        removedCount++;
        // Resolve any attached sync awaiter as error
        const awaiter = this._getSyncAwaiter(tid, rid);
        if (awaiter) {
          clearTimeout(awaiter.timer);
          this._removeSyncAwaiter(tid, rid);
          awaiter.resolve({ status: "error", errorMessage: "timeout" });
        }
      }
    }

    if (threadMap.size === 0) this._awaiting.delete(tid);
    return { removedCount, remainingCount: threadMap.size };
  }

  /**
   * Removes all awaiting state and sync awaiters for `threadId`.
   * Any pending sync awaiters are resolved with `{ status: "error", errorMessage: "cleared" }`.
   * Call on `clear_context`.
   */
  clearThread(threadId: string): void {
    const tid = threadId.trim();

    // Resolve all pending sync awaiters for this thread
    const syncMap = this._syncAwaiters.get(tid);
    if (syncMap) {
      for (const awaiter of syncMap.values()) {
        clearTimeout(awaiter.timer);
        awaiter.resolve({ status: "error", errorMessage: "cleared" });
      }
      this._syncAwaiters.delete(tid);
    }

    this._awaiting.delete(tid);
    this._earlyResults.delete(tid);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _dispatch(
    processor: LocalToolResponseProcessor<TContext>,
    ctx: TContext,
    status: LocalToolResponseStatus,
    responseJson?: object,
    errorMessage?: string
  ): void {
    switch (status) {
      case "success":
        processor.onSuccess?.(ctx, responseJson ?? {});
        break;
      case "denied":
        processor.onDenied?.(ctx);
        break;
      case "not_supported":
        processor.onNotSupported?.(ctx);
        break;
      case "error":
        processor.onError?.(ctx, errorMessage);
        break;
    }
  }

  private _getSyncAwaiter(threadId: string, requestId: string): SyncAwaiterEntry | undefined {
    return this._syncAwaiters.get(threadId)?.get(requestId);
  }

  private _removeSyncAwaiter(threadId: string, requestId: string): void {
    const syncMap = this._syncAwaiters.get(threadId);
    if (!syncMap) return;
    syncMap.delete(requestId);
    if (syncMap.size === 0) this._syncAwaiters.delete(threadId);
  }
}
