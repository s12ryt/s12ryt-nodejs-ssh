// scripts/generate-host-key.js
// 1. 解析目標路徑並拒絕覆蓋既有金鑰（L8-14）
// 2. 委派 src/host-key.js 的 ensureHostKey（ssh-keygen 優先、失敗 fallback EC P-256）（L16-17）
import fs from 'node:fs';

import { ensureHostKey } from '../src/host-key.js';

const target = process.argv[2] || './keys/ssh_host_ed25519_key';

if (fs.existsSync(target)) {
  console.error(`Host key already exists: ${target}`);
  process.exit(1);
}

const type = ensureHostKey(target, (message) => console.error(message));
console.log(`Host key ready (${type}): ${target}`);
process.exit(0);
