import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadVmConfig, validateVmServicePorts } from '../src/vm-config.js';

test('loadVmConfig treats blank values as defaults', () => {
  const config = loadVmConfig('/app', {
    VM_ENABLED: '',
    VM_RAM_MB: '',
    VM_CPU_LIMIT: '',
    VM_DISK_GB: '',
    VM_SSH_HOST_PORT: ''
  });

  assert.equal(config.enabled, false);
  assert.equal(config.ramMb, 1024);
  assert.equal(config.cpuLimit, 1);
  assert.equal(config.diskGb, 10);
  assert.equal(config.sshHostPort, 2223);
  assert.equal(config.imagePath, path.resolve('/app/vm/debian-12-genericcloud-amd64.qcow2'));
  assert.equal(config.qemuAutoInstall, true);
  assert.equal(config.qemuRuntimePath, path.resolve('/app/vm/runtime'));
});

test('loadVmConfig validates QEMU auto-install settings', () => {
  const config = loadVmConfig('/app', {
    VM_QEMU_AUTO_INSTALL: 'false',
    VM_QEMU_RUNTIME_PATH: './cache/qemu',
    VM_QEMU_INSTALL_TIMEOUT_MS: '120000'
  });

  assert.equal(config.qemuAutoInstall, false);
  assert.equal(config.qemuRuntimePath, path.resolve('/app/cache/qemu'));
  assert.equal(config.qemuInstallTimeoutMs, 120000);
  assert.throws(() => loadVmConfig('/app', { VM_QEMU_AUTO_INSTALL: 'maybe' }), /must be a boolean/);
});

test('loadVmConfig accepts a CPU limit with one decimal place', () => {
  const config = loadVmConfig('/app', { VM_CPU_LIMIT: '1.5' });
  assert.equal(config.cpuLimit, 1.5);
});

test('loadVmConfig rejects CPU limits with more than one decimal place', () => {
  assert.throws(() => loadVmConfig('/app', { VM_CPU_LIMIT: '1.25' }), /at most 1 decimal place/);
});

test('loadVmConfig rejects unsupported architectures and unsafe image URLs', () => {
  assert.throws(() => loadVmConfig('/app', { VM_ARCH: 'arm64' }), /supports amd64 only/);
  assert.throws(() => loadVmConfig('/app', { VM_IMAGE_URL: 'http://example.com/vm.qcow2' }), /must use HTTPS/);
});

test('loadVmConfig preserves an explicitly blank VM password for key-only login', () => {
  const config = loadVmConfig('/app', {
    SSH_DEFAULT_PASSWORD: 'HostPassword123!',
    VM_SSH_PASSWORD: '',
    VM_SSH_AUTHORIZED_KEY: 'ssh-ed25519 AAAAC3NzaExample root@test'
  });

  assert.equal(config.sshPassword, '');
  assert.match(config.sshAuthorizedKey, /^ssh-ed25519/);
});

test('validateVmServicePorts rejects a collision with the host SSH server', () => {
  assert.throws(
    () => validateVmServicePorts({ enabled: true, sshHostPort: 2222 }, 2222),
    /must differ from SSH_PORT/
  );
  assert.doesNotThrow(() => validateVmServicePorts({ enabled: false, sshHostPort: 2222 }, 2222));
});

test('loadVmConfig rejects an enabled VM without SSH credentials before downloading', () => {
  assert.throws(
    () => loadVmConfig('/app', { VM_ENABLED: 'true', VM_SSH_PASSWORD: '', VM_SSH_AUTHORIZED_KEY: '' }),
    /VM_SSH_PASSWORD or VM_SSH_AUTHORIZED_KEY/
  );
});
