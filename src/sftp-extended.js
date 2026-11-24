// ===== SFTP 進階檔案操作（補齊真實主機的連結與屬性調整能力）=====
// 功能索引：
// 1. 事件清單      EXTENDED_SFTP_EVENTS → 供 SFTP session 結束時移除 listener
// 2. 掛載          attachExtendedSftpOperations → 註冊下列事件，路徑一律經 safeResolve 解析
// 3. 符號連結      READLINK / SYMLINK（目標字串原樣保存，等同 ln -s）
// 4. 硬連結        LINK（等同 ln）
// 5. 屬性調整      SETSTAT / FSETSTAT → chmod / chown / utimes（FSETSTAT 僅接受檔案 handle）
import fs from 'node:fs';
import ssh2 from 'ssh2';
import { applyStatChanges } from './sftp-fs.js';

const { STATUS_CODE } = ssh2.utils.sftp;
const text = (value) => (Buffer.isBuffer(value) ? value.toString() : String(value));

export const EXTENDED_SFTP_EVENTS = ['READLINK', 'SYMLINK', 'LINK', 'SETSTAT', 'FSETSTAT'];

export function attachExtendedSftpOperations(sftp, { safeResolve, getHandle, toAttrs, statusForError }) {
  const reply = (reqid, operation) => {
    try {
      operation();
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  };

  sftp.on('READLINK', (reqid, linkPath) => {
    try {
      const absolutePath = safeResolve(linkPath);
      const target = fs.readlinkSync(absolutePath);
      sftp.name(reqid, [{ filename: target, longname: target, attrs: toAttrs(fs.lstatSync(absolutePath)) }]);
    } catch (error) {
      sftp.status(reqid, statusForError(error));
    }
  });

  sftp.on('SYMLINK', (reqid, targetPath, linkPath) =>
    reply(reqid, () => fs.symlinkSync(text(targetPath), safeResolve(linkPath), 'file')));

  sftp.on('LINK', (reqid, targetPath, linkPath) =>
    reply(reqid, () => fs.linkSync(safeResolve(targetPath), safeResolve(linkPath))));

  sftp.on('SETSTAT', (reqid, givenPath, attrs) =>
    reply(reqid, () => {
      const error = applyStatChanges(safeResolve(givenPath), attrs);
      if (error) {
        throw error;
      }
    }));

  sftp.on('FSETSTAT', (reqid, handle, attrs) => {
    const entry = getHandle(handle);
    if (!entry || entry.type !== 'file') {
      sftp.status(reqid, STATUS_CODE.FAILURE);
      return;
    }
    reply(reqid, () => {
      const error = applyStatChanges(undefined, attrs, entry.fd);
      if (error) {
        throw error;
      }
    });
  });
}
