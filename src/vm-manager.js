import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { ensureVmImage } from './vm-image.js';
import { cloudInitFingerprint, startMetadataServer } from './vm-metadata.js';
import { applyCpuLimit } from './vm-cpu-limit.js';
import { sendQmpCommand } from './qmp-client.js';
import { qemuCommandEnvironment } from './vm-runtime.js';

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    function onExit() {
      clearTimeout(timeout);
      resolve(true);
    }
    child.once('exit', onExit);
  });
}

function probeSsh(host, port, signal) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('SSH probe timed out')), 1000);
    function finish(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }
    function onAbort() {
      finish(signal.reason instanceof Error ? signal.reason : new Error('VM startup cancelled'));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.setEncoding('utf8');
    socket.once('data', (data) => {
      if (data.startsWith('SSH-')) {
        finish();
      } else {
        finish(new Error('VM port did not return an SSH banner'));
      }
    });
    socket.once('error', finish);
  });
}

function abortableDelay(timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(finish, timeoutMs);
    function finish(error) {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }
    function onAbort() {
      finish(signal.reason instanceof Error ? signal.reason : new Error('VM startup cancelled'));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function waitForVmSsh(config, timeoutMs, options = {}) {
  const host = config.sshHost === '0.0.0.0' ? '127.0.0.1' : config.sshHost;
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error ? options.signal.reason : new Error('VM startup cancelled');
    }
    try {
      await probeSsh(host, config.sshHostPort, options.signal);
      return;
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
      lastError = error;
      await abortableDelay(1000, options.signal);
    }
  }
  throw new Error(`VM SSH did not become ready within ${timeoutMs} ms: ${lastError?.message || 'unknown error'}`);
}

function recentQemuOutput(lines) {
  if (lines.length === 0) {
    return '';
  }
  return ` Recent QEMU output: ${lines.slice(-20).join(' | ')}`;
}

function logLines(stream, logger, level, message, recentLines) {
  if (!stream) {
    return;
  }
  const lines = readline.createInterface({ input: stream });
  lines.on('line', (line) => {
    if (line.trim()) {
      recentLines.push(line.trim());
      if (recentLines.length > 100) {
        recentLines.shift();
      }
      logger[level](message, { output: line });
    }
  });
}

function monitorStartupExit(child, recentLines) {
  let onExit;
  const promise = new Promise((resolve, reject) => {
    onExit = (code, signal) => {
      reject(new Error(
        `QEMU exited during startup (code=${code}, signal=${signal || 'none'}).${recentQemuOutput(recentLines)}`
      ));
    };
    child.once('exit', onExit);
  });
  return {
    promise,
    cancel() {
      child.off('exit', onExit);
    }
  };
}

function waitDuringStartup(operation, exitMonitor, timeout) {
  let timeoutHandle;
  const operations = [operation, exitMonitor.promise];
  if (timeout) {
    operations.push(new Promise((resolve, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(timeout.message)), timeout.ms);
    }));
  }
  return Promise.race(operations).finally(() => clearTimeout(timeoutHandle));
}

export function buildQemuArgs(config, { seedUrl, qmpPath }) {
  const runtimeArgs = [];
  if (config.qemuDataPath) {
    runtimeArgs.push('-L', config.qemuDataPath);
  }
  if (config.qemuBiosPath) {
    runtimeArgs.push('-bios', config.qemuBiosPath);
  }
  return [
    '-name', config.hostname,
    '-accel', 'tcg,thread=multi',
    '-smp', String(Math.ceil(config.cpuLimit)),
    '-m', String(config.ramMb),
    '-drive', `file=${config.imagePath},if=virtio,format=qcow2,discard=unmap`,
    '-nic', `user,model=virtio-net-pci,hostfwd=tcp:${config.sshHost}:${config.sshHostPort}-:22`,
    '-smbios', `type=1,serial=ds=nocloud-net;s=${seedUrl}`,
    '-qmp', `unix:${qmpPath},server=on,wait=off`,
    '-sandbox', 'on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny',
    ...runtimeArgs,
    '-nographic'
  ];
}

