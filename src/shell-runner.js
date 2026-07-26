import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseProotConfig } from './proot-paths.js';

const require = createRequire(import.meta.url);

const PTY_PACKAGE_NAME = '@homebridge/node-pty-prebuilt-multiarch';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_PROOT_CONFIG_LENGTH = 64 * 1024;
const POSIX_INTERACTIVE_SHELL_CANDIDATES = ['/bin/bash', '/usr/bin/bash', '/bin/zsh', '/usr/bin/zsh'];

function normalizePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function selectDefaultPosixShell({ envShell = process.env.SHELL, isExecutable = isExecutableFile } = {}) {
  const candidates = [...POSIX_INTERACTIVE_SHELL_CANDIDATES, envShell, '/bin/sh'].filter(Boolean);
  return candidates.find((candidate) => isExecutable(candidate)) || envShell || '/bin/sh';
}

function defaultShellPath() {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'powershell.exe';
  }
  return selectDefaultPosixShell();
}

function readRuntimeUserInfo(userInfo = () => os.userInfo()) {
  try {
    return userInfo();
  } catch {
    return {};
  }
}

export function createShellEnv(
  context,
  shellPath,
  {
    env = process.env,
    uid = typeof process.getuid === 'function' ? process.getuid() : undefined,
    userInfo = () => os.userInfo()
  } = {}
) {
  const runtimeUser = readRuntimeUserInfo(userInfo);
  const isRoot = uid === 0;
  const username = isRoot ? 'root' : runtimeUser.username || env.USER || env.LOGNAME || context.username;
  const home = isRoot ? '/root' : runtimeUser.homedir || env.HOME || os.homedir();

  return {
    ...env,
    USER: username,
    LOGNAME: username,
    HOME: home,
    SHELL: shellPath
  };
}

function foregroundProcessId(stat) {
  const commandEnd = stat.lastIndexOf(')');
  if (commandEnd === -1) {
    return undefined;
  }
  const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
  const tpgid = Number.parseInt(fields[5], 10);
  return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : undefined;
}

function processEnvironment(rawEnvironment) {
  return Object.fromEntries(
    String(rawEnvironment)
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf('=');
        return separator === -1 ? [entry, ''] : [entry.slice(0, separator), entry.slice(separator + 1)];
      })
  );
}

export function readLinuxProcessContext(
  pid,
  fallback,
  {
    readFile = (filename) => fs.readFileSync(filename, 'utf8'),
    readLink = (filename) => fs.readlinkSync(filename),
    statFile = (filename) => fs.statSync(filename)
  } = {}
) {
  const processIds = [];
  try {
    const foregroundPid = foregroundProcessId(readFile(`/proc/${pid}/stat`));
    if (foregroundPid !== undefined) {
      processIds.push(foregroundPid);
    }
  } catch {
    // The shell may exit between the SFTP request and this lookup.
  }
  processIds.push(pid);

  let cwd = fallback;
  let foundCwd = false;
  let proot;
  for (const processId of new Set(processIds)) {
    if (!foundCwd) {
      try {
        const candidateCwd = readLink(`/proc/${processId}/cwd`);
        if (pathIsAbsolute(candidateCwd)) {
          cwd = candidateCwd;
          foundCwd = true;
        }
      } catch {
        // Try the parent shell before falling back to its configured cwd.
      }
    }
    if (!proot) {
      try {
        const environment = processEnvironment(readFile(`/proc/${processId}/environ`));
        if (environment.PROOT_CONFIG) {
          const configStats = statFile(environment.PROOT_CONFIG);
          if (configStats.isFile() && configStats.size <= MAX_PROOT_CONFIG_LENGTH) {
            const configText = readFile(environment.PROOT_CONFIG);
            proot = parseProotConfig(configText);
          }
        }
      } catch {
        // Ordinary shells have no readable PRoot configuration.
      }
    }
  }
  return { cwd, proot };
}

export function readLinuxProcessCwd(pid, fallback, io = {}) {
  return readLinuxProcessContext(pid, fallback, io).cwd;
}

function pathIsAbsolute(candidate) {
  return typeof candidate === 'string' && candidate.length > 0 && path.isAbsolute(candidate);
}

function loadPty() {
  try {
    return require(PTY_PACKAGE_NAME);
  } catch (error) {
    error.message = `Failed to load ${PTY_PACKAGE_NAME}. Run npm install and make sure the PTY prebuilt binary can be downloaded for this platform. Original error: ${error.message}`;
    throw error;
  }
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
        const pty = loadPty();
        terminal = pty.spawn(shellPath, [], {
          name: term,
          cols,
          rows,
          cwd: shellCwd,
          env: createShellEnv(context, shellPath),
          handleFlowControl: true
        });
      } catch (error) {
        logger.error('Interactive shell failed to start', { username: context.username, shellPath, error: error.message });
        stderr.write(`Failed to start shell: ${error.message}\n`);
        stream.exit(1);
        stream.end();
        return {
          getCwd() {
            return shellCwd;
          },
          getPathContext() {
            return { cwd: shellCwd, proot: undefined };
          },
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
        getCwd() {
          if (process.platform !== 'linux' || !terminal.pid) {
            return shellCwd;
          }
          return readLinuxProcessCwd(terminal.pid, shellCwd);
        },
        getPathContext() {
          if (process.platform !== 'linux' || !terminal.pid) {
            return { cwd: shellCwd, proot: undefined };
          }
          return readLinuxProcessContext(terminal.pid, shellCwd);
        },
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
