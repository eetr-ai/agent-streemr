// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/**
 * Patch the ingredients list of a recipe.
 *
 * op | required fields        | effect
 * ---|------------------------|------------------------------------------
 * set    | ingredients           | replace the entire list
 * add    | items[, index]        | append items (or insert before index)
 * remove | index OR value        | remove item by 0-based index or exact text
 * update | index, item           | replace item at 0-based index
 */
export const recipeSetIngredients = createLocalTool({
  tool_name: "recipe_set_ingredients",
  description:
    "Patch the ingredients list of a recipe. " +
    "Use op='set' to replace all ingredients at once; " +
    "op='add' to append or insert one or more items; " +
    "op='remove' to delete an item by 0-based index or exact text; " +
    "op='update' to replace the item at a 0-based index.",
  schema: z.object({
    id: z.string().describe("The id of the recipe to update."),
    op: z
      .enum(["set", "add", "remove", "update"])
      .default("set")
      .describe(
        "Patch operation: 'set' | 'add' | 'remove' | 'update'.",
      ),
    ingredients: z
      .array(z.string())
      .optional()
      .describe("Full ingredient list — required for op='set'."),
    items: z
      .array(z.string())
      .optional()
      .describe("Items to insert — required for op='add'."),
    index: z
      .number()
      .int()
      .optional()
      .describe(
        "0-based position — required for op='update'; optional for op='add' (inserts before this index) and op='remove'.",
      ),
    item: z
      .string()
      .optional()
      .describe("Replacement text — required for op='update'."),
    value: z
      .string()
      .optional()
      .describe("Exact ingredient text to remove — for op='remove' when index is unknown."),
  }),
  buildRequest: (args) => ({
    id: args.id,
    op: args.op,
    ingredients: args.ingredients,
    items: args.items,
    index: args.index,
    item: args.item,
    value: args.value,
  }),
  mode: "sync",
});
