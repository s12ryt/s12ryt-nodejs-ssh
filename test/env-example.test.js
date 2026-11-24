// 功能索引
// L13 collectReferencedEnvNames：掃描原始碼取出所有被讀取的 SSH_* 變數名
// L31 parseEnvKeys / parseEnvValues：解析 .env 風格檔案的鍵與值（含註解鍵）
// L52 覆蓋率守衛：程式讀取的每個 SSH_* 都必須出現在 .env.example
// L72 預設值一致性：.env.example 的限額值必須等於 src/config.js 的預設
// L92 殘留守衛：不得出現已移除的 QEMU/VM 變數
// L101 .env 與 .env.example 鍵集合必須一致

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(rootDir, relative), 'utf8');

const SOURCE_FILES = [
  ...fs.readdirSync(path.join(rootDir, 'src')).filter((name) => name.endsWith('.js')).map((name) => `src/${name}`),
  ...fs.readdirSync(path.join(rootDir, 'scripts')).filter((name) => name.endsWith('.js')).map((name) => `scripts/${name}`),
  'start.js'
];

function collectReferencedEnvNames() {
  const names = new Set();
  for (const relative of SOURCE_FILES) {
    const source = read(relative);
    for (const match of source.matchAll(/(?:process\.env|env)\.(SSH_[A-Z0-9_]+)/g)) {
      names.add(match[1]);
    }
    for (const match of source.matchAll(/['"](SSH_[A-Z0-9_]+)['"]/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

function parseEnvEntries(content) {
  const entries = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^#\s*/, '');
    const match = line.match(/^(SSH_[A-Z0-9_]+)=(.*)$/);
    if (match) {
      entries.set(match[1], match[2].trim());
    }
  }
  return entries;
}

const example = parseEnvEntries(read('.env.example'));

test('every SSH_* variable read by the code is documented in .env.example', () => {
  const referenced = [...collectReferencedEnvNames()].sort();
  const missing = referenced.filter((name) => !example.has(name));
  assert.deepEqual(missing, [], `missing from .env.example: ${missing.join(', ')}`);
});

test('.env.example documents the sandbox escape hatch explicitly', () => {
  assert.ok(example.has('SSH_SFTP_FOLLOW_SHELL_CWD'));
  assert.equal(example.get('SSH_SFTP_FOLLOW_SHELL_CWD'), 'true');
});

test('.env.example limits match src/config.js defaults', () => {
  const config = read('src/config.js');
  const defaults = new Map();
  for (const match of config.matchAll(/readInteger\('(SSH_[A-Z0-9_]+)',\s*(\d+)/g)) {
    defaults.set(match[1], match[2]);
  }
  for (const [name, expected] of defaults) {
    assert.ok(example.has(name), `${name} missing from .env.example`);
    assert.equal(example.get(name), expected, `${name} should default to ${expected}`);
  }
});

test('.env.example keeps no removed QEMU/VM leftovers', () => {
  const content = read('.env.example');
  for (const pattern of [/VM_/, /qemu/i, /qcow2/i, /\b2223\b/]) {
    assert.equal(pattern.test(content), false, `unexpected leftover matching ${pattern}`);
  }
});

test('.env stays in sync with .env.example key set', (t) => {
  if (!fs.existsSync(path.join(rootDir, '.env'))) {
    t.skip('.env not present');
    return;
  }
  const actual = [...parseEnvEntries(read('.env')).keys()].sort();
  assert.deepEqual(actual, [...example.keys()].sort());
});
