import path from 'node:path';

function scalarValue(rawValue) {
  const value = rawValue.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseBinding(rawBinding) {
  const binding = scalarValue(rawBinding);
  const separator = binding.lastIndexOf(':/');
  const hostPath = separator === -1 ? binding : binding.slice(0, separator);
  const guestPath = (separator === -1 ? binding : binding.slice(separator + 1)).replace(/!$/, '');
  if (!path.isAbsolute(hostPath) || !guestPath.startsWith('/')) {
    return undefined;
  }
  return {
    hostPath: path.resolve(hostPath),
    guestPath: path.posix.normalize(guestPath)
  };
}

export function parseProotConfig(configText) {
  let rootfs;
  let cwd = '/';
  let readingBindings = false;
  const bindings = [];

  for (const line of String(configText).split(/\r?\n/)) {
    const rootfsMatch = line.match(/^rootfs:\s*(.+)$/);
    if (rootfsMatch) {
      rootfs = scalarValue(rootfsMatch[1]);
      readingBindings = false;
      continue;
    }
    const cwdMatch = line.match(/^cwd:\s*(.+)$/);
    if (cwdMatch) {
      cwd = scalarValue(cwdMatch[1]);
      readingBindings = false;
      continue;
    }
    if (/^bindings:\s*$/.test(line)) {
      readingBindings = true;
      continue;
    }
    if (readingBindings) {
      const bindingMatch = line.match(/^\s+-\s+(.+)$/);
      if (bindingMatch) {
        const parsedBinding = parseBinding(bindingMatch[1]);
        if (parsedBinding) {
          bindings.push(parsedBinding);
        }
        continue;
      }
      if (line.trim() && !line.trimStart().startsWith('#')) {
        readingBindings = false;
      }
    }
  }

  if (!rootfs || !path.isAbsolute(rootfs)) {
    return undefined;
  }
  return {
    rootfs: path.resolve(rootfs),
    cwd: cwd.startsWith('/') ? path.posix.normalize(cwd) : '/',
    bindings
  };
}

function pathWithin(basePath, targetPath) {
  const relative = path.relative(basePath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function guestPathWithin(basePath, targetPath) {
  const relative = path.posix.relative(basePath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.posix.isAbsolute(relative));
}

export function prootGuestPathToHost(proot, guestPath) {
  const normalizedGuestPath = path.posix.resolve('/', guestPath);
  const binding = [...proot.bindings]
    .sort((left, right) => right.guestPath.length - left.guestPath.length)
    .find((candidate) => guestPathWithin(candidate.guestPath, normalizedGuestPath));

  if (binding) {
    const relative = path.posix.relative(binding.guestPath, normalizedGuestPath);
    return path.resolve(binding.hostPath, ...relative.split('/').filter(Boolean));
  }
  const relative = path.posix.relative('/', normalizedGuestPath);
  return path.resolve(proot.rootfs, ...relative.split('/').filter(Boolean));
}

export function prootHostPathToGuest(proot, hostPath) {
  if (!proot) {
    return undefined;
  }
  const normalizedHostPath = path.resolve(hostPath);
  const binding = [...proot.bindings]
    .sort((left, right) => right.hostPath.length - left.hostPath.length)
    .find((candidate) => pathWithin(candidate.hostPath, normalizedHostPath));

  if (binding) {
    const relative = path.relative(binding.hostPath, normalizedHostPath).replaceAll('\\', '/');
    return path.posix.resolve(binding.guestPath, relative);
  }
  if (!pathWithin(proot.rootfs, normalizedHostPath)) {
    return undefined;
  }
  const relative = path.relative(proot.rootfs, normalizedHostPath).replaceAll('\\', '/');
  return path.posix.resolve('/', relative);
}
