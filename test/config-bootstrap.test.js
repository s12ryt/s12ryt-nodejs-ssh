// test/config-bootstrap.test.js
// 1. SSH_SFTP_ROOT 未設定時以機器根為虛擬根，不得嘗試建立機器根目錄（Windows EPERM）
// 2. 明確設定的 SSH_SFTP_ROOT 仍會被建立（SSH_SHELL_CWD 已移除：shell 改以家目錄啟動）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../src/config.js';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's12ryt-config-'));
  const hostKeyPath = path.join(dir, 'host_key');
  fs.writeFileSync(hostKeyPath, 'placeholder');
  return { dir, hostKeyPath };
}

function withEnv(overrides, run) {
  const keys = ['SSH_SFTP_ROOT', 'SSH_HOST_KEY_PATH', 'SSH_USERS_FILE', 'SSH_COMMANDS_FILE'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      delete process.env[key];
    }
    Object.assign(process.env, overrides);
    return run();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

test('loadConfig does not try to create the machine root when SSH_SFTP_ROOT is unset', () => {
  const { dir, hostKeyPath } = sandbox();

  const config = withEnv({ SSH_HOST_KEY_PATH: hostKeyPath }, () => loadConfig());

  assert.equal('shellCwd' in config, false);
  assert.ok(fs.statSync(config.sftpRoot).isDirectory(), 'sftpRoot must already exist as a directory');
});

test('loadConfig still creates an explicit SSH_SFTP_ROOT', () => {
  const { dir, hostKeyPath } = sandbox();
  const sftpRoot = path.join(dir, 'sandbox');

  const config = withEnv(
    { SSH_HOST_KEY_PATH: hostKeyPath, SSH_SFTP_ROOT: sftpRoot },
    () => loadConfig()
  );

  assert.equal(config.sftpRoot, sftpRoot);
  assert.ok(fs.existsSync(sftpRoot), 'explicit sftpRoot must be created');
});
