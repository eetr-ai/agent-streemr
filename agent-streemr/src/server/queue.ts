// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module server/queue
 *
 * Per-thread task serialisation queue.
 * Ensures at most one agent run is active at a time per thread; subsequent
 * calls for the same `threadId` are chained and execute in order.
 *
 * Dependency tier: Node.js built-ins only.
 *
 * @example
 * ```ts
 * const queue = new ThreadQueue();
 *
 * socket.on("message", (payload) => {
 *   queue.enqueue(threadId, () => runAgent(socket, threadId, payload.text));
 * });
 * ```
 */
export class ThreadQueue {
  private readonly _pending = new Map<string, Promise<void>>();

  /**
   * Enqueues `task` for `threadId`.
   *
   * - If no run is active for the thread, `task` starts immediately.
   * - If a run is active, `task` is chained after it.
   * - Errors thrown by `task` are swallowed from the queue's perspective
   *   (the returned promise resolves regardless) so subsequent tasks are
   *   not blocked. The caller is responsible for error handling inside `task`.
   *
   * @returns A promise that resolves when `task` has completed (or errored).
   */
  enqueue(threadId: string, task: () => Promise<void>): Promise<void> {
    const id = threadId.trim();
    if (!id) return Promise.reject(new Error("threadId must be a non-empty string"));

    const prev = this._pending.get(id) ?? Promise.resolve();
    const next = prev.then(() => task()).catch(() => {
      // Errors are intentionally swallowed from the queue chain so subsequent
      // tasks for this thread are not blocked. Callers should handle errors
      // inside `task` (e.g. emit an error event to the socket).
    });

    this._pending.set(id, next);

    // Clean up the map entry once this task's chain has settled so the map
    // does not grow unboundedly for threads that are no longer active.
    next.then(() => {
      if (this._pending.get(id) === next) {
        this._pending.delete(id);
      }
    });

    return next;
  }

  /**
   * Returns `true` if there is a pending or active task for `threadId`.
   */
  has(threadId: string): boolean {
    return this._pending.has(threadId.trim());
  }

  /**
   * Removes any tracked state for `threadId`.
   * Safe to call even if no run is active — used on `clear_context`.
   */
  clear(threadId: string): void {
    this._pending.delete(threadId.trim());
  }
}
