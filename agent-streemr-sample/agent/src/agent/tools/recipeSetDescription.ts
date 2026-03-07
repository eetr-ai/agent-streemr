// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/** Set or replace the short description / intro text of a recipe. */
export const recipeSetDescription = createLocalTool({
  tool_name: "recipe_set_description",
  description: "Set or replace the short description / intro text of a recipe.",
  schema: z.object({
    id: z.string().describe("The id of the recipe to update."),
    description: z.string().describe("The new description text."),
  }),
  buildRequest: (args) => ({ id: args.id, description: args.description }),
  mode: "fire_and_forget",
});
