// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/**
 * Set or replace the step-by-step cooking directions of a recipe.
 * Accepts markdown — numbered lists are recommended for steps.
 */
export const recipeSetDirections = createLocalTool({
  tool_name: "recipe_set_directions",
  description:
    "Set or replace the cooking instructions for a recipe. " +
    "Accepts markdown — use numbered lists for steps.",
  schema: z.object({
    id: z.string().describe("The id of the recipe to update."),
    instructions: z.string().describe("Step-by-step cooking directions (markdown)."),
  }),
  buildRequest: (args) => ({ id: args.id, instructions: args.instructions }),
  mode: "sync",
});
