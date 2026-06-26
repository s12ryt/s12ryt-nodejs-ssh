import fs from 'node:fs';
import { spawn } from 'node:child_process';

function splitCommandLine(commandLine) {
  const parts = [];
  const matches = commandLine.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g);
  for (const match of matches) {
    parts.push(match[1] ?? match[2] ?? match[3]);
  }
  return parts;
}

export function createCommandRunner(commandsFile, logger) {
  const commands = JSON.parse(fs.readFileSync(commandsFile, 'utf8'));

  function getCommand(commandName) {
    const command = commands[commandName];
    if (!command?.executable) {
      throw new Error(`Command is not allowed: ${commandName}`);
    }
    return command;
  }

  return {
    run(commandLine, stream, context = {}) {
      const [commandName, ...clientArgs] = splitCommandLine(String(commandLine || '').trim());
      if (!commandName) {
        stream.stderr.write('Empty command is not allowed\n');
        stream.exit(2);
        stream.end();
        return;
      }

      let command;
      try {
        command = getCommand(commandName);
      } catch (error) {
        logger.warn('Rejected command', { username: context.username, commandName });
        stream.stderr.write(`${error.message}\n`);
        stream.exit(127);
        stream.end();
        return;
      }

      const args = [...(command.args || [])];
      if (command.allowClientArgs) {
        args.push(...clientArgs);
      }

      const child = spawn(command.executable, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH }
      });

      const timeoutMs = Number.isInteger(command.timeoutMs) ? command.timeoutMs : 10000;
      let settled = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        stream.stderr.write(`Command timed out after ${timeoutMs}ms\n`);
        child.kill('SIGTERM');
      }, timeoutMs);

      function finish(exitCode) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        stream.exit(exitCode);
        stream.end();
      }

      child.stdout.pipe(stream, { end: false });
      child.stderr.pipe(stream.stderr, { end: false });

      child.on('error', (error) => {
        logger.error('Command failed to start', { username: context.username, commandName, error: error.message });
        stream.stderr.write(`Failed to start command: ${error.message}\n`);
        finish(1);
      });

      child.on('close', (code, signal) => {
        logger.info('Command finished', { username: context.username, commandName, code, signal, timedOut });
        const exitCode = timedOut ? 124 : (code ?? (signal ? 1 : 0));
        finish(exitCode);
      });
    }
  };
}
