# Changelog

本專案的所有重大變更都會記錄於此。All notable changes to this project are documented here.

格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，版本號採用 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### Fixed 修復

- \.env.example\ / \.env\ 補上先前遺漏的 \SSH_SFTP_FOLLOW_SHELL_CWD\（程式讀取但文件未記載的沙箱逃逸開關），並分區註解、標註 host key fallback 演算法與 bootstrap 憑證的 72 bytes 上限。新增 \	est/env-example.test.js\ 守衛，確保原始碼讀取的每個 \SSH_*\ 變數都必須記載於 \.env.example\、限額預設值與 \src/config.js\ 一致、且不得殘留 QEMU/VM 變數。
  \.env.example\ and \.env\ now document \SSH_SFTP_FOLLOW_SHELL_CWD\, grouped by concern, with host key fallback and 72-byte credential notes. \	est/env-example.test.js\ guards env coverage, default parity with \src/config.js\, and absence of removed QEMU variables.

- 修正 `loadConfig()` 在 `SSH_SFTP_ROOT` 未設定時對機器根目錄呼叫 `mkdirSync`，Windows 會以 `EPERM` 中止 `npm start` 的缺陷。Fixed `loadConfig()` calling `mkdirSync` on the machine root, which aborted `npm start` with `EPERM` on Windows.
- `start.js` 不再以過時的 `./s12ryt` 作為 `SSH_SFTP_ROOT` 預設值，與 `src/config.js` 的機器根語意對齊。`start.js` no longer hardcodes the stale `./s12ryt` default for `SSH_SFTP_ROOT`.
- `SSH_DEFAULT_PASSWORD` 新增 bcrypt 72 byte 上限檢查，避免先寫出 `config/users.json` 才在 `normalizeUsers()` 拋錯。Added the bcrypt 72-byte limit to `SSH_DEFAULT_PASSWORD` so startup fails before writing `config/users.json`.

### Security 安全

- host key fallback 由 RSA 改為 `ecdsa-sha2-nistp256`；RSA 金鑰會讓 ssh2 把 SHA-1 的 `ssh-rsa` 重新加回 `serverHostKey` 清單，繞過硬化後的演算法白名單。Replaced the RSA host-key fallback with `ecdsa-sha2-nistp256` because an RSA key made ssh2 re-advertise SHA-1 `ssh-rsa`.

- 升級 runtime 到 Node.js 24 LTS：`Dockerfile` 兩個 stage、`package.json` engines、CI matrix 與 README badge 全面脫離 2026-04-30 已 EOL 的 Node 20，避開含 CISA KEV 項目 CVE-2026-111497（Brotli decoder buffer overflow）在內的三輪未修補安全發行。Moved the runtime off EOL Node 20 to Node.js 24 LTS.
- 將 `ssh2` 釘選在精確版本 `1.16.0`，規避只影響 1.17.0 且上游尚無修補的 CVE-2025-70034（ReDoS，CWE-1333）。Pinned `ssh2` to 1.16.0 to avoid CVE-2025-70034.
- 修正認證時序側信道：未知帳號使用的 dummy bcrypt hash cost 由 10 對齊真實使用者的 12，避免以回應時間列舉帳號。Aligned the dummy bcrypt cost with real users to stop username enumeration.
- 密碼明確限制 UTF-8 72 bytes：`normalizeUsers` 與 `verifyPassword` 兩側都拒絕超長密碼，阻斷 bcrypt 靜默截斷造成的認證繞過語意（CVE-2025-22228 類）。Rejected passwords over 72 UTF-8 bytes on both hashing and verification paths.
- 新增 `src/connection-guard.js` 連線守衛：全域連線上限、per-IP 上限、單一連線認證失敗上限（超過即斷線）與 per-connection channel 上限，並把 `SSH_MAX_CLIENTS` 預設由 `3` 提高到 `64`，消除 3 條閒置連線即可癱瘓服務的問題。Added global/per-IP connection, auth-failure and channel limits.
- SSH server 顯式設定 `algorithms` 白名單（curve25519/ECDH、ChaCha20-Poly1305 與 AES-GCM/CTR、SHA-2 ETM MAC），不再依賴 `ssh2` 預設清單。Pinned an explicit algorithm allow-list.
- 供應鏈流程補強：CI 加入 `npm audit --audit-level=high` gate、GHCR workflow 推送前以 Trivy 掃描 CRITICAL/HIGH 漏洞、新增 `.github/dependabot.yml` 監控 npm、GitHub Actions 與 Docker base image。Added an audit gate, Trivy image scanning and Dependabot.

### Removed 移除

