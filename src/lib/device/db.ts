const DB_NAME = "tubeshadow-device";
const DB_VERSION = 1;

export type AccountRow = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  passwordSalt: string | null;
  passwordHash: string | null;
  googleSub: string | null;
  xSub: string | null;
  createdAt: string;
};

export type ProfileRow = {
  userId: string;
  locale: "ko" | "en";
  ageBand: "child" | "teen" | "college" | "adult";
  cefrLevel: string | null;
  listeningScore: number | null;
  speakingScore: number | null;
  placementDone: boolean;
  placementPath: unknown;
  placementBankVersion: number | null;
  openaiModel: string;
  openaiKey: string | null;
  updatedAt: string;
};

export type LessonRow = {
  id: string;
  userId: string;
  videoId: string;
  payload: unknown;
  createdAt: string;
};

export type VocabRow = {
  id: number;
  userId: string;
  video_id: string | null;
  word: string;
  meaning_ko: string | null;
  meaning_en: string | null;
  ipa: string | null;
  clip_start: number | null;
  clip_end: number | null;
  created_at: string;
};

export type BookmarkRow = {
  id: number;
  userId: string;
  video_id: string;
  start_sec: number;
  end_sec: number;
  caption: string | null;
  note: string | null;
  created_at: string;
};

export type ProgressRow = {
  id: string;
  userId: string;
  video_id: string;
  position_sec: number;
  title: string | null;
  thumbnail: string | null;
  updated_at: string;
};

export type SpeakingRow = {
  id: number;
  userId: string;
  lessonId: string | null;
  videoId: string | null;
  target: string;
  transcript: string;
  accuracy: number;
  createdAt: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("accounts")) {
        const s = db.createObjectStore("accounts", { keyPath: "id" });
        s.createIndex("email", "email", { unique: false });
        s.createIndex("googleSub", "googleSub", { unique: false });
        s.createIndex("xSub", "xSub", { unique: false });
      }
      if (!db.objectStoreNames.contains("profiles")) {
        db.createObjectStore("profiles", { keyPath: "userId" });
      }
      if (!db.objectStoreNames.contains("lessons")) {
        const s = db.createObjectStore("lessons", { keyPath: "id" });
        s.createIndex("userVideo", ["userId", "videoId"], { unique: false });
      }
      if (!db.objectStoreNames.contains("vocab")) {
        const s = db.createObjectStore("vocab", { keyPath: "id", autoIncrement: true });
        s.createIndex("userId", "userId", { unique: false });
      }
      if (!db.objectStoreNames.contains("bookmarks")) {
        const s = db.createObjectStore("bookmarks", { keyPath: "id", autoIncrement: true });
        s.createIndex("userId", "userId", { unique: false });
      }
      if (!db.objectStoreNames.contains("progress")) {
        const s = db.createObjectStore("progress", { keyPath: "id" });
        s.createIndex("userId", "userId", { unique: false });
      }
      if (!db.objectStoreNames.contains("speaking")) {
        const s = db.createObjectStore("speaking", { keyPath: "id", autoIncrement: true });
        s.createIndex("userId", "userId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function asPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, mode);
    const s = tx.objectStore(store);
    const result = fn(s);
    const value = result instanceof Promise ? await result : await asPromise(result);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx aborted"));
    });
    return value;
  } finally {
    db.close();
  }
}

export async function getById<T>(store: string, id: IDBValidKey): Promise<T | undefined> {
  return withStore(store, "readonly", (s) => s.get(id));
}

export async function putRow<T>(store: string, row: T): Promise<void> {
  await withStore(store, "readwrite", (s) => s.put(row));
}

export async function getAllByIndex<T>(store: string, index: string, value: IDBValidKey): Promise<T[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, "readonly");
    const s = tx.objectStore(store);
    const idx = s.index(index);
    const rows = await asPromise(idx.getAll(value));
    return rows as T[];
  } finally {
    db.close();
  }
}

export function newId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}
