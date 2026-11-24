// src/host-key.js
// 1. FALLBACK_HOST_KEY_TYPE / HOST_KEY_COMMENT：fallback 金鑰型別常數（L10-11）
// 2. generateFallbackHostKey：ssh-keygen 不可用時產生 ssh2 可解析的 EC P-256 host key（L13-27）
// 3. ensureHostKey：ssh-keygen 優先、失敗則 fallback，並收斂 0600 權限（L29-60）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';

// ssh2 的私鑰解析器只接受 OPENSSH / PKCS#1 RSA / SEC1 EC / PuTTY 格式，不吃 PKCS#8，
// 因此 ed25519 無法由 node:crypto 直接產出；改用 SEC1 的 P-256，對應 ecdsa-sha2-nistp256，
// 避免 RSA 金鑰讓 ssh2 把 SHA-1 的 ssh-rsa 重新加回 serverHostKey 清單。
export const FALLBACK_HOST_KEY_TYPE = 'ecdsa-sha2-nistp256';
const HOST_KEY_COMMENT = 'nodejs-ssh-server';

export function generateFallbackHostKey(target) {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'sec1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, privateKey, { mode: 0o600 });
  return FALLBACK_HOST_KEY_TYPE;
}

function describeFailure(result) {
  if (result.error) {
    return result.error.message;
  }
  const stderr = result.stderr?.toString().trim();
  return stderr || `ssh-keygen exited with status ${result.status ?? 1}`;
}

export function ensureHostKey(target, log = () => {}) {
  if (fs.existsSync(target)) {
    return 'existing';
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const result = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', target, '-N', '', '-C', HOST_KEY_COMMENT], {
    encoding: 'utf8',
    shell: false
  });

  if (result.error || result.status !== 0) {
    log(`ssh-keygen failed, falling back to ${FALLBACK_HOST_KEY_TYPE}: ${describeFailure(result)}`);
    generateFallbackHostKey(target);
  } else if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  try {
    fs.chmodSync(target, 0o600);
  } catch (error) {
    log(`Warning: failed to chmod host key: ${error.message}`);
  }

  return result.error || result.status !== 0 ? FALLBACK_HOST_KEY_TYPE : 'ssh-ed25519';
}
