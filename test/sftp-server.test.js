import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import ssh2 from 'ssh2';
import { attachSftpServer, resolveSftpPath, sftpClientPath } from '../src/sftp-server.js';
import { parseProotConfig } from '../src/proot-paths.js';

const { OPEN_MODE } = ssh2.utils.sftp;

class FakeSftp extends EventEmitter {
  constructor() {
    super();
    this.lastHandle = undefined;
    this.statuses = [];
  }

  handle(reqid, handle) {
    this.lastHandle = handle;
  }

  status(reqid, status) {
    this.statuses.push([reqid, status]);
  }
}

test('resolveSftpPath follows the current shell cwd for relative paths', () => {
  const resolved = resolveSftpPath({
    root: path.resolve('sandbox'),
    requestedPath: 'nested/file.txt',
    followShellCwd: true,
    shellCwd: path.resolve('shell-current')
  });

  assert.equal(resolved, path.resolve('shell-current', 'nested/file.txt'));
});

test('resolveSftpPath allows absolute OS paths when shell following is enabled', () => {
  const absolutePath = path.resolve(path.parse(process.cwd()).root, 'root', 'file.txt');
  const resolved = resolveSftpPath({
    root: path.resolve('sandbox'),
    requestedPath: absolutePath,
    followShellCwd: true,
    shellCwd: path.resolve('shell-current')
  });

  assert.equal(resolved, absolutePath);
});

test('resolveSftpPath preserves the SFTP root sandbox when shell following is disabled', () => {
  const root = path.resolve('sandbox');

  assert.equal(
    resolveSftpPath({ root, requestedPath: '/nested/file.txt', followShellCwd: false, shellCwd: '/root' }),
    path.join(root, 'nested', 'file.txt')
  );
  assert.equal(
    resolveSftpPath({ root, requestedPath: '../../secret.txt', followShellCwd: false, shellCwd: '/root' }),
    path.join(root, 'secret.txt')
  );
});

test('resolveSftpPath maps FreeRoot guest paths into the physical rootfs', () => {
  const rootfs = path.resolve('freeroot');
  const proot = parseProotConfig(`rootfs: ${rootfs}\ncwd: /root\nbindings:\n`);

  assert.equal(
    resolveSftpPath({
      root: path.resolve('sandbox'),
      requestedPath: '/root/file.txt',
      followShellCwd: true,
      shellCwd: path.join(rootfs, 'root'),
      proot
    }),
    path.join(rootfs, 'root', 'file.txt')
  );
  assert.equal(
    resolveSftpPath({
      root: path.resolve('sandbox'),
      requestedPath: '../../etc/hosts',
      followShellCwd: true,
      shellCwd: path.join(rootfs, 'root'),
      proot
    }),
    path.join(rootfs, 'etc', 'hosts')
  );
  assert.equal(sftpClientPath(path.join(rootfs, 'root'), proot), '/root');
});

test('attachSftpServer releases open handles when the channel closes without end', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-cleanup-'));
  const filename = path.join(directory, 'open.txt');
  fs.writeFileSync(filename, 'data');
  const sftp = new FakeSftp();
  let ended = 0;
  attachSftpServer(sftp, directory, {
    info(message) {
      if (message === 'SFTP session ended') {
        ended += 1;
      }
    },
    warn() {}
  });

  try {
    sftp.emit('OPEN', 1, filename, OPEN_MODE.READ);
    assert.ok(sftp.lastHandle);

    const statusCount = sftp.statuses.length;
    sftp.emit('close');
    assert.equal(sftp.listenerCount('end'), 0);
    assert.equal(sftp.listenerCount('close'), 0);
    assert.equal(sftp.listenerCount('error'), 0);
    assert.equal(sftp.listenerCount('OPEN'), 0);
    assert.equal(sftp.listenerCount('READ'), 0);
    sftp.emit('READ', 2, sftp.lastHandle, 0, 1024);
    assert.equal(sftp.statuses.length, statusCount);
    assert.equal(ended, 1);

    sftp.emit('end');
    assert.equal(ended, 1);
  } finally {
    sftp.emit('end');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
