import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import bcrypt from 'bcryptjs';
import ssh2 from 'ssh2';
import { createSshServer } from '../src/server.js';

const { Client } = ssh2;

function hasSshKeygen() {
  return spawnSync('ssh-keygen', ['-V'], { shell: false }).error?.code !== 'ENOENT';
}

function connectExec({ port, command }) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let stdout = '';
    let stderr = '';

    client
      .on('ready', () => {
        client.exec(command, (error, stream) => {
          if (error) {
            reject(error);
            return;
          }

          stream
            .on('close', (code) => {
              client.end();
              resolve({ code, stdout, stderr });
            })
            .on('data', (chunk) => {
              stdout += chunk.toString();
            });

          stream.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
          });
        });
      })
      .on('error', reject)
      .connect({ host: '127.0.0.1', port, username: 'deploy', password: 'ChangeMe123!', readyTimeout: 5000 });
  });
}

function connectShell({ port, command, window = { term: 'xterm-256color', cols: 80, rows: 24 } }) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let output = '';
    let settled = false;

    function finish(error, result) {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    }

    client
      .on('ready', () => {
        client.shell(window, (error, stream) => {
          if (error) {
            client.once('close', () => finish(error));
            client.end();
            return;
          }

          stream
            .on('close', (code) => {
              client.once('close', () => finish(undefined, { code, output }));
              client.end();
            })
            .on('data', (chunk) => {
              output += chunk.toString();
            });

          stream.write(command);
        });
      })
      .on('error', finish)
      .connect({ host: '127.0.0.1', port, username: 'deploy', password: 'ChangeMe123!', readyTimeout: 5000 });
  });
}

function createTestWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-server-'));
  const hostKeyPath = path.join(workspace, 'ssh_host_ed25519_key');
  const usersFile = path.join(workspace, 'users.json');
  const commandsFile = path.join(workspace, 'commands.json');
  const sftpRoot = path.join(workspace, 'sftp');

  const keygen = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', hostKeyPath, '-N', '', '-C', 'test'], { stdio: 'ignore' });
  assert.equal(keygen.status, 0);

  fs.writeFileSync(usersFile, JSON.stringify([{ username: 'deploy', passwordHash: bcrypt.hashSync('ChangeMe123!', 4), authorizedKeys: [] }]));
  fs.writeFileSync(commandsFile, JSON.stringify({ ping: { executable: process.execPath, args: ['-e', 'process.stdout.write("pong")'], timeoutMs: 5000 } }));

  return { workspace, hostKeyPath, usersFile, commandsFile, sftpRoot };
}

async function withServer(configOverrides, callback) {
  const workspace = createTestWorkspace();
  const server = createSshServer(
    { maxClients: 3, readyTimeoutMs: 5000, enableShell: false, ...workspace, ...configOverrides },
    { debug() {}, info() {}, warn() {}, error() {} }
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    return await callback({ port, ...workspace });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(workspace.workspace, { recursive: true, force: true });
  }
}

test('SSH server accepts password auth and runs whitelisted exec', { skip: !hasSshKeygen() }, async () => {
  await withServer({}, async ({ port }) => {
    const result = await connectExec({ port, command: 'ping' });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'pong');
    assert.equal(result.stderr, '');
  });
});

test('SSH server rejects shell sessions by default', { skip: !hasSshKeygen() }, async () => {
  await withServer({}, async ({ port }) => {
    await assert.rejects(connectShell({ port, command: 'echo should-not-run\nexit\n' }));
  });
});

test('SSH server runs enabled interactive shell through PTY', { skip: !hasSshKeygen() || process.platform === 'win32' }, async () => {
  const shellPath = process.platform === 'win32' ? process.env.ComSpec : '/bin/sh';

  await withServer({ enableShell: true, shellPath }, async ({ port }) => {
    const command = process.platform === 'win32' ? 'echo shell-ok\r\nexit\r\n' : 'echo shell-ok\nexit\n';
    const result = await connectShell({ port, command });
    assert.equal(result.code, 0);
    assert.match(result.output, /shell-ok/);
  });
});
