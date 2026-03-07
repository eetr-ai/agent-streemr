import { useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { type Recipe } from "../db/recipes";
import { useRecipeContext } from "../context/RecipeContext";

marked.setOptions({ breaks: true });

function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

// ---------------------------------------------------------------------------
// Recipe list (top section)
// ---------------------------------------------------------------------------

interface RecipeListProps {
  recipes: Recipe[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onDelete: (id: string) => void;
}

function RecipeList({ recipes, selectedId, onSelect, onRefresh, onDelete }: RecipeListProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col border-b border-slate-700 shrink-0" style={{ height: "13rem" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800 shrink-0 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Recipes
          </span>
          {recipes.length > 0 && (
            <span className="text-[0.65rem] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded-full">
              {recipes.length}
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          title="Refresh recipe list"
          className="text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
        </button>
      </div>

      {/* Recipe cards */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5 bg-slate-950/60">
        {recipes.length === 0 ? (
          <p className="text-xs text-slate-500 italic text-center mt-6 px-3">
            No recipes yet. Ask the agent to create one!
          </p>
        ) : (
          recipes.map((r) => (
            <div
              key={r.id}
              className={`flex items-center rounded-lg transition-colors ${
                selectedId === r.id
                  ? "bg-blue-600/30 ring-1 ring-blue-500"
                  : "bg-slate-800 hover:bg-slate-700"
              }`}
            >
              {/* Select area */}
              <button
                onClick={() => { setConfirmingId(null); onSelect(r.id); }}
                className="flex-1 min-w-0 text-left px-3 py-2"
              >
                <p className="text-sm font-medium text-slate-200 truncate">{r.name}</p>
                {r.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {r.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="text-[0.6rem] bg-slate-700 text-slate-400 px-1.5 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>

              {/* Spacer + delete */}
              <div className="shrink-0 flex items-center pr-2">
                {confirmingId === r.id ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => { setConfirmingId(null); onDelete(r.id); }}
                      className="text-[0.65rem] text-red-400 hover:text-red-300 font-medium transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmingId(null)}
                      className="text-[0.65rem] text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmingId(r.id); }}
                    title="Delete recipe"
                    className="text-slate-600 hover:text-red-400 transition-colors p-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipe viewer (bottom section)
// ---------------------------------------------------------------------------

interface RecipeViewerProps {
  recipe: Recipe | null;
}

function RecipeViewer({ recipe }: RecipeViewerProps) {
  if (!recipe) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-0 bg-slate-900/20">
        <p className="text-sm text-slate-500 italic text-center max-w-xs px-4">
          Select a recipe from the list above to view its details here.
          <br />
          <span className="text-slate-600">
            The agent can create and update recipes on your behalf.
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
      {/* Title */}
      <h2 className="text-lg font-semibold text-slate-100 mb-1">{recipe.name}</h2>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-slate-400">
        {recipe.servings && (
          <span className="flex items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z" />
              <path d="M6 17h12" />
            </svg>
            {recipe.servings}
          </span>
        )}
        {recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {recipe.tags.map((tag) => (
              <span
                key={tag}
                className="bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded text-[0.65rem]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Description */}
      {recipe.description && (
        <div
          className="chat-markdown text-sm text-slate-300 mb-4 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(recipe.description) }}
        />
      )}

      {/* Ingredients */}
      {recipe.ingredients.length > 0 && (
        <section className="mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
            Ingredients
          </h3>
          <ul className="space-y-1">
            {recipe.ingredients.map((ing, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-200">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                {ing}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Instructions */}
      {recipe.instructions && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
            Instructions
          </h3>
          <div
            className="chat-markdown text-sm text-slate-200 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(recipe.instructions) }}
          />
        </section>
      )}

      {/* Footer */}
      <p className="text-[0.65rem] text-slate-600 mt-6">
        Last updated: {new Date(recipe.updatedAt).toLocaleString()}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecipePanel (root)
// ---------------------------------------------------------------------------

export default function RecipePanel() {
  const { recipes, selectedId, selectedRecipe, select, reload, deleteById } = useRecipeContext();

  const handleDelete = async (id: string) => {
    await deleteById(id);
  };

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <RecipeList
        recipes={recipes}
        selectedId={selectedId}
        onSelect={select}
        onRefresh={reload}
        onDelete={handleDelete}
      />
      <RecipeViewer recipe={selectedRecipe} />
    </div>
  );
}
