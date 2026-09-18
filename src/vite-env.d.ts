/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the JSON API, e.g. "http://localhost:3001". Empty = same origin. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Project homepage (package.json `homepage`), injected via `define` in vite.config.ts. */
declare const __HOMEPAGE__: string;
