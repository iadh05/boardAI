import { ErrorBoundary as SentryErrorBoundary } from '@sentry/react';
import type { ReactNode } from 'react';

export type ErrorBoundaryProps = {
  /** What to show instead of the part that crashed. */
  fallback: ReactNode;
  /** Also told about the crash (Sentry is told anyway, when it is on). */
  onError?: (error: unknown) => void;
  children: ReactNode;
};

/**
 * Catches a crash while rendering its children, reports it to Sentry, and shows `fallback` — so
 * one broken part (the chat panel) doesn't blank the whole page. Sentry's boundary, because React
 * error boundaries must be classes and our components are functions (frontend.md).
 */
export function ErrorBoundary({ fallback, onError, children }: ErrorBoundaryProps) {
  return (
    <SentryErrorBoundary fallback={<>{fallback}</>} onError={(error) => onError?.(error)}>
      {children}
    </SentryErrorBoundary>
  );
}
