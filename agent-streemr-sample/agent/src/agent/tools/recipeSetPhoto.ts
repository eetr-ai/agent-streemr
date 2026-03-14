// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/**
 * Save the most-recently uploaded photo as the recipe's cover image.
 *
 * The agent MUST validate the photo via vision before calling this tool:
 * - The image must clearly depict food.
 * - The content must be appropriate (no offensive or unrelated material).
 * - The food should reasonably match the recipe's description/theme.
 *
 * The client holds the attachment in a local staging area and consumes it
 * when this tool fires, so no base64 data is passed through the tool args.
 */
export const recipeSetPhoto = createLocalTool({
  tool_name: "recipe_set_photo",
  description:
    "Save the most recently uploaded photo as this recipe's cover image. " +
    "Only call this AFTER you have validated the photo with your vision capabilities. " +
    "The photo must clearly show food, be appropriate, and match the recipe theme.",
  schema: z.object({
    id: z.string().describe("The id of the recipe to attach the photo to."),
  }),
  buildRequest: (args) => ({ id: args.id }),
  mode: "async",
});
