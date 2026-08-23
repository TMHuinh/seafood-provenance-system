/// <reference types="vite/client" />

declare module 'vuestic-ui/css'

interface ImportMetaEnv {
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
