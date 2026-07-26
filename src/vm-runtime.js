import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const QEMU_PACKAGES = ['qemu-system-x86', 'qemu-utils', 'qemu-system-data', 'seabios'];

export function runRuntimeCommand(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : undefined;

    function finish(error, result) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => {
      if (code === 0) {
        finish(undefined, { stdout, stderr });
        return;
      }
      const reason = timedOut
        ? `timed out after ${options.timeoutMs} ms`
        : signal
        ? `terminated by ${signal}`
        : `exited with status ${code}`;
      finish(new Error(`${binary} ${reason}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

function runtimePaths(runtimePath) {
  const libraryDirectories = [
    path.join(runtimePath, 'lib', 'x86_64-linux-gnu'),
    path.join(runtimePath, 'usr', 'lib', 'x86_64-linux-gnu')
  ].filter((directory) => fs.existsSync(directory));
  const biosCandidates = [
    path.join(runtimePath, 'usr', 'share', 'seabios', 'bios-256k.bin'),
    path.join(runtimePath, 'usr', 'share', 'seabios', 'bios.bin')
  ];
  return {
    qemuBinary: path.join(runtimePath, 'usr', 'bin', 'qemu-system-x86_64'),
    qemuImgBinary: path.join(runtimePath, 'usr', 'bin', 'qemu-img'),
    libraryPath: libraryDirectories.join(path.delimiter),
    dataPath: path.join(runtimePath, 'usr', 'share', 'qemu'),
    biosPath: biosCandidates.find((candidate) => fs.existsSync(candidate))
  };
}

function applyLocalRuntime(config) {
  const paths = runtimePaths(config.qemuRuntimePath);
  if (!fs.existsSync(paths.qemuBinary) || !fs.existsSync(paths.qemuImgBinary) || !paths.biosPath) {
    return false;
  }
  config.qemuBinary = paths.qemuBinary;
  config.qemuImgBinary = paths.qemuImgBinary;
  config.qemuLibraryPath = paths.libraryPath;
  config.qemuDataPath = paths.dataPath;
  config.qemuBiosPath = paths.biosPath;
  return true;
}

export function qemuCommandEnvironment(config, baseEnvironment = process.env) {
  if (!config.qemuLibraryPath) {
    return baseEnvironment;
  }
  return {
    ...baseEnvironment,
    LD_LIBRARY_PATH: [config.qemuLibraryPath, baseEnvironment.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter)
  };
}

function aptOptions(aptDirectory, uid) {
  const options = [
    '-o', `Dir::State::extended_states=${path.join(aptDirectory, 'extended_states')}`,
    '-o', `Dir::State::Lists=${path.join(aptDirectory, 'lists')}`,
    '-o', `Dir::Cache=${path.join(aptDirectory, 'cache')}`,
    '-o', `Dir::Cache::Archives=${path.join(aptDirectory, 'archives')}`,
    '-o', 'Debug::NoLocking=true',
    '-o', 'APT::Get::List-Cleanup=0',
    '-o', 'Acquire::Languages=none'
  ];
  if (uid !== 0) {
    options.push('-o', 'APT::Sandbox::User=');
  }
  return options;
}

async function commandAvailable(run, binary, config) {
  try {
    await run(binary, ['--version'], {
      env: qemuCommandEnvironment(config),
      timeoutMs: 15000
    });
    return true;
  } catch {
    return false;
  }
}

async function installLocalRuntime(config, logger, run, system = {}) {
  const platform = system.platform || process.platform;
  const architecture = system.arch || process.arch;
  const uid = system.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined);
  if (platform !== 'linux' || architecture !== 'x64') {
    throw new Error('Automatic QEMU installation currently supports x86_64 Debian-compatible Linux only');
  }
  const parentDirectory = path.dirname(config.qemuRuntimePath);
  const suffix = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const stagingDirectory = `${config.qemuRuntimePath}.install-${suffix}`;
  const aptDirectory = `${stagingDirectory}.apt`;
  const backupDirectory = `${config.qemuRuntimePath}.previous-${suffix}`;
  const archiveDirectory = path.join(aptDirectory, 'archives');
  const options = { timeoutMs: config.qemuInstallTimeoutMs };

  fs.mkdirSync(path.join(aptDirectory, 'lists', 'partial'), { recursive: true });
  fs.mkdirSync(path.join(archiveDirectory, 'partial'), { recursive: true });
  fs.mkdirSync(stagingDirectory, { recursive: true });
  try {
    await run('apt-get', [...aptOptions(aptDirectory, uid), 'update'], options);
    logger.info('Downloading signed Debian QEMU runtime packages', { packages: QEMU_PACKAGES });
    await run('apt-get', [
      ...aptOptions(aptDirectory, uid),
      '--yes',
      '--download-only',
      '--no-install-recommends',
      '--reinstall',
      'install',
      ...QEMU_PACKAGES
    ], options);

    const archives = fs.readdirSync(archiveDirectory)
      .filter((filename) => filename.endsWith('.deb'))
      .map((filename) => path.join(archiveDirectory, filename));
    if (archives.length === 0) {
      throw new Error('APT did not download any QEMU packages');
    }
    for (const archive of archives) {
      await run('dpkg-deb', ['--extract', archive, stagingDirectory], options);
    }

    const stagedPaths = runtimePaths(stagingDirectory);
    if (!fs.existsSync(stagedPaths.qemuBinary) || !fs.existsSync(stagedPaths.qemuImgBinary) || !stagedPaths.biosPath) {
      throw new Error('Downloaded packages did not contain a complete QEMU x86 runtime');
    }
    fs.rmSync(aptDirectory, { recursive: true, force: true });
    fs.mkdirSync(parentDirectory, { recursive: true });
    const hadPreviousRuntime = fs.existsSync(config.qemuRuntimePath);
    if (hadPreviousRuntime) {
      fs.renameSync(config.qemuRuntimePath, backupDirectory);
    }
    try {
      fs.renameSync(stagingDirectory, config.qemuRuntimePath);
      fs.rmSync(backupDirectory, { recursive: true, force: true });
    } catch (error) {
      fs.rmSync(config.qemuRuntimePath, { recursive: true, force: true });
      if (hadPreviousRuntime && fs.existsSync(backupDirectory)) {
        fs.renameSync(backupDirectory, config.qemuRuntimePath);
      }
      throw error;
    }
    logger.info('Local QEMU runtime installed', { runtimePath: config.qemuRuntimePath });
  } catch (error) {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
    fs.rmSync(aptDirectory, { recursive: true, force: true });
    if (!fs.existsSync(config.qemuRuntimePath) && fs.existsSync(backupDirectory)) {
      fs.renameSync(backupDirectory, config.qemuRuntimePath);
    }
    throw error;
  }
}

export async function ensureQemuRuntime(config, logger, dependencies = {}) {
  const run = dependencies.runCommand || runRuntimeCommand;
  const systemQemu = await commandAvailable(run, config.qemuBinary, config);
  const systemQemuImg = await commandAvailable(run, config.qemuImgBinary, config);
  if (systemQemu && systemQemuImg) {
    return;
  }
  if (config.customQemuBinaries) {
    throw new Error('Configured VM_QEMU_BINARY or VM_QEMU_IMG_BINARY is unavailable');
  }
  if (applyLocalRuntime(config)) {
    const localQemu = await commandAvailable(run, config.qemuBinary, config);
    const localQemuImg = await commandAvailable(run, config.qemuImgBinary, config);
    if (localQemu && localQemuImg) {
      return;
    }
  }
  if (!config.qemuAutoInstall) {
    throw new Error('QEMU runtime is unavailable and VM_QEMU_AUTO_INSTALL=false');
  }

  logger.warn('QEMU runtime is unavailable; installing a private signed APT runtime', {
    runtimePath: config.qemuRuntimePath
  });
  try {
    await installLocalRuntime(config, logger, run, dependencies.system);
    applyLocalRuntime(config);
    const localQemu = await commandAvailable(run, config.qemuBinary, config);
    const localQemuImg = await commandAvailable(run, config.qemuImgBinary, config);
    if (!localQemu || !localQemuImg) {
      throw new Error('Installed QEMU runtime failed its version check');
    }
  } catch (error) {
    throw new Error(
      'QEMU runtime auto-install failed. FeatherPanel must provide apt-get, dpkg-deb, Debian-compatible repositories, network access, and writable VM storage. ' +
      error.message
    );
  }
}
