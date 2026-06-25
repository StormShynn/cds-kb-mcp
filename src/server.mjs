#!/usr/bin/env node
// cds-kb-mcp — a DATALESS MCP server for the SAP CDS knowledge base.
// Ships no view data. Points at either a local clone or a remote (public GitHub) data repo.
//
//   cds-kb-mcp --data   /path/to/cloned/cds-kb-data
//   cds-kb-mcp --remote https://raw.githubusercontent.com/<user>/cds-kb-data/main
//
// The index file is self-describing (carries its own MiniSearch options), so this server
// has zero schema coupling to how the data repo was built.

import MiniSearch from 'minisearch';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveDataSource } from './datasource.mjs';

// Query-time ranking knobs live with the server (tunable independently of the index).
const SEARCH_OPTIONS = {
  boost: { name: 3, semanticDescription: 2.5, tagText: 1.5, description: 1, appComponent: 1 },
  prefix: true,
  fuzzy: 0.2,
};

const ds = resolveDataSource();
let mini;
let meta = {};

async function loadIndex() {
  const w = await ds.loadIndexWrapper();
  if (!w || !w.minisearch || !w.options) {
    throw new Error('Index file is not in the expected self-describing format. Rebuild it in the data repo.');
  }
  mini = MiniSearch.loadJSON(w.minisearch, w.options);
  meta = { viewCount: w.viewCount, enrichedCount: w.enrichedCount, builtAt: w.builtAt };
}

const server = new McpServer({ name: 'cds-knowledge-base', version: '1.0.0' });

server.registerTool(
  'search_cds',
  {
    title: 'Search SAP CDS views',
    description:
      'Search SAP S/4HANA released CDS views by business meaning / name / tags. ' +
      'Returns a ranked shortlist (name + path + description). ' +
      'Use this INSTEAD of grepping or reading routers, then call get_cds_view to read one. ' +
      'Optionally filter by module (FI, SD, MM...), lob, or bo.',
    inputSchema: {
      query: z.string().describe('Natural-language or keyword query, e.g. "overdue customer invoices"'),
      module: z.string().optional().describe('Module code filter, e.g. FI, SD, MM, PP'),
      lob: z.string().optional().describe('Line-of-business filter, e.g. "Finance"'),
      bo: z.string().optional().describe('Business object filter, e.g. "salesorder"'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 8)'),
    },
  },
  async ({ query, module, lob, bo, limit = 8 }) => {
    const eq = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
    const facetFilter = (r) =>
      (!module || eq(r.module, module)) && (!lob || eq(r.lob, lob)) && (!bo || eq(r.bo, bo));

    const results = mini.search(query, { ...SEARCH_OPTIONS, filter: facetFilter }).slice(0, limit);
    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No CDS views matched "${query}"${module ? ` (module=${module})` : ''}.` }] };
    }
    const lines = results.map((r, i) => {
      const desc = r.semanticDescription || r.description || '';
      return `${i + 1}. ${r.name}  [${r.appComponent || r.module || '-'}]  (score ${r.score.toFixed(1)})\n   ${desc}\n   path: ${r.path}`;
    });
    return {
      content: [{ type: 'text', text: `Top ${results.length} CDS views for "${query}":\n\n${lines.join('\n')}\n\nUse get_cds_view(name) to read the full definition.` }],
    };
  },
);

server.registerTool(
  'get_cds_view',
  {
    title: 'Get a CDS view definition',
    description: 'Return the full markdown (fields, associations, DDL source) of one CDS view by its exact name.',
    inputSchema: { name: z.string().describe('Exact view name, e.g. I_SalesDocument (case-insensitive)') },
  },
  async ({ name }) => {
    try {
      return { content: [{ type: 'text', text: await ds.getView(name) }] };
    } catch {
      return {
        content: [{ type: 'text', text: `View "${name}" not found. Use search_cds first to get the exact name.` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'kb_info',
  {
    title: 'Knowledge base info',
    description: 'Report the active data source, view count, enrichment coverage, and index build time.',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text:
      `source: ${ds.describe()}\nviews: ${meta.viewCount ?? '?'}\nenriched: ${meta.enrichedCount ?? '?'}\nbuiltAt: ${meta.builtAt ?? '?'}` }],
  }),
);

async function main() {
  await loadIndex();
  await server.connect(new StdioServerTransport());
  console.error(`[cds-kb-mcp] ready. ${ds.describe()} | views=${meta.viewCount} enriched=${meta.enrichedCount}`);
}

main().catch((e) => {
  console.error('[cds-kb-mcp] fatal:', e.message);
  process.exit(1);
});
