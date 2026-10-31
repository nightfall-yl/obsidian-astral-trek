/**
 * Minimal IndexedDB key-value store that replaces upstream's `localforage`
 * dependency (vendored from nightfall-yl/obsidian-third-party-sync@6240bcc,
 * which used localforage for src/localdb.ts — NOT sql.js, so no WASM needed).
 *
 * Upstream created one localforage instance per logical table
 * (localforage.createInstance({ name, storeName })). We keep a single
 * IndexedDB database with a single object store and prefix keys by table
 * name, which preserves the same per-table key namespaces with ~80 lines
 * and zero npm dependencies.
 */

const DB_NAME = "astral-trek-sync-db";
const STORE_NAME = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

const getDB = (): Promise<IDBDatabase> => {
  if (dbPromise === null) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error("indexedDB open failed"));
      };
    });
  }
  return dbPromise;
};

const requestToPromise = <T>(req: IDBRequest<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("indexedDB request failed"));
    };
  });
};

export interface KvStore {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<T>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
  iterate(
    iterator: (value: unknown, key: string, iterationNumber: number) => void
  ): Promise<void>;
  clear(): Promise<void>;
}

class IdbKvStore implements KvStore {
  private readonly prefix: string;

  constructor(storeName: string) {
    this.prefix = `${storeName}\u0000`;
  }

  private fullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private stripPrefix(fullKey: string): string {
    return fullKey.substring(this.prefix.length);
  }

  getItem = async <T>(key: string): Promise<T | null> => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const res = await requestToPromise<unknown>(
      tx.objectStore(STORE_NAME).get(this.fullKey(key))
    );
    return (res ?? null) as T | null;
  };

  setItem = async <T>(key: string, value: T): Promise<T> => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    await requestToPromise(
      tx.objectStore(STORE_NAME).put(value as unknown, this.fullKey(key))
    );
    return value;
  };

  removeItem = async (key: string): Promise<void> => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    await requestToPromise(
      tx.objectStore(STORE_NAME).delete(this.fullKey(key))
    );
  };

  keys = async (): Promise<string[]> => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const allKeys = await requestToPromise(
      tx.objectStore(STORE_NAME).getAllKeys()
    );
    const res: string[] = [];
    for (const k of allKeys) {
      if (typeof k === "string" && k.startsWith(this.prefix)) {
        res.push(this.stripPrefix(k));
      }
    }
    return res;
  };

  iterate = async (
    iterator: (value: unknown, key: string, iterationNumber: number) => void
  ): Promise<void> => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const allKeys = await requestToPromise(
      tx.objectStore(STORE_NAME).getAllKeys()
    );
    let iterationNumber = 0;
    for (const k of allKeys) {
      if (typeof k !== "string" || !k.startsWith(this.prefix)) {
        continue;
      }
      const value = await requestToPromise<unknown>(
        db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(k)
      );
      iterator(value, this.stripPrefix(k), iterationNumber);
      iterationNumber += 1;
    }
  };

  clear = async (): Promise<void> => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const allKeys = await requestToPromise(
      tx.objectStore(STORE_NAME).getAllKeys()
    );
    const writeTx = db.transaction(STORE_NAME, "readwrite");
    const store = writeTx.objectStore(STORE_NAME);
    for (const k of allKeys) {
      if (typeof k === "string" && k.startsWith(this.prefix)) {
        store.delete(k);
      }
    }
    await new Promise<void>((resolve, reject) => {
      writeTx.oncomplete = () => {
        resolve();
      };
      writeTx.onerror = () => {
        reject(writeTx.error ?? new Error("indexedDB clear failed"));
      };
    });
  };
}

export const createKvStore = (storeName: string): KvStore => {
  return new IdbKvStore(storeName);
};

/** Drop the whole sync database (used by "wipe local sync data"). */
export const destroyDBs = async (): Promise<void> => {
  if (dbPromise !== null) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => {
      resolve();
    };
    req.onerror = () => {
      resolve();
    };
    req.onblocked = () => {
      resolve();
    };
  });
};
