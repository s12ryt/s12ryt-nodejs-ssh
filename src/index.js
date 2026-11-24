import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createSshServer } from './server.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const server = createSshServer(config, logger);

server.on('error', (error) => {
  logger.error('SSH server error', { error: error.message });
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  logger.info('SSH server listening', { host: config.host, port: config.port, sftpRoot: config.sftpRoot });
});

function shutdown(signal) {
  logger.info('Shutdown requested', { signal });
  server.close(() => {
    logger.info('SSH server stopped');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown timeout exceeded');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
