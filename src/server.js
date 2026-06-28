import fs from 'node:fs';
import ssh2 from 'ssh2';
import { createAuthenticator } from './auth.js';
import { createCommandRunner } from './command-runner.js';
import { attachSftpServer } from './sftp-server.js';
import { createShellRunner } from './shell-runner.js';

const { Server } = ssh2;

export function createSshServer(config, logger) {
  const authenticator = createAuthenticator(config.usersFile);
  const commandRunner = createCommandRunner(config.commandsFile, logger);
  const shellRunner = createShellRunner(config, logger);
  let activeClients = 0;

  const server = new Server(
    {
      hostKeys: [fs.readFileSync(config.hostKeyPath)],
      readyTimeout: config.readyTimeoutMs
    },
    (client, info) => {
      if (activeClients >= config.maxClients) {
        logger.warn('Rejected client because max clients reached', { ip: info.ip, activeClients });
        client.end();
        return;
      }

      activeClients += 1;
      const context = { username: undefined, ip: info.ip };
      logger.info('Client connected', { ip: info.ip, activeClients });

      client.on('authentication', (ctx) => {
        context.username = ctx.username;

        if (ctx.method === 'password' && authenticator.verifyPassword(ctx.username, ctx.password)) {
          ctx.accept();
          return;
        }

        if (ctx.method === 'publickey') {
          const verified = authenticator.verifyPublicKey(ctx.username, ctx.key, ctx.blob, ctx.signature, ctx.hashAlgo);
          if (verified) {
            ctx.accept();
            return;
          }
        }

        logger.warn('Authentication failed', { username: ctx.username, method: ctx.method, ip: info.ip });
        ctx.reject(['password', 'publickey']);
      });

      client.on('ready', () => {
        logger.info('Client authenticated', { username: context.username, ip: info.ip });

        client.on('session', (accept, reject) => {
          const session = accept();
          if (!session) {
            logger.warn('Rejected session because no channel was available', { username: context.username, ip: info.ip });
            reject?.();
            return;
          }

          let ptyInfo;
          let activeShell;

          session.on('exec', (execAccept, reject, info) => {
            const stream = execAccept();
            if (!stream) {
              logger.warn('Rejected exec because no stream was available', { username: context.username, command: info?.command });
              reject?.();
              return;
            }
            commandRunner.run(info.command, stream, context);
          });

          session.on('shell', (acceptShell, rejectShell) => {
            if (!config.enableShell) {
              rejectShell?.();
              return;
            }

            const stream = acceptShell();
            if (!stream) {
              logger.warn('Rejected shell because no stream was available', { username: context.username });
              rejectShell?.();
              return;
            }
            activeShell = shellRunner.start(stream, ptyInfo, context);
          });

          session.on('pty', (acceptPty, rejectPty, info) => {
            ptyInfo = info;
            acceptPty?.();
          });

          session.on('window-change', (acceptWindowChange, rejectWindowChange, info) => {
            ptyInfo = { ...ptyInfo, ...info };
            activeShell?.resize(ptyInfo);
            acceptWindowChange?.();
          });

          session.on('close', () => {
            activeShell?.close();
          });

          session.on('sftp', (acceptSftp, rejectSftp) => {
            const sftp = acceptSftp();
            if (!sftp) {
              logger.warn('Rejected SFTP because no subsystem stream was available', { username: context.username });
              rejectSftp?.();
              return;
            }
            logger.info('SFTP session started', { username: context.username });
            attachSftpServer(sftp, config.sftpRoot, logger, context);
          });
        });
      });

      client.on('error', (error) => {
        logger.warn('Client error', { username: context.username, ip: info.ip, error: error.message });
      });

      client.on('close', () => {
        activeClients = Math.max(0, activeClients - 1);
        logger.info('Client disconnected', { username: context.username, ip: info.ip, activeClients });
      });
    }
  );

  return server;
}
