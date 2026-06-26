import path from 'node:path';

export function resolveInsideRoot(root, requestedPath = '.') {
  const normalizedRequest = requestedPath.replaceAll('\\', '/');
  const pathSegments = normalizedRequest.split('/').filter(Boolean);
  if (pathSegments.includes('..')) {
    throw new Error('Path escapes SFTP root');
  }

  const absolutePath = path.resolve(root, `.${path.posix.normalize(`/${normalizedRequest}`)}`);
  const relative = path.relative(root, absolutePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes SFTP root');
  }

  return absolutePath;
}
