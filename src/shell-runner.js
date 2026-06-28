import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pty = require('node-pty');

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function normalizePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function defaultShellPath() {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/sh';
}

function createShellEnv(context) {
  return {
    ...process.env,
    USER: context.username || process.env.USER,
    LOGNAME: context.username || process.env.LOGNAME,
    HOME: process.env.HOME || os.homedir()
  };
}

export function createShellRunner(config, logger) {
  const shellPath = config.shellPath || defaultShellPath();
  const shellCwd = config.shellCwd || process.cwd();

  function stderrFor(stream) {
    return stream.stderr || stream;
  }

  return {
    start(stream, ptyInfo = {}, context = {}) {
      const stderr = stderrFor(stream);
      const cols = normalizePositiveInteger(ptyInfo.cols, DEFAULT_COLS);
      const rows = normalizePositiveInteger(ptyInfo.rows, DEFAULT_ROWS);
      const term = ptyInfo.term || 'xterm-256color';

      let exited = false;
      let terminal;

      try {
        terminal = pty.spawn(shellPath, [], {
          name: term,
          cols,
          rows,
          cwd: shellCwd,
          env: createShellEnv(context),
          handleFlowControl: true
        });
      } catch (error) {
        logger.error('Interactive shell failed to start', { username: context.username, shellPath, error: error.message });
        stderr.write(`Failed to start shell: ${error.message}\n`);
        stream.exit(1);
        stream.end();
        return {
          resize() {},
          close() {}
        };
      }

      logger.info('Interactive shell started', {
        username: context.username,
        shellPath,
        term,
        cols,
        rows
      });

      terminal.onData((data) => {
        if (!exited) {
          stream.write(data);
        }
      });

      terminal.onExit(({ exitCode, signal }) => {
        if (exited) {
          return;
        }
        exited = true;
        logger.info('Interactive shell exited', { username: context.username, exitCode, signal });
        stream.exit(exitCode ?? 0);
        stream.end();
      });

      stream.on('data', (data) => {
        if (!exited) {
          terminal.write(data.toString());
        }
      });

      stream.on('close', () => {
        if (!exited) {
          terminal.kill();
        }
      });

      return {
        resize(nextPtyInfo = {}) {
          const nextCols = normalizePositiveInteger(nextPtyInfo.cols, cols);
          const nextRows = normalizePositiveInteger(nextPtyInfo.rows, rows);
          terminal.resize(nextCols, nextRows);
        },
        close() {
          if (!exited) {
            terminal.kill();
          }
        }
      };
    }
  };
}
