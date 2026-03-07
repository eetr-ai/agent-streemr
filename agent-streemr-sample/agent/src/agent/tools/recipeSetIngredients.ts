// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/**
 * Replace the full ingredients list of a recipe.
 * Each element is a single ingredient line, e.g. "2 cups all-purpose flour".
 */
export const recipeSetIngredients = createLocalTool({
  tool_name: "recipe_set_ingredients",
  description:
    "Replace the ingredients list of a recipe. " +
    "Each array element should be one ingredient line, e.g. '2 cups all-purpose flour'.",
  schema: z.object({
    id: z.string().describe("The id of the recipe to update."),
    ingredients: z.array(z.string()).describe("Full list of ingredient strings."),
  }),
  buildRequest: (args) => ({ id: args.id, ingredients: args.ingredients }),
  mode: "sync",
});
