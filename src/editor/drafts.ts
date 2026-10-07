import { Table } from '../storage/database';
import { type EditorTrack, isEditorTrack } from './model';

/** A track being worked on in the editor. */
export interface Draft {
  id: string;
  track: EditorTrack;
  /** Milliseconds since the Unix epoch. */
  modified: number;
}

function isDraft(value: unknown): value is Draft {
  const draft = value as Partial<Draft> | null;
  return (
    typeof draft === 'object' &&
    draft !== null &&
    typeof draft.id === 'string' &&
    typeof draft.modified === 'number' &&
    isEditorTrack(draft.track)
  );
}

export class Drafts {
  private readonly table = new Table('drafts', isDraft);
  private counter = 0;

  /** Drafts in the order they were made. */
  async list(): Promise<Draft[]> {
    return (await this.table.all()).sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async create(track: EditorTrack): Promise<Draft> {
    // The time first, so that sorting by identifier is sorting by age.
    const id = `${Date.now().toString(36).padStart(9, '0')}-${(this.counter++).toString(36)}`;
    const draft = { id, track, modified: Date.now() };
    await this.table.put(draft);
    return draft;
  }

  save(draft: Draft): Promise<void> {
    draft.modified = Date.now();
    return this.table.put(draft);
  }

  delete(id: string): Promise<void> {
    return this.table.delete(id);
  }

  clear(): void {
    void this.table.clear();
  }
}
