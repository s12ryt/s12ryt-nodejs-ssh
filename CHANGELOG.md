# Changelog

本專案的所有重大變更都會記錄於此。All notable changes to this project are documented here.

格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，版本號採用 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### Removed 移除

- 移除可選的 QEMU TCG Debian VM 與 rootless QEMU runtime：`VM_*` 環境變數、2223 guest SSH/SFTP、QMP graceful shutdown 與 Docker 內建的 QEMU 套件一併移除，專案回復為單一 Node.js SSH/SFTP server。Removed the optional QEMU VM and its rootless runtime; the project is an SSH/SFTP server only again.

### Fixed 修復

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

### Security 安全

- `auth`：未知使用者也會執行一次 dummy bcrypt 比對，消除可用於使用者列舉的時序側信道。Unknown usernames now run a dummy bcrypt comparison to remove a username-enumeration timing side channel.

### Added 新增

- 開源準備：README（中英雙語）、GPL-3.0 LICENSE、SECURITY.md、CONTRIBUTING.md、CODE_OF_CONDUCT.md、GitHub Actions CI。Open-source scaffolding.
- `command-runner` 新增逾時（exit 124）與啟動失敗的回歸測試。Regression tests for timeout and spawn failure.

## [0.1.0]

### Added 新增

- 初版 Node.js 20 SSH server：`ssh2` server、bcrypt 密碼認證、公鑰認證、白名單 `exec`、可選 `node-pty` 互動 shell、SFTP 根目錄沙箱、systemd 範本與整合測試。Initial release.
