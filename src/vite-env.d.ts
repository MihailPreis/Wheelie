/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional fallback for other hosts; auto uses the Pages/itch mapping, disabled turns tracking off. */
  readonly VITE_GA_MEASUREMENT_ID?: string;
  /** Base address baked into replay share links. Empty in local development. */
  readonly VITE_SHARE_BASE_URL?: string;
  /** Address of the short link service (see worker/); short links are offered only if it is set. */
  readonly VITE_SHORT_LINK_API?: string;
}

/** The version in package.json, put in by the build. */
declare const __APP_VERSION__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
