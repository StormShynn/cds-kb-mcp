// datasource.mjs
// Pluggable access to the CDS data, kept fully separate from the data itself.
// Two backends, same interface:
//   - LocalDataSource(rootDir):  reads <root>/index/search_index.json and <root>/views/<NAME>.md
//   - RemoteDataSource(baseUrl): downloads the index once (cached), lazy-fetches views (cached)
//
// Interface:
//   async loadIndexWrapper() -> { schemaVersion, options, minisearch, viewCount, ... }
//   async getView(name)      -> markdown string  (throws if not found)
//   async getViewSections(name, sections) -> filtered markdown (only requested sections)
//   async getTaxonomy()      -> returns parsed taxonomy JSON (or null if not available)
//   describe()               -> short human string for logs

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// ── Section parser ──────────────────────────────────────────────────────────
// Splits a CDS view markdown file into named sections for selective retrieval.
// Recognised sections: metadata (frontmatter + heading + property table),
// fields, associations, source (DDL source code).

const SECTION_NAMES = ['metadata', 'fields', 'associations', 'source'];

function parseViewSections(md) {
  const sections = { metadata: '', fields: '', associations: '', source: '' };

  // --- frontmatter + heading + property table → metadata
  const fmEnd = md.indexOf('---', 4);            // second '---'
  const fieldsStart = md.indexOf('## Fields');
  if (fieldsStart === -1) {
    // No structured sections — return everything as metadata
    sections.metadata = md;
    return sections;
  }
  sections.metadata = md.slice(0, fieldsStart).trimEnd();

  // --- fields table
  const assocStart = md.indexOf('## Associations');
  const sourceStart = md.indexOf('## Source Code');
  const fieldsEnd = assocStart !== -1 ? assocStart : sourceStart !== -1 ? sourceStart : md.length;
  sections.fields = md.slice(fieldsStart, fieldsEnd).trimEnd();

  // --- associations table
  if (assocStart !== -1) {
    const assocEnd = sourceStart !== -1 ? sourceStart : md.length;
    sections.associations = md.slice(assocStart, assocEnd).trimEnd();
  }

  // --- source code block
  if (sourceStart !== -1) {
    sections.source = md.slice(sourceStart).trimEnd();
  }

  return sections;
}

function filterSections(md, requestedSections) {
  if (!requestedSections || requestedSections.length === 0) return md;
  const valid = requestedSections.filter((s) => SECTION_NAMES.includes(s));
  if (valid.length === 0) return md;

  const parsed = parseViewSections(md);
  return valid.map((s) => parsed[s]).filter(Boolean).join('\n\n');
}

// ── Cache TTL (24 hours default, configurable via CDS_KB_CACHE_TTL_HOURS) ──
const CACHE_TTL_MS = (parseInt(process.env.CDS_KB_CACHE_TTL_HOURS, 10) || 24) * 60 * 60 * 1000;

async function isCacheFresh(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false; // file does not exist
  }
}

// ── Local backend ───────────────────────────────────────────────────────────

export class LocalDataSource {
  constructor(rootDir) {
    this.root = path.resolve(rootDir);
  }
  describe() {
    return `local:${this.root}`;
  }
  async loadIndexWrapper() {
    const file = path.join(this.root, 'index', 'search_index.json');
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch (e) {
      throw new Error(`Cannot read index at ${file}. Build it in the data repo (npm run build:index). ${e.message}`);
    }
  }
  async getView(name) {
    const safe = path.basename(name).replace(/\.md$/i, '').toUpperCase();
    const file = path.join(this.root, 'views', `${safe}.md`);
    return fs.readFile(file, 'utf-8'); // throws ENOENT if missing; server maps to a friendly error
  }
  async getViewSections(name, sections) {
    const md = await this.getView(name);
    return filterSections(md, sections);
  }
  async getTaxonomy() {
    const file = path.join(this.root, 'index', 'taxonomy.json');
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch {
      return null;
    }
  }
}

// ── Remote backend ──────────────────────────────────────────────────────────

export class RemoteDataSource {
  // baseUrl example: https://raw.githubusercontent.com/<user>/<repo>/<branch>
  constructor(baseUrl, { cacheDir } = {}) {
    this.base = baseUrl.replace(/\/+$/, '');
    const key = crypto.createHash('sha1').update(this.base).digest('hex').slice(0, 12);
    this.cacheDir = cacheDir || path.join(os.homedir(), '.cache', 'cds-kb', key);
  }
  describe() {
    return `remote:${this.base} (cache ${this.cacheDir})`;
  }
  async #fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
    return res.text();
  }
  async loadIndexWrapper() {
    const cacheFile = path.join(this.cacheDir, 'search_index.json');
    // Use cache unless CDS_KB_REFRESH=1 forces a re-download, or cache has expired.
    if (process.env.CDS_KB_REFRESH !== '1') {
      try {
        if (await isCacheFresh(cacheFile)) {
          return JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
        }
        // Cache exists but is stale — fall through to re-download.
        console.error('[cds-kb-mcp] index cache expired, re-downloading...');
      } catch { /* not cached yet */ }
    }
    const text = await this.#fetchText(`${this.base}/index/search_index.json`);
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(cacheFile, text, 'utf-8');
    return JSON.parse(text);
  }
  async getView(name) {
    const safe = path.basename(name).replace(/\.md$/i, '').toUpperCase();
    const cacheFile = path.join(this.cacheDir, 'views', `${safe}.md`);
    try {
      return await fs.readFile(cacheFile, 'utf-8'); // cache hit
    } catch { /* fetch below */ }
    const md = await this.#fetchText(`${this.base}/views/${safe}.md`);
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, md, 'utf-8');
    return md;
  }
  async getViewSections(name, sections) {
    const md = await this.getView(name);
    return filterSections(md, sections);
  }
  async getTaxonomy() {
    const cacheFile = path.join(this.cacheDir, 'taxonomy.json');
    if (process.env.CDS_KB_REFRESH !== '1') {
      try {
        if (await isCacheFresh(cacheFile)) {
          return JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
        }
      } catch { /* proceed to fetch */ }
    }
    try {
      const text = await this.#fetchText(`${this.base}/index/taxonomy.json`);
      await fs.writeFile(cacheFile, text, 'utf-8');
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}

// ── Resolver ────────────────────────────────────────────────────────────────
// Resolve a datasource from CLI args / env. Precedence: --data > CDS_KB_DATA > --remote > CDS_KB_REMOTE.
// (Local-first, per the chosen default.)
export function resolveDataSource(argv = process.argv.slice(2)) {
  const getFlag = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const dataPath = getFlag('--data') || process.env.CDS_KB_DATA;
  if (dataPath) return new LocalDataSource(dataPath);

  const remote = getFlag('--remote') || process.env.CDS_KB_REMOTE;
  if (remote) return new RemoteDataSource(remote);

  const defaultRemote = 'https://raw.githubusercontent.com/truongdva2/cds-kb-data/main';
  return new RemoteDataSource(defaultRemote);
}

// Export for server use
export { SECTION_NAMES };
