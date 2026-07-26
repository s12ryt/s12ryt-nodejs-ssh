import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudInitData, startMetadataServer } from '../src/vm-metadata.js';

test('createCloudInitData provisions VM SSH and root filesystem growth', () => {
  const data = createCloudInitData({
    hostname: 'test-vm',
    sshUsername: 'root',
    sshPassword: 'StrongPassword123!',
    sshAuthorizedKey: ''
  });
  const cloudConfig = JSON.parse(data.userData.slice('#cloud-config\n'.length));

  assert.equal(cloudConfig.hostname, 'test-vm');
  assert.equal(cloudConfig.disable_root, false);
  assert.equal(cloudConfig.ssh_pwauth, true);
  assert.equal(cloudConfig.chpasswd.users[0].name, 'root');
  assert.equal(cloudConfig.write_files[0].path, '/etc/ssh/sshd_config.d/00-s12ryt-cloud-init.conf');
  assert.match(cloudConfig.write_files[0].content, /PasswordAuthentication yes/);
  assert.match(cloudConfig.write_files[0].content, /PermitRootLogin yes/);
  assert.deepEqual(cloudConfig.runcmd, [['systemctl', 'restart', 'ssh.service']]);
  assert.equal(cloudConfig.resize_rootfs, true);
  assert.match(data.metaData, /instance-id: s12ryt-/);
});

test('createCloudInitData does not enable root password login for key-only provisioning', () => {
  const data = createCloudInitData({
    hostname: 'test-vm',
    sshUsername: 'root',
    sshPassword: '',
    sshAuthorizedKey: 'ssh-ed25519 AAAAC3NzaExample test@example'
  });
  const cloudConfig = JSON.parse(data.userData.slice('#cloud-config\n'.length));

  assert.equal(cloudConfig.ssh_pwauth, false);
  assert.equal(cloudConfig.write_files, undefined);
  assert.equal(cloudConfig.runcmd, undefined);
});

test('createCloudInitData requires at least one SSH authentication method', () => {
  assert.throws(
    () => createCloudInitData({ hostname: 'vm', sshUsername: 'root', sshPassword: '', sshAuthorizedKey: '' }),
    /VM_SSH_PASSWORD or VM_SSH_AUTHORIZED_KEY/
  );
});

test('createCloudInitData omits credentials after provisioning', () => {
  const data = createCloudInitData({
    hostname: 'test-vm',
    sshUsername: 'root',
    sshPassword: 'StrongPassword123!',
    sshAuthorizedKey: ''
  }, { includeCredentials: false });
  const cloudConfig = JSON.parse(data.userData.slice('#cloud-config\n'.length));

  assert.deepEqual(cloudConfig, {});
  assert.equal(data.userData.includes('StrongPassword123!'), false);
});

test('startMetadataServer marks metadata consumed only after both files are fetched', async () => {
  const logMessages = [];
  const metadata = await startMetadataServer({
    hostname: 'test-vm',
    sshUsername: 'root',
    sshPassword: 'StrongPassword123!',
    sshAuthorizedKey: ''
  }, { info(message, details) { logMessages.push([message, details]); } });
  const localBase = metadata.seedUrl.replace('10.0.2.2', '127.0.0.1');
  let consumed = false;
  metadata.consumed.then(() => {
    consumed = true;
  });

  assert.equal((await fetch(`${localBase}meta-data`)).status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(consumed, false);
  assert.equal((await fetch(`${localBase}user-data`)).status, 200);
  await metadata.consumed;
  assert.equal(consumed, true);
  const userData = await (await fetch(`${localBase}user-data`)).text();
  const cloudConfig = JSON.parse(userData.slice('#cloud-config\n'.length));
  const completionUrl = cloudConfig.phone_home.url.replace('10.0.2.2', '127.0.0.1');
  let completed = false;
  metadata.completed.then(() => {
    completed = true;
  });
  assert.equal((await fetch(completionUrl)).status, 404);
  assert.equal(completed, false);
  assert.equal((await fetch(completionUrl, { method: 'POST', body: 'instance_id=test' })).status, 204);
  await metadata.completed;
  assert.equal(completed, true);
  assert.deepEqual(logMessages.filter(([message]) => message === 'VM requested cloud-init metadata').map(([, details]) => details.file), [
    'meta-data',
    'user-data'
  ]);
  assert.equal(logMessages.filter(([message]) => message === 'VM cloud-init provisioning completed').length, 1);
  await metadata.close();
});
