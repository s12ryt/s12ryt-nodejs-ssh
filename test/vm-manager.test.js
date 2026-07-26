import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { buildQemuArgs, createVmManager } from '../src/vm-manager.js';

test('buildQemuArgs uses TCG, rounds fractional CPU up, and forwards VM SSH', () => {
  const args = buildQemuArgs({
    hostname: 'vm',
    cpuLimit: 1.5,
    ramMb: 1536,
    imagePath: '/data/vm.qcow2',
    sshHost: '0.0.0.0',
    sshHostPort: 2223,
    qemuDataPath: '/runtime/usr/share/qemu',
    qemuBiosPath: '/runtime/usr/share/seabios/bios-256k.bin'
  }, {
    seedUrl: 'http://10.0.2.2:1234/token/',
    qmpPath: '/tmp/vm.qmp'
  });

  assert.deepEqual(args.slice(args.indexOf('-smp'), args.indexOf('-smp') + 2), ['-smp', '2']);
  assert.deepEqual(args.slice(args.indexOf('-m'), args.indexOf('-m') + 2), ['-m', '1536']);
  assert.ok(args.includes('tcg,thread=multi'));
  assert.ok(args.includes('user,model=virtio-net-pci,hostfwd=tcp:0.0.0.0:2223-:22'));
  assert.ok(args.includes('on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny'));
  assert.deepEqual(args.slice(args.indexOf('-L'), args.indexOf('-L') + 2), ['-L', '/runtime/usr/share/qemu']);
  assert.deepEqual(args.slice(args.indexOf('-bios'), args.indexOf('-bios') + 2), ['-bios', '/runtime/usr/share/seabios/bios-256k.bin']);
  assert.equal(args.some((arg) => String(arg).includes('kvm')), false);
});

test('createVmManager starts and gracefully stops the QEMU child', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-manager-'));
  const child = new EventEmitter();
  child.pid = 1234;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal) => {
    child.signalCode = signal;
    child.emit('exit', null, signal);
  };
  let metadataClosed = false;
  let qmpCommand;
  const config = {
    enabled: true,
    qemuBinary: 'qemu',
    qemuLibraryPath: '/runtime/lib:/runtime/usr/lib',
    hostname: 'vm',
    cpuLimit: 1,
    ramMb: 512,
    diskGb: 4,
    imagePath: path.join(directory, 'vm.qcow2'),
    sshUsername: 'root',
    sshPassword: 'StrongPassword123!',
    sshAuthorizedKey: '',
    sshHost: '127.0.0.1',
    sshHostPort: 2223,
    shutdownTimeoutMs: 1000,
    metadataTimeoutMs: 1000
  };
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  let spawnOptions;
  const manager = createVmManager(config, logger, {
    qmpPath: '/tmp/test-vm.qmp',
    ensureVmImage: async () => {},
    startMetadataServer: async () => ({
      seedUrl: 'http://10.0.2.2:1234/token/',
      consumed: Promise.resolve(),
      async close() {
        metadataClosed = true;
      }
    }),
    spawnProcess: (binary, args, options) => {
      spawnOptions = options;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    applyCpuLimit: () => ({ enforced: true, cleanup() {} }),
    waitForVmSsh: async () => {},
    sendQmpCommand: async (socketPath, command) => {
      qmpCommand = command;
      child.exitCode = 0;
      child.emit('exit', 0, null);
    }
  });

  await manager.start();
  assert.equal(child.listenerCount('error'), 0);
  await manager.stop();

  assert.equal(qmpCommand, 'system_powerdown');
  assert.equal(metadataClosed, true);
  assert.match(spawnOptions.env.LD_LIBRARY_PATH, /^\/runtime\/lib:/);
  assert.equal(fs.readdirSync(directory).some((entry) => entry.includes('.cloud-init-')), true);
});

