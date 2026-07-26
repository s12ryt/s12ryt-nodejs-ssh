import fs from 'node:fs';
import path from 'node:path';
import { constants } from 'node:fs';
import ssh2 from 'ssh2';
import { resolveInsideRoot } from './fs-safe.js';
import { prootGuestPathToHost, prootHostPathToGuest } from './proot-paths.js';

const { OPEN_MODE, STATUS_CODE } = ssh2.utils.sftp;
const { OK, EOF, NO_SUCH_FILE, PERMISSION_DENIED, FAILURE } = STATUS_CODE;
const MAX_READ_LENGTH = 64 * 1024;
const DIRECTORY_BATCH_SIZE = 50;
const SFTP_REQUEST_EVENTS = [
  'REALPATH', 'STAT', 'LSTAT', 'OPENDIR', 'READDIR', 'OPEN', 'READ', 'WRITE',
  'CLOSE', 'REMOVE', 'MKDIR', 'RMDIR', 'RENAME'
];

function normalizedClientPath(absolutePath) {
  return absolutePath.replaceAll('\\', '/');
}

export function resolveSftpPath({ root, requestedPath = '.', followShellCwd = true, shellCwd, proot }) {
  if (!followShellCwd) {
    return resolveInsideRoot(root, requestedPath);
  }
  const basePath = shellCwd || root;
  if (proot) {
    const guestCwd = prootHostPathToGuest(proot, basePath) || proot.cwd || '/';
    const guestPath = requestedPath.startsWith('/')
      ? path.posix.resolve('/', requestedPath)
      : path.posix.resolve(guestCwd, requestedPath.replaceAll('\\', '/'));
    return prootGuestPathToHost(proot, guestPath);
  }
  return path.resolve(basePath, requestedPath.replaceAll('\\', '/'));
}

export function sftpClientPath(absolutePath, proot) {
  return prootHostPathToGuest(proot, absolutePath) || normalizedClientPath(absolutePath);
}

function toAttrs(stats) {
  return {
    mode: stats.mode,
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    gid: typeof process.getgid === 'function' ? process.getgid() : 0,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000)
  };
}

function toLongName(name, stats) {
  const type = stats.isDirectory() ? 'd' : '-';
  const size = String(stats.size).padStart(8, ' ');
  const date = stats.mtime.toISOString().slice(0, 10);
  return `${type}rw-r--r-- 1 owner group ${size} ${date} ${name}`;
}

function flagsToOpenFlags(flags) {
  if ((flags & OPEN_MODE.WRITE) && (flags & OPEN_MODE.READ)) {
    return (flags & OPEN_MODE.TRUNC) ? 'w+' : 'r+';
  }
  if (flags & OPEN_MODE.WRITE) {
    return (flags & OPEN_MODE.APPEND) ? 'a' : 'w';
  }
  return 'r';
}

function statusForError(error) {
  if (error.message === 'Path escapes SFTP root') {
    return PERMISSION_DENIED;
  }
  if (error.code === 'ENOENT') {
    return NO_SUCH_FILE;
  }
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    return PERMISSION_DENIED;
  }
  return FAILURE;
}

