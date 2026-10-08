import type { MenuItem, MenuScreen } from '../ui/menu/view';
import { STRINGS as S } from '../ui/strings';
import {
  type CatalogPack,
  downloadPack,
  loadCatalog,
  SORT_ORDERS,
  type SortOrder,
  searchPacks,
  sortPacks,
  trackTotal,
} from './catalog';
import type { InstalledPack, Library } from './library';
import { buildPack, ORIGINAL_PACK_ID, type Pack } from './pack';

export type ScreenBuilder = () => MenuScreen;

/** What the mod screens need from the rest of the game. */
export interface ModsHost {
  open(builder: ScreenBuilder): void;
  alert(title: string, text: string, then: () => void): void;
  /** The screen the Mods menu was entered from. */
  readonly parent: ScreenBuilder;
  activePackId(): string;
  /** Switches the game to a pack and shows its tracks. */
  usePack(pack: Pack): void;
  /** Erases the progress and the scores made on a pack. */
  forgetPack(id: string): void;
}

/** Packs listed at once; the rest come with "Load more". */
const PAGE = 50;
/** Nothing that calls itself a level pack is anywhere near this big. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_NAME = 40;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const field = (label: string, value: string): MenuItem => ({
  kind: 'text',
  html: `<span class="menu-dim">${label}:</span> ${escapeHtml(value)}`,
});
const date = (milliseconds: number) =>
  new Date(milliseconds).toLocaleDateString(S.locale, { day: 'numeric', month: 'short', year: 'numeric' });
const catalogId = (pack: CatalogPack) => `gdtr-${pack.id}`;

async function fileId(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  try {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return `file-${[...digest.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    // Hashing needs a secure context; without one the pack is simply never recognised again.
    return `file-${Date.now().toString(16)}`;
  }
}

/** The Mods section of the menu: the bundled catalogue, installed packs, and the player's own files. */
export class ModsScreens {
  private catalog: CatalogPack[] | null = null;
  private installed = new Map<string, InstalledPack>();
  private order: SortOrder = 'popular';
  private shown = PAGE;
  private query = '';

  constructor(
    private readonly host: ModsHost,
    private readonly library: Library,
    private readonly baseUrl: string,
    private readonly original: Pack,
  ) {}

  readonly menu: ScreenBuilder = () => {
    const back = () => this.host.open(this.host.parent);
    return {
      title: S.mods,
      back,
      items: [
        { kind: 'action', label: S.downloadMods, run: () => void this.openDownload() },
        { kind: 'action', label: S.installedMods, run: () => void this.openInstalled() },
        { kind: 'action', label: S.installMrg, run: () => this.pickFile() },
        { kind: 'action', label: S.back, run: back },
      ],
    };
  };

  private busy(title: string, text: string): void {
    this.host.open(() => ({ title, back: null, items: [{ kind: 'text', html: text }] }));
  }

  private async refreshInstalled(): Promise<void> {
    this.installed = new Map((await this.library.list()).map((pack) => [pack.id, pack]));
  }

  // ---- the catalogue ----------------------------------------------------------------------

  private async openDownload(): Promise<void> {
    this.busy(S.downloadMods, S.downloading);
    try {
      this.catalog ??= await loadCatalog(this.baseUrl);
      await this.refreshInstalled();
    } catch {
      this.host.alert(S.downloadMods, S.downloadError, () => this.host.open(this.menu));
      return;
    }
    this.host.open(this.downloadScreen);
  }

