/**
 * IndexedDB persistence layer for recipes.
 *
 * Database : agent-streemr-recipes  (version 1)
 * Store    : recipes  (keyPath: "id")
 *
 * Schema:
 *   Recipe {
 *     id          : string   (UUID)
 *     name        : string
 *     description : string   (optional)
 *     ingredients : string[] (one entry per ingredient)
 *     instructions: string   (markdown)
 *     tags        : string[]
 *     servings    : string   (optional, e.g. "4 servings")
 *     createdAt   : number   (epoch ms)
 *     updatedAt   : number   (epoch ms)
 *   }
 *
 * The agent can write/update recipes via local tool calls.
 * After any mutation, dispatch window event "recipes-updated" so the UI refreshes.
 */

export interface Recipe {
  id: string;
  name: string;
  description?: string;
  ingredients: string[];
  instructions: string;
  tags: string[];
  servings?: string;
  /** Base64-encoded recipe photo (validated by the agent as food before saving). */
  photoBase64?: string;
  /** MIME type of the stored photo, e.g. "image/jpeg". */
  photoMimeType?: string;
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = "agent-streemr-recipes";
const STORE_NAME = "recipes";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function notifyRecipesUpdated(): void {
  window.dispatchEvent(new CustomEvent("recipes-updated"));
}

export async function getAllRecipes(): Promise<Recipe[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () =>
      resolve(
        (req.result as Recipe[]).sort((a, b) => b.updatedAt - a.updatedAt)
      );
    req.onerror = () => reject(req.error);
  });
}

export async function getRecipe(id: string): Promise<Recipe | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as Recipe | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecipe(recipe: Recipe): Promise<Recipe> {
  const db = await openDB();
  const now = Date.now();
  const toSave: Recipe = {
    ...recipe,
    id: recipe.id || crypto.randomUUID(),
    createdAt: recipe.createdAt || now,
    updatedAt: now,
    ingredients: recipe.ingredients ?? [],
    tags: recipe.tags ?? [],
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(toSave);
    req.onsuccess = () => {
      notifyRecipesUpdated();
      resolve(toSave);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecipe(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => {
      notifyRecipesUpdated();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}