export function attachSftpServer(sftp, root, logger, context = {}, options = {}) {
  const handles = new Map();
  let nextHandleId = 1;
  const followShellCwd = options.followShellCwd ?? true;
  let closed = false;

  function createHandle(entry) {
    const handle = Buffer.alloc(4);
    handle.writeUInt32BE(nextHandleId, 0);
    nextHandleId = (nextHandleId + 1) >>> 0 || 1;
    handles.set(handle.toString('hex'), entry);
    return handle;
  }

  function getHandle(handle) {
    return handles.get(handle.toString('hex'));
  }

  function closeHandle(handle) {
    const key = handle.toString('hex');
    const entry = handles.get(key);
    handles.delete(key);
    return entry;
  }

  function closeEntry(entry) {
    if (!entry || entry.closed) {
      return;
    }
    entry.closed = true;
    try {
      if (entry.type === 'file') {
        fs.closeSync(entry.fd);
      } else if (entry.type === 'dir') {
        entry.directory.closeSync();
      }
    } catch (error) {
      if (error.code !== 'EBADF' && error.code !== 'ERR_DIR_CLOSED') {
        logger.warn('Failed to close SFTP handle', { username: context.username, error: error.message });
      }
    }
  }

  function cleanup() {
    if (closed) {
      return;
    }
    closed = true;
    sftp.off('end', cleanup);
    sftp.off('close', cleanup);
    sftp.off('error', onSftpError);
    for (const event of SFTP_REQUEST_EVENTS) {
      sftp.removeAllListeners(event);
    }
    for (const entry of handles.values()) {
      closeEntry(entry);
    }
    handles.clear();
    logger.info('SFTP session ended', { username: context.username });
  }

  function onSftpError(error) {
    logger.warn('SFTP session error', { username: context.username, error: error.message });
    cleanup();
  }

  function pathContext() {
    return options.getShellPathContext?.() || {
      cwd: options.getShellCwd?.() || options.defaultCwd || root,
      proot: undefined
    };
  }

  function safeResolve(givenPath, context = pathContext()) {
    return resolveSftpPath({
      root,
      requestedPath: givenPath || '.',
      followShellCwd,
      shellCwd: context.cwd || options.defaultCwd || root,
      proot: context.proot
    });
  }

  sftp.on('REALPATH', (reqid, givenPath) => {
    try {
      const context = pathContext();
      const absolutePath = safeResolve(givenPath, context);
      const clientPath = followShellCwd
        ? sftpClientPath(absolutePath, context.proot)
        : `/${path.relative(root, absolutePath).replaceAll('\\', '/') || '.'}`;
      sftp.name(reqid, [{ filename: clientPath, longname: clientPath, attrs: toAttrs(fs.statSync(absolutePath)) }]);
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  });

  sftp.on('STAT', (reqid, givenPath) => {
    try {
      sftp.attrs(reqid, toAttrs(fs.statSync(safeResolve(givenPath))));
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  });

  sftp.on('LSTAT', (reqid, givenPath) => {
    try {
      sftp.attrs(reqid, toAttrs(fs.lstatSync(safeResolve(givenPath))));
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  });

  sftp.on('OPENDIR', (reqid, givenPath) => {
    try {
      const absolutePath = safeResolve(givenPath);
      const directory = fs.opendirSync(absolutePath);
      sftp.handle(reqid, createHandle({ type: 'dir', directory, path: absolutePath, closed: false }));
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  });

  sftp.on('READDIR', (reqid, handle) => {
    const entry = getHandle(handle);
    if (!entry || entry.type !== 'dir') {
      sftp.status(reqid, FAILURE);
      return;
    }
    if (entry.eof) {
      sftp.status(reqid, EOF);
      return;
    }
    try {
      const batch = [];
      while (batch.length < DIRECTORY_BATCH_SIZE) {
        const dirent = entry.directory.readSync();
        if (!dirent) {
          entry.eof = true;
          closeEntry(entry);
          break;
        }
        const entryPath = path.join(entry.path, dirent.name);
        const stats = fs.statSync(entryPath);
        batch.push({ filename: dirent.name, longname: toLongName(dirent.name, stats), attrs: toAttrs(stats) });
      }
      if (batch.length === 0) {
        sftp.status(reqid, EOF);
        return;
      }
      sftp.name(reqid, batch);
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  });

  sftp.on('OPEN', (reqid, filename, flags) => {
    try {
      const absolutePath = safeResolve(filename);
      if (flags & OPEN_MODE.WRITE) {
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      }
      const fd = fs.openSync(absolutePath, flagsToOpenFlags(flags), constants.S_IRUSR | constants.S_IWUSR);
      sftp.handle(reqid, createHandle({ type: 'file', fd }));
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  });

  sftp.on('READ', (reqid, handle, offset, length) => {
    const entry = getHandle(handle);
    if (!entry || entry.type !== 'file') {
      sftp.status(reqid, FAILURE);
      return;
    }
    const readLength = Math.min(length, MAX_READ_LENGTH);
    const buffer = Buffer.allocUnsafe(readLength);
    fs.read(entry.fd, buffer, 0, readLength, offset, (error, bytesRead) => {
      if (closed) {
        return;
      }
      if (error) {
        sftp.status(reqid, statusForError(error));
        return;
      }
      if (bytesRead === 0) {
        sftp.status(reqid, EOF);
        return;
      }
      sftp.data(reqid, buffer.subarray(0, bytesRead));
    });
  });

  sftp.on('WRITE', (reqid, handle, offset, data) => {
    const entry = getHandle(handle);
    if (!entry || entry.type !== 'file') {
      sftp.status(reqid, FAILURE);
      return;
    }
    fs.write(entry.fd, data, 0, data.length, offset, (error) => {
      if (closed) {
        return;
      }
      sftp.status(reqid, error ? statusForError(error) : OK);
    });
  });

  sftp.on('CLOSE', (reqid, handle) => {
    const entry = closeHandle(handle);
    if (!entry) {
      sftp.status(reqid, FAILURE);
      return;
    }
    closeEntry(entry);
    sftp.status(reqid, OK);
  });

  sftp.on('REMOVE', (reqid, filename) => {
    try {
      fs.unlink(safeResolve(filename), (error) => sftp.status(reqid, error ? statusForError(error) : OK));
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  });

  sftp.on('MKDIR', (reqid, givenPath) => {
    try {
      fs.mkdir(safeResolve(givenPath), { recursive: false }, (error) => sftp.status(reqid, error ? statusForError(error) : OK));
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  });

  sftp.on('RMDIR', (reqid, givenPath) => {
    try {
      fs.rmdir(safeResolve(givenPath), (error) => sftp.status(reqid, error ? statusForError(error) : OK));
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  });

  sftp.on('RENAME', (reqid, oldPath, newPath) => {
    try {
      fs.rename(safeResolve(oldPath), safeResolve(newPath), (error) => sftp.status(reqid, error ? statusForError(error) : OK));
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  });

  sftp.once('end', cleanup);
  sftp.once('close', cleanup);
  sftp.once('error', onSftpError);
}