  private readonly downloadScreen: ScreenBuilder = () => {
    const packs = searchPacks(sortPacks(this.catalog ?? [], this.order), this.query);
    const back = () => this.host.open(this.menu);
    const items: MenuItem[] = [
      {
        kind: 'input',
        label: S.search,
        value: this.query,
        maxLength: 40,
        change: (value) => {
          this.query = value.trim();
          this.shown = PAGE;
          this.host.open(this.downloadScreen);
        },
      },
      {
        kind: 'option',
        label: S.sortBy,
        options: S.sortOrders,
        value: SORT_ORDERS.indexOf(this.order),
        change: (value) => {
          this.order = SORT_ORDERS[value] ?? 'popular';
          this.shown = PAGE;
          this.host.open(this.downloadScreen);
        },
      },
    ];
    for (const pack of packs.slice(0, this.shown)) {
      const mark = this.installed.has(catalogId(pack)) ? ` - ${S.installed}` : '';
      items.push({
        kind: 'action',
        label: `${pack.name} (${trackTotal(pack)})${mark}`,
        run: () => this.host.open(this.catalogPackScreen(pack)),
      });
    }
    if (packs.length === 0) items.push({ kind: 'text', html: S.nothingFound });
    if (packs.length > this.shown) {
      items.push({
        kind: 'action',
        label: S.loadMore(packs.length - this.shown),
        run: () => {
          this.shown += PAGE;
          this.host.open(this.downloadScreen);
        },
      });
    }
    items.push({ kind: 'action', label: S.back, run: back });
    return { title: S.downloadMods, back, items };
  };

  private catalogPackScreen(pack: CatalogPack): ScreenBuilder {
    const self: ScreenBuilder = () => {
      const back = () => this.host.open(this.downloadScreen);
      const installed = this.installed.get(catalogId(pack));
      const items: MenuItem[] = [
        { kind: 'text', html: escapeHtml(pack.name), big: true },
        field(S.author, pack.author || S.unknownAuthor),
        field(S.added, date(pack.added * 1000)),
        field(S.tracks, pack.tracks.join(' - ')),
        { kind: 'space', size: 10 },
      ];
      if (pack.broken) {
        items.push({ kind: 'text', html: S.damagedPack });
      } else if (installed) {
        items.push({
          kind: 'action',
          label: S.openInstalled,
          run: () => this.host.open(this.installedPackScreen(installed, self)),
        });
      } else {
        items.push({
          kind: 'action',
          label: S.installKb(Math.max(1, Math.round(pack.size / 1024))),
          run: () => void this.install(pack, self),
        });
      }
      items.push({ kind: 'action', label: S.back, run: back });
      return { title: S.downloadMods, back, items };
    };
    return self;
  }

  private async install(pack: CatalogPack, screen: ScreenBuilder): Promise<void> {
    this.busy(S.downloadMods, S.installing);
    const then = () => this.host.open(screen);
    let bytes: Uint8Array;
    try {
      bytes = await downloadPack(this.baseUrl, pack);
    } catch {
      this.host.alert(S.downloadMods, S.downloadInterrupted, then);
      return;
    }
    await this.store(catalogId(pack), pack.name, pack.author, bytes, then);
  }

  /** Checks a pack file and puts it in the library. */
  private async store(id: string, name: string, author: string, bytes: Uint8Array, then: () => void): Promise<void> {
    try {
      buildPack(id, name, author, bytes);
    } catch {
      this.host.alert(S.mods, S.damagedPack, then);
      return;
    }
    const pack: InstalledPack = { id, name, author, bytes, installed: Date.now() };
    await this.library.put(pack);
    this.installed.set(id, pack);
    this.host.alert(S.mods, S.successfullyInstalled, then);
  }

  // ---- installed packs --------------------------------------------------------------------

  private async openInstalled(): Promise<void> {
    await this.refreshInstalled();
    this.host.open(this.installedScreen);
  }

  private readonly installedScreen: ScreenBuilder = () => {
    const back = () => this.host.open(this.menu);
    const active = (id: string) => (this.host.activePackId() === id ? ` - ${S.active}` : '');
    const items: MenuItem[] = [
      {
        kind: 'action',
        label: this.original.name + active(ORIGINAL_PACK_ID),
        run: () => this.host.open(this.installedPackScreen(null, this.installedScreen)),
      },
    ];
    for (const pack of this.installed.values()) {
      items.push({
        kind: 'action',
        label: pack.name + active(pack.id),
        run: () => this.host.open(this.installedPackScreen(pack, this.installedScreen)),
      });
    }
    items.push({ kind: 'action', label: S.back, run: back });
    return { title: S.installedMods, back, items };
  };

