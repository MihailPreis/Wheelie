/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base address baked into replay share links. Empty in local development. */
  readonly VITE_SHARE_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
