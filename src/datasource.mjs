// datasource.mjs
// Pluggable access to the CDS data, kept fully separate from the data itself.
// Two backends, same interface:
//   - LocalDataSource(rootDir):  reads <root>/index/search_index.json and <root>/views/<NAME>.md
//   - RemoteDataSource(baseUrl): downloads the index once (cached), lazy-fetches views (cached)
//
// Interface:
//   async loadIndexWrapper() -> { schemaVersion, options, minisearch, viewCount, ... }
//   async getView(name)      -> markdown string  (throws if not found)
//   describe()               -> short human string for logs

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

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
}

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
    // Use cache unless CDS_KB_REFRESH=1 forces a re-download.
    if (process.env.CDS_KB_REFRESH !== '1') {
      try {
        return JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
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
}

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

  throw new Error(
    'No data source. Provide one of:\n' +
    '  --data <path-to-cloned-data-repo>     (CDS_KB_DATA env)\n' +
    '  --remote <raw-github-base-url>        (CDS_KB_REMOTE env)\n' +
    'e.g. --remote https://raw.githubusercontent.com/<user>/cds-kb-data/main',
  );
}
