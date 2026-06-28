import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const rootDir = process.cwd();

function resolveFromRoot(value) {
  return path.resolve(rootDir, value);
}

function readInteger(name, fallback, { min, max } = {}) {
  const rawValue = process.env[name];
  const parsed = rawValue === undefined ? fallback : Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  if (min !== undefined && parsed < min) {
    throw new Error(`${name} must be >= ${min}`);
  }
  if (max !== undefined && parsed > max) {
    throw new Error(`${name} must be <= ${max}`);
  }

  return parsed;
}

function readBoolean(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(rawValue.toLowerCase())) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(rawValue.toLowerCase())) {
    return false;
  }
  throw new Error(`${name} must be a boolean`);
}

export function loadConfig() {
  const config = {
    host: process.env.SSH_HOST || '0.0.0.0',
    port: readInteger('SSH_PORT', 2222, { min: 1, max: 65535 }),
    hostKeyPath: resolveFromRoot(process.env.SSH_HOST_KEY_PATH || './keys/ssh_host_ed25519_key'),
    usersFile: resolveFromRoot(process.env.SSH_USERS_FILE || './config/users.json'),
    commandsFile: resolveFromRoot(process.env.SSH_COMMANDS_FILE || './config/commands.json'),
    sftpRoot: resolveFromRoot(process.env.SSH_SFTP_ROOT || './s12ryt'),
    enableShell: readBoolean('SSH_ENABLE_SHELL', true),
    shellPath: process.env.SSH_SHELL_PATH || undefined,
    shellCwd: resolveFromRoot(process.env.SSH_SHELL_CWD || './s12ryt'),
    maxClients: readInteger('SSH_MAX_CLIENTS', 3, { min: 1, max: 100 }),
    readyTimeoutMs: readInteger('SSH_READY_TIMEOUT_MS', 20000, { min: 1000 }),
    logLevel: process.env.SSH_LOG_LEVEL || 'info'
  };

  if (!fs.existsSync(config.hostKeyPath)) {
    throw new Error(`SSH host key not found: ${config.hostKeyPath}`);
  }

  fs.mkdirSync(config.sftpRoot, { recursive: true });
  fs.mkdirSync(config.shellCwd, { recursive: true });
  return config;
}
