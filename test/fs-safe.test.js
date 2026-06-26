import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveInsideRoot } from '../src/fs-safe.js';

test('resolveInsideRoot keeps normal paths inside root', () => {
  const root = path.resolve('tmp-root');
  assert.equal(resolveInsideRoot(root, 'nested/file.txt'), path.join(root, 'nested', 'file.txt'));
});

test('resolveInsideRoot blocks parent traversal', () => {
  const root = path.resolve('tmp-root');
  assert.throws(() => resolveInsideRoot(root, '../../secret.txt'), /escapes/);
});

test('resolveInsideRoot normalizes absolute SFTP paths into root', () => {
  const root = path.resolve('tmp-root');
  assert.equal(resolveInsideRoot(root, '/upload/a.txt'), path.join(root, 'upload', 'a.txt'));
});
