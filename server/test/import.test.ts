import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readCSV, parsePRCSV } from '../src/csv.js';
import { inspectKit, readKitDirectory, readKitZip, parseContractText } from '../src/import-kit.js';
import { zipSync, strToU8 } from 'fflate';
import {reconcileContracts} from '../src/contracts.js';

test('CSV handles quoted delimiters and rejects malformed/duplicate headers', () => {
  assert.deepEqual(readCSV('code,description\r\na,"nuts, bolts"\r\n', ['code', 'description']), [{ code: 'a', description: 'nuts, bolts' }]);
  assert.throws(() => readCSV('code,code\na,b', ['code']));
  assert.throws(() => readCSV('code,description\na,b,c', ['code']));
  assert.throws(() => parsePRCSV('pr_no\nabc'));
});
test('ZIP import normalizes kit root and rejects duplicate filenames', () => {
  const files = readKitZip(Buffer.from(zipSync({ 'Task/master_data/item_master.csv': strToU8('item_code\nx') })));
  assert.ok(files.has('master_data/item_master.csv'));
  assert.throws(() => readKitZip(Buffer.from(zipSync({ 'A/master_data/item_master.csv': strToU8('a'), 'B/master_data/item_master.csv': strToU8('b') }))));
});
test('unparseable contract text is rejected rather than guessed', () => {
  assert.throws(() => parseContractText('A signed contract with no complete fields'));
});
const root = resolve(process.env.KIT_DATA_DIR || 'kit_data');
test('kit import reconciles all PDFs, retains raw PR anomalies, and finds PDF-only contracts', { skip: !existsSync(resolve(root, 'master_data/item_master.csv')) }, async () => {
  const kit = await inspectKit(await readKitDirectory(root));
  assert.equal(kit.data.items.length, 73); assert.equal(kit.data.suppliers.length, 48);
  assert.equal(kit.data.po_history.length, 468); assert.equal(kit.documents.length, 12);
  assert.equal(kit.data.contracts.length, 12); assert.equal(kit.batch.length, 186);
  assert.equal(kit.data.contracts.filter(c => c.source === 'pdf_only').length, 2);
  assert.ok(kit.batch.some(r => r.quantity === '0'));
  assert.ok(kit.warnings.some(w => w.includes('58 historical POs')));
  assert.equal(kit.snapshot_date, '2026-10-31');
  const reconciled=reconcileContracts(kit.data,kit.documents,'2026-11-16');
  assert.equal(reconciled.contracts.filter(c=>c.reconciliation==='MATCHED').length,12);
  assert.deepEqual(reconciled.contracts.filter(c=>c.source==='pdf_only').map(c=>c.contract_id).sort(),['RC-2026-031','RC-2026-033']);
});
