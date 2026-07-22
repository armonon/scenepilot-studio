import type { AnalysisResult } from "./analysis-engine";

export type StoredProject<TSection, TPlacement, TTrack = unknown> = {
  mainFile: File;
  assets: Array<{ id: string; name: string; file: File; kind: "image" | "video"; color: string }>;
  duration: number;
  bpm: number;
  beatOffset?: number;
  beats: number[];
  sections: TSection[];
  placements: TPlacement[];
  tracks?: TTrack[];
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

export async function saveProject<TSection, TPlacement, TTrack = unknown>(project: StoredProject<TSection, TPlacement, TTrack>) {
  const mediaBytes = project.mainFile.size + project.assets.reduce((sum, asset) => sum + asset.file.size, 0);
  if (navigator.storage) {
    await navigator.storage.persist?.().catch(() => false);
    const estimate = await navigator.storage.estimate().catch((): StorageEstimate => ({}));
    const available = (estimate.quota ?? Infinity) - (estimate.usage ?? 0);
    if (available < mediaBytes * 1.1) {
      throw new Error(`This project needs about ${Math.ceil(mediaBytes / 1024 / 1024)} MB, but browser storage does not have enough room.`);
    }
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(project, CURRENT_PROJECT);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Project could not be saved."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Project storage ran out of space before the media finished saving."));
    });
  } finally {
    database.close();
  }
}

export async function loadProject<TSection, TPlacement, TTrack = unknown>() {
  const database = await openDatabase();
  try {
    return await new Promise<StoredProject<TSection, TPlacement, TTrack> | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(CURRENT_PROJECT);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error("Project could not be restored."));
    });
  } finally {
    database.close();
  }
}
