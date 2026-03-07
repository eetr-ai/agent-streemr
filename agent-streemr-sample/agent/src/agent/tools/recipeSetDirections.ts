// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/**
 * Patch the cooking directions of a recipe.
 *
 * op | required fields       | effect
 * ---|----------------------|-------------------------------------------
 * set    | instructions        | replace all directions with a markdown string
 * add    | step[, index]       | append a step (or insert before 1-based index)
 * remove | index               | remove step at 1-based index
 * update | index, step         | replace step at 1-based index
 */
export const recipeSetDirections = createLocalTool({
  tool_name: "recipe_set_directions",
  description:
    "Patch the cooking directions for a recipe. " +
    "Use op='set' to replace all directions at once (accepts markdown); " +
    "op='add' to append or insert a single step; " +
    "op='remove' to delete a step by 1-based step number; " +
    "op='update' to replace the text of a specific step by 1-based step number.",
  schema: z.object({
    id: z.string().describe("The id of the recipe to update."),
    op: z
      .enum(["set", "add", "remove", "update"])
      .default("set")
      .describe("Patch operation: 'set' | 'add' | 'remove' | 'update'."),
    instructions: z
      .string()
      .optional()
      .describe("Full markdown directions — required for op='set'."),
    step: z
      .string()
      .optional()
      .describe("Step text (plain, no numbering) — required for op='add' and op='update'."),
    index: z
      .number()
      .int()
      .optional()
      .describe(
        "1-based step number — required for op='update' and op='remove'; optional for op='add' (inserts before this step).",
      ),
  }),
  buildRequest: (args) => ({
    id: args.id,
    op: args.op,
    instructions: args.instructions,
    step: args.step,
    index: args.index,
  }),
  mode: "sync",
});