- 移除可選的 QEMU TCG Debian VM 與 rootless QEMU runtime：`VM_*` 環境變數、2223 guest SSH/SFTP、QMP graceful shutdown 與 Docker 內建的 QEMU 套件一併移除，專案回復為單一 Node.js SSH/SFTP server。Removed the optional QEMU VM and its rootless runtime; the project is an SSH/SFTP server only again.

### Changed 變更

- `sftp-server` / `config` / `server`：SFTP 登入改為落在使用者家目錄（`root` → `/root`，其他 → `/home/<帳號>`，自動建立），`SSH_SFTP_ROOT` 未設定時虛擬根目錄即機器根目錄；沙箱模式可用 `..` 回到上層（正規化後仍限制在根目錄內）。SFTP sessions now start in the user home directory, default to the machine root and resolve `..` inside the sandbox like a chroot.
- 互動 shell 改以使用者家目錄啟動（`root` → `/root`，其他 → `/home/<帳號>`，自動建立），與 SFTP 一致；移除 `SSH_SHELL_CWD` 設定與 `s12ryt/` 工作區的建立、忽略規則與 Docker 掛載說明。Interactive shells now start in the user home directory; the `SSH_SHELL_CWD` setting and the `s12ryt/` workspace are gone.

### Fixed 修復

- \.env.example\ / \.env\ 補上先前遺漏的 \SSH_SFTP_FOLLOW_SHELL_CWD\（程式讀取但文件未記載的沙箱逃逸開關），並分區註解、標註 host key fallback 演算法與 bootstrap 憑證的 72 bytes 上限。新增 \	est/env-example.test.js\ 守衛，確保原始碼讀取的每個 \SSH_*\ 變數都必須記載於 \.env.example\、限額預設值與 \src/config.js\ 一致、且不得殘留 QEMU/VM 變數。
  \.env.example\ and \.env\ now document \SSH_SFTP_FOLLOW_SHELL_CWD\, grouped by concern, with host key fallback and 72-byte credential notes. \	est/env-example.test.js\ guards env coverage, default parity with \src/config.js\, and absence of removed QEMU variables.

- `command-runner` / `shell-runner`：SSH channel 中斷時解除 pipe/listener、清除 timer 並終止 child/PTY；命令忽略 `SIGTERM` 時會升級 `SIGKILL`，避免斷線或逾時後程序持續佔用資源。Release exec and PTY resources on disconnect and force-kill commands that ignore timeout termination.
- `sftp-server`：channel 的 `end`/`close`/`error` 統一關閉全部 file/dir handles；目錄改為每批 50 筆串流讀取，單次 file read 降至 64 KiB，避免大型目錄與並行讀取造成記憶體尖峰。Stream directory entries and close every SFTP handle on all channel termination paths.
- `proot-paths` / `shell-runner` / `sftp-server`：自動從 Linux 前景程序的 `PROOT_CONFIG` 偵測 Mytai20100/freeroot，解析 `proot.yml` 的 rootfs/cwd/bindings，讓 SFTP guest 路徑與 FreeRoot 實體檔案雙向映射。Added automatic FreeRoot PRoot guest/host path translation.
- `sftp-server` / `shell-runner`：新增預設開啟的 `SSH_SFTP_FOLLOW_SHELL_CWD`；同一 SSH connection 的 SFTP 相對路徑會動態跟隨 Linux shell 前景程序 cwd，絕對路徑可直接存取容器檔案系統，關閉設定時保留原 SFTP root 沙箱。Added same-connection shell cwd tracking for SFTP with an opt-out sandbox mode.
- `shell-runner`：依 Node.js 程序的實際 OS UID 設定 `USER`、`LOGNAME`、`HOME`；有效 UID 為 0 時使用 `/root`，修復 FeatherPanel root shell 仍把腳本寫到 `/home/container` 的問題。Derive shell identity variables from the real process UID and use `/root` for effective UID 0.
- `shell-runner`：Linux/macOS 未指定 `SSH_SHELL_PATH` 時改為優先使用 Bash/Zsh，並把 `SHELL` 環境變數同步為實際 shell，修復 `/bin/sh` 導致方向鍵歷史與 `bash <(curl ...)` 類腳本不相容的問題。Prefer Bash/Zsh for default POSIX interactive shells and expose the selected shell via `SHELL`.
- `start` / `generate:host-key`：當 `ssh-keygen` 在 FeatherPanel 等容器中因 `No user exists for uid ...` 失敗時，改用 Node.js crypto 產生 RSA host key，避免啟動前直接崩潰。Added Node.js crypto host-key fallback when `ssh-keygen` fails in containers with unmapped UIDs.
- `shell-runner`：將 PTY 依賴從 `node-pty` 換成 `@homebridge/node-pty-prebuilt-multiarch`，保留互動 shell 並優先使用預編譯 binary，降低 FeatherPanel 低磁碟容器內 node-gyp rebuild 失敗機率。Switched the PTY dependency to a prebuilt multiarch package to keep interactive shells while reducing low-disk install failures.
- `sftp-server`：handle ID 由 `handles.size + 1` 改為單調遞增計數器，修復刪除 handle 後 ID 重用導致的 entry 覆蓋與檔案描述符洩漏。Fixed SFTP handle ID reuse causing entry collisions and fd leaks.
- `command-runner`：以 `settled` 旗標避免 `error` 與 `close` 重複呼叫 exit；timeout 統一回退碼 124（對齊 GNU `timeout`），純 signal 結束回 1。Hardened exit handling and standardized timeout exit code to 124.
- `logger`：調整欄位合併順序，避免 meta 覆蓋系統欄位（`time`/`level`/`message`）。Prevented metadata from overriding reserved log fields.
- `shell-runner`：互動 shell 退出後加上 `exited` 防護，避免對已結束 stream 的 write-after-end。Guarded against write-after-end after shell exit.

