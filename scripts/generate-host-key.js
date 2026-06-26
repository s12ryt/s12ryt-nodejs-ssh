import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const target = process.argv[2] || './keys/ssh_host_ed25519_key';

if (fs.existsSync(target)) {
  console.error(`Host key already exists: ${target}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });

const result = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', target, '-N', '', '-C', 'nodejs-ssh-server'], {
  stdio: 'inherit',
  shell: false
});

if (result.error) {
  console.error(`Failed to run ssh-keygen: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
