// src/dev-credentials.js
// 1. DEFAULT_USERNAME / DEFAULT_PASSWORD：開發用預設帳密常數（L9-10）
// 2. resolveDefaultUsername：讀取並驗證非空帳號（L12-19）
// 3. resolveDefaultPassword：套用 8 字元下限與 bcrypt 72 byte 上限（L21-32）
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, passwordByteLength } from './auth.js';

const DEFAULT_USERNAME = 'deploy';
const DEFAULT_PASSWORD = 'ChangeMe123!';

export function resolveDefaultUsername(env = process.env) {
  const username = (env.SSH_DEFAULT_USERNAME || DEFAULT_USERNAME).trim();
  if (!username) {
    throw new Error('SSH_DEFAULT_USERNAME must not be empty');
  }
  return username;
}

// 與 normalizeUsers 同一套政策：先攔下過短密碼，再攔下 bcrypt 會靜默截斷的過長密碼，
// 否則 users.json 會先被寫出、啟動時才在 normalizeUsers 拋錯。
export function resolveDefaultPassword(env = process.env) {
  const password = env.SSH_DEFAULT_PASSWORD || DEFAULT_PASSWORD;
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SSH_DEFAULT_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (passwordByteLength(password) > MAX_PASSWORD_BYTES) {
    throw new Error(`SSH_DEFAULT_PASSWORD must not exceed ${MAX_PASSWORD_BYTES} bytes`);
  }
  return password;
}
