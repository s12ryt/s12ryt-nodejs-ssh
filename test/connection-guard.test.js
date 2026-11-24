// 連線/認證/channel 限額測試（對應 agent/question.md 驗收標準 C）
// 全域與 per-IP 連線上限、release 歸還與不殘留、認證失敗上限、session 上限、release 幂等

import test from 'node:test';
import assert from 'node:assert';
import { createConnectionGuard } from '../src/connection-guard.js';

const guardWith = (overrides = {}) => createConnectionGuard({
  maxClients: 4,
  maxClientsPerIp: 2,
  maxAuthFailures: 3,
  maxSessionsPerClient: 2,
  ...overrides
});

test('達全域上限時以 max-clients 拒絕', () => {
  const guard = guardWith({ maxClients: 2, maxClientsPerIp: 10 });
  assert.strictEqual(guard.acquire('1.1.1.1').allowed, true);
  assert.strictEqual(guard.acquire('2.2.2.2').allowed, true);
  const third = guard.acquire('3.3.3.3');
  assert.strictEqual(third.allowed, false);
  assert.strictEqual(third.reason, 'max-clients');
  assert.strictEqual(guard.activeClients, 2);
});

test('達 per-IP 上限時只拒絕該 IP', () => {
  const guard = guardWith();
  guard.acquire('1.1.1.1');
  guard.acquire('1.1.1.1');
  const blocked = guard.acquire('1.1.1.1');
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.reason, 'max-clients-per-ip');
  assert.strictEqual(guard.acquire('9.9.9.9').allowed, true);
});

test('release 歸還配額且不殘留 per-IP 項目', () => {
  const guard = guardWith();
  const first = guard.acquire('1.1.1.1');
  const second = guard.acquire('1.1.1.1');
  assert.strictEqual(guard.trackedIpCount, 1);
  first.handle.release();
  const third = guard.acquire('1.1.1.1');
  assert.strictEqual(third.allowed, true);
  second.handle.release();
  third.handle.release();
  assert.strictEqual(guard.activeClients, 0);
  assert.strictEqual(guard.trackedIpCount, 0);
});

test('認證失敗累計達上限回報 exhausted', () => {
  const guard = guardWith({ maxAuthFailures: 2 });
  const { handle } = guard.acquire('1.1.1.1');
  assert.deepStrictEqual(handle.registerAuthFailure(), { exhausted: false, failures: 1 });
  assert.deepStrictEqual(handle.registerAuthFailure(), { exhausted: true, failures: 2 });
  assert.strictEqual(handle.registerAuthFailure().exhausted, true);
});

test('session 達上限後 release 可再取得', () => {
  const guard = guardWith({ maxSessionsPerClient: 1 });
  const { handle } = guard.acquire('1.1.1.1');
  assert.strictEqual(handle.acquireSession(), true);
  assert.strictEqual(handle.acquireSession(), false);
  handle.releaseSession();
  assert.strictEqual(handle.acquireSession(), true);
});

test('release 幂等且計數不為負', () => {
  const guard = guardWith();
  const { handle } = guard.acquire('1.1.1.1');
  handle.release();
  handle.release();
  handle.release();
  assert.strictEqual(guard.activeClients, 0);
  assert.strictEqual(guard.trackedIpCount, 0);
  handle.releaseSession();
  assert.strictEqual(handle.acquireSession(), false);
});

test('缺少 ip 時仍以單一桶計數，不會拋錯', () => {
  const guard = guardWith({ maxClientsPerIp: 1 });
  assert.strictEqual(guard.acquire(undefined).allowed, true);
  assert.strictEqual(guard.acquire(undefined).reason, 'max-clients-per-ip');
});
