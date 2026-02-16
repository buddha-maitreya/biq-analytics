# Agentuity — CLI Reference

> Source: https://agentuity.dev/Reference/CLI

The Agentuity CLI is the primary interface for building, deploying, and managing agents. It handles project creation, local development, cloud deployment, storage management, configuration, debugging, and AI-assisted development.

## Installation & Setup

```bash
# Install CLI
curl -sSL https://agentuity.sh | sh
# Or via package manager
bun add -g @agentuity/cli

# Verify
agentuity --version

# Upgrade
agentuity upgrade
agentuity upgrade --force   # Force re-install
```

> **Requires:** Bun 1.3.0 or higher.

## Authentication

```bash
# Login (browser-based)
agentuity auth login        # or: agentuity login

# Check status
agentuity auth whoami

# Get API key
agentuity auth apikey

# Sign up for new account
agentuity auth signup

# Logout
agentuity auth logout       # or: agentuity logout
```

### SSH Key Management

```bash
agentuity auth ssh list                        # List keys
agentuity auth ssh add                         # Add interactively
agentuity auth ssh add --file ~/.ssh/id_ed25519.pub  # Add specific key
agentuity auth ssh delete                      # Remove interactively
agentuity auth ssh delete <fingerprint>        # Remove specific key
```

### Preferences

```bash
# Default organization
agentuity auth org select org_abc123
agentuity auth org current
agentuity auth org unselect

# Default region
agentuity cloud region select usw     # US West
agentuity cloud region current
agentuity cloud region unselect
```

### Configuration Profiles

```bash
agentuity profile use production    # Switch profile
agentuity profile list              # List profiles
```

Config stored in `~/.config/agentuity/<profile>.yaml`.

---

## Creating & Managing Projects

### Create

```bash
agentuity project create                  # Interactive
agentuity create                          # Shortcut
agentuity project create --name my-agent  # Named
agentuity project create --name my-agent --dir ~/projects  # Custom dir
```

#### Project Creation Options

| Flag | Purpose |
|------|---------|
| `--name <name>` | Project name |
| `--dir <path>` | Target directory |
| `--template <name>` | Template (default: "default") |
| `--no-install` | Skip dependency installation |
| `--no-build` | Skip initial build |
| `--no-register` | Don't register with cloud |
| `--database <value>` | `skip`, `new`, or existing DB name |
| `--storage <value>` | `skip`, `new`, or existing bucket name |
| `--enable-auth` | Enable Agentuity Auth |

#### Headless (CI/CD)

```bash
# Create with new database and storage
agentuity project create \
  --name my-agent \
  --database new \
  --storage new \
  --enable-auth

# Skip optional resources
agentuity project create \
  --name my-agent \
  --database skip \
  --storage skip
```

### Manage

```bash
agentuity project list                    # List all projects
agentuity --json project list             # JSON output (for scripts)
agentuity project show <project-id>       # Details
agentuity project delete                  # Interactive delete
agentuity project delete <id> --confirm   # Force delete
agentuity project import                  # Import existing project
agentuity project import --dir ./path     # Import from directory
agentuity project import --validate-only  # Dry-run validation
```

### Default Template Contents

Running `agentuity create` scaffolds:
- **Translation agent** — Demonstrates AI Gateway, thread state, structured logging
- **API routes** — Shows agent integration and state management endpoints
- **React frontend** — Pre-configured with Tailwind CSS
- **Workbench** — Local testing UI at `/workbench`
- **Evaluations** — Example eval setup for testing agent behavior

---

## Local Development

```bash
agentuity dev             # Start dev server (port 3500)
bun run dev               # Alias
```

### Dev Server Options

| Flag | Default | Purpose |
|------|---------|---------|
| `--port` | 3500 | TCP port |
| `--local` | false | Offline mode (no cloud services) |
| `--no-public` | - | Disable public URL tunneling |
| `--no-interactive` | - | Disable keyboard shortcuts |
| `--inspect` | - | Enable Bun debugger |
| `--inspect-wait` | - | Wait for debugger before starting |
| `--inspect-brk` | - | Break on first line |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `h` | Show help |
| `c` | Clear console |
| `r` | Restart server |
| `o` | Show routes |
| `a` | Show agents |
| `q` | Quit |

### Public URLs

Enabled by default — your local server gets a public HTTPS URL instantly via Agentuity's Gravity network. Useful for webhook testing, sharing, mobile testing, OAuth callbacks.

```
⨺ Agentuity DevMode
  Local:   http://127.0.0.1:3500
  Public:  https://abc123.devmode.agentuity.com
```

### Local Mode

```bash
agentuity dev --local   # No cloud services
```

In local mode: cloud storage APIs disabled, no public URL, requires your own LLM API keys.

### Workbench UI

