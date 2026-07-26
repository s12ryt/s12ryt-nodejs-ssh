import net from 'node:net';

export function sendQmpCommand(socketPath, execute, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let stage = 'greeting';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`QMP command timed out: ${execute}`));
    }, timeoutMs);

    function finish(error) {
      clearTimeout(timeout);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
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
    });
    socket.once('error', finish);
  });
}
