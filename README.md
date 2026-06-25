# cds-kb-mcp

A **dataless** MCP server that searches the SAP CDS knowledge base. It ships **no view data** —
you point it at the data either locally (a cloned data repo) or remotely (a public GitHub repo).
The whole server bundles into **one file** (`dist/cds-kb-mcp.mjs`) that runs on any machine with
Node ≥ 18 — download it, point it at data, done.

Works in **Claude Desktop**, **Claude Code**, and **Antigravity IDE** (all speak MCP over stdio).

## Tools

| Tool | Purpose |
|---|---|
| `search_cds(query, module?, lob?, bo?, limit?)` | Ranked shortlist of views (name + path + description). Use instead of grep. |
| `get_cds_view(name)` | Full markdown (fields, associations, DDL) of one view. |
| `kb_info()` | Active data source, view count, enrichment coverage, index build time. |

## Build the single file

```bash
npm install
npm run build          # -> dist/cds-kb-mcp.mjs  (~780 KB, self-contained)
```

`dist/cds-kb-mcp.mjs` is committed so others can grab it without building.

## Choosing a data source (local-first)

The server resolves data in this precedence — **local wins when both are set**:

| Flag | Env | Mode |
|---|---|---|
| `--data <path>` | `CDS_KB_DATA` | **Local**: read a cloned data repo. Offline, fastest. |
| `--remote <baseUrl>` | `CDS_KB_REMOTE` | **Remote**: download index once + lazy-fetch views, cached to `~/.cache/cds-kb/`. |

Remote base URL = the raw GitHub root of the **public** data repo, e.g.
`https://raw.githubusercontent.com/<user>/cds-kb-data/main`.
Set `CDS_KB_REFRESH=1` to force re-downloading the index (e.g. after the data repo updates).

```bash
# local
node dist/cds-kb-mcp.mjs --data /path/to/cloned/cds-kb-data
# remote (public repo)
node dist/cds-kb-mcp.mjs --remote https://raw.githubusercontent.com/<user>/cds-kb-data/main
```

## Register with clients

### Claude Code
```bash
# local
claude mcp add cds-kb -- node /abs/path/dist/cds-kb-mcp.mjs --data /abs/path/to/cds-kb-data
# remote
claude mcp add cds-kb -- node /abs/path/dist/cds-kb-mcp.mjs --remote https://raw.githubusercontent.com/<user>/cds-kb-data/main
```

### Claude Desktop
`~/Library/Application Support/Claude/claude_desktop_config.json` (restart after editing):
```json
{
  "mcpServers": {
    "cds-kb": {
      "command": "node",
      "args": ["/abs/path/dist/cds-kb-mcp.mjs", "--remote", "https://raw.githubusercontent.com/<user>/cds-kb-data/main"]
    }
  }
}
```

### Antigravity IDE
Add the same server via the IDE's MCP settings:
- command: `node`
- args: `["/abs/path/dist/cds-kb-mcp.mjs", "--data", "/abs/path/to/cds-kb-data"]`

> [Unverified] Exact MCP-config file path for Antigravity IDE not confirmed here — add it via the
> IDE's MCP settings UI. The server is a standard stdio MCP server; no platform-specific changes.

## Index format contract

The server expects `index/search_index.json` to be the **self-describing wrapper** produced by the
data repo's `build_search_index.mjs`: `{ schemaVersion, options, minisearch, viewCount, ... }`.
Because the MiniSearch `options` travel inside the file, this server shares **no schema code** with
the data repo — they evolve independently as long as `schemaVersion` is honored.
