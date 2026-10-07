import { Table } from '../storage/database';

export interface InstalledPack {
  id: string;
  name: string;
  author: string;
  bytes: Uint8Array;
  /** Milliseconds since the Unix epoch. */
  installed: number;
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

/** Level packs the player has installed, kept so they work offline. */
export class Library {
  private readonly table = new Table('packs', isInstalledPack);

  /** Installed packs, oldest first. */
  async list(): Promise<InstalledPack[]> {
    return (await this.table.all()).sort((a, b) => a.installed - b.installed);
  }

  get(id: string): Promise<InstalledPack | null> {
    return this.table.get(id);
  }

  put(pack: InstalledPack): Promise<void> {
    return this.table.put(pack);
  }

  delete(id: string): Promise<void> {
    return this.table.delete(id);
  }

  /** Forgets every pack, for a full reset of the game. */
  clear(): void {
    void this.table.clear();
  }
}
