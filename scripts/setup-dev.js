// scripts/setup-dev.js
// 1. 載入 .env 並建立開發用目錄（L12-20）
// 2. copyIfMissing：補齊 .env 與 commands.json（L22-32）
// 3. 以 src/dev-credentials.js 的政策產生開發用 users.json（L34-41）
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

import { resolveDefaultUsername, resolveDefaultPassword } from '../src/dev-credentials.js';

const root = process.cwd();
dotenv.config({ path: path.join(root, '.env') });

const defaultUsername = resolveDefaultUsername();
const defaultPassword = resolveDefaultPassword();

for (const directory of ['config', 'keys', 's12ryt']) {
  fs.mkdirSync(path.join(root, directory), { recursive: true });
}

function copyIfMissing(source, target) {
  if (!fs.existsSync(target)) {
    fs.copyFileSync(source, target);
    console.log(`Created ${path.relative(root, target)}`);
  }
}

copyIfMissing(path.join(root, '.env.example'), path.join(root, '.env'));
copyIfMissing(path.join(root, 'config', 'commands.example.json'), path.join(root, 'config', 'commands.json'));

const usersPath = path.join(root, 'config', 'users.json');
if (!fs.existsSync(usersPath)) {
  const users = [{ username: defaultUsername, password: defaultPassword, authorizedKeys: [] }];
  fs.writeFileSync(usersPath, `${JSON.stringify(users, null, 2)}\n`);
  console.log(`Created config/users.json with user ${defaultUsername}`);
}

console.log('Development files are ready. Run npm run generate:host-key if keys are missing.');
