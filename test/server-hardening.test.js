// 伺服器硬化守衛測試（CVE 稽核 C-2 / C-4 / C-5 / C-6）
// 以靜態原始碼契約驗證：顯式 algorithms 白名單、弱演算法不得出現、
// connection-guard 必須被 server 實際接入、config 必須提供三個新限額。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const serverSource = fs.readFileSync(path.join(rootDir, 'src/server.js'), 'utf8');
const configSource = fs.readFileSync(path.join(rootDir, 'src/config.js'), 'utf8');

test('server 必須顯式設定 algorithms 白名單', () => {
  assert.match(serverSource, /algorithms\s*:\s*(\{|ALGORITHMS)/);
  for (const name of ['kex', 'cipher', 'serverHostKey', 'hmac']) {
    assert.match(serverSource, new RegExp(`${name}\\s*:\\s*\\[`), `algorithms 缺少 ${name}`);
  }
  assert.match(serverSource, /chacha20-poly1305@openssh\.com/);
});

test('algorithms 不得包含已知弱演算法', () => {
  for (const weak of ['-cbc', 'hmac-sha1', 'hmac-md5', 'diffie-hellman-group1-sha1', 'arcfour', '3des-cbc']) {
    assert.ok(!serverSource.includes(weak), `algorithms 仍包含弱演算法 ${weak}`);
  }
});

test('server 必須接入 connection-guard 的三道限額', () => {
  assert.match(serverSource, /from '\.\/connection-guard\.js'/);
  assert.match(serverSource, /createConnectionGuard\(/);
  assert.match(serverSource, /registerAuthFailure\(/);
  assert.match(serverSource, /acquireSession\(/);
  assert.match(serverSource, /\.release\(\)/);
});

test('config 必須提供 per-IP、認證失敗與 session 限額', () => {
  assert.match(configSource, /SSH_MAX_CLIENTS_PER_IP/);
  assert.match(configSource, /SSH_MAX_AUTH_FAILURES/);
  assert.match(configSource, /SSH_MAX_SESSIONS_PER_CLIENT/);
});

test('SSH_MAX_CLIENTS 預設不得再是易耗盡的 3', () => {
  const match = configSource.match(/readInteger\('SSH_MAX_CLIENTS',\s*(\d+)/);
  assert.ok(match, '找不到 SSH_MAX_CLIENTS 預設值');
  assert.ok(Number(match[1]) >= 32, `SSH_MAX_CLIENTS 預設 ${match[1]} 過低`);
});