  /** One pack of the library; `null` stands for the tracks the game comes with. */
  private installedPackScreen(installed: InstalledPack | null, parent: ScreenBuilder): ScreenBuilder {
    const self: ScreenBuilder = () => {
      const back = () => this.host.open(parent);
      const id = installed?.id ?? ORIGINAL_PACK_ID;
      const items: MenuItem[] = [{ kind: 'text', html: escapeHtml(installed?.name ?? this.original.name), big: true }];
      const author = installed ? installed.author : this.original.author;
      if (author) items.push(field(S.author, author));
      if (installed) items.push(field(S.installed, date(installed.installed)));
      items.push({ kind: 'space', size: 10 });
      if (this.host.activePackId() === id) {
        items.push({ kind: 'text', html: S.activeText });
      } else {
        items.push({ kind: 'action', label: S.playThese, run: () => this.use(installed, back) });
      }
      if (installed) {
        items.push({ kind: 'action', label: S.delete, run: () => this.host.open(this.deleteScreen(installed, self)) });
      }
      items.push({ kind: 'action', label: S.back, run: back });
      return { title: S.installedMods, back, items };
    };
    return self;
  }

  private use(installed: InstalledPack | null, failed: () => void): void {
    if (!installed) {
      this.host.usePack(this.original);
      return;
    }
    try {
      this.host.usePack(buildPack(installed.id, installed.name, installed.author, installed.bytes));
    } catch {
      this.host.alert(S.mods, S.damagedPack, failed);
    }
  }

  private deleteScreen(pack: InstalledPack, parent: ScreenBuilder): ScreenBuilder {
    return () => {
      const back = () => this.host.open(parent);
      return {
        title: S.deleteLevels,
        back,
        items: [
          { kind: 'text', html: S.deleteLevelsConfirmation },
          { kind: 'space', size: 10 },
          { kind: 'action', label: S.no, run: back },
          {
            kind: 'action',
            label: S.yes,
            run: () => {
              void this.library.delete(pack.id);
              this.installed.delete(pack.id);
              this.host.forgetPack(pack.id);
              if (this.host.activePackId() === pack.id) this.host.usePack(this.original);
              else this.host.open(this.installedScreen);
            },
          },
        ],
      };
    };
  }

  /**
   * A pack by its identifier, ready to play: from the library, or fetched from the bundled
   * catalogue and installed. Null if it is neither.
   */
  async obtain(id: string): Promise<Pack | null> {
    try {
      const installed = await this.library.get(id);
      if (installed) return buildPack(installed.id, installed.name, installed.author, installed.bytes);
      this.catalog ??= await loadCatalog(this.baseUrl);
      const listed = this.catalog.find((pack) => catalogId(pack) === id && !pack.broken);
      if (!listed) return null;
      const bytes = await downloadPack(this.baseUrl, listed);
      const pack = buildPack(id, listed.name, listed.author, bytes);
      const record: InstalledPack = { id, name: listed.name, author: listed.author, bytes, installed: Date.now() };
      await this.library.put(record);
      this.installed.set(id, record);
      return pack;
    } catch {
      return null;
    }
  }

  // ---- the player's own files -------------------------------------------------------------

  private pickFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mrg';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void this.installFile(file);
    });
    input.click();
  }

  /** Installs a `.mrg` file the player picked or dropped on the page. */
  async installFile(file: File): Promise<void> {
    const then = () => void this.openInstalled();
    if (file.size > MAX_FILE_BYTES) {
      this.host.alert(S.mods, S.damagedPack, then);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      buildPack('', '', '', bytes);
    } catch {
      this.host.alert(S.mods, S.damagedPack, then);
      return;
    }
    // The file name is only a suggestion: most of these files are called levels.mrg.
    let name = file.name.replace(/\.mrg$/i, '').slice(0, MAX_NAME);
    const install = async () => {
      this.busy(S.installMrg, S.installing);
      await this.store(await fileId(bytes), name.trim() || S.installMrg, '', bytes, then);
    };
    this.host.open(() => ({
      title: S.installMrg,
      back: then,
      items: [
        {
          kind: 'input',
          label: S.name,
          value: name,
          maxLength: MAX_NAME,
          change: (value) => {
            name = value;
          },
        },
        { kind: 'space', size: 10 },
        { kind: 'action', label: S.install, run: () => void install() },
        { kind: 'action', label: S.back, run: then },
      ],
    }));
  }
}
