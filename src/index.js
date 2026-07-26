import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createSshServer } from './server.js';
import { createVmManager } from './vm-manager.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const server = createSshServer(config, logger);
const vmManager = createVmManager(config.vm, logger);
let shutdownPromise;

function closeSshServer() {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function shutdown(signal) {
  if (shutdownPromise) {
    return shutdownPromise;
  }
  logger.info('Shutdown requested', { signal });
  shutdownPromise = Promise.allSettled([closeSshServer(), vmManager.stop()]).then((results) => {
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) {
      logger.error('Shutdown failed', { error: failed.reason?.message || String(failed.reason) });
      process.exit(1);
    }
    logger.info('SSH server stopped');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown timeout exceeded');
    process.exit(1);
  }, Math.max(10000, config.vm.shutdownTimeoutMs + 10000)).unref();
  return shutdownPromise;
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('error', (error) => {
  logger.error('SSH server error', { error: error.message });
  process.exitCode = 1;
});

await vmManager.start();

if (!shutdownPromise) {
  server.listen(config.port, config.host, () => {
    logger.info('SSH server listening', {
      host: config.host,
      port: config.port,
      sftpRoot: config.sftpRoot,
      sftpFollowShellCwd: config.sftpFollowShellCwd,
      vmEnabled: config.vm.enabled,
      vmSshPort: config.vm.enabled ? config.vm.sshHostPort : undefined
    });
  });
}
