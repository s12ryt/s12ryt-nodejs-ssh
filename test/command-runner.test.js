import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { createCommandRunner } from '../src/command-runner.js';

function createMockStream() {
  const chunks = [];
  const errors = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk).toString());
      callback();
    }
  });
  stream.stderr = new Writable({
    write(chunk, encoding, callback) {
      errors.push(Buffer.from(chunk).toString());
      callback();
    }
  });
  stream.exitCode = undefined;
  stream.exit = (code) => {
    stream.exitCode = code;
  };
  stream.output = () => chunks.join('');
  stream.errorOutput = () => errors.join('');
  return stream;
}

function createMockStreamWithoutStderr() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk).toString());
      callback();
    }
  });
  stream.exitCode = undefined;
  stream.exit = (code) => {
    stream.exitCode = code;
  };
  stream.output = () => chunks.join('');
  return stream;
}

test('command runner rejects commands outside whitelist', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'commands-')), 'commands.json');
  fs.writeFileSync(file, JSON.stringify({ allowed: { executable: process.execPath, args: ['-e', 'console.log(1)'] } }));
  const runner = createCommandRunner(file, { warn() {}, error() {}, info() {} });
  const stream = createMockStream();

  runner.run('not-allowed', stream, { username: 'u' });

  assert.equal(stream.exitCode, 127);
  assert.match(stream.errorOutput(), /not allowed/);
});

test('command runner executes whitelisted command', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'commands-')), 'commands.json');
  fs.writeFileSync(file, JSON.stringify({ ok: { executable: process.execPath, args: ['-e', 'process.stdout.write("ok")'], timeoutMs: 5000 } }));
  const runner = createCommandRunner(file, { warn() {}, error() {}, info() {} });
  const stream = createMockStream();

  runner.run('ok', stream, { username: 'u' });
  await new Promise((resolve) => stream.on('finish', resolve));

  assert.equal(stream.exitCode, 0);
  assert.equal(stream.output(), 'ok');
});

test('command runner times out long running command with exit code 124', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'commands-')), 'commands.json');
  fs.writeFileSync(file, JSON.stringify({ slow: { executable: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], timeoutMs: 200 } }));
  const runner = createCommandRunner(file, { warn() {}, error() {}, info() {} });
  const stream = createMockStream();

  runner.run('slow', stream, { username: 'u' });
  await new Promise((resolve) => stream.on('finish', resolve));

  assert.equal(stream.exitCode, 124);
  assert.match(stream.errorOutput(), /timed out/);
});

test('command runner exits cleanly without exit code collisions on error', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'commands-')), 'commands.json');
  fs.writeFileSync(file, JSON.stringify({ missing: { executable: path.join(os.tmpdir(), 'definitely-not-a-real-binary-xyz'), args: [] } }));
  const runner = createCommandRunner(file, { warn() {}, error() {}, info() {} });
  const stream = createMockStream();

  runner.run('missing', stream, { username: 'u' });
  await new Promise((resolve) => stream.on('finish', resolve));

  assert.equal(stream.exitCode, 1);
  assert.match(stream.errorOutput(), /Failed to start/);
});

test('command runner falls back to main stream when stderr is unavailable', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'commands-')), 'commands.json');
  fs.writeFileSync(file, JSON.stringify({ allowed: { executable: process.execPath, args: ['-e', 'console.log(1)'] } }));
  const runner = createCommandRunner(file, { warn() {}, error() {}, info() {} });
  const stream = createMockStreamWithoutStderr();

  runner.run('not-allowed', stream, { username: 'u' });

  assert.equal(stream.exitCode, 127);
  assert.match(stream.output(), /not allowed/);
});
