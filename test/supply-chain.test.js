// 供應鏈守衛測試（對應 agent/question.md 驗收標準 A/F）
// A1-A3 Node runtime 不得殘留 EOL 的 Node 20：engines / Dockerfile / CI matrix
// A4-A5 ssh2 必須 pin 在 1.16.0 以規避 CVE-2025-70034（1.17.0 唯一受影響且無 patch）
// F1    CI 必須有 npm audit gate
// F2    .github/dependabot.yml 必須監控 npm 與 github-actions
// F3    ghcr.yml 必須含映像漏洞掃描

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const readText = (relative) => fs.readFileSync(path.join(rootDir, relative), 'utf8');
const readJson = (relative) => JSON.parse(readText(relative));

test('engines.node 不得允許 EOL 的 Node 20', () => {
  const { engines } = readJson('package.json');
  assert.ok(engines && typeof engines.node === 'string', 'engines.node 必須存在');
  assert.doesNotMatch(engines.node, /(^|[^\d])20([^\d]|$)/, 'engines.node 仍指向 Node 20');
});

test('Dockerfile 所有 base image 必須是 node:24-bookworm-slim', () => {
  const bases = [...readText('Dockerfile').matchAll(/^FROM\s+(node:\S+)/gm)].map((m) => m[1]);
  assert.ok(bases.length > 0, 'Dockerfile 必須有 node base image');
  for (const base of bases) {
    assert.strictEqual(base, 'node:24-bookworm-slim');
  }
});

test('CI matrix 不得包含 20.x 且必須涵蓋 24.x', () => {
  const ci = readText('.github/workflows/ci.yml');
  assert.doesNotMatch(ci, /20\.x/, 'CI 仍在測 EOL 的 Node 20');
  assert.match(ci, /24\.x/);
});

test('ssh2 必須 pin 在精確版本 1.16.0', () => {
  assert.strictEqual(readJson('package.json').dependencies.ssh2, '1.16.0');
});

test('lockfile 解析出的 ssh2 必須是 1.16.0', () => {
  const entry = readJson('package-lock.json').packages?.['node_modules/ssh2'];
  assert.ok(entry, 'lockfile 必須含 node_modules/ssh2');
  assert.strictEqual(entry.version, '1.16.0');
});

test('CI 必須有 npm audit gate', () => {
  assert.match(readText('.github/workflows/ci.yml'), /npm audit[^\n]*--audit-level/);
});

test('dependabot 必須同時監控 npm 與 github-actions', () => {
  const dependabot = readText('.github/dependabot.yml');
  assert.match(dependabot, /package-ecosystem:\s*["']?npm/);
  assert.match(dependabot, /package-ecosystem:\s*["']?github-actions/);
});

test('ghcr workflow 必須掃描映像漏洞', () => {
  assert.match(readText('.github/workflows/ghcr.yml'), /trivy/i);
});
