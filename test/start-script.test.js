// test/start-script.test.js
// 1. generateFallbackHostKey 必產生 ssh2 可解析且不含 SHA-1 ssh-rsa 的 host key
// 2. resolveDefaultPassword 必同時套用 8 字元下限與 72 byte 上限
// 3. start.js / scripts 必改用共用模組，且 SSH_SFTP_ROOT 預設與 src/config.js 一致
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';

import { FALLBACK_HOST_KEY_TYPE, generateFallbackHostKey } from '../src/host-key.js';
import { resolveDefaultUsername, resolveDefaultPassword } from '../src/dev-credentials.js';
import { MAX_PASSWORD_BYTES } from '../src/auth.js';

const rootDir = path.resolve(import.meta.dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 's12ryt-start-'));
}

test('fallback host key type stays inside the hardened serverHostKey allow list', () => {
  assert.equal(FALLBACK_HOST_KEY_TYPE, 'ecdsa-sha2-nistp256');
});

test('generateFallbackHostKey writes a key ssh2 parses as ecdsa-sha2-nistp256', () => {
  const target = path.join(tempDir(), 'host_key');
  generateFallbackHostKey(target);

  const pem = fs.readFileSync(target, 'utf8');
  const parsed = ssh2.utils.parseKey(pem);
  assert.ok(!(parsed instanceof Error), `parseKey failed: ${parsed.message}`);
  assert.equal(parsed.type, FALLBACK_HOST_KEY_TYPE);
});

test('generateFallbackHostKey never emits an RSA key (ssh2 would offer SHA-1 ssh-rsa)', () => {
  const target = path.join(tempDir(), 'host_key');
  generateFallbackHostKey(target);

  const pem = fs.readFileSync(target, 'utf8');
  assert.ok(!pem.includes('RSA PRIVATE KEY'), 'fallback key must not be an RSA private key');
});

test('resolveDefaultUsername falls back and trims', () => {
  assert.equal(resolveDefaultUsername({}), 'deploy');
  assert.equal(resolveDefaultUsername({ SSH_DEFAULT_USERNAME: '  alice  ' }), 'alice');
  assert.throws(() => resolveDefaultUsername({ SSH_DEFAULT_USERNAME: '   ' }), /must not be empty/);
});

test('resolveDefaultPassword rejects passwords shorter than 8 characters', () => {
  assert.throws(() => resolveDefaultPassword({ SSH_DEFAULT_PASSWORD: 'short' }), /at least 8/);
});

test('resolveDefaultPassword rejects passwords above the bcrypt 72 byte limit', () => {
  assert.equal(MAX_PASSWORD_BYTES, 72);
  assert.equal(resolveDefaultPassword({ SSH_DEFAULT_PASSWORD: 'a'.repeat(72) }).length, 72);
  assert.throws(() => resolveDefaultPassword({ SSH_DEFAULT_PASSWORD: 'a'.repeat(73) }), /72 bytes/);
  assert.throws(() => resolveDefaultPassword({ SSH_DEFAULT_PASSWORD: '密'.repeat(25) }), /72 bytes/);
});

test('start.js and the scripts reuse the shared host-key and credential modules', () => {
  for (const file of ['start.js', 'scripts/generate-host-key.js']) {
    const source = readText(file);
    assert.match(source, /host-key\.js/, `${file} must import src/host-key.js`);
    assert.ok(!source.includes("generateKeyPairSync('rsa'"), `${file} must not inline an RSA fallback`);
  }

  for (const file of ['start.js', 'scripts/setup-dev.js']) {
    const source = readText(file);
    assert.match(source, /dev-credentials\.js/, `${file} must import src/dev-credentials.js`);
  }
});

test('start.js no longer hardcodes the stale ./s12ryt default for SSH_SFTP_ROOT', () => {
  const source = readText('start.js');
  assert.ok(
    !/SSH_SFTP_ROOT'\s*,\s*'\.\/s12ryt'/.test(source),
    'SSH_SFTP_ROOT default must match src/config.js (machine root when unset)'
  );
  assert.match(source, /SSH_SFTP_ROOT/);
});

test('start.js keeps no QEMU or VM residue', () => {
  const source = readText('start.js');
  for (const token of ['VM_', 'qemu', 'QEMU', 'qcow2', '2223']) {
    assert.ok(!source.includes(token), `start.js must not reference ${token}`);
  }
});
