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
    isFetching: boolean;
    isSuccess: boolean;
    isError: boolean;
    invoke: (body?: unknown, options?: { params?: Record<string, string> }) => Promise<T>;
    reset: () => void;
  }

  /**
   * Universal data-fetching hook.
   *
   * GET routes auto-fetch and return reactive data.
   * POST/PUT/DELETE routes return an invoke() function.
   */
  export function useAPI<T = unknown>(route: `GET ${string}`): UseAPIGetResult<T>;
  export function useAPI<T = unknown>(route: `POST ${string}`): UseAPIMutationResult<T>;
  export function useAPI<T = unknown>(route: `PUT ${string}`): UseAPIMutationResult<T>;
  export function useAPI<T = unknown>(route: `PATCH ${string}`): UseAPIMutationResult<T>;
  export function useAPI<T = unknown>(route: `DELETE ${string}`): UseAPIMutationResult<T>;
  export function useAPI<T = unknown>(route: string): UseAPIGetResult<T>;
  export function useAPI<T = unknown>(options: {
    route: string;
    staleTime?: number;
    refetchInterval?: number;
    enabled?: boolean;
    onSuccess?: (data: T) => void;
    onError?: (error: Error) => void;
    delimiter?: string;
    onChunk?: (chunk: unknown) => unknown;
    input?: unknown;
  }): UseAPIGetResult<T> | UseAPIMutationResult<T>;

  // ── useWebsocket ────────────────────────────────────────

  interface WebsocketOptions {
    query?: URLSearchParams;
    subpath?: string;
    signal?: AbortSignal;
    maxMessages?: number;
  }

  interface UseWebsocketResult<TOutput, TInput> {
    isConnected: boolean;
    send: (data: TInput) => void;
    data: TOutput | undefined;
    messages: TOutput[];
    clearMessages: () => void;
    error: Error | null;
    isError: boolean;
    readyState: number;
    close: () => void;
    reset: () => void;
  }

  /** Bidirectional real-time communication hook (WebSocket). */
  export function useWebsocket<TOutput = unknown, TInput = unknown>(
    route: string,
    options?: WebsocketOptions,
  ): UseWebsocketResult<TOutput, TInput>;

  // ── useEventStream ──────────────────────────────────────

  interface EventStreamOptions {
    query?: URLSearchParams;
    subpath?: string;
    signal?: AbortSignal;
  }

  interface UseEventStreamResult<T> {
    isConnected: boolean;
    data: T | undefined;
    error: Error | null;
    isError: boolean;
    readyState: number;
    close: () => void;
    reset: () => void;
  }

  /** Server-push hook (Server-Sent Events). */
  export function useEventStream<T = unknown>(
    route: string,
    options?: EventStreamOptions,
  ): UseEventStreamResult<T>;

  /** Agentuity context value exposed by useAgentuity(). */
  export function useAgentuity(): Record<string, unknown>;

  /** Auth hook. */
  export function useAuth(): Record<string, unknown>;
}
