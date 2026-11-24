/**
 * test/no-vm.test.js — SSH-only 回歸守衛
 *
 * 功能索引：
 *   1. src/ 不含 VM / QMP 模組            → test('src has no VM or QMP modules')
 *   2. 進入點與設定檔不再引用 VM           → test('entrypoint and config stay VM-free')
 *   3. 範例環境變數不含 VM_* 設定           → test('.env.example has no VM settings')
 *   4. 套件中繼資料不再提及 QEMU            → test('package metadata has no QEMU references')
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('src has no VM or QMP modules', () => {
  assert.deepEqual(fs.readdirSync(path.join(root, 'src')).filter((f) => /^(vm-|qmp-)/.test(f)), []);
});

test('entrypoint and config stay VM-free', () => {
  for (const rel of ['src/index.js', 'src/config.js']) {
    assert.doesNotMatch(read(rel), /vm-config|vm-manager|qmp-client|VM_[A-Z]/, rel);
  }
});

test('.env.example has no VM settings', () => {
  assert.doesNotMatch(read('.env.example'), /^VM_/m);
});

test('package metadata has no QEMU references', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.doesNotMatch(pkg.description, /qemu/i);
  assert.ok(!pkg.keywords.includes('qemu'));
});
