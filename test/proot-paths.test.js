import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseProotConfig, prootGuestPathToHost, prootHostPathToGuest } from '../src/proot-paths.js';

function freeRootConfig(rootfs) {
  return `rootfs: ${rootfs}
cwd: /root
root: true
bindings:
  - ${path.join(rootfs, 'dev')}:/dev
  - ${path.join(rootfs, 'usr', 'local', 'bin')}:/usr/local/bin
`;
}

test('parseProotConfig reads the FreeRoot rootfs, cwd, and bindings', () => {
  const rootfs = path.resolve('freeroot');
  const config = parseProotConfig(freeRootConfig(rootfs));

  assert.equal(config.rootfs, rootfs);
  assert.equal(config.cwd, '/root');
  assert.deepEqual(config.bindings.map(({ guestPath }) => guestPath), ['/dev', '/usr/local/bin']);
});

test('PRoot paths map between guest root and the physical FreeRoot directory', () => {
  const rootfs = path.resolve('freeroot');
  const config = parseProotConfig(freeRootConfig(rootfs));

  assert.equal(prootGuestPathToHost(config, '/root/file.txt'), path.join(rootfs, 'root', 'file.txt'));
  assert.equal(prootHostPathToGuest(config, path.join(rootfs, 'etc', 'hosts')), '/etc/hosts');
});

test('PRoot bind paths use the most specific guest and host mapping', () => {
  const rootfs = path.resolve('freeroot');
  const config = parseProotConfig(freeRootConfig(rootfs));

  assert.equal(prootGuestPathToHost(config, '/usr/local/bin/tool'), path.join(rootfs, 'usr', 'local', 'bin', 'tool'));
  assert.equal(prootHostPathToGuest(config, path.join(rootfs, 'usr', 'local', 'bin', 'tool')), '/usr/local/bin/tool');
});

test('parseProotConfig rejects a missing or non-absolute rootfs', () => {
  assert.equal(parseProotConfig('cwd: /root\n'), undefined);
  assert.equal(parseProotConfig('rootfs: relative/rootfs\n'), undefined);
});
