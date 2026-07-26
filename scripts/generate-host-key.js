import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';

const target = process.argv[2] || './keys/ssh_host_ed25519_key';

if (fs.existsSync(target)) {
  console.error(`Host key already exists: ${target}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });

function writeNodeGeneratedHostKey() {
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
  console.log(`Generated RSA host key without ssh-keygen: ${target}`);
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

const result = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', target, '-N', '', '-C', 'nodejs-ssh-server'], {
  encoding: 'utf8',
  shell: false
});

if (result.error || result.status !== 0) {
  console.error(`ssh-keygen failed, falling back to Node.js crypto host key generation: ${describeCommandFailure(result)}`);
  writeNodeGeneratedHostKey();
  process.exit(0);
}

if (result.stdout) {
  process.stdout.write(result.stdout);
}

process.exit(0);
