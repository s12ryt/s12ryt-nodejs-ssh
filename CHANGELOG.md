# Changelog

本專案的所有重大變更都會記錄於此。All notable changes to this project are documented here.

格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，版本號採用 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### Fixed 修復

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
