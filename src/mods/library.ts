/**
 * Level packs the player has installed, kept in IndexedDB so they work offline. Where IndexedDB is
 * missing or refuses to open (private browsing, embedded frames) the packs last for the session.
 */

export interface InstalledPack {
  id: string;
  name: string;
  author: string;
  bytes: Uint8Array;
  /** Milliseconds since the Unix epoch. */
  installed: number;
}

const DATABASE = 'wheelie';
const STORE = 'packs';

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error);
  });
}

function isInstalledPack(value: unknown): value is InstalledPack {
  const pack = value as Partial<InstalledPack> | null;
  return (
    typeof pack === 'object' &&
    pack !== null &&
    typeof pack.id === 'string' &&
    typeof pack.name === 'string' &&
    typeof pack.author === 'string' &&
    pack.bytes instanceof Uint8Array &&
    typeof pack.installed === 'number'
  );
}

export class Library {
  private readonly memory = new Map<string, InstalledPack>();
  private database: Promise<IDBDatabase | null> | null = null;

  private open(): Promise<IDBDatabase | null> {
    this.database ??= new Promise((resolve) => {
      try {
        const opening = indexedDB.open(DATABASE, 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore(STORE, { keyPath: 'id' });
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => resolve(null);
        opening.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.database;
  }

  private async run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    const database = await this.open();
    if (!database) return null;
    try {
      return await request(work(database.transaction(STORE, mode).objectStore(STORE)));
    } catch {
      return null;
    }
  }

  /** Installed packs, oldest first. */
  async list(): Promise<InstalledPack[]> {
    const stored = (await this.run<unknown[]>('readonly', (store) => store.getAll())) ?? [];
    const packs = new Map(this.memory);
    for (const pack of stored) if (isInstalledPack(pack)) packs.set(pack.id, pack);
    return [...packs.values()].sort((a, b) => a.installed - b.installed);
  }

  async get(id: string): Promise<InstalledPack | null> {
    const stored: unknown = await this.run('readonly', (store) => store.get(id));
    return isInstalledPack(stored) ? stored : (this.memory.get(id) ?? null);
  }

  async put(pack: InstalledPack): Promise<void> {
    this.memory.set(pack.id, pack);
    await this.run('readwrite', (store) => store.put(pack));
  }

  /** Forgets every pack, for a full reset of the game. */
  clear(): void {
    this.memory.clear();
    void this.run('readwrite', (store) => store.clear());
  }

  async delete(id: string): Promise<void> {
    this.memory.delete(id);
    await this.run('readwrite', (store) => store.delete(id));
  }
}
