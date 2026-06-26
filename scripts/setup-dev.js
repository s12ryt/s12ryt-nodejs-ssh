import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const root = process.cwd();

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
  const password = 'ChangeMe123!';
  const users = [{ username: 'deploy', passwordHash: bcrypt.hashSync(password, 12), authorizedKeys: [] }];
  fs.writeFileSync(usersPath, `${JSON.stringify(users, null, 2)}\n`);
  console.log('Created config/users.json with user deploy and password ChangeMe123!');
}

console.log('Development files are ready. Run npm run generate:host-key if keys are missing.');
