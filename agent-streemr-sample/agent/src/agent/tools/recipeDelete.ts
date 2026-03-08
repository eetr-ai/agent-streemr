// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/**
 * Delete a recipe from the user's collection by id.
 */
export const recipeDelete = createLocalTool({
  tool_name: "recipe_delete",
  description:
    "Delete a recipe from the user's collection. Permanently removes it from local storage. " +
    "Use when the user asks to remove or delete a recipe.",
  schema: z.object({
    id: z.string().describe("The id of the recipe to delete."),
  }),
  buildRequest: (args) => ({ id: args.id }),
  mode: "sync",
});
