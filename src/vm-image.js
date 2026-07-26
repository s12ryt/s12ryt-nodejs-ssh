import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ensureQemuRuntime, qemuCommandEnvironment, runRuntimeCommand } from './vm-runtime.js';

const GIB = 1024 ** 3;

export function checksumForFile(checksums, filename) {
  for (const line of String(checksums).split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{128})\s+\*?(.+)$/);
    if (match && match[2] === filename) {
      return match[1].toLowerCase();
    }
  }
  throw new Error(`No SHA-512 checksum found for ${filename}`);
}

async function fetchChecked(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  return response;
}

function ensureFreeDisk(directory, minimumGb) {
  if (minimumGb <= 0 || typeof fs.statfsSync !== 'function') {
    return;
  }
  const stats = fs.statfsSync(directory);
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  if (availableBytes < minimumGb * GIB) {
    throw new Error(`VM requires at least ${minimumGb} GiB free in ${directory}`);
  }
}

async function downloadImage(config, logger) {
  const directory = path.dirname(config.imagePath);
  const filename = path.basename(decodeURIComponent(new URL(config.imageUrl).pathname));
  const temporaryPrefix = `${path.basename(config.imagePath)}.download-`;
  for (const entry of fs.readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    if (entry.startsWith(temporaryPrefix) && Date.now() - fs.statSync(entryPath).mtimeMs > config.downloadTimeoutMs) {
      fs.rmSync(entryPath, { force: true });
    }
  }
  const temporaryPath = path.join(directory, `${temporaryPrefix}${randomBytes(8).toString('hex')}`);
  const signal = AbortSignal.timeout(config.downloadTimeoutMs);
  ensureFreeDisk(directory, config.minHostFreeGb);

  logger.info('Downloading VM checksum', { checksumUrl: config.checksumUrl });
  const checksumResponse = await fetchChecked(config.checksumUrl, { signal });
  const expectedHash = checksumForFile(await checksumResponse.text(), filename);
  logger.info('Downloading Debian VM image', { imageUrl: config.imageUrl });

  const imageResponse = await fetchChecked(config.imageUrl, { signal });
  if (!imageResponse.body) {
    throw new Error('VM image download returned an empty body');
  }
  const hash = createHash('sha512');
  const hashStream = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    }
  });

  try {
    await pipeline(Readable.fromWeb(imageResponse.body), hashStream, fs.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
    const actualHash = hash.digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error(`SHA-512 mismatch for ${filename}`);
    }
    fs.renameSync(temporaryPath, config.imagePath);
    for (const entry of fs.readdirSync(directory)) {
      if (entry.startsWith(`${path.basename(config.imagePath)}.cloud-init-`)) {
        fs.rmSync(path.join(directory, entry), { force: true });
      }
    }
    logger.info('VM image downloaded and verified', { imagePath: config.imagePath });
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export async function ensureVmImage(config, logger, dependencies = {}) {
  const run = dependencies.runCommand || runRuntimeCommand;
  const prepareRuntime = dependencies.ensureQemuRuntime || ensureQemuRuntime;
  fs.mkdirSync(path.dirname(config.imagePath), { recursive: true });
  ensureFreeDisk(path.dirname(config.imagePath), config.minHostFreeGb);

  try {
    await prepareRuntime(config, logger, { runCommand: run });
  } catch (error) {
    throw new Error(`QEMU runtime is unavailable. ${error.message}`);
  }
  if (!fs.existsSync(config.imagePath)) {
    await (dependencies.downloadImage || downloadImage)(config, logger);
  }

  const commandOptions = { env: qemuCommandEnvironment(config) };
  const { stdout } = await run(config.qemuImgBinary, ['info', '--output=json', config.imagePath], commandOptions);
  const imageInfo = JSON.parse(stdout);
  const targetSize = config.diskGb * GIB;
  if (imageInfo.format !== 'qcow2') {
    throw new Error(`VM image must use qcow2 format, received ${imageInfo.format || 'unknown'}`);
  }
  if (!Number.isFinite(imageInfo['virtual-size'])) {
    throw new Error('qemu-img did not report a valid virtual-size');
  }
  if (imageInfo['virtual-size'] < targetSize) {
    await run(config.qemuImgBinary, ['resize', config.imagePath, `${config.diskGb}G`], commandOptions);
    logger.info('VM disk expanded', { diskGb: config.diskGb });
  } else if (imageInfo['virtual-size'] > targetSize) {
    throw new Error(
      `Existing VM disk is ${imageInfo['virtual-size'] / GIB} GiB, larger than VM_DISK_GB=${config.diskGb}. ` +
      'Automatic shrinking is unsafe; increase VM_DISK_GB or recreate the VM image.'
    );
  }
}
