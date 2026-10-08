import { encodePack, type TrackData } from '../formats/mrg';
import { LEVEL_NAMES } from '../game/progress';
import { buildPack, type Pack } from '../mods/pack';
import { encodeTrackLink } from '../replay/share';
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
  /** The level pack being played, to take into the editor whole. */
  activePack(): Pack;
  /** Address that links are built on. */
  readonly shareBaseUrl: string;
  /** Installs a pack built from the drafts and switches the game to it. */
  playPack(bytes: Uint8Array): void;
}

/** Tracks taken into the editor at once; a pack of more is cut short. */
const MAX_IMPORT = 150;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const levelOf = (draft: Draft) => (draft.level === 1 || draft.level === 2 ? draft.level : 0);

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

  /** All drafts as one level pack, each in the level it was given, in the order they were made. */
  private pack(): Uint8Array {
    return encodePack(
      [0, 1, 2].map((level) =>
        this.drafts
          .filter((draft) => levelOf(draft) === level)
          .map((draft) => ({ name: draft.track.name, data: toTrackData(draft.track) })),
      ),
    );
  }

  /** Takes a track from outside into the drafts and shows the list. */
  async adopt(name: string, data: TrackData): Promise<boolean> {
    const track = fromTrackData(name, data);
    if (track) await this.store.create(track);
    await this.openList();
    return track !== null;
  }

  /** Takes every track of a pack into the drafts, as far as the editor can hold them. */
  private async importPack(pack: Pack): Promise<void> {
    let taken = 0;
    let skipped = 0;
    for (const [level, tracks] of pack.levels.entries()) {
      for (const source of tracks) {
        const track = taken < MAX_IMPORT ? fromTrackData(source.name, source.data) : null;
        if (track) {
          await this.store.create(track, level);
          taken++;
        } else {
          skipped++;
        }
      }
    }
    this.host.alert(S.editor, S.editorImported(taken, skipped), () => void this.openList());
  }

  private pickFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mrg';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void this.importFile(file);
    });
    input.click();
  }

  /** Takes the tracks of a `.mrg` file into the drafts. */
  async importFile(file: File): Promise<void> {
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Too large');
      await this.importPack(buildPack('', '', '', new Uint8Array(await file.arrayBuffer())));
    } catch {
      this.host.alert(S.editor, S.damagedPack, () => void this.openList());
    }
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
    const pack = this.host.activePack();
    items.push(
      { kind: 'action', label: S.editorCopyPack(pack.name), run: () => void this.importPack(pack) },
      { kind: 'action', label: S.editorImportFile, run: () => this.pickFile() },
    );
    for (const draft of this.drafts) {
      items.push({
        kind: 'action',
        label: `${draft.track.name || S.editorUnnamed} - ${LEVEL_NAMES[levelOf(draft)] ?? ''}`,
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

  private draftScreen(draft: Draft, status = ''): ScreenBuilder {
    const self: ScreenBuilder = () => {
      const back = () => void this.openList();
      const say = (text: string) => this.host.open(this.draftScreen(draft, text));
      return {
        title: S.editor,
        back,
        items: [
          { kind: 'text', html: escapeHtml(draft.track.name || S.editorUnnamed), big: true },
          { kind: 'text', html: S.editorPoints(draft.track.points.length) },
          { kind: 'text', html: status || '&nbsp;' },
          { kind: 'action', label: S.editorEdit, run: () => this.host.edit(draft, back) },
          {
            kind: 'option',
            label: S.level,
            options: LEVEL_NAMES,
            value: levelOf(draft),
            change: (value) => {
              draft.level = value;
              void this.store.save(draft);
              say('');
            },
          },
          {
            kind: 'action',
            label: S.copyLink,
            run: () => {
              const one = encodePack(
                [0, 1, 2].map((level) =>
                  level === 0 ? [{ name: draft.track.name, data: toTrackData(draft.track) }] : [],
                ),
              );
              void encodeTrackLink(this.host.shareBaseUrl, Uint8Array.from(one))
                .then(async (url) => {
                  await navigator.clipboard.writeText(url);
                  say(S.linkCopied(url.length));
                })
                .catch(() => say(S.exportFailed));
            },
          },
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