export function createVmManager(config, logger, dependencies = {}) {
  let child;
  let metadata;
  let cpuController = { enforced: false, cleanup() {} };
  let stopping = false;
  let cleanupPromise;
  const qmpPath = dependencies.qmpPath || `${os.tmpdir()}/s12ryt-vm-${process.pid}.qmp`;
  const spawnProcess = dependencies.spawnProcess || spawn;
  const prepareImage = dependencies.ensureVmImage || ensureVmImage;
  const createMetadata = dependencies.startMetadataServer || startMetadataServer;
  const limitCpu = dependencies.applyCpuLimit || applyCpuLimit;
  const qmpCommand = dependencies.sendQmpCommand || sendQmpCommand;
  const waitForSsh = dependencies.waitForVmSsh || waitForVmSsh;

  async function cleanup() {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        cpuController.cleanup();
        cpuController = { enforced: false, cleanup() {} };
        fs.rmSync(qmpPath, { force: true });
        if (metadata) {
          const currentMetadata = metadata;
          metadata = undefined;
          await currentMetadata.close();
        }
      })().finally(() => {
        cleanupPromise = undefined;
      });
    }
    return cleanupPromise;
  }

  return {
    get enabled() {
      return config.enabled;
    },
    get shutdownTimeoutMs() {
      return config.shutdownTimeoutMs;
    },
    async start() {
      if (!config.enabled || child || stopping) {
        return;
      }
      await prepareImage(config, logger);
      if (stopping) {
        return;
      }
      const fingerprint = cloudInitFingerprint(config);
      const provisionMarker = `${config.imagePath}.cloud-init-${fingerprint}`;
      const alreadyProvisioned = fs.existsSync(provisionMarker);
      metadata = await createMetadata(config, logger, { includeCredentials: !alreadyProvisioned });
      if (stopping) {
        await cleanup();
        return;
      }
      fs.rmSync(qmpPath, { force: true });
      const args = buildQemuArgs(config, { seedUrl: metadata.seedUrl, qmpPath });
      logger.info('Starting QEMU TCG VM', {
        imagePath: config.imagePath,
        ramMb: config.ramMb,
        cpuLimit: config.cpuLimit,
        vcpus: Math.ceil(config.cpuLimit),
        diskGb: config.diskGb,
        sshHost: config.sshHost,
        sshHostPort: config.sshHostPort
      });
      child = spawnProcess(config.qemuBinary, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: qemuCommandEnvironment(config)
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      }).catch(async (error) => {
        child = undefined;
        await cleanup();
        throw new Error(`Failed to start QEMU: ${error.message}`);
      });
      const recentOutput = [];
      logLines(child.stdout, logger, 'debug', 'QEMU output', recentOutput);
      logLines(child.stderr, logger, 'warn', 'QEMU error output', recentOutput);
      const startupExit = monitorStartupExit(child, recentOutput);
      cpuController = limitCpu(child.pid, config.cpuLimit, logger);
      child.once('exit', async (code, signal) => {
        const expected = stopping;
        child = undefined;
        await cleanup();
        logger[expected ? 'info' : 'error']('QEMU VM stopped', { code, signal, expected });
      });
      const activeMetadata = metadata;
      const runningChild = child;
      const startupAbort = new AbortController();
      const startupStartedAt = Date.now();
      let startupStage = 'cloud-init metadata';
      const progressIntervalMs = dependencies.startupProgressIntervalMs || 30000;
      const progressTimer = setInterval(() => {
        logger.info('VM startup is still in progress', {
          stage: startupStage,
          elapsedSeconds: Math.floor((Date.now() - startupStartedAt) / 1000),
          timeoutMs: config.metadataTimeoutMs
        });
      }, progressIntervalMs);
      progressTimer.unref?.();
      try {
        if (activeMetadata.consumed && !alreadyProvisioned) {
          logger.info('Waiting for VM to fetch cloud-init metadata', { timeoutMs: config.metadataTimeoutMs });
          await waitDuringStartup(
            activeMetadata.consumed,
            startupExit,
            {
              ms: config.metadataTimeoutMs,
              message: `VM did not fetch cloud-init metadata within ${config.metadataTimeoutMs} ms`
            }
          );
          logger.info('VM fetched cloud-init metadata');
        }
        if (activeMetadata.completed && !alreadyProvisioned) {
          startupStage = 'cloud-init completion';
          logger.info('Waiting for VM cloud-init provisioning completion', { timeoutMs: config.metadataTimeoutMs });
          await waitDuringStartup(
            activeMetadata.completed,
            startupExit,
            {
              ms: config.metadataTimeoutMs,
              message: `VM cloud-init provisioning did not complete within ${config.metadataTimeoutMs} ms`
            }
          );
          logger.info('VM cloud-init provisioning is complete');
        }
        startupStage = 'SSH readiness';
        logger.info('Waiting for VM SSH readiness', {
          sshHost: config.sshHost,
          sshHostPort: config.sshHostPort,
          timeoutMs: config.metadataTimeoutMs
        });
        await waitDuringStartup(
          waitForSsh(config, config.metadataTimeoutMs, { signal: startupAbort.signal }),
          startupExit
        );
        startupExit.cancel();
        await activeMetadata.close();
        if (metadata === activeMetadata) {
          metadata = undefined;
        }
        if (!alreadyProvisioned) {
          fs.writeFileSync(provisionMarker, `${new Date().toISOString()}\n`, { mode: 0o600 });
        }
        logger.info('VM SSH is ready and cloud-init metadata server is closed', {
          sshHost: config.sshHost,
          sshHostPort: config.sshHostPort
        });
      } catch (error) {
        startupExit.cancel();
        if (runningChild.exitCode === null && runningChild.signalCode === null) {
          runningChild.kill('SIGTERM');
        }
        await waitForExit(runningChild, 5000);
        await cleanup();
        if (!error.message.includes('Recent QEMU output:')) {
          error.message += recentQemuOutput(recentOutput);
        }
        throw error;
      } finally {
        startupAbort.abort(new Error('VM startup wait completed'));
        clearInterval(progressTimer);
      }
    },
    async stop() {
      stopping = true;
      if (!child) {
        await cleanup();
        return;
      }
      const runningChild = child;
      logger.info('Stopping QEMU VM');
      try {
        await qmpCommand(qmpPath, 'system_powerdown');
      } catch (error) {
        logger.warn('QMP powerdown failed; sending SIGTERM to QEMU', { error: error.message });
        runningChild.kill('SIGTERM');
      }
      if (!(await waitForExit(runningChild, config.shutdownTimeoutMs))) {
        logger.warn('VM shutdown timeout exceeded; sending SIGTERM');
        runningChild.kill('SIGTERM');
      }
      if (!(await waitForExit(runningChild, 5000))) {
        logger.error('QEMU did not stop after SIGTERM; sending SIGKILL');
        runningChild.kill('SIGKILL');
        await waitForExit(runningChild, 5000);
      }
      await cleanup();
    }
  };
}
