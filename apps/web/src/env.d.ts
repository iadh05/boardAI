/// <reference types="vite/client" />

// Build-time settings the web app reads (Vite exposes only VITE_* variables to the browser).
interface ImportMetaEnv {
  /** The web project's Sentry DSN; unset = error tracking off. See apps/web/.env.example. */
  readonly VITE_SENTRY_DSN?: string;
}