### Fixed 修復

- \.env.example\ / \.env\ 補上先前遺漏的 \SSH_SFTP_FOLLOW_SHELL_CWD\（程式讀取但文件未記載的沙箱逃逸開關），並分區註解、標註 host key fallback 演算法與 bootstrap 憑證的 72 bytes 上限。新增 \	est/env-example.test.js\ 守衛，確保原始碼讀取的每個 \SSH_*\ 變數都必須記載於 \.env.example\、限額預設值與 \src/config.js\ 一致、且不得殘留 QEMU/VM 變數。
  \.env.example\ and \.env\ now document \SSH_SFTP_FOLLOW_SHELL_CWD\, grouped by concern, with host key fallback and 72-byte credential notes. \	est/env-example.test.js\ guards env coverage, default parity with \src/config.js\, and absence of removed QEMU variables.

- 修正 `loadConfig()` 在 `SSH_SFTP_ROOT` 未設定時對機器根目錄呼叫 `mkdirSync`，Windows 會以 `EPERM` 中止 `npm start` 的缺陷。Fixed `loadConfig()` calling `mkdirSync` on the machine root, which aborted `npm start` with `EPERM` on Windows.
- `start.js` 不再以過時的 `./s12ryt` 作為 `SSH_SFTP_ROOT` 預設值，與 `src/config.js` 的機器根語意對齊。`start.js` no longer hardcodes the stale `./s12ryt` default for `SSH_SFTP_ROOT`.
- `SSH_DEFAULT_PASSWORD` 新增 bcrypt 72 byte 上限檢查，避免先寫出 `config/users.json` 才在 `normalizeUsers()` 拋錯。Added the bcrypt 72-byte limit to `SSH_DEFAULT_PASSWORD` so startup fails before writing `config/users.json`.

### Security 安全

- host key fallback 由 RSA 改為 `ecdsa-sha2-nistp256`；RSA 金鑰會讓 ssh2 把 SHA-1 的 `ssh-rsa` 重新加回 `serverHostKey` 清單，繞過硬化後的演算法白名單。Replaced the RSA host-key fallback with `ecdsa-sha2-nistp256` because an RSA key made ssh2 re-advertise SHA-1 `ssh-rsa`.

- `auth`：未知使用者也會執行一次 dummy bcrypt 比對，消除可用於使用者列舉的時序側信道。Unknown usernames now run a dummy bcrypt comparison to remove a username-enumeration timing side channel.

### Added 新增

- 開源準備：README（中英雙語）、GPL-3.0 LICENSE、SECURITY.md、CONTRIBUTING.md、CODE_OF_CONDUCT.md、GitHub Actions CI。Open-source scaffolding.
- `command-runner` 新增逾時（exit 124）與啟動失敗的回歸測試。Regression tests for timeout and spawn failure.
- `sftp-fs` / `sftp-extended` / `sftp-server`：SFTP 回報真實 uid/gid 與權限，清單採 `ls -l` 格式（由 `/etc/passwd`、`/etc/group` 解析擁有者與群組，顯示符號連結目標），並新增 READLINK、SYMLINK、LINK、SETSTAT、FSETSTAT（chmod / chown / utime）。SFTP now reports real ownership, lists entries in `ls -l` style and supports symlinks, hard links and attribute changes.

## [0.1.0]

### Added 新增

- 初版 Node.js 20 SSH server：`ssh2` server、bcrypt 密碼認證、公鑰認證、白名單 `exec`、可選 `node-pty` 互動 shell、SFTP 根目錄沙箱、systemd 範本與整合測試。Initial release.
