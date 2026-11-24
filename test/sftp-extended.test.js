// 檔案標註：SFTP 進階操作的整合測試（經 attachSftpServer，以暫存目錄充當機器根）
// 1. REALPATH               → 登入落點為家目錄，.. 可回到上一層
// 2. READDIR                → lstat 列表與符號連結 longname
// 3. SYMLINK / READLINK     → 原樣保存目標字串
// 4. SETSTAT / FSETSTAT     → 修改時間戳
// 5. LINK                   → 建立硬連結
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';
import { attachSftpServer } from '../src/sftp-server.js';

const { OPEN_MODE, STATUS_CODE } = ssh2.utils.sftp;

function canCreateSymlinks() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-probe-'));
  try {
    fs.symlinkSync('target', path.join(directory, 'link'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const symlink = canCreateSymlinks();

class FakeSftp extends EventEmitter {
  constructor() {
    super();
    this.statuses = [];
    this.names = [];
    this.lastHandle = null;
  }

  status(reqid, status) {
    this.statuses.push([reqid, status]);
  }

  name(reqid, names) {
    this.names.push(names);
  }

  handle(reqid, handle) {
    this.lastHandle = handle;
  }
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

function createMachine(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-machine-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home', 'alice');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true });
  fs.writeFileSync(path.join(home, 'notes.txt'), 'hello');
  const sftp = new FakeSftp();
  attachSftpServer(sftp, root, logger, {}, { followShellCwd: false, home, ...options });
  return { root, home, sftp };
}

test('REALPATH of . lands in the home directory and .. moves up like a chroot', (t) => {
  const { sftp } = createMachine(t);
  sftp.emit('REALPATH', 1, '.');
  sftp.emit('REALPATH', 2, '..');
  sftp.emit('REALPATH', 3, '../../etc');
  assert.deepEqual(sftp.names.map((names) => names[0].filename), ['/home/alice', '/home', '/etc']);
});

test('follow mode lands in the home directory when no shell cwd exists', (t) => {
  const { home, sftp } = createMachine(t, { followShellCwd: true });
  sftp.emit('REALPATH', 1, '.');
  assert.equal(sftp.names[0][0].filename, home.replaceAll('\\', '/'));
});

test('READDIR reports symlinks with their target and keeps listing broken links', { skip: !symlink }, (t) => {
  const { home, sftp } = createMachine(t);
  fs.symlinkSync('../etc/hosts', path.join(home, 'hosts-link'), 'file');
  sftp.emit('OPENDIR', 1, '.');
  sftp.emit('READDIR', 2, sftp.lastHandle);
  const entries = sftp.names.flat();
  assert.ok(entries.some((entry) => entry.filename === 'notes.txt' && entry.longname.startsWith('-rw')));
  const link = entries.find((entry) => entry.filename === 'hosts-link');
  assert.match(link.longname, /^lrwxrwxrwx +1 \S+ \S+ +\d+ \w{3} +\d+ [\d:]+ hosts-link -> \.\.\/etc\/hosts$/);
});

test('SYMLINK stores the raw target and READLINK returns it', { skip: !symlink }, (t) => {
  const { home, sftp } = createMachine(t);
  sftp.emit('SYMLINK', 1, '../etc/hosts', 'hosts-link');
  assert.equal(sftp.statuses.at(-1)[1], STATUS_CODE.OK);
  assert.equal(fs.readlinkSync(path.join(home, 'hosts-link')), '../etc/hosts');
  sftp.emit('READLINK', 2, 'hosts-link');
  assert.equal(sftp.names.at(-1)[0].filename, '../etc/hosts');
});

test('SETSTAT and FSETSTAT update timestamps', (t) => {
  const { home, sftp } = createMachine(t);
  const file = path.join(home, 'notes.txt');
  sftp.emit('SETSTAT', 1, 'notes.txt', { atime: 1_000_000_000, mtime: 1_000_000_000 });
  assert.equal(sftp.statuses.at(-1)[1], STATUS_CODE.OK);
  assert.equal(Math.round(fs.statSync(file).mtimeMs), 1_000_000_000_000);
  sftp.emit('OPEN', 2, 'notes.txt', OPEN_MODE.WRITE);
  sftp.emit('FSETSTAT', 3, sftp.lastHandle, { atime: 1_000_000_005, mtime: 1_000_000_005 });
  assert.equal(sftp.statuses.at(-1)[1], STATUS_CODE.OK);
  assert.equal(Math.round(fs.statSync(file).mtimeMs), 1_000_000_005_000);
});

test('LINK creates a hard link', (t) => {
  const { home, sftp } = createMachine(t);
  sftp.emit('LINK', 1, 'notes.txt', 'hard.txt');
  assert.equal(sftp.statuses.at(-1)[1], STATUS_CODE.OK);
  assert.equal(fs.readFileSync(path.join(home, 'hard.txt'), 'utf8'), 'hello');
});
