# Agentuity Frontend — React Hooks & Client

Reference for building React frontends with `@agentuity/react` hooks.

---

## Installation

```bash
bun add @agentuity/react
```

---

## Provider Setup

Wrap your app in `<AgentuityProvider>`:

```tsx
import { AgentuityProvider } from '@agentuity/react';

export default function App() {
  return (
    <AgentuityProvider>
      <YourApp />
    </AgentuityProvider>
  );
}
```

---

## useAPI — Request/Response

The primary hook for calling API routes with full type safety.

### Basic Usage

```tsx
import { useAPI } from '@agentuity/react';

function ChatForm() {
  const { invoke, isLoading, data, error } = useAPI('POST /api/chat');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const message = formData.get('message') as string;
    try {
      await invoke({ message });
    } catch (err) {
      console.error('API call failed:', err);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="message" placeholder="Type a message..." disabled={isLoading} />
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Sending...' : 'Send'}
      </button>
      {error && <p>Error: {error.message}</p>}
      {data && <p>Response: {data.response}</p>}
    </form>
  );
}
```

### Return Values

| Property | Type | Description | Available For |
|---|---|---|---|
| `invoke` | `(input) => Promise<TOutput>` | Execute the request | POST, PUT, PATCH, DELETE |
| `refetch` | `() => Promise<void>` | Manually refetch data | GET |
| `data` | `TOutput \| undefined` | Last successful response | All |
| `error` | `Error \| null` | Last error | All |
| `isLoading` | `boolean` | True during initial load | All |
| `isFetching` | `boolean` | True during any fetch | All |
| `isSuccess` | `boolean` | True after success | All |
| `isError` | `boolean` | True if failed | All |
| `reset` | `() => void` | Reset state | All |

**GET requests auto-fetch on mount.** POST/PUT/PATCH/DELETE require calling `invoke()`.

### Options

```ts
const { data, refetch } = useAPI({
  route: 'GET /api/users',
  staleTime: 30000,        // Data stays fresh for 30s
  refetchInterval: 60000,  // Auto-refetch every 60s
  enabled: isReady,        // Only fetch when condition is true
  onSuccess: (data) => console.log('Fetched:', data),
  onError: (err) => console.error('Failed:', err),
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `route` | `string` | — | Route key (e.g., `'GET /api/users'`) |
| `query` | `URLSearchParams \| Record` | — | Query parameters |
| `headers` | `Record<string, string>` | — | Additional headers |
| `enabled` | `boolean` | `true` (GET) | Control when request executes |
| `staleTime` | `number` | `0` | Milliseconds data stays fresh |
| `refetchInterval` | `number` | — | Auto-refetch interval (ms) |
| `onSuccess` | `(data) => void` | — | Success callback |
| `onError` | `(error) => void` | — | Error callback |

### Streaming with useAPI

```ts
const { data, isLoading } = useAPI({
  route: 'POST /api/stream',
  input: { prompt: 'Hello' },
  delimiter: '\n',  // Split chunks by newline
  onChunk: (chunk) => {
    console.log('Received chunk:', chunk);
    return chunk;  // Transform before accumulation
  },
});
// data is TOutput[] — array of all received chunks
```

### Dynamic Path Parameters

```tsx
function ItemActions({ itemId }: { itemId: string }) {
  const { invoke: deleteItem, isLoading } = useAPI('DELETE /api/items/:itemId');
  const { invoke: updateItem } = useAPI('PUT /api/items/:itemId');

  const handleDelete = async () => {
    await deleteItem(undefined, { params: { itemId } });
  };

  const handleUpdate = async (name: string) => {
    await updateItem({ name }, { params: { itemId } });
  };

  return (
    <div>
      <button onClick={() => handleUpdate('New Name')} disabled={isLoading}>Rename</button>
      <button onClick={handleDelete} disabled={isLoading}>Delete</button>
    </div>
  );
}
```

---

## useWebsocket — Bidirectional Real-Time

For live chat, multiplayer sync, and shared editing.

```tsx
import { useWebsocket } from '@agentuity/react';

