import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCpuLimit } from '../src/vm-cpu-limit.js';

test('applyCpuLimit reports fallback when fractional cgroup control is unavailable', () => {
  const warnings = [];
  const result = applyCpuLimit(123, 1.5, { warn: (message, meta) => warnings.push({ message, meta }), info() {} }, {
    readFileSync: () => '0::/container\n',
    existsSync: () => false,
    mkdirSync() {},
    writeFileSync() {},
    rmdirSync() {}
  });

  assert.equal(result.enforced, false);
  assert.equal(warnings[0].meta.vcpus, 2);
});
