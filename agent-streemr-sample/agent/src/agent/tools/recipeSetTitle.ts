// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/** Update the name / title of an existing recipe. */
export const recipeSetTitle = createLocalTool({
  tool_name: "recipe_set_title",
  description: "Update the name/title of an existing recipe.",
  schema: z.object({
    id: z.string().describe("The id of the recipe to update."),
    name: z.string().describe("The new title."),
  }),
  buildRequest: (args) => ({ id: args.id, name: args.name }),
  mode: "fire_and_forget",
});
