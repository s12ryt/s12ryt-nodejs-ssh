import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { sendQmpCommand } from '../src/qmp-client.js';

test('sendQmpCommand negotiates capabilities before powerdown', { skip: process.platform === 'win32' }, async () => {
  const socketPath = path.join(os.tmpdir(), `qmp-test-${process.pid}-${Date.now()}.sock`);
  const commands = [];
  const server = net.createServer((socket) => {
    socket.write(`${JSON.stringify({ QMP: { version: {}, capabilities: [] } })}\r\n`);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n');
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        commands.push(JSON.parse(line).execute);
        socket.write(`${JSON.stringify({ return: {} })}\r\n`);
      }
    });
  });

  await new Promise((resolve) => server.listen(socketPath, resolve));
  try {
    await sendQmpCommand(socketPath, 'system_powerdown');
    assert.deepEqual(commands, ['qmp_capabilities', 'system_powerdown']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(socketPath, { force: true });
  }
});

test('sendQmpCommand removes socket listeners after completion', async () => {
  const socket = new EventEmitter();
  const writes = [];
  socket.setEncoding = () => {};
  socket.write = (value) => writes.push(JSON.parse(value));
  socket.destroy = () => {};

  const command = sendQmpCommand('unused', 'system_powerdown', 1000, {
    createConnection: () => socket
  });
  socket.emit('data', [
    JSON.stringify({ QMP: { version: {}, capabilities: [] } }),
    JSON.stringify({ return: {} }),
    JSON.stringify({ return: {} })
  ].join('\r\n') + '\r\n');

  await command;
  assert.deepEqual(writes.map((message) => message.execute), ['qmp_capabilities', 'system_powerdown']);
  assert.equal(socket.listenerCount('data'), 0);
  assert.equal(socket.listenerCount('error'), 0);
});
