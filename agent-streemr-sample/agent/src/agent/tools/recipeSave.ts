// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/**
 * Persist / finalise a recipe to the user's browser storage.
 * Call this after finishing all edits (title, description, ingredients, directions).
 */
export const recipeSave = createLocalTool({
  tool_name: "recipe_save",
  description:
    "Persist the current state of a recipe to the user's local storage. " +
    "Call this after finishing all edits. Returns a confirmation with the saved recipe name.",
  schema: z.object({
    id: z.string().describe("The id of the recipe to save."),
  }),
  buildRequest: (args) => ({ id: args.id }),
  mode: "sync",
});
