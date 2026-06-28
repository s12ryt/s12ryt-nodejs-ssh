import fs from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import ssh2 from 'ssh2';

const { utils } = ssh2;

function readUsers(usersFile) {
  const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  if (!Array.isArray(users)) {
    throw new Error('Users file must contain an array');
  }
  return users;
}

function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
}

function normalizeUsers(usersFile) {
  let changed = false;
  const users = readUsers(usersFile).map((user) => {
    const normalized = { ...user };

    if (normalized.password === undefined && normalized.passwordHash !== undefined) {
      normalized.password = normalized.passwordHash;
      delete normalized.passwordHash;
      changed = true;
    }

    if (normalized.passwordHash !== undefined) {
      delete normalized.passwordHash;
      changed = true;
    }

    if (normalized.password === undefined) {
      return normalized;
    }

    if (typeof normalized.password !== 'string') {
      throw new Error(`Password for user ${normalized.username || '<unknown>'} must be a string`);
    }

    if (!isBcryptHash(normalized.password)) {
      if (normalized.password.length < 8) {
        throw new Error(`Password for user ${normalized.username || '<unknown>'} must be at least 8 characters`);
      }
      normalized.password = bcrypt.hashSync(normalized.password, 12);
      changed = true;
    }

    return normalized;
  });

  if (changed) {
    fs.writeFileSync(usersFile, `${JSON.stringify(users, null, 2)}\n`);
  }

  return users;
}

function safeStringEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseAuthorizedKeys(keys = []) {
  return keys.flatMap((key) => {
    const parsed = utils.parseKey(key);
    if (parsed instanceof Error) {
      throw parsed;
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return parsed;
  });
}

function safeBufferEquals(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicKeyData(parsedKey) {
  const publicKey = parsedKey.getPublicSSH();
  if (Buffer.isBuffer(publicKey)) {
    return publicKey;
  }
  const [, base64Key] = String(publicKey).split(' ');
  return Buffer.from(base64Key || publicKey, 'base64');
}

export function createAuthenticator(usersFile) {
  const users = normalizeUsers(usersFile).map((user) => ({
    username: user.username,
    storedPasswordHash: user.password,
    authorizedKeys: parseAuthorizedKeys(user.authorizedKeys || [])
  }));

  // Dummy hash so that authentication for unknown usernames still spends time on
  // bcrypt, preventing username enumeration via response timing differences.
  const dummyPasswordHash = bcrypt.hashSync('invalid-placeholder-password', 10);

  function findUser(username) {
    return users.find((user) => safeStringEquals(user.username, username));
  }

  return {
    verifyPassword(username, password) {
      const user = findUser(username);
      const hash = user?.storedPasswordHash || dummyPasswordHash;
      const matches = bcrypt.compareSync(password, hash);
      return Boolean(user?.storedPasswordHash) && matches;
    },

    verifyPublicKey(username, key, blob, signature, hashAlgo) {
      const user = findUser(username);
      if (!user) {
        return false;
      }
      return user.authorizedKeys.some((authorizedKey) => {
        const publicKeyMatches = authorizedKey.type === key.algo && safeBufferEquals(publicKeyData(authorizedKey), key.data);
        if (!publicKeyMatches) {
          return false;
        }
        if (!signature) {
          return true;
        }
        return authorizedKey.verify(blob, signature, hashAlgo);
      });
    }
  };
}
