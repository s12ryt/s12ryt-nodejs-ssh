import net from 'node:net';

export function sendQmpCommand(socketPath, execute, timeoutMs = 3000, dependencies = {}) {
  return new Promise((resolve, reject) => {
    const createConnection = dependencies.createConnection || net.createConnection;
    const socket = createConnection(socketPath);
    let buffer = '';
    let stage = 'greeting';
    let settled = false;
    const timeout = setTimeout(() => finish(new Error(`QMP command timed out: ${execute}`)), timeoutMs);

    function finish(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', finish);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.setEncoding('utf8');
    function onData(chunk) {
      buffer += chunk;
      if (buffer.length > 256 * 1024) {
        finish(new Error('QMP response exceeded 256 KiB'));
        return;
      }
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n');
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) {
          continue;
        }
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (stage === 'greeting' && message.QMP) {
          stage = 'capabilities';
          socket.write(`${JSON.stringify({ execute: 'qmp_capabilities' })}\r\n`);
        } else if (stage === 'capabilities' && Object.hasOwn(message, 'return')) {
          stage = 'command';
          socket.write(`${JSON.stringify({ execute })}\r\n`);
        } else if (stage === 'command' && message.error) {
          finish(new Error(`QMP ${execute} failed: ${message.error.desc || message.error.class}`));
        } else if (stage === 'command' && Object.hasOwn(message, 'return')) {
          finish();
        }
      }
    }
    socket.on('data', onData);
    socket.once('error', finish);
  });
}
