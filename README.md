# cds-kb-mcp

A **dataless** MCP server that gives AI agents access to **7,355 SAP S/4HANA CDS views** via semantic search and structured taxonomy. Ships **no view data** — you point it at the data either locally or it automatically fetches from GitHub.

The whole server bundles into **one file** (`dist/cds-kb-mcp.mjs`, ~784 KB) that runs on any machine with Node ≥ 18.

Works perfectly with **Claude Desktop**, **Claude Code**, **Antigravity IDE**, and any MCP-compatible client.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Data Source Configuration](#data-source-configuration)
- [Tools Reference](#tools-reference)
- [Client Registration](#client-registration)
- [Data Enrichment & Taxonomy](#data-enrichment--taxonomy)
- [Architecture](#architecture)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

### 1. Zero-Config Run (Online Mode)
The absolute easiest way to start. It will automatically download the search index and fetch views on-demand from the official GitHub repository.

```bash
git clone https://github.com/truongdva2/cds-kb-mcp.git
cd cds-kb-mcp

# Run without any arguments! Defaults to online remote mode.
node dist/cds-kb-mcp.mjs
```

### 2. Local Data Run (Offline Mode)
For the fastest, zero-latency experience.

```bash
# Clone the server and the data repo
git clone https://github.com/truongdva2/cds-kb-mcp.git
git clone --recurse-submodules https://github.com/truongdva2/cds-kb-mcp.git # Or clone cds-kb-data manually

# Run pointing to the local data folder
node dist/cds-kb-mcp.mjs --data ./cds-kb-data
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
- No other runtime dependencies — everything is bundled into the single file.

---

## Data Source Configuration

The server resolves its data source in the following precedence order. **Local wins when both are set**. If nothing is provided, it safely defaults to **Remote (Online)** mode.

| Priority | Flag | Env Var | Mode |
|---|---|---|---|
| 1 | `--data <path>` | `CDS_KB_DATA` | **Local** — reads a cloned data repo. Offline, fastest. |
| 2 | `--remote <url>` | `CDS_KB_REMOTE` | **Remote** — downloads index once, lazy-fetches views, cached. |
| 3 | *(None)* | *(None)* | **Default Remote** — automatically points to `https://raw.githubusercontent.com/truongdva2/cds-kb-data/main`. |

### Remote mode caching

1. Downloads `search_index.json` (~5 MB) and `taxonomy.json` once → cached to `~/.cache/cds-kb/<hash>/`
2. Individual views fetched on-demand when `get_cds_view` is called → also cached
3. Cache auto-expires after **24 hours** (configurable via `CDS_KB_CACHE_TTL_HOURS`)
4. Force re-download: set `CDS_KB_REFRESH=1`

---

## Tools Reference

The server exposes **5 highly optimized MCP tools**:

### 1. `search_cds`

Search CDS views by business meaning, name, or traditional SAP keywords (e.g. `VBAK`). Returns a ranked shortlist.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | ✅ | Natural-language or keyword query |
| `module` | string | ❌ | Module code (`FI`, `SD`, `MM`) or name (`Finance`, `Procurement`) |
| `lob` | string | ❌ | Line-of-business filter (partial match) |
| `bo` | string | ❌ | Business object filter (partial match) |
| `limit` | number | ❌ | Max results, 1–50 (default: 10) |

**Examples:**
```javascript
// Search by natural language
search_cds("overdue customer invoices", module="Finance")

// Search by traditional SAP T-Codes or Table Names (thanks to Synonym Enrichment!)
search_cds("VBAK") 
search_cds("BSEG")

// Search with specific BO filter
search_cds("material stock", bo="Inventory")
```

### 2. `get_taxonomy`

Retrieves the semantic map of the knowledge base. It groups all views into **Lines of Business (LOB)** and **Business Objects (BO)**, providing rich keywords. 

Use this to understand how data is organized before searching, or to discover valid tags for `get_views_by_tag`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| *(none)* | — | — | — |

**Example output:**
```markdown
SAP CDS Knowledge Base Taxonomy

## Lines of Business (12)
- **lob:finance** (finance) — Keywords: FI, FIN, General Ledger, Accounts Payable, Asset Accounting, Tax...
- **lob:sales & distribution** (sales & distribution) — Keywords: SD, Sales Order, Billing, Pricing...

## Business Objects (829 total, sample of 30)
- **bo:salesorder** — Keywords: SO, SD-SLS, Customer Order, VBAK
- **bo:journalentry** — Keywords: FI-GL, BSEG, BKPF, Accounting Document
...
```

### 3. `get_views_by_tag`

Retrieve a deterministic, paginated list of all CDS views that possess a specific tag (e.g., `bo:salesorder` or `lob:finance`). Use this to accurately browse a category without relying on semantic search.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `tag` | string | ✅ | The exact tag to filter by, e.g., "bo:salesorder" |
| `limit` | number | ❌ | Max results (default 50) |

**Examples:**
```javascript
get_views_by_tag("bo:salesorder")
get_views_by_tag("lob:controlling")
```

### 4. `get_cds_view`

Return the full (or partial) markdown definition of one CDS view.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✅ | Exact view name (case-insensitive) |
| `sections` | string[] | ❌ | Filter to specific sections (saves tokens) |

**Available sections:** `metadata`, `fields`, `associations`, `source`

**Examples:**
```javascript
get_cds_view("I_PurchaseOrderAPI01")                       // full view
get_cds_view("I_PurchaseOrderAPI01", sections=["metadata", "fields"])  // 62% smaller, recommended!
get_cds_view("C_PURCHASEORDERDEX", sections=["source"])    // DDL source code only
```

> **💡 Token savings:** For large views (some are 50–95 KB), using `sections` can save **60–80%** of context window tokens. Always use `["metadata", "fields"]` first to understand the view structure!

### 5. `kb_info`

Report the active data source, view count, enrichment coverage, and index build time.

---

## Client Registration

### Claude Code

```bash
# Zero-config (Online Default)
claude mcp add cds-kb -- node /abs/path/to/cds-kb-mcp/dist/cds-kb-mcp.mjs

# Local data
claude mcp add cds-kb -- node /abs/path/to/cds-kb-mcp/dist/cds-kb-mcp.mjs --data /abs/path/to/cds-kb-data
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cds-kb": {
      "command": "node",
      "args": [
        "/abs/path/to/cds-kb-mcp/dist/cds-kb-mcp.mjs"
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
| **Args** | `["/abs/path/to/cds-kb-mcp/dist/cds-kb-mcp.mjs"]` |

---

## Data Enrichment & Taxonomy

The search index ships with **7,160 enriched views** (97.3%) that have human-readable `semanticDescription` extracted from `@EndUserText.label` annotations in DDL source.

It also integrates a curated **Taxonomy** (`taxonomy.json`). When the index is built, keywords like `VBAK`, `EKKO`, `BSEG` are dynamically injected into a `synonyms` field for the relevant Business Objects. This allows AI to search using traditional SAP terminology even if those words aren't in the official view descriptions!

### Re-run enrichment after data updates

```bash
cd cds-kb-mcp
node enrich_index.mjs /path/to/cds-kb-data
npm run build
```

This will:
1. Scan all 7,355 view files for `@EndUserText.label`
2. Populate `semanticDescription` field in the index
3. Load `taxonomy.json` and inject keywords into the `synonyms` field for ~6,900 views.
4. Rebuild the MiniSearch index from scratch.
5. Create a `.bak` backup of the original index.

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
│  │  search_cds  │  │ get_cds_view │  │get_taxonomy│ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                 │                 │        │
│         ▼                 ▼                 ▼        │
│  ┌──────────────────────────────────────────────┐   │
│  │          MiniSearch (in-memory BM25)          │   │
│  │  boost: name(3x) semantic(2.5x) synonyms(2x)  │   │
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
│             cds-kb-data (separate repo)              │
│                                                      │
│  index/taxonomy.json        (LOBs, BOs, Keywords)   │
│  index/search_index.json    (~5 MB, self-desc.)     │
│  views/*.md                 (7,355 CDS view files)  │
└─────────────────────────────────────────────────────┘
```

### Key design decisions

| Decision | Rationale |
|---|---|
| **Data/code separation** | Data updates independently of server code |
| **Taxonomy Routing** | Deterministic browsing via `get_taxonomy` & `get_views_by_tag` without file bloat |
| **Synonym Injection** | Allows searching for traditional SAP T-Codes/Tables (e.g. `VBAK`) |
| **Section-based retrieval** | `get_cds_view(sections)` saves 60–80% tokens per read |
| **Single-file bundle** | `dist/cds-kb-mcp.mjs` — no install needed on target |
| **Zero-config Remote** | Defaults to fetching from GitHub online automatically |
| **Cache with TTL** | Remote cache auto-refreshes every 24h |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CDS_KB_DATA` | — | Path to local data repo (alternative to `--data`) |
| `CDS_KB_REMOTE` | `https://.../main` | Raw GitHub URL (alternative to `--remote`) |
| `CDS_KB_REFRESH` | `0` | Set to `1` to force re-download of remote index |
| `CDS_KB_CACHE_TTL_HOURS` | `24` | Cache expiry for remote mode (in hours) |

---

## Troubleshooting

### Search returns poor results

Check `kb_info` output — if `enriched: 0`, the index hasn't been enriched.

**Fix:**
```bash
node enrich_index.mjs /path/to/cds-kb-data
```

### Remote cache is stale

```bash
# Force re-download
CDS_KB_REFRESH=1 node dist/cds-kb-mcp.mjs
```

### View not found

View names are **case-insensitive** but must be exact. Use `search_cds` or `get_views_by_tag` first to find the correct name.

---

## Project Structure

```
cds-kb-mcp/
├── src/
│   ├── server.mjs        # MCP server — tool definitions, search logic
│   └── datasource.mjs    # Data access layer (Local + Remote backends)
├── dist/
│   └── cds-kb-mcp.mjs    # Pre-built single-file bundle (~784 KB)
├── cds-kb-data/          # Git submodule (if cloned with --recurse-submodules)
├── build.mjs             # esbuild bundler config
├── enrich_index.mjs      # Index enrichment script
├── test_tools.mjs        # Integration smoke tests
├── package.json
└── README.md
```

## License

MIT
