/**
 * Larger data — level packs, replays — lives in IndexedDB. Where it is missing or refuses to open
 * (private browsing, embedded frames) each table keeps working in memory for the session.
 */

const DATABASE = 'wheelie';
/** Every table, with the property its records are keyed by. Adding one means raising the version. */
const TABLES = { packs: 'id', replays: 'id', drafts: 'id' } as const;
const VERSION = 3;

export type TableName = keyof typeof TABLES;

let database: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    try {
      const opening = indexedDB.open(DATABASE, VERSION);
      opening.onupgradeneeded = () => {
        for (const [name, keyPath] of Object.entries(TABLES)) {
          if (!opening.result.objectStoreNames.contains(name)) opening.result.createObjectStore(name, { keyPath });
        }
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => resolve(null);
      opening.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return database;
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error);
  });
}

/** Records keyed by a string `id`. What comes back from storage is checked before it is trusted. */
export class Table<T extends { id: string }> {
  private readonly memory = new Map<string, T>();

  constructor(
    private readonly name: TableName,
    private readonly isValid: (value: unknown) => value is T,
  ) {}

  private async run<R>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<R>): Promise<R | null> {
    const db = await open();
    if (!db) return null;
    try {
      return await request(work(db.transaction(this.name, mode).objectStore(this.name)));
    } catch {
      return null;
    }
  }

  async all(): Promise<T[]> {
    const stored = (await this.run<unknown[]>('readonly', (store) => store.getAll())) ?? [];
    const records = new Map(this.memory);
    for (const record of stored) if (this.isValid(record)) records.set(record.id, record);
    return [...records.values()];
  }

  async get(id: string): Promise<T | null> {
    const stored: unknown = await this.run('readonly', (store) => store.get(id));
    return this.isValid(stored) ? stored : (this.memory.get(id) ?? null);
  }

  async put(record: T): Promise<void> {
    this.memory.set(record.id, record);
    await this.run('readwrite', (store) => store.put(record));
  }

  async delete(id: string): Promise<void> {
    this.memory.delete(id);
    await this.run('readwrite', (store) => store.delete(id));
  }

  async clear(): Promise<void> {
    this.memory.clear();
    await this.run('readwrite', (store) => store.clear());
  }
}
