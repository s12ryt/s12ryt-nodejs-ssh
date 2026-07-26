import path from 'node:path';
import net from 'node:net';

const DEBIAN_CLOUD_BASE = 'https://cloud.debian.org/images/cloud/bookworm/latest';

function valueOrDefault(env, name, fallback) {
  const value = env[name]?.trim();
  return value ? value : fallback;
}

function readBoolean(env, name, fallback) {
  const value = env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(value)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }
  throw new Error(`${name} must be a boolean`);
}

function readNumber(env, name, fallback, { min, max, integer = false, decimals } = {}) {
  const rawValue = env[name]?.trim();
  const value = rawValue ? Number(rawValue) : fallback;
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'}`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`${name} must be >= ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`${name} must be <= ${max}`);
  }
  if (decimals !== undefined && Math.round(value * 10 ** decimals) !== value * 10 ** decimals) {
    throw new Error(`${name} supports at most ${decimals} decimal place${decimals === 1 ? '' : 's'}`);
  }
  return value;
}

export function loadVmConfig(rootDir, env = process.env) {
  const architecture = valueOrDefault(env, 'VM_ARCH', 'amd64');
  if (architecture !== 'amd64') {
    throw new Error('VM_ARCH currently supports amd64 only');
  }

  const imageName = `debian-12-genericcloud-${architecture}.qcow2`;
  const qemuBinaryValue = env.VM_QEMU_BINARY?.trim();
  const qemuImgBinaryValue = env.VM_QEMU_IMG_BINARY?.trim();
  const config = {
    enabled: readBoolean(env, 'VM_ENABLED', false),
    qemuBinary: qemuBinaryValue || (architecture === 'arm64' ? 'qemu-system-aarch64' : 'qemu-system-x86_64'),
    qemuImgBinary: qemuImgBinaryValue || 'qemu-img',
    customQemuBinaries: Boolean(qemuBinaryValue || qemuImgBinaryValue),
    qemuAutoInstall: readBoolean(env, 'VM_QEMU_AUTO_INSTALL', true),
    qemuRuntimePath: path.resolve(rootDir, valueOrDefault(env, 'VM_QEMU_RUNTIME_PATH', './vm/runtime')),
    qemuInstallTimeoutMs: readNumber(env, 'VM_QEMU_INSTALL_TIMEOUT_MS', 900000, { min: 10000, max: 3600000, integer: true }),
    architecture,
    imagePath: path.resolve(rootDir, valueOrDefault(env, 'VM_IMAGE_PATH', `./vm/${imageName}`)),
    imageUrl: valueOrDefault(env, 'VM_IMAGE_URL', `${DEBIAN_CLOUD_BASE}/${imageName}`),
    checksumUrl: valueOrDefault(env, 'VM_IMAGE_CHECKSUM_URL', `${DEBIAN_CLOUD_BASE}/SHA512SUMS`),
    ramMb: readNumber(env, 'VM_RAM_MB', 1024, { min: 256, max: 32768, integer: true }),
    cpuLimit: readNumber(env, 'VM_CPU_LIMIT', 1, { min: 0.1, max: 64, decimals: 1 }),
    diskGb: readNumber(env, 'VM_DISK_GB', 10, { min: 4, max: 1024, integer: true }),
    minHostFreeGb: readNumber(env, 'VM_MIN_HOST_FREE_GB', 2, { min: 0, max: 1024, decimals: 1 }),
    sshHost: valueOrDefault(env, 'VM_SSH_HOST', '0.0.0.0'),
    sshHostPort: readNumber(env, 'VM_SSH_HOST_PORT', 2223, { min: 1, max: 65535, integer: true }),
    sshUsername: valueOrDefault(env, 'VM_SSH_USERNAME', 'root'),
    sshPassword: env.VM_SSH_PASSWORD === undefined
      ? env.SSH_DEFAULT_PASSWORD?.trim() || ''
      : env.VM_SSH_PASSWORD.trim(),
    sshAuthorizedKey: env.VM_SSH_AUTHORIZED_KEY?.trim() || '',
    hostname: valueOrDefault(env, 'VM_HOSTNAME', 's12ryt-vm'),
    shutdownTimeoutMs: readNumber(env, 'VM_SHUTDOWN_TIMEOUT_MS', 30000, { min: 1000, max: 300000, integer: true }),
    metadataTimeoutMs: readNumber(env, 'VM_METADATA_TIMEOUT_MS', 300000, { min: 10000, max: 1800000, integer: true }),
    downloadTimeoutMs: readNumber(env, 'VM_DOWNLOAD_TIMEOUT_MS', 900000, { min: 10000, max: 3600000, integer: true })
  };
  if (!net.isIPv4(config.sshHost)) {
    throw new Error('VM_SSH_HOST must be an IPv4 address');
  }
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(config.sshUsername)) {
    throw new Error('VM_SSH_USERNAME must be a valid Linux username');
  }
  if (config.sshPassword && config.sshPassword.length < 8) {
    throw new Error('VM_SSH_PASSWORD must be at least 8 characters or blank');
  }
  if (config.sshAuthorizedKey && !/^ssh-(?:ed25519|rsa|ecdsa-[^\s]+)\s+\S+/.test(config.sshAuthorizedKey)) {
    throw new Error('VM_SSH_AUTHORIZED_KEY must be a valid OpenSSH public key');
  }
  if (config.enabled && !config.sshPassword && !config.sshAuthorizedKey) {
    throw new Error('VM_SSH_PASSWORD or VM_SSH_AUTHORIZED_KEY is required when VM_ENABLED=true');
  }
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,61}[a-zA-Z0-9])?$/.test(config.hostname)) {
    throw new Error('VM_HOSTNAME must be a valid hostname');
  }
  for (const [name, url] of [['VM_IMAGE_URL', config.imageUrl], ['VM_IMAGE_CHECKSUM_URL', config.checksumUrl]]) {
    if (new URL(url).protocol !== 'https:') {
      throw new Error(`${name} must use HTTPS`);
    }
  }
  return config;
}

export function validateVmServicePorts(vmConfig, sshPort) {
  if (vmConfig.enabled && vmConfig.sshHostPort === sshPort) {
    throw new Error(`VM_SSH_HOST_PORT must differ from SSH_PORT (${sshPort})`);
  }
}
