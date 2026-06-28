import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { createAuthenticator } from '../src/auth.js';

function writeUsers(users) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-users-'));
  const usersFile = path.join(directory, 'users.json');
  fs.writeFileSync(usersFile, `${JSON.stringify(users, null, 2)}\n`);
  return { directory, usersFile };
}

test('auth hashes plaintext password and writes it back to users file', () => {
  const { directory, usersFile } = writeUsers([{ username: 'root', password: 'ChangeMe123!', authorizedKeys: [] }]);

  try {
    const authenticator = createAuthenticator(usersFile);
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));

    assert.equal(authenticator.verifyPassword('root', 'ChangeMe123!'), true);
    assert.equal(users[0].username, 'root');
    assert.notEqual(users[0].password, 'ChangeMe123!');
    assert.match(users[0].password, /^\$2[aby]\$/);
    assert.equal(bcrypt.compareSync('ChangeMe123!', users[0].password), true);
    assert.equal(Object.hasOwn(users[0], 'passwordHash'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('auth migrates legacy passwordHash field to password', () => {
  const hash = bcrypt.hashSync('ChangeMe123!', 4);
  const { directory, usersFile } = writeUsers([{ username: 'deploy', passwordHash: hash, authorizedKeys: [] }]);

  try {
    const authenticator = createAuthenticator(usersFile);
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));

    assert.equal(authenticator.verifyPassword('deploy', 'ChangeMe123!'), true);
    assert.equal(users[0].password, hash);
    assert.equal(Object.hasOwn(users[0], 'passwordHash'), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
