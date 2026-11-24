// 檔案標註：src/sftp-fs.js 單元測試
// 1. machineRoot            → 檔案系統根目錄
// 2. homeDirectoryFor /     → 家目錄映射與非法名稱
//    ensureHomeDirectory
// 3. createOwnerNames       → /etc/passwd、/etc/group 名稱解析
// 4. formatLongName         → ls -l longname（檔案、目錄、sticky、符號連結、舊日期）
// 5. applyStatChanges       → 時間戳、權限、空屬性、chown 失敗
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyStatChanges,
  createOwnerNames,
  ensureHomeDirectory,
  formatLongName,
  homeDirectoryFor,
  machineRoot
} from '../src/sftp-fs.js';

function tempRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('machineRoot returns the filesystem root of the given directory', () => {
  assert.equal(machineRoot(path.join(os.tmpdir(), 'any', 'where')), path.parse(os.tmpdir()).root);
});

test('homeDirectoryFor maps root to /root and other users to /home/<user>', () => {
  const root = path.parse(os.tmpdir()).root;
  assert.equal(homeDirectoryFor(root, 'root'), path.join(root, 'root'));
  assert.equal(homeDirectoryFor(root, 'alice'), path.join(root, 'home', 'alice'));
});

test('homeDirectoryFor rejects unsafe usernames', () => {
  const root = path.parse(os.tmpdir()).root;
  for (const username of ['../etc', 'a/b', 'a\\b', '', '.']) {
    assert.throws(() => homeDirectoryFor(root, username), /Invalid username/, username);
  }
});

test('ensureHomeDirectory creates the home directory and returns its path', (t) => {
  const root = tempRoot(t, 'sftp-home-');
  const home = ensureHomeDirectory(root, 'alice');
  assert.equal(home, path.join(root, 'home', 'alice'));
  assert.equal(fs.statSync(home).isDirectory(), true);
});

test('createOwnerNames resolves uid and gid, falling back to numeric ids', (t) => {
  const root = tempRoot(t, 'sftp-owners-');
  fs.mkdirSync(path.join(root, 'etc'));
  fs.writeFileSync(path.join(root, 'etc', 'passwd'), 'root:x:0:0:root:/root:/bin/sh\nalice:x:1001:100::/home/alice:/bin/sh\n');
  fs.writeFileSync(path.join(root, 'etc', 'group'), 'root:x:0:alice\nusers:x:100:alice\n');
  const names = createOwnerNames(root);
  assert.equal(names.owner(0), 'root');
  assert.equal(names.owner(1001), 'alice');
  assert.equal(names.group(100), 'users');
  assert.equal(names.owner(4242), '4242');
  assert.equal(createOwnerNames(path.join(root, 'missing')).owner(0), '0');
});

test('formatLongName renders entries like ls -l', () => {
  const recent = new Date(Date.now() - 3_600_000);
  const pad = (value) => String(value).padStart(2, '0');
  const clock = `${recent.toLocaleString('en-US', { month: 'short' })} ${pad(recent.getDate())} ${pad(recent.getHours())}:${pad(recent.getMinutes())}`;
  const file = { mode: 0o100644, nlink: 1, size: 5, mtimeMs: recent.getTime() };
  assert.equal(formatLongName('notes.txt', file, 'alice', 'users'), `-rw-r--r--  1 alice users        5 ${clock} notes.txt`);
  const directory = { mode: 0o40755, nlink: 2, size: 4096, mtimeMs: recent.getTime() };
  assert.equal(formatLongName('bin', directory, 'root', 'root'), `drwxr-xr-x  2 root root     4096 ${clock} bin`);
  const sticky = { mode: 0o41777, nlink: 2, size: 4096, mtimeMs: recent.getTime() };
  assert.match(formatLongName('tmp', sticky, 'root', 'root'), /^drwxrwxrwt  2 root root/);
  const link = { mode: 0o120777, nlink: 1, size: 11, mtimeMs: recent.getTime() };
  assert.equal(formatLongName('latest', link, 'alice', 'users', '../etc/hosts'), `lrwxrwxrwx  1 alice users       11 ${clock} latest -> ../etc/hosts`);
  const old = { mode: 0o100644, nlink: 1, size: 5, mtimeMs: new Date(2000, 5, 15, 12, 0).getTime() };
  assert.equal(formatLongName('old.txt', old, 'root', 'root'), '-rw-r--r--  1 root root        5 Jun 15  2000 old.txt');
});

test('applyStatChanges applies timestamps and mode, and tolerates empty attributes', (t) => {
  const file = path.join(tempRoot(t, 'sftp-stat-'), 'notes.txt');
  fs.writeFileSync(file, 'hello');
  assert.equal(applyStatChanges(file, { atime: 1_000_000_000, mtime: 1_000_000_000, mode: 0o600 }), null);
  const stats = fs.statSync(file);
  assert.equal(Math.round(stats.mtimeMs), 1_000_000_000_000);
  if (process.platform !== 'win32') {
    assert.equal(stats.mode & 0o777, 0o600);
  }
  assert.equal(applyStatChanges(file, {}), null);
});

test('applyStatChanges reports chown failures when not permitted', (t) => {
  const file = path.join(tempRoot(t, 'sftp-chown-'), 'notes.txt');
  fs.writeFileSync(file, 'hello');
  const denied = applyStatChanges(file, { uid: 0, gid: 0 });
  if (process.platform !== 'win32' && process.getuid() !== 0) {
    assert.equal(denied?.code, 'EPERM');
  } else {
    assert.equal(denied, null);
  }
});