test('createVmManager waits for cloud-init completion before SSH readiness and marker creation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-manager-completion-'));
  const child = new EventEmitter();
  child.pid = 5678;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal) => {
    child.signalCode = signal;
    child.emit('exit', null, signal);
  };
  let resolveCompletion;
  const completed = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  let sshWaitStarted = false;
  const imagePath = path.join(directory, 'vm.qcow2');
  const manager = createVmManager({
    enabled: true,
    qemuBinary: 'qemu',
    hostname: 'vm',
    cpuLimit: 1,
    ramMb: 512,
    diskGb: 4,
    imagePath,
    sshUsername: 'root',
    sshPassword: 'StrongPassword123!',
    sshAuthorizedKey: '',
    sshHost: '127.0.0.1',
    sshHostPort: 2223,
    shutdownTimeoutMs: 1000,
    metadataTimeoutMs: 1000
  }, { debug() {}, info() {}, warn() {}, error() {} }, {
    qmpPath: '/tmp/test-vm-completion.qmp',
    ensureVmImage: async () => {},
    startMetadataServer: async () => ({
      seedUrl: 'http://10.0.2.2:1234/token/',
      consumed: Promise.resolve(),
      completed,
      async close() {}
    }),
    spawnProcess: () => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    applyCpuLimit: () => ({ enforced: true, cleanup() {} }),
    waitForVmSsh: async () => {
      sshWaitStarted = true;
    }
  });

  const startPromise = manager.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sshWaitStarted, false);
  assert.equal(fs.readdirSync(directory).some((entry) => entry.includes('.cloud-init-')), false);

  resolveCompletion();
  await startPromise;
  assert.equal(sshWaitStarted, true);
  assert.equal(fs.readdirSync(directory).some((entry) => entry.includes('.cloud-init-')), true);

  await manager.stop();
});

test('createVmManager fails immediately when QEMU exits after the initial spawn window', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-manager-exit-'));
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  let metadataClosed = false;
  const manager = createVmManager({
    enabled: true,
    qemuBinary: 'qemu',
    hostname: 'vm',
    cpuLimit: 1,
    ramMb: 512,
    diskGb: 4,
    imagePath: path.join(directory, 'vm.qcow2'),
    sshUsername: 'root',
    sshPassword: 'StrongPassword123!',
    sshAuthorizedKey: '',
    sshHost: '127.0.0.1',
    sshHostPort: 2223,
    shutdownTimeoutMs: 1000,
    metadataTimeoutMs: 60000
  }, { debug() {}, info() {}, warn() {}, error() {} }, {
    qmpPath: '/tmp/test-vm-exit.qmp',
    ensureVmImage: async () => {},
    startMetadataServer: async () => ({
      seedUrl: 'http://10.0.2.2:1234/token/',
      consumed: new Promise(() => {}),
      async close() {
        metadataClosed = true;
      }
    }),
    spawnProcess: () => {
      queueMicrotask(() => {
        child.emit('spawn');
        child.stderr.write('fatal boot error\n');
        setTimeout(() => {
          child.exitCode = 1;
          child.emit('exit', 1, null);
        }, 20);
      });
      return child;
    },
    applyCpuLimit: () => ({ enforced: true, cleanup() {} }),
    waitForVmSsh: async () => {},
    startupProgressIntervalMs: 1000
  });

  await assert.rejects(() => manager.start(), /QEMU exited during startup.*fatal boot error/);
  assert.equal(metadataClosed, true);
});

test('createVmManager bounds QEMU console lines retained during startup failure', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-manager-output-bound-'));
  const child = new EventEmitter();
  child.pid = 8765;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const loggedOutputLengths = [];
  const manager = createVmManager({
    enabled: true,
    qemuBinary: 'qemu',
    hostname: 'vm',
    cpuLimit: 1,
    ramMb: 512,
    diskGb: 4,
    imagePath: path.join(directory, 'vm.qcow2'),
    sshUsername: 'root',
    sshPassword: 'StrongPassword123!',
    sshAuthorizedKey: '',
    sshHost: '127.0.0.1',
    sshHostPort: 2223,
    shutdownTimeoutMs: 1000,
    metadataTimeoutMs: 60000
  }, {
    debug(message, details) { loggedOutputLengths.push(details?.output?.length || 0); },
    info() {},
    warn(message, details) { loggedOutputLengths.push(details?.output?.length || 0); },
    error() {}
  }, {
    qmpPath: '/tmp/test-vm-output-bound.qmp',
    ensureVmImage: async () => {},
    startMetadataServer: async () => ({
      seedUrl: 'http://10.0.2.2:1234/token/',
      consumed: new Promise(() => {}),
      async close() {}
    }),
    spawnProcess: () => {
      queueMicrotask(() => {
        child.emit('spawn');
        child.stderr.write(`${'x'.repeat(1024 * 1024)}\n`);
        setTimeout(() => {
          child.exitCode = 1;
          child.emit('exit', 1, null);
        }, 20);
      });
      return child;
    },
    applyCpuLimit: () => ({ enforced: true, cleanup() {} })
  });

  let startupError;
  try {
    await manager.start();
  } catch (error) {
    startupError = error;
  }

  assert.ok(startupError);
  assert.ok(startupError.message.length < 100000);
  assert.ok(Math.max(...loggedOutputLengths) <= 64 * 1024);
});
