// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * Module-level staging area for a single photo attachment.
 *
 * When the user attaches an image in ChatView, the base64 data is staged here.
 * When the agent validates the photo and calls `recipe_set_photo`, the client
 * handler consumes the staged data to persist it in IndexedDB.
 */

interface StagedPhoto {
  base64: string;
  mimeType: string;
}

let staged: StagedPhoto | null = null;

/** Stage a photo for later consumption by the recipe_set_photo handler. */
export function stagePhoto(base64: string, mimeType: string): void {
  staged = { base64, mimeType };
}

/** Consume (and clear) the staged photo. Returns null if nothing is staged. */
export function consumePhoto(): StagedPhoto | null {
  const photo = staged;
  staged = null;
  return photo;
}
