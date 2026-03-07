// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module agent/userContext
 *
 * Defines the per-thread context shape shared between the bootstrap layer and
 * the agent runner, and provides utilities for injecting that context into
 * outgoing user messages.
 */

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

/**
 * Per-thread context object maintained by the server listener.
 * Updated via `set_context` events emitted by the client.
 */
export type UserContext = {
  /** ID of the recipe the user currently has open in the editor, if any. */
  selectedRecipeId?: string | null;
};

// ---------------------------------------------------------------------------
// Context injection
// ---------------------------------------------------------------------------

/**
 * Prepends a human-readable context block to `message` when `ctx` carries
 * relevant state, so the agent understands the user's current editor state
 * without needing to be told explicitly in every prompt.
 *
 * Returns the original message unchanged when there is no useful context.
 */
export function buildContextualMessage(message: string, ctx: UserContext | undefined): string {
  const lines: string[] = [];

  if (ctx?.selectedRecipeId) {
    lines.push(`Selected recipe ID: ${ctx.selectedRecipeId}`);
  }

  if (lines.length === 0) return message;

  const header = `[Editor context]\n${lines.join("\n")}`;
  return `${header}\n\n${message}`;
}
