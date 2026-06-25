// build.mjs — bundle the whole server (+ deps) into ONE runnable file: dist/cds-kb-mcp.mjs
// Output needs only Node >= 18 on the target machine. No data is bundled.
import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';

const outfile = 'dist/cds-kb-mcp.mjs';

await build({
  entryPoints: ['src/server.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile,
  // esbuild preserves the shebang already present in src/server.mjs — don't add another.
});

await chmod(outfile, 0o755);
console.log(`Built ${outfile}`);
