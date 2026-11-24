// start.js
// 1. loadEnv：補齊 .env 並解析各執行期路徑（L43-56）
// 2. ensureDirectories / ensureCommandsFile / ensureUsersFile：補齊執行期檔案（L58-88）
// 3. main：產生 host key 後載入 src/index.js（L90-103）
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

import { ensureHostKey } from './src/host-key.js';
import { resolveDefaultUsername, resolveDefaultPassword } from './src/dev-credentials.js';

const root = import.meta.dirname;
process.chdir(root);

const envPath = path.join(root, '.env');
const envExamplePath = path.join(root, '.env.example');
const commandsExamplePath = path.join(root, 'config', 'commands.example.json');
let commandsPath;
let usersPath;
let hostKeyPath;
let sftpRoot;

function log(message) {
  console.log(`[start] ${message}`);
}

function resolveRuntimePath(envName, fallback) {
  const value = process.env[envName] || fallback;
  return value ? path.resolve(root, value) : undefined;
}

function copyIfMissing(source, target) {
  if (fs.existsSync(target)) {
    return false;
  }
  if (!fs.existsSync(source)) {
    throw new Error(`Missing template file: ${path.relative(root, source)}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function loadEnv() {
  if (copyIfMissing(envExamplePath, envPath)) {
    log('Created .env from .env.example');
  }

  dotenv.config({ path: envPath });
  commandsPath = resolveRuntimePath('SSH_COMMANDS_FILE', './config/commands.json');
  usersPath = resolveRuntimePath('SSH_USERS_FILE', './config/users.json');
  hostKeyPath = resolveRuntimePath('SSH_HOST_KEY_PATH', './keys/ssh_host_ed25519_key');
  // 未設定時 src/config.js 以機器根目錄當虛擬根，這裡不得再建立過時的沙箱目錄。
  sftpRoot = resolveRuntimePath('SSH_SFTP_ROOT', '');
}

function ensureDirectories() {
  const targets = [path.dirname(hostKeyPath), path.dirname(usersPath), path.dirname(commandsPath), sftpRoot];
  for (const directory of targets.filter(Boolean)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function ensureCommandsFile() {
  if (copyIfMissing(commandsExamplePath, commandsPath)) {
    log(`Created ${path.relative(root, commandsPath)} from config/commands.example.json`);
  }
}

function ensureUsersFile() {
  if (fs.existsSync(usersPath)) {
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Missing ${path.relative(root, usersPath)}. Create production users first from config/users.example.json.`
    );
  }

  const username = resolveDefaultUsername();
  const users = [{ username, password: resolveDefaultPassword(), authorizedKeys: [] }];
  fs.mkdirSync(path.dirname(usersPath), { recursive: true });
  fs.writeFileSync(usersPath, `${JSON.stringify(users, null, 2)}\n`);
  log(`Created ${path.relative(root, usersPath)} with development user ${username}`);
}

async function main() {
  loadEnv();
  ensureDirectories();
  ensureCommandsFile();
  ensureUsersFile();

  if (ensureHostKey(hostKeyPath, log) !== 'existing') {
    log(`Generated SSH host key at ${path.relative(root, hostKeyPath)}`);
  }

  log('Runtime files are ready. Starting SSH server.');
  await import('./src/index.js');
}

main().catch((error) => {
  console.error(`[start] ${error.message}`);
  process.exit(1);
});
