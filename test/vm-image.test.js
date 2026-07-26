import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checksumForFile, ensureVmImage } from '../src/vm-image.js';

test('checksumForFile selects the exact Debian image filename', () => {
  const hash = 'a'.repeat(128);
  const otherHash = 'b'.repeat(128);
  const checksums = `${otherHash} debian-12-generic-amd64.qcow2\n${hash} debian-12-genericcloud-amd64.qcow2\n`;

  assert.equal(checksumForFile(checksums, 'debian-12-genericcloud-amd64.qcow2'), hash);
});

test('checksumForFile rejects a missing image checksum', () => {
  assert.throws(() => checksumForFile('', 'missing.qcow2'), /No SHA-512 checksum/);
});

test('ensureVmImage expands a smaller qcow2 image but never shrinks it', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-image-'));
  const imagePath = path.join(directory, 'vm.qcow2');
  fs.writeFileSync(imagePath, 'test');
  const commands = [];
  const config = {
    imagePath,
    qemuBinary: 'qemu',
    qemuImgBinary: 'qemu-img',
    diskGb: 10,
    minHostFreeGb: 0
  };
  const runCommand = async (binary, args) => {
    commands.push([binary, ...args]);
    if (args[0] === 'info') {
      return { stdout: JSON.stringify({ format: 'qcow2', 'virtual-size': 5 * 1024 ** 3 }) };
    }
    return { stdout: '' };
  };

  await ensureVmImage(config, { info() {}, warn() {} }, { runCommand });
  assert.ok(commands.some((command) => command.includes('resize') && command.includes('10G')));

  await assert.rejects(
    () => ensureVmImage({ ...config, diskGb: 4 }, { info() {}, warn() {} }, {
      runCommand: async (binary, args) => args[0] === 'info'
        ? { stdout: JSON.stringify({ format: 'qcow2', 'virtual-size': 5 * 1024 ** 3 }) }
        : { stdout: '' }
    }),
    /Automatic shrinking is unsafe/
  );
});
