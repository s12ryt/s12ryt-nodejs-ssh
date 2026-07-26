import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createShellEnv, readLinuxProcessContext, readLinuxProcessCwd, selectDefaultPosixShell } from '../src/shell-runner.js';

test('selectDefaultPosixShell prefers bash over sh for interactive compatibility', () => {
  const executable = new Set(['/bin/bash', '/bin/sh']);

  const shellPath = selectDefaultPosixShell({
    envShell: '/bin/sh',
    isExecutable: (candidate) => executable.has(candidate)
  });

  assert.equal(shellPath, '/bin/bash');
});

test('selectDefaultPosixShell falls back to env shell when no preferred shell exists', () => {
  const shellPath = selectDefaultPosixShell({
    envShell: '/custom/shell',
    isExecutable: (candidate) => candidate === '/custom/shell'
  });

  assert.equal(shellPath, '/custom/shell');
});

test('selectDefaultPosixShell falls back to /bin/sh as the last POSIX option', () => {
  const shellPath = selectDefaultPosixShell({
    envShell: undefined,
    isExecutable: (candidate) => candidate === '/bin/sh'
  });

  assert.equal(shellPath, '/bin/sh');
});

test('createShellEnv uses the real root identity instead of inherited container variables', () => {
  const shellEnv = createShellEnv(
    { username: 'root' },
    '/bin/bash',
    {
      env: { HOME: '/home/container', USER: 'container', LOGNAME: 'container' },
      uid: 0,
      userInfo: () => ({ username: 'container', homedir: '/home/container' })
    }
  );

  assert.equal(shellEnv.USER, 'root');
  assert.equal(shellEnv.LOGNAME, 'root');
  assert.equal(shellEnv.HOME, '/root');
  assert.equal(shellEnv.SHELL, '/bin/bash');
});

test('createShellEnv exposes the runtime OS user instead of the virtual SSH username', () => {
  const shellEnv = createShellEnv(
    { username: 'root' },
    '/bin/bash',
    {
      env: { HOME: '/home/container', USER: 'container' },
      uid: 999,
      userInfo: () => ({ username: 'app', homedir: '/srv/app' })
    }
  );

  assert.equal(shellEnv.USER, 'app');
  assert.equal(shellEnv.LOGNAME, 'app');
  assert.equal(shellEnv.HOME, '/srv/app');
});

test('createShellEnv tolerates an unmapped container uid', () => {
  const shellEnv = createShellEnv(
    { username: 'deploy' },
    '/bin/bash',
    {
      env: { HOME: '/home/container', USER: 'container' },
      uid: 999,
      userInfo: () => {
        throw new Error('uid is not mapped');
      }
    }
  );

  assert.equal(shellEnv.USER, 'container');
  assert.equal(shellEnv.HOME, '/home/container');
});

test('readLinuxProcessCwd follows the foreground process group cwd', () => {
  const links = [];
  const cwd = readLinuxProcessCwd(100, '/fallback', {
    readFile: () => '100 (bash) S 1 100 100 34816 200 0 0 0',
    readLink: (filename) => {
      links.push(filename);
      return '/root/current';
    }
  });

  assert.equal(cwd, '/root/current');
  assert.deepEqual(links, ['/proc/200/cwd']);
});

test('readLinuxProcessCwd falls back when proc entries disappear', () => {
  const cwd = readLinuxProcessCwd(100, '/configured', {
    readFile: () => {
      throw new Error('process exited');
    },
    readLink: () => {
      throw new Error('process exited');
    }
  });

  assert.equal(cwd, '/configured');
});

test('readLinuxProcessContext detects FreeRoot through PROOT_CONFIG', () => {
  const rootfs = path.resolve('freeroot');
  const configPath = path.join(rootfs, 'usr', 'local', '.config', 'proot.yml');
  const context = readLinuxProcessContext(100, '/fallback', {
    readFile: (filename) => {
      if (filename.endsWith('/stat')) {
        return '100 (bash) S 1 100 100 34816 200 0 0 0';
      }
      if (filename.endsWith('/environ')) {
        return `PATH=/usr/bin\0PROOT_CONFIG=${configPath}\0`;
      }
      if (filename === configPath) {
        return `rootfs: ${rootfs}\ncwd: /root\nbindings:\n  - ${path.join(rootfs, 'usr', 'local', 'bin')}:/usr/local/bin\n`;
      }
      throw new Error(`unexpected path: ${filename}`);
    },
    readLink: () => path.join(rootfs, 'root'),
    statFile: () => ({ isFile: () => true, size: 512 })
  });

  assert.equal(context.cwd, path.join(rootfs, 'root'));
  assert.equal(context.proot.rootfs, rootfs);
  assert.equal(context.proot.cwd, '/root');
  assert.equal(context.proot.bindings[0].guestPath, '/usr/local/bin');
});

test('readLinuxProcessContext rejects an oversized PRoot config before reading it', () => {
  const configPath = path.resolve('freeroot', 'proot.yml');
  let configRead = false;
  const context = readLinuxProcessContext(100, '/fallback', {
    readFile: (filename) => {
      if (filename.endsWith('/stat')) {
        return '100 (bash) S 1 100 100 34816 200 0 0 0';
      }
      if (filename.endsWith('/environ')) {
        return `PROOT_CONFIG=${configPath}\0`;
      }
      configRead = true;
      return `rootfs: ${path.dirname(configPath)}\n`;
    },
    readLink: () => '/fallback',
    statFile: () => ({ isFile: () => true, size: 64 * 1024 + 1 })
  });

  assert.equal(context.proot, undefined);
  assert.equal(configRead, false);
});
