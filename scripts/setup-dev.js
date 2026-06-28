import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const root = process.cwd();
dotenv.config({ path: path.join(root, '.env') });

const defaultUsername = (process.env.SSH_DEFAULT_USERNAME || 'deploy').trim();
const defaultPassword = process.env.SSH_DEFAULT_PASSWORD || 'ChangeMe123!';

if (!defaultUsername) {
  throw new Error('SSH_DEFAULT_USERNAME must not be empty');
}

if (defaultPassword.length < 8) {
  throw new Error('SSH_DEFAULT_PASSWORD must be at least 8 characters');
}

function copyIfMissing(source, target) {
  if (!fs.existsSync(target)) {
    fs.copyFileSync(source, target);
    console.log(`Created ${path.relative(root, target)}`);
  }
}

fs.mkdirSync(path.join(root, 'config'), { recursive: true });
fs.mkdirSync(path.join(root, 'keys'), { recursive: true });
fs.mkdirSync(path.join(root, 'storage', 'sftp'), { recursive: true });

copyIfMissing(path.join(root, '.env.example'), path.join(root, '.env'));
copyIfMissing(path.join(root, 'config', 'commands.example.json'), path.join(root, 'config', 'commands.json'));

const usersPath = path.join(root, 'config', 'users.json');
if (!fs.existsSync(usersPath)) {
  const users = [{ username: defaultUsername, password: defaultPassword, authorizedKeys: [] }];
  fs.writeFileSync(usersPath, `${JSON.stringify(users, null, 2)}\n`);
  console.log(`Created config/users.json with user ${defaultUsername}`);
}

console.log('Development files are ready. Run npm run generate:host-key if keys are missing.');
