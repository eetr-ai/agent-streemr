// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * useRecipeTools — registers all client-side local tool handlers for the
 * recipe management workflow.
 *
 * Tools handled:
 *   recipe_list          — returns all recipe summaries from IndexedDB
 *   recipe_get_state     — returns the full state of one recipe by id
 *   recipe_create        — creates a new draft and returns its id
 *   recipe_set_title     — updates the name of a recipe in-memory
 *   recipe_set_description — updates the description in-memory
 *   recipe_set_ingredients — replaces the ingredients list in-memory
 *   recipe_set_directions  — replaces the instructions in-memory
 *   recipe_save          — persists the current in-memory draft to IndexedDB
 *
 * The hook maintains a Map of in-memory recipe drafts so the agent can call
 * the setter tools freely before committing with recipe_save.
 *
 * A custom fallback is also registered that answers notSupported for any
 * tool that is NOT a recipe tool, so ChatView can drop useLocalToolFallback.
 */

import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  LocalToolPayload,
} from "@eetr/agent-streemr";
import { useLocalToolHandler } from "@eetr/agent-streemr-react";
import {
  getAllRecipes,
  getRecipe,
  saveRecipe,
  type Recipe,
} from "../db/recipes";

type AgentSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const RECIPE_TOOLS = new Set([
  "recipe_list",
  "recipe_get_state",
  "recipe_create",
  "recipe_set_title",
  "recipe_set_description",
  "recipe_set_ingredients",
  "recipe_set_directions",
  "recipe_save",
]);

// ---------------------------------------------------------------------------
// Non-recipe fallback — answers notSupported for everything else
// ---------------------------------------------------------------------------

function useNonRecipeFallback(socket: AgentSocket | null): void {
  useEffect(() => {
    if (!socket) return;

    const onLocalTool = (payload: LocalToolPayload) => {
      if (RECIPE_TOOLS.has(payload.tool_name)) return; // handled elsewhere
      socket.emit("local_tool_response", {
        request_id: payload.request_id,
        tool_name: payload.tool_name,
        notSupported: true,
      });
    };

    socket.on("local_tool", onLocalTool);
    return () => {
      socket.off("local_tool", onLocalTool);
    };
  }, [socket]);
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export function useRecipeTools(socket: AgentSocket | null): void {
  // In-memory drafts keyed by recipe id.
  // Lets the agent populate fields before calling recipe_save.
  const draftsRef = useRef<Map<string, Partial<Recipe>>>(new Map());

  // recipe_list ---------------------------------------------------------------
  useLocalToolHandler(socket, "recipe_list", async () => {
    const recipes = await getAllRecipes();
    const summaries = recipes.map(({ id, name, tags, servings }) => ({
      id,
      name,
      tags,
      servings,
    }));
    return { response_json: { recipes: summaries } };
  });

  // recipe_get_state ----------------------------------------------------------
  useLocalToolHandler(socket, "recipe_get_state", async (args) => {
    const { id } = args as { id: string };

    // merge with any in-memory draft changes
    const stored = await getRecipe(id);
    const draft = draftsRef.current.get(id) ?? {};
    if (!stored && !draft.name) {
      return { response_json: { error: `No recipe found with id "${id}".` } };
    }
    const merged = { ...(stored ?? {}), ...draft };
    return { response_json: { recipe: merged } };
  });

  // recipe_create -------------------------------------------------------------
  useLocalToolHandler(socket, "recipe_create", async (args) => {
    const { name, tags, servings } = args as {
      name: string;
      tags?: string[];
      servings?: string;
    };
    const id = crypto.randomUUID();
    const now = Date.now();
    const draft: Recipe = {
      id,
      name,
      description: "",
      ingredients: [],
      instructions: "",
      tags: tags ?? [],
      servings: servings ?? "",
      createdAt: now,
      updatedAt: now,
    };
    draftsRef.current.set(id, draft);
    return { response_json: { id, name } };
  });

  // recipe_set_title ----------------------------------------------------------
  useLocalToolHandler(socket, "recipe_set_title", async (args) => {
    const { id, name } = args as { id: string; name: string };
    const existing = draftsRef.current.get(id) ?? {};
    draftsRef.current.set(id, { ...existing, id, name });
    return { response_json: { ok: true, id, name } };
  });

  // recipe_set_description ----------------------------------------------------
  useLocalToolHandler(socket, "recipe_set_description", async (args) => {
    const { id, description } = args as { id: string; description: string };
    const existing = draftsRef.current.get(id) ?? {};
    draftsRef.current.set(id, { ...existing, id, description });
    return { response_json: { ok: true, id } };
  });

  // recipe_set_ingredients ----------------------------------------------------
  useLocalToolHandler(socket, "recipe_set_ingredients", async (args) => {
    const { id, ingredients } = args as { id: string; ingredients: string[] };
    const existing = draftsRef.current.get(id) ?? {};
    draftsRef.current.set(id, { ...existing, id, ingredients });
    return { response_json: { ok: true, id, count: ingredients.length } };
  });

  // recipe_set_directions -----------------------------------------------------
  useLocalToolHandler(socket, "recipe_set_directions", async (args) => {
    const { id, instructions } = args as { id: string; instructions: string };
    const existing = draftsRef.current.get(id) ?? {};
    draftsRef.current.set(id, { ...existing, id, instructions });
    return { response_json: { ok: true, id } };
  });

  // recipe_save ---------------------------------------------------------------
  useLocalToolHandler(socket, "recipe_save", async (args) => {
    const { id } = args as { id: string };
    const draft = draftsRef.current.get(id);

    // Merge stored recipe (if any) with in-memory draft changes
    const stored = await getRecipe(id);
    const base: Recipe = stored ?? {
      id,
      name: "",
      description: "",
      ingredients: [],
      instructions: "",
      tags: [],
      servings: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const toSave: Recipe = { ...base, ...(draft ?? {}), id };

    const saved = await saveRecipe(toSave);
    draftsRef.current.delete(id); // clean up draft after persisting
    return { response_json: { ok: true, id: saved.id, name: saved.name } };
  });

  // Fallback for non-recipe tools ---------------------------------------------
  useNonRecipeFallback(socket);
}
