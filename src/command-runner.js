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

export function createCommandRunner(commandsFile, logger, dependencies = {}) {
  const commands = JSON.parse(fs.readFileSync(commandsFile, 'utf8'));
  const spawnProcess = dependencies.spawnProcess || spawn;

  function stderrFor(stream) {
    return stream.stderr || stream;
  }

  function getCommand(commandName) {
    const command = commands[commandName];
    if (!command?.executable) {
      throw new Error(`Command is not allowed: ${commandName}`);
    }
    return command;
  }

  return {
    run(commandLine, stream, context = {}) {
      const stderr = stderrFor(stream);
      const [commandName, ...clientArgs] = splitCommandLine(String(commandLine || '').trim());
      if (!commandName) {
        stderr.write('Empty command is not allowed\n');
        stream.exit(2);
        stream.end();
        return;
      }

      let command;
      try {
        command = getCommand(commandName);
      } catch (error) {
        logger.warn('Rejected command', { username: context.username, commandName });
        stderr.write(`${error.message}\n`);
        stream.exit(127);
        stream.end();
        return;
      }

      const args = [...(command.args || [])];
      if (command.allowClientArgs) {
        args.push(...clientArgs);
      }

      const child = spawnProcess(command.executable, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH }
      });

      const timeoutMs = Number.isInteger(command.timeoutMs) ? command.timeoutMs : 10000;
      const killGraceMs = dependencies.killGraceMs ?? 1000;
      let settled = false;
      let timedOut = false;
      let disconnected = false;
      let forceKillTimer;

      const timer = setTimeout(() => {
        timedOut = true;
        if (!stream.destroyed) {
          stderr.write(`Command timed out after ${timeoutMs}ms\n`);
        }
        terminateChild();
      }, timeoutMs);

      function releaseResources() {
        clearTimeout(timer);
        clearTimeout(forceKillTimer);
        child.stdout?.unpipe(stream);
        child.stderr?.unpipe(stderr);
        stream.off('close', onStreamClose);
        stream.off('error', onStreamError);
      }

      function finish(exitCode) {
        clearTimeout(forceKillTimer);
        if (settled) {
          return;
        }
        settled = true;
        releaseResources();
        if (disconnected || stream.destroyed) {
          return;
        }
        stream.exit(exitCode);
        stream.end();
      }

      function terminateChild() {
        if (child.exitCode != null || child.signalCode != null) {
          return;
        }
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => {
          if (child.exitCode == null && child.signalCode == null) {
            child.kill('SIGKILL');
          }
        }, killGraceMs);
      }

      function cancelForDisconnect() {
        if (settled) {
          return;
        }
        disconnected = true;
        settled = true;
        releaseResources();
        terminateChild();
      }

      function onStreamClose() {
        cancelForDisconnect();
      }

      function onStreamError() {
        cancelForDisconnect();
      }

      child.stdout?.pipe(stream, { end: false });
      child.stderr?.pipe(stderr, { end: false });
      stream.once('close', onStreamClose);
      stream.once('error', onStreamError);

      child.once('error', (error) => {
        logger.error('Command failed to start', { username: context.username, commandName, error: error.message });
        if (disconnected) {
          clearTimeout(forceKillTimer);
          return;
        }
        stderr.write(`Failed to start command: ${error.message}\n`);
        finish(1);
      });

      child.once('close', (code, signal) => {
        logger.info('Command finished', { username: context.username, commandName, code, signal, timedOut });
        const exitCode = timedOut ? 124 : (code ?? (signal ? 1 : 0));
        finish(exitCode);
      });
    }
  };
}
