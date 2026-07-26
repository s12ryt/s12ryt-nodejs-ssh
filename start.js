import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);

const defaultUsernameFallback = 'deploy';
const defaultPasswordFallback = 'ChangeMe123!';
const envPath = path.join(root, '.env');
const envExamplePath = path.join(root, '.env.example');
const commandsExamplePath = path.join(root, 'config', 'commands.example.json');
let commandsPath;
let usersPath;
let hostKeyPath;
let sftpRoot;
let shellCwd;

function log(message) {
  console.log(`[start] ${message}`);
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function resolveRuntimePath(envName, fallback) {
  const value = process.env[envName] || fallback;
  return path.resolve(root, value);
}

function readDefaultUsername() {
  const username = (process.env.SSH_DEFAULT_USERNAME || defaultUsernameFallback).trim();
  if (!username) {
    throw new Error('SSH_DEFAULT_USERNAME must not be empty');
  }
  return username;
}

function readDefaultPassword() {
  const password = process.env.SSH_DEFAULT_PASSWORD || defaultPasswordFallback;
  if (password.length < 8) {
    throw new Error('SSH_DEFAULT_PASSWORD must be at least 8 characters');
  }
  return password;
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
  sftpRoot = resolveRuntimePath('SSH_SFTP_ROOT', './s12ryt');
  shellCwd = resolveRuntimePath('SSH_SHELL_CWD', './s12ryt');
}

function ensureDirectories() {
  for (const directory of [path.dirname(hostKeyPath), path.dirname(usersPath), path.dirname(commandsPath), sftpRoot, shellCwd]) {
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

  if (isProduction()) {
    throw new Error(
      `Missing ${path.relative(root, usersPath)}. Create production users first from config/users.example.json.`
    );
  }

  const username = readDefaultUsername();
  const password = readDefaultPassword();
  const users = [{ username, password, authorizedKeys: [] }];
  fs.mkdirSync(path.dirname(usersPath), { recursive: true });
  fs.writeFileSync(usersPath, `${JSON.stringify(users, null, 2)}\n`);
  log(`Created ${path.relative(root, usersPath)} with development user ${username}`);
}

function writeNodeGeneratedHostKey(target) {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem'
    },
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    }
  });

  fs.writeFileSync(target, privateKey, { mode: 0o600 });
  log(`Generated RSA host key without ssh-keygen at ${path.relative(root, target)}`);
}

function describeCommandFailure(result) {
  if (result.error) {
    return result.error.message;
  }

  const stderr = result.stderr?.toString().trim();
  if (stderr) {
    return stderr;
  }

  return `ssh-keygen exited with status ${result.status ?? 1}`;
}

function ensureHostKey() {
  if (fs.existsSync(hostKeyPath)) {
    return;
  }

  fs.mkdirSync(path.dirname(hostKeyPath), { recursive: true });
  log(`Generating SSH host key at ${path.relative(root, hostKeyPath)}`);

  const result = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', hostKeyPath, '-N', '', '-C', 'nodejs-ssh-server'], {
    encoding: 'utf8',
    shell: false
  });

  if (result.error || result.status !== 0) {
    log(`ssh-keygen failed, falling back to Node.js crypto host key generation: ${describeCommandFailure(result)}`);
    writeNodeGeneratedHostKey(hostKeyPath);
  } else if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  try {
    fs.chmodSync(hostKeyPath, 0o600);
  } catch (error) {
    log(`Warning: failed to chmod host key: ${error.message}`);
  }
}

async function main() {
  loadEnv();
  ensureDirectories();
  ensureCommandsFile();
  ensureUsersFile();
  ensureHostKey();

  log('Runtime files are ready. Starting SSH server.');
  await import('./src/index.js');
}

main().catch((error) => {
  console.error(`[start] ${error.message}`);
  process.exit(1);
});