Access at `http://localhost:3500/workbench` — visual agent testing with schemas, input validation, execution results, and timing metrics.

### Building

```bash
agentuity build                      # Full build
agentuity build --skip-type-check    # Skip TypeScript checks
agentuity build --outdir ./dist      # Custom output
```

Build steps: TypeScript compilation → bundle agents/routes/frontend → generate registry/types → type check → create `.agentuity/` output.

### Hot Reload

- Source file changes (`.ts`, `.tsx`, `.js`, `.jsx`) trigger rebuild + restart
- Frontend changes use Vite HMR (instant)
- 500ms cooldown prevents restart loops
- Ignores: `node_modules/`, `.agentuity/`, `*.generated.ts`

---

## Deploying to the Cloud

```bash
agentuity deploy          # Deploy current project
bun run deploy            # Alias
```

### What Happens

1. Syncs env vars from `.env.production` (or `.env` fallback)
2. Builds and packages project
3. Encrypts and uploads deployment bundle
4. Provisions infrastructure
5. Activates deployment

### Deployment URLs

Each deployment gets two URLs:
- **Deployment URL** (`dep_xxx.agentuity.cloud`) — unique to this specific deploy, persists forever
- **Project URL** (`proj_xxx.agentuity.cloud`) — always points to active deployment, updates on deploy

### Deploy Options

| Flag | Purpose |
|------|---------|
| `-y, --confirm` | Skip prompts (CI/CD) |
| `--dry-run` | Simulate without executing |
| `--log-level debug` | Verbose output |
| `--project-id <id>` | Deploy specific project |
| `--message <msg>` | Associate message with build |

### Managing Deployments

```bash
agentuity cloud deployment list                    # List recent
agentuity cloud deployment list --count=25         # Custom count
agentuity cloud deployment show dep_abc123         # Details
agentuity cloud deployment logs dep_abc123         # View logs
agentuity cloud deployment logs dep_abc123 --limit=50
agentuity cloud deployment rollback                # Revert to previous
agentuity cloud deployment undeploy                # Stop active
agentuity cloud deployment undeploy --force        # Skip prompt
agentuity cloud deployment remove dep_abc123       # Permanent delete
```

### Resource Configuration

In `agentuity.json`:

```json
{
  "deployment": {
    "resources": {
      "cpu": "500m",
      "memory": "512Mi",
      "disk": "1Gi"
    },
    "domains": []
  }
}
```

Defaults: `cpu: "500m"`, `memory: "500Mi"`, `disk: "500Mi"`.

### Custom Domains

```json
{
  "deployment": {
    "domains": ["api.example.com", "app.example.com"]
  }
}
```

Add CNAME record: `api.example.com → p<hash>.agentuity.cloud`. CLI validates DNS during deploy.

### Regions

Available: `use` (US East), `usc` (US Central), `usw` (US West).

```bash
agentuity cloud region select usw    # Set default
agentuity cloud region current       # View current
```

Region stored in `agentuity.json` after first deploy. Cross-region resource access handled automatically.

### CI/CD Pipelines

```bash
# Skip all prompts
agentuity deploy --confirm

# Pre-created deployment (for external CI systems)
export AGENTUITY_DEPLOYMENT='{"id":"dep_xxx","orgId":"org_xxx","publicKey":"..."}'
agentuity deploy
```

### Preview Environments

Enable in Agentuity App → Project → Settings → GitHub → "Deploy PRs to preview environments". Every PR auto-deploys to a unique preview URL.

### Machine Management

```bash
agentuity cloud machine list                     # List machines
agentuity cloud machine get mach_abc123          # Details
agentuity cloud machine delete mach_abc123       # Delete
agentuity cloud machine deployments mach_abc123  # List deployments on machine
```

---

## Environment Variables & Secrets

### Environment Variables (non-sensitive)

```bash
agentuity cloud env list                  # List
agentuity cloud env get NODE_ENV          # Get
agentuity cloud env set NODE_ENV production  # Set
agentuity cloud env delete OLD_CONFIG     # Delete
agentuity cloud env push                  # Upload from .env.production
agentuity cloud env pull                  # Download to .env.production
agentuity cloud env pull --force          # Overwrite local
agentuity cloud env import .env.staging   # Import from file
```

### Secrets (sensitive — encrypted)

```bash
agentuity cloud secret list
agentuity cloud secret get API_KEY
agentuity cloud secret set API_KEY "sk_live_..."
agentuity cloud secret delete OLD_TOKEN
agentuity cloud secret push              # Push from local
agentuity cloud secret pull              # Pull to local
agentuity cloud secret import .env.secrets
```

> **Auto-detection:** Variables with suffixes `_SECRET`, `_KEY`, `_TOKEN`, `_PASSWORD`, `_PRIVATE` are automatically encrypted as secrets during deploy.

