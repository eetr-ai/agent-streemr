// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/**
 * Create a new empty recipe draft in the user's collection.
 * Returns the new recipe id — required for all subsequent recipe tools.
 */
export const recipeCreate = createLocalTool({
  tool_name: "recipe_create",
  description:
    "Create a new recipe draft in the user's collection. " +
    "Returns the new recipe id — use it with all other recipe tools.",
  schema: z.object({
    name: z.string().describe("The name of the recipe."),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional category tags, e.g. ['Italian', 'pasta']."),
    servings: z
      .string()
      .optional()
      .describe("Optional servings string, e.g. '4 servings'."),
  }),
  buildRequest: (args) => ({
    name: args.name,
    tags: args.tags,
    servings: args.servings,
  }),
  mode: "sync",
});
