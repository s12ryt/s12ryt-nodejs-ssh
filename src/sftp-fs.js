// ===== SFTP 虛擬檔案系統工具（讓 SFTP 呈現方式貼近真實 VPS）=====
// 功能索引：
// 1. 機器根目錄    machineRoot → SSH_SFTP_ROOT 未設定時的 SFTP 虛擬根
// 2. 家目錄        homeDirectoryFor / ensureHomeDirectory → root → <root>/root，其他 → <root>/home/<user>；無法建立或不可存取時回傳 null
// 3. 擁有者名稱    createOwnerNames → 由 <root>/etc/passwd、etc/group 查 uid/gid 對應名稱
// 4. ls -l 字串    formatLongName → 權限（含 s/S/t/T）、連結數、擁有者、群組、大小、時間、-> 目標
// 5. 屬性變更      applyStatChanges → chmod / chown / utimes（路徑或檔案描述符）
import fs from 'node:fs';
import path from 'node:path';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SIX_MONTHS = 183 * 24 * 60 * 60 * 1000;

export function machineRoot(rootDir) {
  return path.parse(path.resolve(rootDir)).root;
}

export function homeDirectoryFor(root, username) {
  const valid = typeof username === 'string' && /^[^\0/\\]{1,64}$/.test(username);
  if (!valid || username === '.' || username === '..') {
    throw new Error(`Invalid username for home directory: ${username}`);
  }
  return username === 'root' ? path.join(root, 'root') : path.join(root, 'home', username);
}

function isUsableDirectory(directory) {
  try {
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.X_OK);
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

export function ensureHomeDirectory(root, username) {
  const home = homeDirectoryFor(root, username);
  if (isUsableDirectory(home)) return home;
  try {
    fs.mkdirSync(home, { recursive: true });
  } catch {
    // 無權限建立時交由呼叫端備援
  }
  return isUsableDirectory(home) ? home : null;
}

export function createOwnerNames(root) {
  const cache = new Map();
  const table = (relative) => {
    const file = path.join(root, relative);
    try {
      const mtime = fs.statSync(file).mtimeMs;
      let entry = cache.get(relative);
      if (!entry || entry.mtime !== mtime) {
        const names = new Map();
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
          const [name, , id] = line.split(':');
          if (name && /^\d+$/.test(id ?? '')) {
            names.set(Number(id), name);
          }
        }
        entry = { mtime, names };
        cache.set(relative, entry);
      }
      return entry.names;
    } catch {
      return cache.get(relative)?.names ?? new Map();
    }
  };
  return {
    owner(uid) {
      return table('etc/passwd').get(uid) ?? String(uid);
    },
    group(gid) {
      return table('etc/group').get(gid) ?? String(gid);
    }
  };
}

function permissionString(mode) {
  const marks = ['s', 's', 't'];
  return [6, 3, 0].map((shift, index) => [4, 2, 1].map((bit, position) => {
    const on = mode & (bit << shift);
    if (bit !== 1) {
      return on ? 'rw'[position] : '-';
    }
    const special = mode & (1 << (11 - index));
    if (!special) {
      return on ? 'x' : '-';
    }
    return on ? marks[index] : marks[index].toUpperCase();
  }).join('')).join('');
}

export function formatLongName(name, stats, owner, group, linkTarget) {
  const type = linkTarget ? 'l' : (stats.mode & 0o170000) === 0o040000 ? 'd' : '-';
  const date = new Date(stats.mtimeMs);
  const recent = Date.now() - stats.mtimeMs < SIX_MONTHS;
  const day = String(date.getDate()).padStart(2, '0');
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const when = recent ? clock : String(date.getFullYear()).padStart(5, ' ');
  const target = linkTarget ? ` -> ${linkTarget}` : '';
  const nlink = String(stats.nlink ?? 1).padStart(2, ' ');
  const size = String(stats.size).padStart(8, ' ');
  return `${type}${permissionString(stats.mode)} ${nlink} ${owner} ${group} ${size} ${MONTHS[date.getMonth()]} ${day} ${when} ${name}${target}`;
}

export function applyStatChanges(target, attrs, fd) {
  const failures = [];
  let applied = 0;
  const attempt = (operation) => {
    try {
      operation();
      applied += 1;
    } catch (error) {
      failures.push(error);
    }
  };
  if (attrs.mode !== undefined) {
    const mode = attrs.mode & 0o7777;
    attempt(() => (fd === undefined ? fs.chmodSync(target, mode) : fs.fchmodSync(fd, mode)));
  }
  if (attrs.uid !== undefined || attrs.gid !== undefined) {
    const uid = attrs.uid ?? -1;
    const gid = attrs.gid ?? -1;
    attempt(() => (fd === undefined ? fs.chownSync(target, uid, gid) : fs.fchownSync(fd, uid, gid)));
  }
  if (attrs.atime !== undefined && attrs.mtime !== undefined) {
    attempt(() => (fd === undefined
      ? fs.utimesSync(target, attrs.atime, attrs.mtime)
      : fs.futimesSync(fd, attrs.atime, attrs.mtime)));
  }
  return applied === 0 ? failures[0] ?? null : null;
}