### Organization-Level Config

```bash
# Shared across all projects in org
agentuity cloud env set DATABASE_URL "postgresql://..." --org
agentuity cloud secret set SHARED_API_KEY "sk_..." --org
agentuity cloud env list --org
agentuity cloud secret list --org
```

Project-level values take precedence over org-level.

### API Keys

```bash
agentuity cloud apikey create --name "Production Key" --expires-at 1y
agentuity cloud apikey create --name "CI/CD Key" --expires-at 90d --confirm
agentuity cloud apikey list
agentuity cloud apikey get <key-id>
agentuity cloud apikey delete <key-id>
```

> API key value shown only once during creation. Store as `AGENTUITY_SDK_KEY` in `.env`.

---

## Storage Commands

All require `cloud` prefix: `agentuity cloud <storage-type> ...`

### Key-Value Storage

KV is scoped to the organization, not individual projects.

```bash
agentuity cloud kv repl                          # Interactive REPL
agentuity cloud kv get <namespace> <key>         # Get value
agentuity cloud kv set <ns> <key> '<json>'       # Set value
agentuity cloud kv set <ns> <key> "data" --ttl 3600  # With TTL
agentuity cloud kv delete <ns> <key>             # Delete
agentuity cloud kv keys <ns>                     # List keys
agentuity cloud kv search <ns> <pattern>         # Search
agentuity cloud kv stats                         # All stats
agentuity cloud kv stats <ns>                    # Namespace stats
agentuity cloud kv list-namespaces               # List namespaces
agentuity cloud kv create-namespace <name>       # Create namespace
agentuity cloud kv delete-namespace <name>       # Delete namespace + keys
```

In agents: `ctx.kv`

### S3 / Object Storage

`cloud storage` and `cloud s3` are interchangeable.

```bash
agentuity cloud s3 create --name my-storage     # Create (adds creds to .env)
agentuity cloud s3 list                          # List resources
agentuity cloud s3 upload ./file.pdf             # Upload
agentuity cloud s3 download <file-id> --output ./file.pdf  # Download
agentuity cloud s3 get <storage-id>              # Details
agentuity cloud s3 delete <storage-id>           # Delete
```

In agents: `import { s3 } from "bun"`

### Vector Storage

```bash
agentuity cloud vector search <ns> "query text"          # Search
agentuity cloud vector search <ns> "query" --limit 5     # Limit results
agentuity cloud vector search <ns> "query" --similarity 0.8  # Min threshold
agentuity cloud vector search <ns> "query" --metadata category=ai  # Filter
agentuity cloud vec get <vector-id>                       # Get by ID
agentuity cloud vector upsert <ns> --file vectors.json   # Bulk upsert
agentuity cloud vec delete <vector-id>                    # Delete
agentuity cloud vector stats                              # All stats
agentuity cloud vector stats <ns>                         # Namespace stats
agentuity cloud vector namespaces                         # List namespaces
agentuity cloud vector delete-namespace <name>            # Delete namespace
```

In agents: `ctx.vector`

### Database

```bash
agentuity cloud db list                     # List databases
agentuity cloud db create --name my-db      # Create (adds DATABASE_URL to .env)
agentuity cloud db create --name my-db --description "Description"
agentuity cloud db get <db-id>              # Details
agentuity cloud db sql "SELECT * FROM users LIMIT 10"  # Run SQL
agentuity cloud db logs <db-id>             # View logs
agentuity cloud db delete <db-id>           # Delete
```

In agents: `import { sql } from "bun"` or `@agentuity/drizzle`

### Streams

```bash
agentuity cloud stream list              # List streams
agentuity cloud stream get <stream-id>   # Details
agentuity cloud stream delete <id>       # Delete
```

In agents: `ctx.stream`

### Redis

```bash
agentuity cloud redis show                    # Connection URL (masked)
agentuity cloud redis show --show-credentials # Show full credentials
agentuity --json cloud redis show             # JSON output
```

Redis is provisioned at the org level. Add `REDIS_URL=redis://...` to `.env` for local use.

---

## Debugging Deployments

### SSH Access

```bash
agentuity cloud ssh                    # SSH into current project
agentuity cloud ssh proj_abc123        # Specific project
agentuity cloud ssh dep_abc123         # Specific deployment
agentuity cloud ssh sbx_abc123         # Into a sandbox
agentuity cloud ssh 'ps aux'           # Run command and exit
agentuity cloud ssh proj_abc123 'tail -f /var/log/app.log'
agentuity cloud ssh --show             # Show SSH command without executing
```

> Requires SSH key: `agentuity auth ssh add --file ~/.ssh/id_rsa.pub`

### File Transfer (SCP)

