import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const PROVISIONING_SCHEMA_VERSION = '2';

export function cloudInitFingerprint(config) {
  return createHash('sha256')
    .update(`${PROVISIONING_SCHEMA_VERSION}\0${config.hostname}\0${config.sshUsername}\0${config.sshPassword}\0${config.sshAuthorizedKey}`)
    .digest('hex')
    .slice(0, 16);
}

export function createCloudInitData(config, { includeCredentials = true, completionUrl } = {}) {
  if (includeCredentials && !config.sshPassword && !config.sshAuthorizedKey) {
    throw new Error('VM_SSH_PASSWORD or VM_SSH_AUTHORIZED_KEY is required when VM_ENABLED=true');
  }
  const cloudConfig = {};
  if (includeCredentials) {
    const user = {
      name: config.sshUsername,
      shell: '/bin/bash',
      lock_passwd: !config.sshPassword
    };
    if (config.sshAuthorizedKey) {
      user.ssh_authorized_keys = [config.sshAuthorizedKey];
    }
    Object.assign(cloudConfig, {
      hostname: config.hostname,
      disable_root: false,
      ssh_pwauth: Boolean(config.sshPassword),
      users: [user],
      growpart: { mode: 'auto', devices: ['/'] },
      resize_rootfs: true
    });
    if (config.sshPassword) {
      cloudConfig.chpasswd = {
        expire: false,
        users: [{ name: config.sshUsername, password: config.sshPassword, type: 'text' }]
      };
      const sshdSettings = ['PasswordAuthentication yes'];
      if (config.sshUsername === 'root') {
        sshdSettings.push('PermitRootLogin yes');
      }
      cloudConfig.write_files = [{
        path: '/etc/ssh/sshd_config.d/00-s12ryt-cloud-init.conf',
        owner: 'root:root',
        permissions: '0600',
        content: `${sshdSettings.join('\n')}\n`
      }];
      cloudConfig.runcmd = [['systemctl', 'restart', 'ssh.service']];
    }
    if (completionUrl) {
      cloudConfig.phone_home = {
        url: completionUrl,
        post: ['instance_id'],
        tries: 5
      };
    }
  }

  const identity = cloudInitFingerprint(config);
  return {
    fingerprint: identity,
    metaData: `instance-id: s12ryt-${identity}\nlocal-hostname: ${config.hostname}\n`,
    userData: `#cloud-config\n${JSON.stringify(cloudConfig)}\n`
  };
}

export async function startMetadataServer(config, logger, options = {}) {
  const token = randomBytes(24).toString('hex');
  let data;
  const served = new Set();
  let resolveConsumed;
  const consumed = new Promise((resolve) => {
    resolveConsumed = resolve;
  });
  let resolveCompleted;
  const completed = new Promise((resolve) => {
    resolveCompleted = resolve;
  });
  let completionReceived = false;
  let closePromise;
  const server = http.createServer((request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      response.writeHead(400).end();
      return;
    }
    const completionPath = `/${token}/complete`;
    if (pathname === completionPath) {
      if (request.method !== 'POST') {
        response.writeHead(404).end();
        return;
      }
      request.resume();
      response.once('finish', () => {
        if (!completionReceived) {
          completionReceived = true;
          logger.info('VM cloud-init provisioning completed');
          resolveCompleted();
        }
      });
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }
    if (!data) {
      response.writeHead(503).end();
      return;
    }
    const files = {
      [`/${token}/meta-data`]: data.metaData,
      [`/${token}/user-data`]: data.userData
    };
    const body = files[pathname];
    if (request.method !== 'GET' || body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store'
    });
    response.end(body);
    const firstRequest = !served.has(pathname);
    served.add(pathname);
    if (firstRequest) {
      logger.info('VM requested cloud-init metadata', { file: pathname.endsWith('/meta-data') ? 'meta-data' : 'user-data' });
    }
    if (served.size === 2) {
      resolveConsumed();
    }
  });

  await new Promise((resolve, reject) => {
    function onListening() {
      server.off('error', onError);
      resolve();
    }
    function onError(error) {
      server.off('listening', onListening);
      reject(error);
    }
    server.once('error', onError);
    server.listen(0, '127.0.0.1', onListening);
  });
  const address = server.address();
  const guestBaseUrl = `http://10.0.2.2:${address.port}/${token}/`;
  data = createCloudInitData(config, {
    ...options,
    completionUrl: options.includeCredentials === false ? undefined : `${guestBaseUrl}complete`
  });
  logger.info('VM cloud-init metadata server started', { port: address.port });
  return {
    fingerprint: data.fingerprint,
    seedUrl: guestBaseUrl,
    consumed,
    completed,
    close() {
      if (!closePromise) {
        closePromise = new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        });
      }
      return closePromise;
    }
  };
}