function RealtimeChat() {
  const { isConnected, send, messages, clearMessages } = useWebsocket('/api/chat', {
    maxMessages: 100,
  });

  return (
    <div>
      <p>Status: {isConnected ? 'Connected' : 'Connecting...'}</p>
      <ul>
        {messages.map((msg, i) => (
          <li key={i}>{JSON.stringify(msg)}</li>
        ))}
      </ul>
      <button onClick={() => send({ message: 'Hello!' })}>Send Hello</button>
      <button onClick={clearMessages}>Clear</button>
    </div>
  );
}
```

### Return Values

| Property | Type | Description |
|---|---|---|
| `isConnected` | `boolean` | True when WebSocket is open |
| `send` | `(data: TInput) => void` | Send a message |
| `data` | `TOutput \| undefined` | Last received message |
| `messages` | `TOutput[]` | All received messages |
| `clearMessages` | `() => void` | Clear messages array |
| `error` | `Error \| null` | Connection error |
| `isError` | `boolean` | True if error occurred |
| `readyState` | `number` | WebSocket state (0=connecting, 1=open, 2=closing, 3=closed) |
| `close` | `() => void` | Close connection |
| `reset` | `() => void` | Clear error state |

### Options

| Option | Type | Description |
|---|---|---|
| `query` | `URLSearchParams` | Query parameters |
| `subpath` | `string` | Subpath to append |
| `signal` | `AbortSignal` | AbortSignal to cancel |
| `maxMessages` | `number` | Max messages to keep (oldest removed) |

**Auto-Reconnection**: Connections automatically reconnect with exponential backoff. Messages sent while disconnected are queued.

---

## useEventStream — Server Push (SSE)

For one-way server-to-client streaming (progress indicators, live dashboards, notifications).

```tsx
import { useEventStream } from '@agentuity/react';

function LiveStatus() {
  const { isConnected, data, error } = useEventStream('/api/status');

  if (!isConnected) return <p>Connecting to status feed...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <div>
      <p>Live Status: {data?.status ?? 'Waiting for update...'}</p>
      <p>Last updated: {data?.timestamp ?? '-'}</p>
    </div>
  );
}
```

### Return Values

| Property | Type | Description |
|---|---|---|
| `isConnected` | `boolean` | True when EventStream is open |
| `data` | `TOutput \| undefined` | Last received event data |
| `error` | `Error \| null` | Connection error |
| `isError` | `boolean` | True if error |
| `readyState` | `number` | EventSource state (0=connecting, 1=open, 2=closed) |
| `close` | `() => void` | Close connection |
| `reset` | `() => void` | Clear error state |

---

## Choosing the Right Hook

| Hook | Pattern | Direction | Use Case |
|---|---|---|---|
| `useAPI` | Request/response | One-time | Send messages, fetch data, submit forms |
| `useWebsocket` | Bidirectional | Client ↔ Server | Live chat, multiplayer, shared editing |
| `useEventStream` | Server push | Server → Client | AI streaming, build logs, live metrics |

---

## useAuth — Authentication State

```tsx
import { useAuth } from '@agentuity/react';

function ProtectedContent() {
  const { isAuthenticated, authLoading } = useAuth();

  if (authLoading) return <p>Loading...</p>;
  if (!isAuthenticated) return <p>Please sign in to continue.</p>;

  return <p>Welcome! You have access.</p>;
}
```

### Return Values

| Property | Type | Description |
|---|---|---|
| `isAuthenticated` | `boolean` | True when auth token is set and not loading |
| `authLoading` | `boolean` | True while auth state initializing |
| `authHeader` | `string \| null` | Current Authorization header value |
| `setAuthHeader` | `(token) => void` | Manually set auth header |
| `setAuthLoading` | `(loading) => void` | Control loading state |

---

## Analytics Hooks

Track page views and custom events:

```tsx
import { useAnalytics, useTrackOnMount } from '@agentuity/react';

function ProductPage({ productId }: { productId: string }) {
  const { track, trackClick } = useAnalytics();

  useTrackOnMount({
    eventName: 'product_viewed',
    properties: { productId },
  });

  return (
    <button onClick={trackClick('add_to_cart', { productId })}>
      Add to Cart
    </button>
  );
}
```

A `withPageTracking` HOC is also available for class components.

---

## RPC Client (Non-React)

For Vue, Svelte, vanilla JS, or server-side code, use `@agentuity/frontend`:

```ts
import { createAPIClient } from '@agentuity/frontend';
// Type-safe API calls without React
```

---

## Frontend File Location

Frontend files live in `src/web/`. The build system uses Vite for the frontend and Bun for the server.

---

## Best Practices

- Always wrap your app in `<AgentuityProvider>`
- Use `useAPI` for standard request/response patterns
- Use `useWebsocket` only when you need bidirectional real-time communication
- Use `useEventStream` for server-push scenarios (dashboards, progress)
- Load client branding and industry terminology from an env-driven config endpoint
- Use `useAuth` for protected routes and conditional rendering
- Set `staleTime` on GET requests to reduce unnecessary refetching
