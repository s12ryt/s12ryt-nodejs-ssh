// SSH server 主流程
//
// L22  ALGORITHMS            顯式演算法白名單（只保留 AEAD 與 SHA-2 系列）
// L41  createSshServer()     建立 ssh2 Server 與連線守衛
// L57  連線進入              guard.acquire() 全域 + per-IP 限額
// L75  authentication        驗證失敗計數，達上限立即斷線
// L105 session               per-connection channel 限額
// L185 close                 釋放 shell、session 與連線配額
import fs from 'node:fs';
import ssh2 from 'ssh2';
import { createAuthenticator } from './auth.js';
import { createCommandRunner } from './command-runner.js';
import { createConnectionGuard } from './connection-guard.js';
import { attachSftpServer } from './sftp-server.js';
import { ensureHomeDirectory } from './sftp-fs.js';
import { createShellRunner } from './shell-runner.js';

const { Server } = ssh2;

// 顯式鎖定演算法策略，避免 ssh2 版本漂移時意外啟用弱 KEX/cipher/MAC。
export const ALGORITHMS = {
  kex: [
    'curve25519-sha256',
    'curve25519-sha256@libssh.org',
    'ecdh-sha2-nistp256',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'diffie-hellman-group16-sha512',
    'diffie-hellman-group18-sha512',
    'diffie-hellman-group14-sha256'
  ],
  cipher: [
    'chacha20-poly1305@openssh.com',
    'aes256-gcm@openssh.com',
    'aes128-gcm@openssh.com',
    'aes256-ctr',
    'aes192-ctr',
    'aes128-ctr'
  ],
  serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256'],
  hmac: [
    'hmac-sha2-256-etm@openssh.com',
    'hmac-sha2-512-etm@openssh.com',
    'hmac-sha2-256',
    'hmac-sha2-512'
  ],
  compress: ['none', 'zlib@openssh.com']
};

export function createSshServer(config, logger) {
  const authenticator = createAuthenticator(config.usersFile);
  const commandRunner = createCommandRunner(config.commandsFile, logger);
  const shellRunner = createShellRunner(
    { ...config, shellCwd: ({ username }) => ensureHomeDirectory(config.sftpRoot, username) },
    logger
  );
  const guard = createConnectionGuard({
    maxClients: config.maxClients,
    maxClientsPerIp: config.maxClientsPerIp,
    maxAuthFailures: config.maxAuthFailures,
    maxSessionsPerClient: config.maxSessionsPerClient
  });

  const server = new Server(
    {
      hostKeys: [fs.readFileSync(config.hostKeyPath)],
      readyTimeout: config.readyTimeoutMs,
      algorithms: ALGORITHMS
    },
    (client, info) => {
      const acquired = guard.acquire(info.ip);
      if (!acquired.allowed) {
        logger.warn('Rejected client because a connection limit was reached', {
          ip: info.ip,
          reason: acquired.reason,
          activeClients: guard.activeClients
        });
        client.end();
        return;
      }

      const handle = acquired.handle;
      const context = { username: undefined, ip: info.ip };
      const activeShells = new Set();
      function latestActiveShell() {
        let latest;
        for (const shell of activeShells) {
          latest = shell;
        }
        return latest;
      }
      logger.info('Client connected', { ip: info.ip, activeClients: guard.activeClients });

      client.on('authentication', (ctx) => {
        if (ctx.method === 'password' && authenticator.verifyPassword(ctx.username, ctx.password)) {
          context.username = ctx.username;
          ctx.accept();
          return;
        }

        if (ctx.method === 'publickey') {
          const verified = authenticator.verifyPublicKey(ctx.username, ctx.key, ctx.blob, ctx.signature, ctx.hashAlgo);
          if (verified) {
            context.username = ctx.username;
            ctx.accept();
            return;
          }
        }

        const { failures, exhausted } = handle.registerAuthFailure();
        logger.warn('Authentication failed', { username: ctx.username, method: ctx.method, ip: info.ip, failures });
        ctx.reject(['password', 'publickey']);

        if (exhausted) {
          logger.warn('Closing client after too many authentication failures', { ip: info.ip, failures });
          client.end();
        }
      });

      client.on('ready', () => {
        logger.info('Client authenticated', { username: context.username, ip: info.ip });

        client.on('session', (accept, reject) => {
          if (!handle.acquireSession()) {
            logger.warn('Rejected session because the channel limit was reached', { username: context.username, ip: info.ip });
            reject?.();
            return;
          }

          const session = accept();
          if (!session) {
            logger.warn('Rejected session because no channel was available', { username: context.username, ip: info.ip });
            handle.releaseSession();
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
            activeShells.add(activeShell);
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
            activeShells.delete(activeShell);
            handle.releaseSession();
          });

          session.on('sftp', (acceptSftp, rejectSftp) => {
            const sftp = acceptSftp();
            if (!sftp) {
              logger.warn('Rejected SFTP because no subsystem stream was available', { username: context.username });
              rejectSftp?.();
              return;
            }
            logger.info('SFTP session started', { username: context.username });
            attachSftpServer(sftp, config.sftpRoot, logger, context, {
              followShellCwd: config.sftpFollowShellCwd,
              home: ensureHomeDirectory(config.sftpRoot, context.username),
              getShellCwd() {
                return latestActiveShell()?.getCwd?.();
              },
              getShellPathContext() {
                return latestActiveShell()?.getPathContext?.();
              }
            });
          });
        });
      });

      client.on('error', (error) => {
        logger.warn('Client error', { username: context.username, ip: info.ip, error: error.message });
      });

      client.on('close', () => {
        for (const shell of activeShells) {
          shell.close();
        }
        activeShells.clear();
        handle.release();
        logger.info('Client disconnected', { username: context.username, ip: info.ip, activeClients: guard.activeClients });
      });
    }
  );

  return server;
}
