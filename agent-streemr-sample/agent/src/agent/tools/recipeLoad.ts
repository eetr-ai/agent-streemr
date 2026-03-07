// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { createLocalTool } from "@eetr/agent-streemr";
import { z } from "zod";

/**
 * Ask the UI to load a recipe into the editing panel.
 * The client responds once the recipe is visible and selected.
 */
export const recipeLoad = createLocalTool({
  tool_name: "recipe_load",
  description:
    "Load a recipe into the UI editing panel so the user can see and review it. " +
    "Call this after creating or saving a recipe so the user sees the result. " +
    "Returns { ok: true } when the UI has selected the recipe.",
  schema: z.object({
    id: z.string().describe("The id of the recipe to load into the editor panel."),
  }),
  buildRequest: (args) => ({ id: args.id }),
  mode: "fire_and_forget",
});
