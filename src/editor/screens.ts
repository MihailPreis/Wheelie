import { encodePack, type TrackData } from '../formats/mrg';
import type { MenuItem, MenuScreen } from '../ui/menu/view';
import { STRINGS as S } from '../ui/strings';
import type { Draft, Drafts } from './drafts';
import { fromTrackData, templateTrack, toTrackData } from './model';

type ScreenBuilder = () => MenuScreen;

export interface EditorHost {
  open(builder: ScreenBuilder): void;
  alert(title: string, text: string, then: () => void): void;
  readonly parent: ScreenBuilder;
  /** Opens a draft in the editor; `back` is the screen to return to. */
  edit(draft: Draft, back: () => void): void;
  /** The track selected in the Play menu, to start a draft from. */
  selectedTrack(): { name: string; data: TrackData } | null;
  /** Installs a pack built from the drafts and switches the game to it. */
  playPack(bytes: Uint8Array): void;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The Editor section of the menu: the list of the player's own tracks and what to do with them. */
export class EditorScreens {
  private drafts: Draft[] = [];

  constructor(
    private readonly host: EditorHost,
    private readonly store: Drafts,
  ) {}

  readonly openList = async (): Promise<void> => {
    this.drafts = await this.store.list();
    this.host.open(this.listScreen);
  };

  private async add(track: ReturnType<typeof templateTrack>): Promise<void> {
    const draft = await this.store.create(track);
    this.host.edit(draft, () => void this.openList());
  }

  /** All drafts as one level pack; they go into the first level, in order. */
  private pack(): Uint8Array {
    return encodePack([
      this.drafts.map((draft) => ({ name: draft.track.name, data: toTrackData(draft.track) })),
      [],
      [],
    ]);
  }

  private readonly listScreen: ScreenBuilder = () => {
    const back = () => this.host.open(this.host.parent);
    const selected = this.host.selectedTrack();
    const items: MenuItem[] = [
      {
        kind: 'action',
        label: S.editorNew,
        run: () => void this.add(templateTrack(S.editorNewName(this.drafts.length + 1))),
      },
    ];
    if (selected) {
      items.push({
        kind: 'action',
        label: S.editorCopy(selected.name),
        run: () => {
          const track = fromTrackData(selected.name, selected.data);
          if (track) void this.add(track);
          else this.host.alert(S.editor, S.editorCannotCopy, () => this.host.open(this.listScreen));
        },
      });
    }
    for (const draft of this.drafts) {
      items.push({
        kind: 'action',
        label: draft.track.name || S.editorUnnamed,
        run: () => this.host.open(this.draftScreen(draft)),
      });
    }
    if (this.drafts.length > 0) {
      items.push(
        { kind: 'action', label: S.editorPlay, run: () => this.host.playPack(this.pack()) },
        { kind: 'action', label: S.editorSave, run: () => this.download() },
      );
    }
    items.push({ kind: 'action', label: S.back, run: back });
    return { title: S.editor, back, items };
  };

  private draftScreen(draft: Draft): ScreenBuilder {
    const self: ScreenBuilder = () => {
      const back = () => void this.openList();
      return {
        title: S.editor,
        back,
        items: [
          { kind: 'text', html: escapeHtml(draft.track.name || S.editorUnnamed), big: true },
          { kind: 'text', html: S.editorPoints(draft.track.points.length) },
          { kind: 'space', size: 10 },
          { kind: 'action', label: S.editorEdit, run: () => this.host.edit(draft, back) },
          {
            kind: 'action',
            label: S.delete,
            run: () =>
              this.host.open(() => ({
                title: S.editorDelete,
                back: () => this.host.open(self),
                items: [
                  { kind: 'text', html: S.editorDeleteConfirmation },
                  { kind: 'space', size: 10 },
                  { kind: 'action', label: S.no, run: () => this.host.open(self) },
                  { kind: 'action', label: S.yes, run: () => void this.store.delete(draft.id).then(back) },
                ],
              })),
          },
          { kind: 'action', label: S.back, run: back },
        ],
      };
    };
    return self;
  }

  private download(): void {
    const url = URL.createObjectURL(new Blob([Uint8Array.from(this.pack())], { type: 'application/octet-stream' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'levels.mrg';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
