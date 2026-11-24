// 密碼政策測試（對應 agent/question.md 驗收標準 B）
// B1 bcrypt cost 統一為 12（dummy hash 與真實使用者一致，消除帳號列舉時序差）
// B2 verifyPassword 以 UTF-8 byte 長度拒絕 >72 bytes，阻斷 bcrypt 靜默截斷繞過
// B3 normalizeUsers 在 hash 前就拒絕超長密碼
// B4 長度判定以 byte 計算，非 String.length

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BCRYPT_COST,
  MAX_PASSWORD_BYTES,
  passwordByteLength,
  normalizeUsers,
  createAuthenticator
} from '../src/auth.js';

function writeUsers(users) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's12ryt-auth-'));
  const file = path.join(dir, 'users.json');
  fs.writeFileSync(file, JSON.stringify(users), 'utf8');
  return file;
}

test('bcrypt cost 常數為 12', () => {
  assert.strictEqual(BCRYPT_COST, 12);
  assert.strictEqual(MAX_PASSWORD_BYTES, 72);
});

test('passwordByteLength 以 UTF-8 byte 計算', () => {
  assert.strictEqual(passwordByteLength('abc'), 3);
  assert.strictEqual(passwordByteLength('密碼'), 6);
});

test('normalizeUsers 產生的 hash 使用 cost 12', () => {
  const file = writeUsers([{ username: 'alice', password: 'correct-horse' }]);
  const [user] = normalizeUsers(file);
  assert.match(user.password, /^\$2[aby]\$12\$/);
});

test('normalizeUsers 拒絕超過 72 bytes 的明文密碼', () => {
  const file = writeUsers([{ username: 'alice', password: 'a'.repeat(73) }]);
  assert.throws(() => normalizeUsers(file), /72 bytes/);
});

test('normalizeUsers 以 byte 而非字元數判定長度', () => {
  const file = writeUsers([{ username: 'alice', password: '密'.repeat(25) }]);
  assert.throws(() => normalizeUsers(file), /72 bytes/);
});

test('verifyPassword 阻斷 bcrypt 72-byte 靜默截斷繞過', () => {
  const password = 'a'.repeat(MAX_PASSWORD_BYTES);
  const file = writeUsers([{ username: 'alice', password }]);
  const auth = createAuthenticator(file);
  assert.strictEqual(auth.verifyPassword('alice', password), true);
  assert.strictEqual(auth.verifyPassword('alice', `${password}EXTRA`), false);
});

test('verifyPassword 對非字串輸入回 false 且不拋錯', () => {
  const file = writeUsers([{ username: 'alice', password: 'correct-horse' }]);
  const auth = createAuthenticator(file);
  assert.strictEqual(auth.verifyPassword('alice', undefined), false);
  assert.strictEqual(auth.verifyPassword('alice', 12345678), false);
});

test('未知使用者與已知使用者的密碼驗證耗時同階（反帳號列舉）', () => {
  const file = writeUsers([{ username: 'alice', password: 'correct-horse' }]);
  const auth = createAuthenticator(file);
  const measure = (username) => {
    const samples = [];
    for (let i = 0; i < 3; i += 1) {
      const started = process.hrtime.bigint();
      auth.verifyPassword(username, 'wrong-password');
      samples.push(Number(process.hrtime.bigint() - started));
    }
    return samples.sort((a, b) => a - b)[1];
  };
  const known = measure('alice');
  const unknown = measure('nobody');
  const ratio = unknown / known;
  assert.ok(ratio > 0.5 && ratio < 2, `耗時比例 ${ratio.toFixed(2)} 偏離 1，dummy hash cost 與真實 hash 不一致`);
});
