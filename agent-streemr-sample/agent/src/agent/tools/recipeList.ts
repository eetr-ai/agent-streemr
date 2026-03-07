// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/**
 * List all recipes saved in the user's browser.
 * Returns an array of summaries: id, name, tags, servings.
 */
export const recipeList = createLocalTool({
  tool_name: "recipe_list",
  description:
    "List all recipes currently saved in the user's browser. " +
    "Returns an array of recipe summaries: id, name, tags, servings.",
  schema: z.object({}),
  buildRequest: () => ({}),
  mode: "async",
});
