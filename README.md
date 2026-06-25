# cds-kb-mcp

A **dataless** MCP server that gives AI agents access to **7,355 SAP S/4HANA CDS views** via
semantic search. Ships **no view data** — you point it at the data either locally or remotely.

The whole server bundles into **one file** (`dist/cds-kb-mcp.mjs`, ~784 KB) that runs on
any machine with Node ≥ 18.

Works with **Claude Desktop**, **Claude Code**, **Antigravity IDE**, and any MCP-compatible client.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Data Source Configuration](#data-source-configuration)
- [Tools Reference](#tools-reference)
- [Client Registration](#client-registration)
- [Data Enrichment](#data-enrichment)
- [Architecture](#architecture)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# 1. Clone both repos
git clone https://github.com/truongdva2/cds-kb-mcp.git
git clone https://github.com/truongdva2/cds_knowledge_base.git cds-kb-data

# 2. Run the server (no npm install needed — dist/ is pre-built)
node cds-kb-mcp/dist/cds-kb-mcp.mjs --data ./cds-kb-data

# Or run from remote (no data clone needed)
node cds-kb-mcp/dist/cds-kb-mcp.mjs --remote https://raw.githubusercontent.com/truongdva2/cds_knowledge_base/main
```

---

## Installation

### Option A: Use pre-built bundle (recommended)

The `dist/cds-kb-mcp.mjs` file is committed to the repo — no build step required.

```bash
git clone https://github.com/truongdva2/cds-kb-mcp.git
# That's it. The server is ready to run.
```

### Option B: Build from source

```bash
git clone https://github.com/truongdva2/cds-kb-mcp.git
cd cds-kb-mcp
npm install
npm run build    # → dist/cds-kb-mcp.mjs (~784 KB, self-contained)
```

### Prerequisites

- **Node.js ≥ 18** (uses native `fetch`, ES modules)
- No other runtime dependencies — everything is bundled into the single file

---

## Data Source Configuration

The server needs a data source. It resolves in this precedence order — **local wins when both are set**:

| Priority | Flag | Env Var | Mode |
|---|---|---|---|
| 1 | `--data <path>` | `CDS_KB_DATA` | **Local** — reads a cloned data repo. Offline, fastest. |
| 2 | `--remote <url>` | `CDS_KB_REMOTE` | **Remote** — downloads index once, lazy-fetches views, cached to `~/.cache/cds-kb/`. |

### Local mode (recommended for development)

```bash
# Clone the data repo
git clone https://github.com/truongdva2/cds_knowledge_base.git /path/to/cds-kb-data

# Run with local data
node dist/cds-kb-mcp.mjs --data /path/to/cds-kb-data
```

**Advantages:** Offline, instant file reads, no network latency.

### Remote mode (zero-clone setup)

```bash
node dist/cds-kb-mcp.mjs --remote https://raw.githubusercontent.com/truongdva2/cds_knowledge_base/main
```

**How it works:**
1. Downloads `search_index.json` (~4.7 MB) once → cached to `~/.cache/cds-kb/<hash>/`
2. Individual views fetched on-demand when `get_cds_view` is called → also cached
3. Cache auto-expires after **24 hours** (configurable via `CDS_KB_CACHE_TTL_HOURS`)
4. Force re-download: set `CDS_KB_REFRESH=1`

---

## Tools Reference

The server exposes **4 MCP tools**:

### `search_cds`

Search CDS views by business meaning, name, or tags. Returns a ranked shortlist.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | ✅ | Natural-language or keyword query |
| `module` | string | ❌ | Module code (`FI`, `SD`, `MM`) or name (`Finance`, `Procurement`) |
| `lob` | string | ❌ | Line-of-business filter (partial match) |
| `bo` | string | ❌ | Business object filter (partial match) |
| `limit` | number | ❌ | Max results, 1–50 (default: 10) |

**Examples:**
```
search_cds("purchase order")
search_cds("overdue customer invoices", module="Finance")
search_cds("journal entry", module="FI", limit=5)
search_cds("material stock", bo="Inventory")
```

**Module aliases** — you can use natural names instead of codes:

| Natural name | Code | Natural name | Code |
|---|---|---|---|
| Finance, Accounting | FI | Sales, Distribution | SD |
| Procurement, Purchasing | MM | Production, Manufacturing | PP |
| Controlling | CO | Plant Maintenance | PM |
| Quality Management | QM | Logistics | LE |
| Transportation | TM | Supply Chain | SCM |
| Real Estate | RE | Project Management | PPM |
| CRM | CRM | Basis | BC |

### `get_cds_view`

Return the full (or partial) markdown definition of one CDS view.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✅ | Exact view name (case-insensitive) |
| `sections` | string[] | ❌ | Filter to specific sections (saves tokens) |

**Available sections:** `metadata`, `fields`, `associations`, `source`

**Examples:**
```
get_cds_view("I_PurchaseOrderAPI01")                       # full view
get_cds_view("I_PurchaseOrderAPI01", sections=["metadata", "fields"])  # 62% smaller
get_cds_view("C_PURCHASEORDERDEX", sections=["source"])    # DDL only
```

> **💡 Token savings:** For large views (some are 50–95 KB), using `sections` can save
> **60–80%** of tokens. Always use `["metadata", "fields"]` first, then fetch `source`
> only if needed.

### `list_modules`

List all SAP modules with view counts and business objects. Use before searching to discover what's available.

| Parameter | Type | Required | Description |
|---|---|---|---|
| *(none)* | — | — | — |

**Example output:**
```
SAP Modules (31 modules, 7355 total views):

- FI (1136 views) — Finance  BOs: Asset, Bank, Customer, JournalEntry, Supplier, ...
- SD (759 views) — Sales & Distribution  BOs: BillingDocument, Customer, SalesOrder, ...
- MM (547 views) — Sourcing & Procurement  BOs: Material, PurchaseOrder, Supplier, ...
...
```

### `kb_info`

Report the active data source, view count, enrichment coverage, and index build time.

**Example output:**
```
source: local:/path/to/cds-kb-data
views: 7355
enriched: 7160
modules: 31
builtAt: 2026-06-25T09:01:31.059Z
```

---

## Client Registration

### Claude Code

```bash
# Local data
claude mcp add cds-kb -- node /abs/path/to/cds-kb-mcp/dist/cds-kb-mcp.mjs --data /abs/path/to/cds-kb-data

# Remote data
claude mcp add cds-kb -- node /abs/path/to/cds-kb-mcp/dist/cds-kb-mcp.mjs --remote https://raw.githubusercontent.com/truongdva2/cds_knowledge_base/main
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cds-kb": {
      "command": "node",
      "args": [
        "/abs/path/to/cds-kb-mcp/dist/cds-kb-mcp.mjs",
        "--data",
        "/abs/path/to/cds-kb-data"
      ]
    }
  }
}
```

> Restart Claude Desktop after editing.

### Antigravity IDE

Add via the IDE's MCP settings UI:

| Setting | Value |
|---|---|
| **Command** | `node` |
| **Args** | `["/abs/path/to/cds-kb-mcp/dist/cds-kb-mcp.mjs", "--data", "/abs/path/to/cds-kb-data"]` |

Or for remote mode:

| Setting | Value |
|---|---|
| **Command** | `node` |
| **Args** | `["/abs/path/to/cds-kb-mcp/dist/cds-kb-mcp.mjs", "--remote", "https://raw.githubusercontent.com/truongdva2/cds_knowledge_base/main"]` |

### Generic MCP Client

The server uses **stdio transport** (stdin/stdout JSON-RPC). Any MCP-compatible client that
supports stdio can connect:

```bash
node /path/to/dist/cds-kb-mcp.mjs --data /path/to/cds-kb-data
```

---

## Data Enrichment

The search index ships with **7,160 enriched views** (97.3%) that have human-readable
`semanticDescription` extracted from `@EndUserText.label` annotations in DDL source.

### Re-run enrichment after data updates

```bash
cd cds-kb-mcp
node enrich_index.mjs /path/to/cds-kb-data
```

This will:
1. Scan all 7,355 view files for `@EndUserText.label`
2. Populate `semanticDescription` field in the index
3. Improve `description` field where it was just name-derived
4. Extract tags from YAML frontmatter
5. Rebuild the MiniSearch index from scratch
6. Create a `.bak` backup of the original index

### Rebuild from scratch (after adding new views)

```bash
# Re-run enrichment — it will pick up any new view files
node enrich_index.mjs /path/to/cds-kb-data

# Then rebuild the dist bundle
npm run build
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   AI Agent / Client                  │
│            (Claude, Antigravity IDE, etc.)            │
└──────────────────────┬──────────────────────────────┘
                       │ MCP (stdio JSON-RPC)
                       ▼
┌─────────────────────────────────────────────────────┐
│              cds-kb-mcp (this repo)                  │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  search_cds  │  │ get_cds_view │  │list_modules│ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                 │                 │        │
│         ▼                 ▼                 ▼        │
│  ┌──────────────────────────────────────────────┐   │
│  │          MiniSearch (in-memory BM25)          │   │
│  │  boost: name(3x) semantic(2.5x) tags(1.5x)  │   │
│  └──────────────────────┬───────────────────────┘   │
│                         │                            │
│  ┌──────────────────────▼───────────────────────┐   │
│  │  DataSource (Local or Remote, pluggable)      │   │
│  │  - LocalDataSource: direct file reads         │   │
│  │  - RemoteDataSource: HTTP + disk cache (24h)  │   │
│  └──────────────────────┬───────────────────────┘   │
└─────────────────────────┼───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│            cds-kb-data (separate repo)               │
│                                                      │
│  index/search_index.json    (~4.7 MB, self-desc.)   │
│  views/*.md                 (7,355 CDS view files)  │
└─────────────────────────────────────────────────────┘
```

### Key design decisions

| Decision | Rationale |
|---|---|
| **Data/code separation** | Data updates independently of server code |
| **Self-describing index** | Options embedded in JSON → zero schema coupling |
| **Section-based retrieval** | `get_cds_view(sections)` saves 60–80% tokens |
| **Module alias mapping** | AI agents can use "Finance" instead of "FI" |
| **Single-file bundle** | `dist/cds-kb-mcp.mjs` — no install needed on target |
| **Local-first** | Local data wins when both sources configured |
| **Cache with TTL** | Remote cache auto-refreshes every 24h |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CDS_KB_DATA` | — | Path to local data repo (alternative to `--data`) |
| `CDS_KB_REMOTE` | — | Raw GitHub URL (alternative to `--remote`) |
| `CDS_KB_REFRESH` | `0` | Set to `1` to force re-download of remote index |
| `CDS_KB_CACHE_TTL_HOURS` | `24` | Cache expiry for remote mode (in hours) |

---

## Troubleshooting

### Server won't start

```
Error: No data source. Provide one of:
  --data <path>    or    --remote <url>
```

**Fix:** Provide either `--data` or `--remote` flag. See [Data Source Configuration](#data-source-configuration).

### "Index file is not in the expected self-describing format"

The `search_index.json` file is missing or corrupted.

**Fix:**
```bash
# Re-run enrichment to rebuild
node enrich_index.mjs /path/to/cds-kb-data
```

### Search returns poor results

Check `kb_info` output — if `enriched: 0`, the index hasn't been enriched.

**Fix:**
```bash
node enrich_index.mjs /path/to/cds-kb-data
```

### Remote cache is stale

```bash
# Force re-download
CDS_KB_REFRESH=1 node dist/cds-kb-mcp.mjs --remote <url>
```

### View not found

View names are **case-insensitive** but must be exact. Use `search_cds` first to find the correct name.

---

## Project Structure

```
cds-kb-mcp/
├── src/
│   ├── server.mjs        # MCP server — tool definitions, search logic
│   └── datasource.mjs    # Data access layer (Local + Remote backends)
├── dist/
│   └── cds-kb-mcp.mjs    # Pre-built single-file bundle (~784 KB)
├── build.mjs             # esbuild bundler config
├── enrich_index.mjs      # Index enrichment script
├── test_tools.mjs        # Integration smoke tests
├── package.json
└── README.md
```

## License

MIT
