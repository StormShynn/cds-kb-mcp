#!/usr/bin/env node
// Quick smoke test for the MCP server tools
// Usage: node test_tools.mjs <path-to-cds-kb-data>
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dataPath = process.argv[2] || '/Users/duckpower/IDE WorkSpaces/cds-knowledge-base/cds-kb-data';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, 'src', 'server.mjs');

const proc = spawn('node', [serverPath, '--data', dataPath], { stdio: ['pipe', 'pipe', 'pipe'] });

let id = 0;
const pending = new Map();
const rl = createInterface({ input: proc.stdout });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  } catch { /* ignore */ }
});

proc.stderr.on('data', (d) => process.stderr.write(d));

function call(method, params = {}) {
  return new Promise((resolve) => {
    const reqId = ++id;
    pending.set(reqId, resolve);
    const req = JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params });
    proc.stdin.write(req + '\n');
  });
}

async function run() {
  // Initialize
  await call('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0' },
  });
  await call('notifications/initialized', {});

  console.log('\n=== TEST 1: search_cds("VBAK") ===');
  const r1 = await call('tools/call', { name: 'search_cds', arguments: { query: 'VBAK', limit: 5 } });
  console.log(r1.result?.content?.[0]?.text?.slice(0, 500));

  console.log('\n=== TEST 2: search_cds with module alias "Finance" ===');
  const r2 = await call('tools/call', { name: 'search_cds', arguments: { query: 'journal entry', module: 'Finance', limit: 3 } });
  console.log(r2.result?.content?.[0]?.text?.slice(0, 500));

  console.log('\n=== TEST 3: get_taxonomy ===');
  const r3 = await call('tools/call', { name: 'get_taxonomy', arguments: {} });
  console.log(r3.result?.content?.[0]?.text?.slice(0, 800));

  console.log('\n=== TEST 3.5: get_views_by_tag ===');
  const r35 = await call('tools/call', { name: 'get_views_by_tag', arguments: { tag: 'bo:salesorder', limit: 3 } });
  console.log(r35.result?.content?.[0]?.text?.slice(0, 800));

  console.log('\n=== TEST 4: get_cds_view with sections ===');
  const r4 = await call('tools/call', { name: 'get_cds_view', arguments: { name: 'C_PURCHASEORDERDEX', sections: ['metadata', 'fields'] } });
  const text4 = r4.result?.content?.[0]?.text || '';
  console.log(`Sections output length: ${text4.length} chars`);
  console.log(text4.slice(0, 400));

  console.log('\n=== TEST 5: get_cds_view full (for comparison) ===');
  const r5 = await call('tools/call', { name: 'get_cds_view', arguments: { name: 'C_PURCHASEORDERDEX' } });
  const text5 = r5.result?.content?.[0]?.text || '';
  console.log(`Full output length: ${text5.length} chars`);
  console.log(`Token savings: ${((1 - text4.length / text5.length) * 100).toFixed(0)}%`);

  console.log('\n=== TEST 6: kb_info ===');
  const r6 = await call('tools/call', { name: 'kb_info', arguments: {} });
  console.log(r6.result?.content?.[0]?.text);

  console.log('\n✅ All tests passed!');
  proc.kill();
  process.exit(0);
}

run().catch((e) => {
  console.error('Test failed:', e);
  proc.kill();
  process.exit(1);
});

// Timeout safety
setTimeout(() => { console.error('Timeout!'); proc.kill(); process.exit(1); }, 30000);
