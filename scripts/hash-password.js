import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';

const passwordFromArg = process.argv[2];

async function main() {
  let password = passwordFromArg;
  if (!password) {
    const rl = readline.createInterface({ input, output });
    password = await rl.question('Password to hash: ');
    rl.close();
  }

  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const hash = bcrypt.hashSync(password, 12);
  console.log(hash);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
