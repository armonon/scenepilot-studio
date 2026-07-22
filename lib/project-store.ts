import type { AnalysisResult } from "./analysis-engine";

export type StoredProject<TSection, TPlacement> = {
  mainFile: File;
  assets: Array<{ id: string; name: string; file: File; kind: "image" | "video"; color: string }>;
  duration: number;
  bpm: number;
  beatOffset?: number;
  beats: number[];
  sections: TSection[];
  placements: TPlacement[];
  analysis: AnalysisResult | null;
  autoEnergy: "smooth" | "dynamic" | "maximum";
  savedAt: number;
};

const DB_NAME = "scenepilot-studio";
const STORE_NAME = "projects";
const CURRENT_PROJECT = "current";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Project storage could not be opened."));
  });
}

export async function saveProject<TSection, TPlacement>(project: StoredProject<TSection, TPlacement>) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(project, CURRENT_PROJECT);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Project could not be saved."));
    });
  } finally {
    database.close();
  }
}

export async function loadProject<TSection, TPlacement>() {
  const database = await openDatabase();
  try {
    return await new Promise<StoredProject<TSection, TPlacement> | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(CURRENT_PROJECT);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error("Project could not be restored."));
    });
  } finally {
    database.close();
  }
}
