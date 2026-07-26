import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveSftpPath, sftpClientPath } from '../src/sftp-server.js';
import { parseProotConfig } from '../src/proot-paths.js';

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
  assert.throws(
    () => resolveSftpPath({ root, requestedPath: '../../secret.txt', followShellCwd: false, shellCwd: '/root' }),
    /escapes/
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
