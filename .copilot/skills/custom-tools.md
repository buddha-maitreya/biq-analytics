# Custom Tools — ElevenLabs-Aligned Tool Taxonomy

This document describes the four tool types supported by the Business IQ Enterprise AI agent platform, aligned with the [ElevenLabs Agents](https://elevenlabs.io) taxonomy.

## Tool Type Overview

| Type | Description | User-Configurable | Storage |
|------|-------------|-------------------|---------|
| **Server** | External API calls (HTTP/REST) | ✅ Yes | `custom_tools` table |
| **Client** | Browser-side execution via SSE | ✅ Yes | `custom_tools` table |
| **System** | Built-in tools (database, analytics) | ❌ No | Agent code |
| **MCP** | Model Context Protocol servers | ❌ Future | Reserved |

Only **Server** and **Client** tools are user-configurable via the Settings UI. System tools are hardcoded in the agent and MCP tools are reserved for future implementation.

---

## 1. Server Tools

Server tools make HTTP requests to external API endpoints when invoked by the AI. They are the equivalent of ElevenLabs "Webhook" tools.

### Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `name` | `string` | ✅ | — | Unique snake_case identifier used as the AI tool key |
| `label` | `string` | ✅ | — | Human-readable display name |
| `description` | `string` | ✅ | — | Tells the AI when/why to invoke this tool |
| `parameterSchema` | `JSON` | ❌ | `{}` | JSON schema defining tool input parameters |
| `webhookUrl` | `string` | ✅ | — | The URL to call. Supports `{{variable}}` placeholders and `{path_param}` interpolation |
| `webhookMethod` | `string` | ❌ | `GET` | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `webhookHeaders` | `JSON` | ❌ | `{}` | Custom HTTP headers as key-value pairs |
| `webhookTimeoutSecs` | `number` | ❌ | `20` | Response timeout in seconds |
| `authType` | `string` | ❌ | `none` | Authentication type: `none`, `api_key`, `bearer`, `basic`, `oauth2` |
| `authConfig` | `JSON` | ❌ | `{}` | Authentication credentials (varies by `authType`) |
| `pathParamsSchema` | `JSON[]` | ❌ | `[]` | Path parameter definitions: `{ name, description, required, default }` |
| `queryParamsSchema` | `JSON[]` | ❌ | `[]` | Query parameter definitions: `{ name, description, required, default }` |
| `requestBodySchema` | `JSON` | ❌ | `{}` | Request body JSON schema for POST/PUT/PATCH |
| `dynamicVariables` | `JSON` | ❌ | `{}` | Template variables available in URL/headers/body via `{{var_name}}` |
| `dynamicVariableAssignments` | `JSON[]` | ❌ | `[]` | How to populate dynamic vars at runtime: `{ var, source, default }` |

### Authentication Types

- **`none`** — No authentication
- **`api_key`** — Custom header with API key (`authConfig: { headerName, apiKey }`)
- **`bearer`** — Bearer token in Authorization header (`authConfig: { token }`)
- **`basic`** — HTTP Basic Auth (`authConfig: { username, password }`)
- **`oauth2`** — OAuth 2.0 access token used as Bearer (`authConfig: { accessToken }`)

### Execution Flow

1. AI decides to invoke the tool based on user query and tool description
2. AI provides parameters matching `parameterSchema`
3. Service resolves dynamic variables from assignments
4. Path parameters are interpolated into the URL (`{param}` → value)
5. Query parameters are appended (GET/DELETE) or body is sent (POST/PUT/PATCH)
6. Authentication headers are injected based on `authType`
7. HTTP request is made with configured timeout
8. Response is parsed as JSON and returned to the AI

### Example

```json
{
  "toolType": "server",
  "name": "check_weather",
  "label": "Check Weather",
  "description": "Get current weather for a city",
  "parameterSchema": {
    "city": { "type": "string", "description": "City name" }
  },
  "webhookUrl": "https://api.weather.com/v1/current?city={city}",
  "webhookMethod": "GET",
  "authType": "api_key",
  "authConfig": { "headerName": "X-API-Key", "apiKey": "sk-..." },
  "webhookTimeoutSecs": 10,
  "pathParamsSchema": [{ "name": "city", "required": true }]
}
```

---

## 2. Client Tools

Client tools emit a structured action payload to the frontend via SSE. The browser handles the actual rendering or action (show modals, navigate, display cards, etc.).

### Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `name` | `string` | ✅ | — | Unique snake_case identifier |
| `label` | `string` | ✅ | — | Human-readable display name |
| `description` | `string` | ✅ | — | Tells the AI when/why to invoke this tool |
| `parameterSchema` | `JSON` | ❌ | `{}` | JSON schema defining the data the AI collects |
| `expectsResponse` | `boolean` | ❌ | `false` | Whether to wait for a response from the browser before continuing |

### Execution Flow

1. AI decides to invoke the tool
2. AI provides parameters matching `parameterSchema`
3. Service builds a structured action payload: `{ __clientAction: true, toolName, toolLabel, params, expectsResponse }`
4. The chat route sends this payload to the frontend via SSE
5. Frontend JavaScript handles the action (e.g., open a modal, navigate to a page)
6. If `expectsResponse` is `true`, the AI waits for the frontend to send back a result

### Example

```json
{
  "toolType": "client",
  "name": "show_product_card",
  "label": "Show Product Card",
  "description": "Display a product card in the user interface",
  "parameterSchema": {
    "product_id": { "type": "string", "description": "Product ID to display" }
  },
  "expectsResponse": false
}
```

---

## 3. System Tools (Built-in)

System tools are hardcoded in the data-science agent. They provide core business intelligence capabilities and are always available. They are **not** stored in the `custom_tools` table and cannot be modified by users.

| Tool Name | Description |
|-----------|-------------|
| `query_database` | Execute read-only SQL queries against the business database |
| `analyze_trends` | Run demand forecasting, anomaly detection, restock recommendations, or sales trend analysis via the insights analyzer agent |
| `generate_report` | Generate comprehensive business reports via the report generator agent |
| `search_knowledge` | Search the knowledge base for documents, policies, and procedures |
| `get_business_snapshot` | Get a quick overview of key business metrics (revenue, orders, inventory, customers) |

---

## 4. MCP Tools (Future)

MCP (Model Context Protocol) tools will allow connecting to external MCP servers that expose tools, resources, and prompts. This is reserved for future implementation.

When implemented, MCP tools will:
- Connect to MCP-compatible servers via stdio or HTTP transport
- Discover available tools at runtime
- Execute tools through the MCP protocol
- Support server-managed resources and prompts

---

## Shared Behaviour Settings

These settings apply to both **Server** and **Client** tools:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `executionMode` | `string` | `immediate` | `immediate` (run right away) or `confirm` (ask user first) |
| `preToolSpeech` | `string` | `auto` | `auto` (AI decides), `custom` (use `preToolSpeechText`), `none` |
| `preToolSpeechText` | `string` | `""` | Custom text the AI says before invoking (when `preToolSpeech = "custom"`) |
| `disableInterruptions` | `boolean` | `false` | Prevent the AI from speaking/streaming while this tool executes |
| `toolCallSound` | `string` | `none` | Sound effect when tool is invoked: `none`, `chime`, `click`, `beep` |
| `dynamicVariables` | `JSON` | `{}` | Template variables for URL/headers/body substitution |
| `dynamicVariableAssignments` | `JSON[]` | `[]` | Runtime resolution rules for dynamic variables |

---

## Database Schema

Custom tools are stored in the `custom_tools` table (see `src/db/schema.ts`).

Key columns:
- `tool_type` — `varchar(20)`, default `"server"`. Values: `server`, `client`
- `name` — `varchar(100)`, unique snake_case identifier
- `webhook_url` — URL for server tools
- `webhook_method` — HTTP method for server tools
- `auth_type` / `auth_config` — Authentication configuration
- `parameter_schema` — JSON schema for tool inputs
- `is_active` — Whether the tool is available to the AI

---

## Code Architecture

| File | Purpose |
|------|---------|
| `src/db/schema.ts` | Drizzle schema for `custom_tools` table |
| `src/services/custom-tools.ts` | CRUD operations + `executeServerTool()`, `buildClientToolAction()`, `executeTool()` dispatcher |
| `src/api/custom-tools.ts` | REST API routes for tool management + test endpoint |
| `src/agent/data-science/index.ts` | Dynamic tool loading (`buildDynamicTools()`), system prompt section, Vercel AI SDK integration |
| `src/web/pages/SettingsPage.tsx` | Custom Tools tab in Settings UI (create/edit/test/delete) |
