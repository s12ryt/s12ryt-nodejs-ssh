import { machineRoot } from './sftp-fs.js';
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
    sftpRoot: process.env.SSH_SFTP_ROOT ? resolveFromRoot(process.env.SSH_SFTP_ROOT) : machineRoot(rootDir),
    sftpFollowShellCwd: readBoolean('SSH_SFTP_FOLLOW_SHELL_CWD', true),
    enableShell: readBoolean('SSH_ENABLE_SHELL', true),
    shellPath: process.env.SSH_SHELL_PATH || undefined,
    maxClients: readInteger('SSH_MAX_CLIENTS', 64, { min: 1, max: 4096 }),
    maxClientsPerIp: readInteger('SSH_MAX_CLIENTS_PER_IP', 8, { min: 1, max: 4096 }),
    maxAuthFailures: readInteger('SSH_MAX_AUTH_FAILURES', 5, { min: 1, max: 100 }),
    maxSessionsPerClient: readInteger('SSH_MAX_SESSIONS_PER_CLIENT', 8, { min: 1, max: 100 }),
    readyTimeoutMs: readInteger('SSH_READY_TIMEOUT_MS', 20000, { min: 1000 }),
    logLevel: process.env.SSH_LOG_LEVEL || 'info'
  };

  // 虛擬根可能是機器根目錄（Windows 的 `F:\`），對既有目錄呼叫 mkdir 會得到 EPERM。
  function ensureDirectory(target) {
    if (fs.existsSync(target)) {
      return;
    }
    fs.mkdirSync(target, { recursive: true });
  }

  if (!fs.existsSync(config.hostKeyPath)) {
    throw new Error(`SSH host key not found: ${config.hostKeyPath}`);
  }

  ensureDirectory(config.sftpRoot);
  return config;
}
