// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * RecipeContext
 *
 * Shared reducer-backed context that owns:
 *  - The recipe list (loaded from IndexedDB)
 *  - The currently selected recipe ID
 *
 * Usage:
 *   - Wrap the app in <RecipeProvider>
 *   - Call useRecipeContext() anywhere below it
 *
 * State management uses @eetr/react-reducer-utils (bootstrapProvider).
 * Async side-effects (DB load, delete) live in RecipeInner.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { bootstrapProvider, type ReducerAction } from "@eetr/react-reducer-utils";
import { getAllRecipes, deleteRecipe as dbDeleteRecipe, type Recipe } from "../db/recipes";

// ---------------------------------------------------------------------------
// State & actions
// ---------------------------------------------------------------------------

interface RecipeState {
  recipes: Recipe[];
  selectedId: string | null;
}

export enum RecipeActionType {
  SET_RECIPES = "SET_RECIPES", // data: Recipe[]
  SELECT      = "SELECT",      // data: string
  DESELECT    = "DESELECT",    // no data
}

const initialState: RecipeState = { recipes: [], selectedId: null };

function reducer(
  state: RecipeState,
  action: ReducerAction<RecipeActionType>,
): RecipeState {
  switch (action.type) {
    case RecipeActionType.SET_RECIPES: {
      const recipes = action.data as Recipe[];
      const stillSelected = recipes.find((r) => r.id === state.selectedId);
      return {
        recipes,
        // keep selection if still valid, otherwise fall back to first
        selectedId: stillSelected ? state.selectedId : (recipes[0]?.id ?? null),
      };
    }
    case RecipeActionType.SELECT:
      return { ...state, selectedId: action.data as string };
    case RecipeActionType.DESELECT:
      return { ...state, selectedId: null };
    default:
      return state;
  }
}

const { Provider: StateProvider, useContextAccessors: useRecipeState } =
  bootstrapProvider<RecipeState, ReducerAction<RecipeActionType>>(reducer, initialState);

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

interface RecipeContextValue {
  recipes: Recipe[];
  selectedId: string | null;
  selectedRecipe: Recipe | null;
  /** Select a recipe by id */
  select: (id: string) => void;
  /** Clear the current selection */
  deselect: () => void;
  /** Reload the recipe list from IndexedDB */
  reload: () => void;
  /** Delete a recipe by id and reload */
  deleteById: (id: string) => Promise<void>;
}

const RecipeContext = createContext<RecipeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Inner component — handles side-effects on top of reducer state
// ---------------------------------------------------------------------------

function RecipeInner({ children }: { children: ReactNode }) {
  const { state, dispatch } = useRecipeState();

  const load = useCallback(async () => {
    try {
      const list = await getAllRecipes();
      dispatch({ type: RecipeActionType.SET_RECIPES, data: list });
    } catch (err) {
      console.error("[RecipeContext] Failed to load recipes:", err);
    }
  }, [dispatch]);

  // Initial load + listen for mutations made by the agent tools
  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("recipes-updated", handler);
    return () => window.removeEventListener("recipes-updated", handler);
  }, [load]);

  const select = useCallback(
    (id: string) => dispatch({ type: RecipeActionType.SELECT, data: id }),
    [dispatch],
  );

  const deselect = useCallback(
    () => dispatch({ type: RecipeActionType.DESELECT }),
    [dispatch],
  );

  const deleteById = useCallback(
    async (id: string) => {
      try {
        await dbDeleteRecipe(id);
        const list = await getAllRecipes();
        dispatch({ type: RecipeActionType.SET_RECIPES, data: list });
      } catch (err) {
        console.error("[RecipeContext] Failed to delete recipe:", err);
      }
    },
    [dispatch],
  );

  const selectedRecipe = state.recipes.find((r) => r.id === state.selectedId) ?? null;

  const value = useMemo(
    () => ({
      recipes: state.recipes,
      selectedId: state.selectedId,
      selectedRecipe,
      select,
      deselect,
      reload: load,
      deleteById,
    }),
    [state.recipes, state.selectedId, selectedRecipe, select, deselect, load, deleteById],
  );

  return <RecipeContext.Provider value={value}>{children}</RecipeContext.Provider>;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function RecipeProvider({ children }: { children: ReactNode }) {
  return (
    <StateProvider>
      <RecipeInner>
        {children}
      </RecipeInner>
    </StateProvider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRecipeContext(): RecipeContextValue {
  const ctx = useContext(RecipeContext);
  if (!ctx) throw new Error("useRecipeContext must be used inside <RecipeProvider>");
  return ctx;
}
