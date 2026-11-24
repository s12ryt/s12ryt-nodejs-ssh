// 檔案標註：家目錄不可用時的退路行為（例如服務以非 root 帳號執行，卻登入 root）
// 1. ensureHomeDirectory：無法建立或不可存取時回傳 null，而不是回傳一個進不去的路徑
// 2. createShellRunner：解析不到家目錄時以呼叫端的備援值（os.homedir()）作為啟動目錄
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ensureHomeDirectory } from '../src/sftp-fs.js';
import { createShellRunner } from '../src/shell-runner.js';

function fileRoot() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'home-fallback-')), 'root-file');
  fs.writeFileSync(file, 'not a directory');
  return file;
}

test('ensureHomeDirectory returns null when the home directory cannot be created', () => {
  assert.equal(ensureHomeDirectory(fileRoot(), 'alice'), null);
});

test('ensureHomeDirectory returns null when the home directory is not accessible', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-fallback-'));
  const home = path.join(root, 'home', 'alice');
  fs.mkdirSync(home, { recursive: true });
  t.after(() => fs.chmodSync(home, 0o755));
  fs.chmodSync(home, 0o000);
  assert.equal(ensureHomeDirectory(root, 'alice'), null);
});

test('interactive shell starts in the fallback directory when the home is unavailable', () => {
  const root = fileRoot();
  const spawned = [];
  const disposer = { dispose() {} };
  const terminal = new Proxy({ pid: 4242 }, { get: (target, key) => (key in target ? target[key] : () => disposer) });
  const runner = createShellRunner(
    { shellPath: '/fake/shell', shellCwd: ({ username }) => ensureHomeDirectory(root, username) || os.homedir() },
    { info() {}, warn() {}, error() {} },
    { loadPty: () => ({ spawn: (file, args, options) => { spawned.push(options); return terminal; } }) }
  );
  runner.start(new EventEmitter(), {}, { username: 'alice' });
  assert.equal(spawned[0].cwd, os.homedir());
});
