/**
 * Type augmentation for @agentuity/react.
 *
 * The actual package exports `useAPI`, `AgentuityProvider`, etc.,
 * but TypeScript can't resolve them through the transitive dependency
 * chain (@agentuity/react → @agentuity/frontend → RouteRegistry).
 *
 * This file provides local type declarations so `tsc --noEmit` passes.
 * At runtime, the real exports from @agentuity/react are used.
 */

declare module "@agentuity/react" {
  import type { FC, ReactNode } from "react";

  /** Provider that wraps the app and enables useAPI, useWebsocket, etc. */
  export const AgentuityProvider: FC<{ children: ReactNode }>;

  /** Result shape for GET-style useAPI calls. */
  interface UseAPIGetResult<T> {
    data: T | undefined;
    error: Error | null;
    isLoading: boolean;
    isFetching: boolean;
    isSuccess: boolean;
    isError: boolean;
    refetch: () => void;
    reset: () => void;
  }

  /** Result shape for mutation-style (POST/PUT/DELETE) useAPI calls. */
  interface UseAPIMutationResult<T> {
    data: T | undefined;
    error: Error | null;
    isLoading: boolean;
    invoke: (body?: unknown) => Promise<T>;
    reset: () => void;
  }

  /**
   * Universal data-fetching hook.
   *
   * For GET requests, pass a route string and get reactive data back.
   * For mutations, use the object form with `method`.
   */
  export function useAPI<T = unknown>(route: string): UseAPIGetResult<T>;
  export function useAPI<T = unknown>(options: {
    method?: string;
    path: string;
    body?: unknown;
  }): UseAPIMutationResult<T>;

  /** Agentuity context value exposed by useAgentuity(). */
  export function useAgentuity(): Record<string, unknown>;

  /** Auth hook. */
  export function useAuth(): Record<string, unknown>;
}
