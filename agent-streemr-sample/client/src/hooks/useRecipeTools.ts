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
  deleteRecipe,
  type Recipe,
} from "../db/recipes";
import { useToolApproval } from "../context/ToolApprovalContext";
import { useRecipeContext } from "../context/RecipeContext";
import { consumePhoto } from "./photoStaging";

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
  "recipe_load",
  "recipe_delete",
  "recipe_set_photo",
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

  // Recipe selection — driven directly from context
  const { select } = useRecipeContext();
  const selectRef = useRef(select);
  useEffect(() => { selectRef.current = select; }, [select]);

  // Interactive allow/deny allowList — every tool call pauses for user approval
  const { allowList } = useToolApproval();

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
  }, { allowList });

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
  }, { allowList });

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
    await saveRecipe(draft);
    selectRef.current(id);
    return { response_json: { id, name } };
  }, { allowList });

  // recipe_set_title ----------------------------------------------------------
  useLocalToolHandler(socket, "recipe_set_title", async (args) => {
    const { id, name } = args as { id: string; name: string };
    const existing = draftsRef.current.get(id) ?? {};
    const updated = { ...existing, id, name };
    draftsRef.current.set(id, updated);
    const stored = await getRecipe(id);
    if (stored) await saveRecipe({ ...stored, ...updated });
    return { response_json: { ok: true, id, name } };
  }, { allowList });

  // recipe_set_description ----------------------------------------------------
  useLocalToolHandler(socket, "recipe_set_description", async (args) => {
    const { id, description } = args as { id: string; description: string };
    const existing = draftsRef.current.get(id) ?? {};
    const updated = { ...existing, id, description };
    draftsRef.current.set(id, updated);
    const stored = await getRecipe(id);
    if (stored) await saveRecipe({ ...stored, ...updated });
    return { response_json: { ok: true, id } };
  }, { allowList });

  // recipe_set_ingredients ----------------------------------------------------
  useLocalToolHandler(socket, "recipe_set_ingredients", async (args) => {
    const { id, op = "set", ingredients, items, index, item, value } = args as {
      id: string;
      op?: "set" | "add" | "remove" | "update";
      ingredients?: string[];
      items?: string[];
      index?: number;
      item?: string;
      value?: string;
    };

    const existing = draftsRef.current.get(id) ?? {};
    const stored = await getRecipe(id);
    const current: string[] = existing.ingredients ?? stored?.ingredients ?? [];

    let next: string[];
    switch (op) {
      case "add": {
        const toInsert = items ?? (item ? [item] : []);
        if (index !== undefined) {
          next = [...current.slice(0, index), ...toInsert, ...current.slice(index)];
        } else {
          next = [...current, ...toInsert];
        }
        break;
      }
      case "remove": {
        if (index !== undefined) {
          next = current.filter((_, i) => i !== index);
        } else if (value !== undefined) {
          next = current.filter((ing) => ing !== value);
        } else {
          return { response_json: { ok: false, error: "op='remove' requires index or value." } };
        }
        break;
      }
      case "update": {
        if (index === undefined || item === undefined) {
          return { response_json: { ok: false, error: "op='update' requires index and item." } };
        }
        next = current.map((ing, i) => (i === index ? item : ing));
        break;
      }
      case "set":
      default: {
        if (!ingredients) {
          return { response_json: { ok: false, error: "op='set' requires ingredients array." } };
        }
        next = ingredients;
        break;
      }
    }

    draftsRef.current.set(id, { ...existing, id, ingredients: next });
    if (stored) await saveRecipe({ ...stored, ...draftsRef.current.get(id) });
    return { response_json: { ok: true, id, count: next.length } };
  }, { allowList });

  // recipe_set_directions -----------------------------------------------------
  useLocalToolHandler(socket, "recipe_set_directions", async (args) => {
    const { id, op = "set", instructions, step, index } = args as {
      id: string;
      op?: "set" | "add" | "remove" | "update";
      instructions?: string;
      step?: string;
      index?: number;
    };

    const existing = draftsRef.current.get(id) ?? {};
    const stored = await getRecipe(id);
    const currentMd: string = existing.instructions ?? stored?.instructions ?? "";

    /** Parse a markdown numbered list into plain step strings. */
    function parseSteps(md: string): string[] {
      return md
        .split("\n")
        .map((l) => l.replace(/^\d+\.\s+/, "").trim())
        .filter(Boolean);
    }

    /** Render plain step strings back to a numbered markdown list. */
    function stepsToMd(steps: string[]): string {
      return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    }

    let nextMd: string;
    switch (op) {
      case "add": {
        if (!step) {
          return { response_json: { ok: false, error: "op='add' requires step." } };
        }
        const steps = parseSteps(currentMd);
        if (index !== undefined) {
          // index is 1-based; insert before that step
          steps.splice(index - 1, 0, step);
        } else {
          steps.push(step);
        }
        nextMd = stepsToMd(steps);
        break;
      }
      case "remove": {
        if (index === undefined) {
          return { response_json: { ok: false, error: "op='remove' requires index (1-based step number)." } };
        }
        const steps = parseSteps(currentMd);
        steps.splice(index - 1, 1);
        nextMd = stepsToMd(steps);
        break;
      }
      case "update": {
        if (index === undefined || !step) {
          return { response_json: { ok: false, error: "op='update' requires index and step." } };
        }
        const steps = parseSteps(currentMd);
        steps[index - 1] = step;
        nextMd = stepsToMd(steps);
        break;
      }
      case "set":
      default: {
        if (instructions === undefined) {
          return { response_json: { ok: false, error: "op='set' requires instructions." } };
        }
        nextMd = instructions;
        break;
      }
    }

    draftsRef.current.set(id, { ...existing, id, instructions: nextMd });
    if (stored) await saveRecipe({ ...stored, ...draftsRef.current.get(id) });
    return { response_json: { ok: true, id, steps: parseSteps(nextMd).length } };
  }, { allowList });

  // recipe_load ---------------------------------------------------------------
  useLocalToolHandler(socket, "recipe_load", async (args) => {
    const { id } = args as { id: string };
    selectRef.current(id);
    return { response_json: { ok: true, id } };
  }, { allowList });

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
  }, { allowList });

  // recipe_delete ------------------------------------------------------------
  useLocalToolHandler(socket, "recipe_delete", async (args) => {
    const { id } = args as { id: string };
    await deleteRecipe(id);
    draftsRef.current.delete(id);
    return { response_json: { ok: true, id } };
  }, { allowList });

  // recipe_set_photo ----------------------------------------------------------
  useLocalToolHandler(socket, "recipe_set_photo", async (args) => {
    const { id } = args as { id: string };
    const photo = consumePhoto();
    if (!photo) {
      return { response_json: { ok: false, error: "No photo staged. The user must attach an image first." } };
    }
    const stored = await getRecipe(id);
    const draft = draftsRef.current.get(id) ?? {};
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
    const toSave: Recipe = {
      ...base,
      ...draft,
      id,
      photoBase64: photo.base64,
      photoMimeType: photo.mimeType,
    };
    await saveRecipe(toSave);
    return { response_json: { ok: true, id } };
  }, { allowList });

  // Fallback for non-recipe tools ---------------------------------------------
  useNonRecipeFallback(socket);
}
