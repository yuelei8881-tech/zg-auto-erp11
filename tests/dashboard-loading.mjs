import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

// Exercise the actual cloud loader without contacting production.
const source = fs.readFileSync(new URL('../src/lib/cloud.ts', import.meta.url), 'utf8');
let pages = [], calls = [], signed = 0, failAt = -1;
let batchCalls = [], batchError = null;
const client = {
  async rpc(name, args) {
    if (name === 'zg_read_records') {
      calls.push({ start: args.p_offset, since: args.p_since });
      return args.p_offset === failAt ? { error: new Error('network failure') } : { data: pages[args.p_offset / 1000] || [] };
    }
    if (name === 'zg_write_records_v2') { batchCalls.push(args); return { data: args.p_records, error: batchError }; }
    throw new Error('Unexpected RPC: ' + name);
  },
  from(table) {
    const query = {
      select() { return this; }, eq() { return this; }, order() { return this; },
      async upsert(rows, options) { batchCalls.push({ table, rows, options }); return { error: batchError }; },
      range(start) { this.start = start; return this; },
      gt(column, value) { this.since = value; return this; },
      maybeSingle: async () => ({ data: { organization_id: 'org', role: 'owner', permissions: {}, status: 'active' } }),
      single: async () => ({ data: { name: 'Test' } }),
      then(resolve, reject) {
        calls.push({ start: this.start, since: this.since });
        return Promise.resolve(this.start === failAt ? { error: new Error('network failure') } : { data: pages[this.start / 1000] || [] }).then(resolve, reject);
      },
    };
    return query;
  },
  storage: { from: () => ({ createSignedUrls: async paths => { signed++; return { data: paths.map(path => ({ path, signedUrl: `signed:${path}` })) }; } }) },
};
const exports = {};
vm.runInNewContext(stripTypeScriptTypes(source).replace(/^import .*;$/gm, '').replace('export async function', 'async function') + '\nexports.openCloudSession = openCloudSession;',
  { exports, supabase: client, console, Map, Set, Date });
const session = await exports.openCloudSession({ id: 'user', email: 'test@example.test' });
const row = i => ({ module: 'workOrders', record_id: String(i), updated_at: '2026-10-09', payload: { total: i, evidencePhotos: [{ storagePath: `org/${i}.jpg`, dataUrl: 'old' }] } });
pages = [Array.from({ length: 1000 }, (_, i) => row(i)), [row(1000)]];
const full = await session.loadStore(undefined, true);
assert.equal(full.workOrders.length, 1001);
assert.equal(signed, 0, 'Dashboard must not wait for image signing');
assert.deepEqual(calls.map(x => x.start), [0, 1000]);
calls = []; pages = [[row(7)]];
const delta = await session.loadStore('2026-10-08T00:00:00Z', true);
assert.equal(delta.workOrders.length, 1);
assert.equal(calls[0].since, '2026-10-08T00:00:00Z');
const legacy = await session.loadStore();
assert.equal(legacy.workOrders[0].evidencePhotos[0].dataUrl, 'signed:org/7.jpg');
pages = [Array.from({ length: 1000 }, (_, i) => row(i))]; failAt = 1000;
await assert.rejects(session.loadStore(undefined, true), /network failure/);
console.log('PASS: full paging, incremental filter, nonblocking dashboard photos, legacy photo signing, partial failure rejection');
const records = [
  { module: 'parts', row: { id: 'part', qty: 4 } },
  { module: 'inventoryLogs', row: { id: 'usage', change: -1 } },
  { module: 'workOrders', row: { id: 'order', total: 100 } },
  { module: 'changeLogs', row: { id: 'audit', action: '新建工单' } },
];
await session.saveWorkOrderRecords(records);
assert.equal(batchCalls.length, 1, 'All save rows must use one request');
assert.equal(batchCalls[0].p_records.length, 4);
assert.equal(batchCalls[0].p_org, 'org');
for (let i = 0; i < records.length; i++) {
  assert.equal(batchCalls[0].p_records[i].module, records[i].module);
  assert.equal(batchCalls[0].p_records[i].row, records[i].row);
}
batchError = new Error('permission denied');
await assert.rejects(session.saveWorkOrderRecords(records), /permission denied/);
await assert.rejects(session.saveWorkOrderRecords([{ module: 'customers', row: { id: 'customer' } }]), /不支持/);
assert.equal(batchCalls.length, 2, 'Invalid module must never be submitted');
console.log('PASS: single batch request, preserved audit/inventory payload, organization scope, error propagation');
