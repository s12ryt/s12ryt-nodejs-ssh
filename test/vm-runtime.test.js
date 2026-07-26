import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureQemuRuntime, qemuCommandEnvironment } from '../src/vm-runtime.js';

function silentLogger() {
  return { info() {}, warn() {} };
}

test('ensureQemuRuntime keeps available system binaries', async () => {
  const config = {
    qemuBinary: 'qemu-system-x86_64',
    qemuImgBinary: 'qemu-img',
    qemuRuntimePath: '/unused',
    qemuAutoInstall: true
  };
  const commands = [];

  await ensureQemuRuntime(config, silentLogger(), {
    runCommand: async (binary, args) => {
      commands.push([binary, ...args]);
      return { stdout: 'version' };
    }
  });

  assert.equal(config.qemuBinary, 'qemu-system-x86_64');
  assert.deepEqual(commands, [
    ['qemu-system-x86_64', '--version'],
    ['qemu-img', '--version']
  ]);
});

test('ensureQemuRuntime rejects unavailable explicit binaries', async () => {
  await assert.rejects(
    () => ensureQemuRuntime({
      qemuBinary: '/custom/qemu',
      qemuImgBinary: '/custom/qemu-img',
      qemuRuntimePath: '/unused',
      qemuAutoInstall: true,
      customQemuBinaries: true
    }, silentLogger(), {
      runCommand: async () => {
        throw new Error('missing');
      }
    }),
    /Configured VM_QEMU_BINARY/
  );
});

test('ensureQemuRuntime respects a disabled automatic install', async () => {
  await assert.rejects(
    () => ensureQemuRuntime({
      qemuBinary: 'missing-qemu',
      qemuImgBinary: 'missing-qemu-img',
      qemuRuntimePath: path.resolve('missing-runtime'),
      qemuAutoInstall: false
    }, silentLogger(), {
      runCommand: async () => {
        throw new Error('missing');
      }
    }),
    /VM_QEMU_AUTO_INSTALL=false/
  );
});

test('ensureQemuRuntime downloads and atomically activates a private APT runtime', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-runtime-'));
  const runtimePath = path.join(directory, 'runtime');
  const config = {
    qemuBinary: 'qemu-system-x86_64',
    qemuImgBinary: 'qemu-img',
    qemuRuntimePath: runtimePath,
    qemuAutoInstall: true,
    qemuInstallTimeoutMs: 60000
  };
  const commands = [];
  const runCommand = async (binary, args) => {
    commands.push([binary, ...args]);
    if (binary === 'apt-get' && args.includes('install')) {
      const archiveOption = args.find((arg) => arg.startsWith('Dir::Cache::Archives='));
      const archiveDirectory = archiveOption.slice('Dir::Cache::Archives='.length);
      fs.writeFileSync(path.join(archiveDirectory, 'qemu.deb'), 'package');
      return { stdout: '' };
    }
    if (binary === 'dpkg-deb') {
      const target = args.at(-1);
      fs.mkdirSync(path.join(target, 'usr', 'bin'), { recursive: true });
      fs.mkdirSync(path.join(target, 'usr', 'share', 'qemu'), { recursive: true });
      fs.mkdirSync(path.join(target, 'usr', 'share', 'seabios'), { recursive: true });
      fs.mkdirSync(path.join(target, 'usr', 'lib', 'x86_64-linux-gnu'), { recursive: true });
      fs.writeFileSync(path.join(target, 'usr', 'bin', 'qemu-system-x86_64'), 'binary');
      fs.writeFileSync(path.join(target, 'usr', 'bin', 'qemu-img'), 'binary');
      fs.writeFileSync(path.join(target, 'usr', 'share', 'seabios', 'bios-256k.bin'), 'bios');
      return { stdout: '' };
    }
    if (path.isAbsolute(binary) && fs.existsSync(binary)) {
      return { stdout: 'version' };
    }
    if (binary === 'apt-get') {
      return { stdout: '' };
    }
    throw new Error('missing');
  };

  await ensureQemuRuntime(config, silentLogger(), {
    runCommand,
    system: { platform: 'linux', arch: 'x64', uid: 999 }
  });

  assert.equal(config.qemuBinary, path.join(runtimePath, 'usr', 'bin', 'qemu-system-x86_64'));
  assert.equal(config.qemuImgBinary, path.join(runtimePath, 'usr', 'bin', 'qemu-img'));
  assert.equal(config.qemuBiosPath, path.join(runtimePath, 'usr', 'share', 'seabios', 'bios-256k.bin'));
  assert.ok(commands.some((command) => command[0] === 'apt-get' && command.includes('update')));
  assert.ok(commands.some((command) => command[0] === 'apt-get' && command.includes('qemu-system-x86')));
  assert.ok(commands.some((command) => command.includes('APT::Sandbox::User=')));
  assert.equal(fs.readdirSync(directory).some((entry) => entry.includes('.install-')), false);
});

test('ensureQemuRuntime preserves an existing private runtime when APT fails', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-runtime-preserve-'));
  const runtimePath = path.join(directory, 'runtime');
  fs.mkdirSync(path.join(runtimePath, 'usr', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(runtimePath, 'usr', 'share', 'seabios'), { recursive: true });
  fs.writeFileSync(path.join(runtimePath, 'usr', 'bin', 'qemu-system-x86_64'), 'old-qemu');
  fs.writeFileSync(path.join(runtimePath, 'usr', 'bin', 'qemu-img'), 'old-img');
  fs.writeFileSync(path.join(runtimePath, 'usr', 'share', 'seabios', 'bios-256k.bin'), 'old-bios');

  await assert.rejects(
    () => ensureQemuRuntime({
      qemuBinary: 'missing-qemu',
      qemuImgBinary: 'missing-qemu-img',
      qemuRuntimePath: runtimePath,
      qemuAutoInstall: true,
      qemuInstallTimeoutMs: 60000
    }, silentLogger(), {
      runCommand: async (binary) => {
        if (binary === 'apt-get') {
          throw new Error('network unavailable');
        }
        throw new Error('runtime unavailable');
      },
      system: { platform: 'linux', arch: 'x64', uid: 999 }
    }),
    /network unavailable/
  );

  assert.equal(fs.readFileSync(path.join(runtimePath, 'usr', 'bin', 'qemu-system-x86_64'), 'utf8'), 'old-qemu');
});

test('qemuCommandEnvironment prepends private runtime libraries', () => {
  const environment = qemuCommandEnvironment(
    { qemuLibraryPath: '/runtime/lib:/runtime/usr/lib' },
    { PATH: '/usr/bin', LD_LIBRARY_PATH: '/existing' }
  );

  assert.equal(environment.LD_LIBRARY_PATH, `/runtime/lib:/runtime/usr/lib${path.delimiter}/existing`);
  assert.equal(environment.PATH, '/usr/bin');
});
