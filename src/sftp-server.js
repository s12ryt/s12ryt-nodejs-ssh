import fs from 'node:fs';
import path from 'node:path';
import { constants } from 'node:fs';
import ssh2 from 'ssh2';
import { resolveInsideRoot } from './fs-safe.js';

const { OPEN_MODE, STATUS_CODE } = ssh2.utils.sftp;
const { OK, EOF, NO_SUCH_FILE, PERMISSION_DENIED, FAILURE } = STATUS_CODE;
const MAX_READ_LENGTH = 1024 * 1024;

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

export function attachSftpServer(sftp, root, logger, context = {}) {
  const handles = new Map();
  let nextHandleId = 1;

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

  function safeResolve(givenPath) {
    return resolveInsideRoot(root, givenPath || '.');
  }

  sftp.on('REALPATH', (reqid, givenPath) => {
    try {
      const absolutePath = safeResolve(givenPath);
      const relativePath = path.relative(root, absolutePath).replaceAll('\\', '/') || '.';
      sftp.name(reqid, [{ filename: `/${relativePath}`, longname: `/${relativePath}`, attrs: toAttrs(fs.statSync(absolutePath)) }]);
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
      const entries = fs.readdirSync(absolutePath, { withFileTypes: true }).map((dirent) => {
        const entryPath = path.join(absolutePath, dirent.name);
        const stats = fs.statSync(entryPath);
        return { filename: dirent.name, longname: toLongName(dirent.name, stats), attrs: toAttrs(stats) };
      });
      sftp.handle(reqid, createHandle({ type: 'dir', entries, offset: 0 }));
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
    if (entry.offset >= entry.entries.length) {
      sftp.status(reqid, EOF);
      return;
    }
    const batch = entry.entries.slice(entry.offset, entry.offset + 50);
    entry.offset += batch.length;
    sftp.name(reqid, batch);
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
    const buffer = Buffer.alloc(readLength);
    fs.read(entry.fd, buffer, 0, readLength, offset, (error, bytesRead) => {
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
      sftp.status(reqid, error ? statusForError(error) : OK);
    });
  });

  sftp.on('CLOSE', (reqid, handle) => {
    const entry = closeHandle(handle);
    if (!entry) {
      sftp.status(reqid, FAILURE);
      return;
    }
    if (entry.type === 'file') {
      fs.close(entry.fd, () => sftp.status(reqid, OK));
      return;
    }
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

  sftp.on('end', () => {
    for (const handle of handles.keys()) {
      const entry = handles.get(handle);
      if (entry?.type === 'file') {
        fs.closeSync(entry.fd);
      }
    }
    handles.clear();
    logger.info('SFTP session ended', { username: context.username });
  });
}