```bash
agentuity cloud scp upload ./config.json                  # Upload to home
agentuity cloud scp upload ./config.json /app/config.json # Upload to path
agentuity cloud scp download /var/log/app.log             # Download
agentuity cloud scp download /app/config.json --identifier=proj_abc123
```

### Agent Inspection

```bash
agentuity cloud agent list                             # List agents
agentuity cloud agent list --project-id=proj_abc123    # Filter by project
agentuity cloud agent get agent_abc123                 # Details
```

### Session Logs

```bash
agentuity cloud session list                           # Recent sessions
agentuity cloud session list --count=25                # Custom count
agentuity cloud session list --success=false           # Failed only
agentuity cloud session list --trigger=api             # By trigger type
agentuity cloud session list --env=production          # By environment
agentuity cloud session get sess_abc123                # Full details + timeline
agentuity cloud session logs sess_abc123               # View logs
agentuity cloud session logs sess_abc123 --no-timestamps
```

### Thread Inspection

```bash
agentuity cloud thread list                 # List threads
agentuity cloud thread list --count=25
agentuity cloud thread get thrd_abc123      # Details
agentuity cloud thread delete thrd_abc123   # Delete
```

### Evaluation Commands

```bash
agentuity cloud eval list                   # List evaluations
agentuity cloud eval get eval_abc123        # Details
agentuity cloud eval-run list               # List eval runs
agentuity cloud eval-run get run_abc123     # Run details
```

### Support & Diagnostics

```bash
agentuity support report                          # Create GitHub issue with logs
agentuity support report --description "..."      # With description
agentuity support logs show                       # Recent CLI logs
agentuity support logs path                       # Log file path
agentuity support system                          # OS, Bun, CLI versions
```

---

## AI Commands

Commands for AI coding agents and IDE integration.

```bash
# CLI capabilities (machine-readable)
agentuity ai capabilities show

# Command schema (for programmatic tools)
agentuity ai schema show
agentuity ai schema generate

# Prompt generation (context for LLMs)
agentuity ai prompt agent    # Agent development context
agentuity ai prompt api      # API/route development context
agentuity ai prompt web      # Frontend development context
agentuity ai prompt llm      # General LLM context
```

### Project Context Files (AGENTS.md)

During `agentuity dev`, the CLI auto-generates context files for AI coding assistants:

```
.agents/
└── agentuity/
    └── sdk/
        ├── agent/AGENTS.md   # Agent creation patterns
        ├── api/AGENTS.md     # Route creation patterns
        └── web/AGENTS.md     # Frontend patterns
```

Add `.agents/` to `.gitignore`.

### OpenCode Plugin

```bash
agentuity ai opencode install       # Install plugin
agentuity ai opencode uninstall     # Remove plugin
agentuity ai opencode run "task"    # Headless mode
agentuity ai opencode run --sandbox "run tests"  # In cloud sandbox
agentuity ai opencode run --json "fix bug"       # JSON output
```

### Cadence Mode (Long-Running AI Sessions)

```bash
# Interactive (in OpenCode)
/agentuity-cadence Build a complete auth system with tests

# Headless
agentuity ai opencode run "/agentuity-cadence Build auth system"
```

---

## Global Options

| Flag | Purpose |
|------|---------|
| `--json` | Machine-readable JSON output |
| `--log-level <level>` | `debug`, `trace`, `info`, `warn`, `error` |
| `--quiet` | Suppress non-essential output |
| `--no-progress` | Disable progress indicators |
| `--color <mode>` | `auto`, `always`, `never` |
| `--explain` | Show what command would do |
| `--dry-run` | Simulate execution |
| `--skip-version-check` | Disable auto version check |

```bash
agentuity --json project list                  # JSON output
agentuity --log-level=debug deploy             # Verbose
agentuity --dry-run deploy                     # Simulate
agentuity --json project list | jq '.[].name'  # Pipe to jq
```

## Command Shortcuts

| Full Command | Shortcut |
|-------------|----------|
| `agentuity auth login` | `agentuity login` |
| `agentuity auth logout` | `agentuity logout` |
| `agentuity auth signup` | `agentuity signup` |
| `agentuity project create` | `agentuity create` |
| `agentuity cloud deploy` | `agentuity deploy` |
| `agentuity cloud ssh` | `agentuity ssh` |

---

## Development vs Production

| Aspect | Development (`agentuity dev`) | Production (`agentuity deploy`) |
|--------|-------------------------------|--------------------------------|
| Storage | Cloud (or local with `--local`) | Cloud always |
| AI Gateway | Available (or BYO keys with `--local`) | Available always |
| URL | `localhost:3500` + optional public tunnel | `*.agentuity.cloud` or custom domain |
| Hot Reload | Yes | No (redeploy required) |
| Debugging | Local logs, Workbench | SSH access, cloud logs |
| Environment | `.env` | `.env.production` (synced to cloud) |
