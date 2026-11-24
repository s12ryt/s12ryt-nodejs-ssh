// test/shell-home.test.js
// 互動 shell 與 SFTP 共用「使用者家目錄」的回歸測試
// 1. loadConfig 不再提供 shellCwd，也不再讀取 SSH_SHELL_CWD、不建立該目錄
// 2. createShellRunner 接受函式型 shellCwd，依登入使用者解析啟動目錄（root → <root>/root，其他 → <root>/home/<user>）
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../src/config.js';
import { createShellRunner } from '../src/shell-runner.js';
import { ensureHomeDirectory } from '../src/sftp-fs.js';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's12ryt-shell-home-'));
  const hostKeyPath = path.join(dir, 'host_key');
  fs.writeFileSync(hostKeyPath, 'placeholder');
  return { dir, hostKeyPath };
}

function withEnv(overrides, run) {
  const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    return run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createTerminal() {
  const disposer = { dispose() {} };
  return new Proxy({ pid: 4242 }, { get: (target, key) => (key in target ? target[key] : () => disposer) });
}

test('loadConfig exposes no shellCwd even when SSH_SHELL_CWD is set', () => {
  const { dir, hostKeyPath } = sandbox();
  const work = path.join(dir, 'work');

  const config = withEnv(
    { SSH_HOST_KEY_PATH: hostKeyPath, SSH_SHELL_CWD: work, SSH_SFTP_ROOT: path.join(dir, 'sftp') },
    () => loadConfig()
  );

  assert.equal('shellCwd' in config, false);
  assert.equal(fs.existsSync(work), false);
});

test('interactive shell starts in the home directory of the login user', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's12ryt-shell-home-'));
  const spawned = [];
  const terminal = createTerminal();
  const runner = createShellRunner(
    { shellPath: '/fake/shell', shellCwd: ({ username }) => ensureHomeDirectory(root, username) },
    { info() {}, error() {} },
    { loadPty: () => ({ spawn: (file, args, options) => { spawned.push(options); return terminal; } }) }
  );

  runner.start(new EventEmitter(), {}, { username: 'alice' });
  runner.start(new EventEmitter(), {}, { username: 'root' });

  assert.deepEqual(spawned.map((options) => options.cwd), [path.join(root, 'home', 'alice'), path.join(root, 'root')]);
});
