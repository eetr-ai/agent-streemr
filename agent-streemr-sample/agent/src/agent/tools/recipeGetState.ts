// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/**
 * Read the full current state of a single recipe by id.
 * Call this before editing to avoid overwriting untouched fields.
 */
export const recipeGetState = createLocalTool({
  tool_name: "recipe_get_state",
  description:
    "Read the complete current state of a recipe (name, description, ingredients, " +
    "instructions, tags, servings) by its id. Use this before editing to avoid " +
    "overwriting fields you did not intend to change.",
  schema: z.object({
    id: z.string().describe("The id of the recipe to read."),
  }),
  buildRequest: (args) => ({ id: args.id }),
  mode: "async",
});
