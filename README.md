# Node.js SSH Server

[![CI](https://github.com/s12ryt/s12ryt-nodejs-ssh/actions/workflows/ci.yml/badge.svg)](https://github.com/s12ryt/s12ryt-nodejs-ssh/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

> 生產級 Node.js 20 SSH server，支援密碼認證、公鑰認證、白名單命令執行與 SFTP。預設不開放互動式 shell，避免生產環境被當成任意遠端執行入口。
>
> A production-ready Node.js 20 SSH server with password / public-key auth, whitelisted command execution, and sandboxed SFTP. Interactive shell is disabled by default so the service cannot be turned into an arbitrary remote-execution endpoint.

繁體中文為主，每節附 English summary。

---

## 目錄 Table of Contents

- [功能 Features](#功能-features)
- [快速開始 Quick Start](#快速開始-quick-start)
- [正式環境設定 Production Setup](#正式環境設定-production-setup)
- [互動式 Shell Interactive Shell](#互動式-shell-interactive-shell)
- [命令白名單 Command Whitelist](#命令白名單-command-whitelist)
- [環境變數 Environment Variables](#環境變數-environment-variables)
- [專案結構 Project Structure](#專案結構-project-structure)
- [安全注意事項 Security Notes](#安全注意事項-security-notes)
- [驗證 Verification](#驗證-verification)
- [貢獻 Contributing](#貢獻-contributing)
- [授權 License](#授權-license)

---

## 功能 Features

- **SSH server**：使用 [`ssh2`](https://github.com/mscdex/ssh2)。Built on `ssh2`.
- **認證 Auth**：支援 bcrypt 密碼雜湊與 authorized keys 公鑰。bcrypt password hashes and authorized public keys.
- **命令執行 Command execution**：只允許 `config/commands.json` 白名單內的命令，以 `spawn(shell: false)` 執行避免注入。Only whitelisted commands run, spawned without a shell to prevent injection.
- **互動 shell Interactive shell**：可透過 `SSH_ENABLE_SHELL=true` 啟用，使用真實 PTY 支援互動程式與視窗 resize。Optional real-PTY shell behind an explicit flag.
- **SFTP**：所有檔案操作限制在 `SSH_SFTP_ROOT` 內，路徑逃逸會被擋下。All file operations are sandboxed to the SFTP root.
- **生產部署 Production**：環境變數設定、graceful shutdown、JSON log、最大連線數限制。Env-based config, graceful shutdown, JSON logs, max-connection limiting.

## 快速開始 Quick Start

```bash
npm install
npm run dev:setup
npm run generate:host-key
npm start
```

測試連線 Test the connection：

```bash
ssh -p 2222 deploy@127.0.0.1 whoami
sftp -P 2222 deploy@127.0.0.1
```

`npm run dev:setup` 會建立開發用帳號 `deploy / ChangeMe123!`，正式環境請立即替換。
`npm run dev:setup` creates a development account `deploy / ChangeMe123!`; replace it immediately in production.

## 正式環境設定 Production Setup

1. 複製 `.env.example` 為 `.env`。Copy `.env.example` to `.env`.
2. 執行 `npm run generate:host-key` 產生 host key。Generate the host key.
3. 執行 `npm run hash:password -- "你的強密碼"` 產生 bcrypt hash。Generate a bcrypt hash for your password.
4. 複製 `config/users.example.json` 為 `config/users.json`，填入使用者、密碼 hash 與公鑰。Fill in users, password hashes, and public keys.
5. 複製 `config/commands.example.json` 為 `config/commands.json`，只加入需要開放的命令。Add only the commands you want to expose.
6. 確認 `keys/`、`config/users.json`、`.env` 權限只有服務帳號可讀。Restrict file permissions so only the service account can read secrets.

> ⚠️ `config/users.json`、`config/commands.json`、`.env`、`keys/`、`storage/` 都已列入 `.gitignore`，請勿提交。These files are git-ignored and must never be committed.

## 互動式 Shell Interactive Shell

若需要互動式 shell，額外設定 If you need an interactive shell, also set：

```bash
SSH_ENABLE_SHELL=true
SSH_SHELL_PATH=/bin/bash
SSH_SHELL_CWD=./storage/sftp
```

未啟用時，shell request 會被拒絕，仍可使用白名單 `exec` 與 SFTP。
When disabled, shell requests are rejected while whitelisted `exec` and SFTP keep working.

## 命令白名單 Command Whitelist

```json
{
  "deploy-status": {
    "executable": "node",
    "args": ["scripts/status.js"],
    "allowClientArgs": false,
    "timeoutMs": 5000
  }
}
```

用戶端執行 `ssh -p 2222 deploy@host deploy-status` 時，只會執行上方設定。
Running `ssh -p 2222 deploy@host deploy-status` executes exactly the configuration above.

| 欄位 Field | 說明 Description |
| --- | --- |
| `executable` | 實際執行的程式（不經過 shell）。The binary to run (no shell). |
| `args` | 固定參數。Fixed arguments always passed. |
| `allowClientArgs` | 是否允許用戶端附加參數。Whether client-supplied args are appended. |
| `timeoutMs` | 逾時毫秒數，超時回退碼 124。Timeout in ms; exit code 124 on timeout. |

## 環境變數 Environment Variables

| 變數 Variable | 預設 Default | 說明 Description |
| --- | --- | --- |
| `SSH_HOST` | `0.0.0.0` | 監聽位址 Listen address |
| `SSH_PORT` | `2222` | 監聽埠 Listen port |
| `SSH_HOST_KEY_PATH` | `./keys/ssh_host_ed25519_key` | Host key 路徑 |
| `SSH_USERS_FILE` | `./config/users.json` | 使用者設定 Users file |
| `SSH_COMMANDS_FILE` | `./config/commands.json` | 命令白名單 Commands file |
| `SSH_SFTP_ROOT` | `./storage/sftp` | SFTP 根目錄 SFTP root |
| `SSH_ENABLE_SHELL` | `false` | 是否啟用互動 shell |
| `SSH_SHELL_PATH` | OS 預設 | 互動 shell 程式 |
| `SSH_SHELL_CWD` | 使用者家目錄 | 互動 shell 工作目錄 |
| `SSH_MAX_CLIENTS` | `3` | 最大同時連線數 Max clients |
| `SSH_READY_TIMEOUT_MS` | `20000` | 握手逾時 Handshake timeout |
| `SSH_LOG_LEVEL` | `info` | 日誌等級 Log level |

## 專案結構 Project Structure

| 路徑 Path | 用途 Purpose |
| --- | --- |
| `src/index.js` | 進入點與 graceful shutdown。Entry point and graceful shutdown. |
| `src/server.js` | SSH server 主流程與 session 路由。Main server flow and session routing. |
| `src/auth.js` | 密碼與公鑰認證。Password and public-key auth. |
| `src/command-runner.js` | 白名單命令執行。Whitelisted command execution. |
| `src/sftp-server.js` | SFTP 協議實作。SFTP protocol implementation. |
| `src/fs-safe.js` | SFTP 路徑沙箱。SFTP path sandboxing. |
| `src/shell-runner.js` | 可選 PTY 互動 shell。Optional PTY interactive shell. |
| `src/config.js` | 環境變數讀取與驗證。Env config loading/validation. |
| `src/logger.js` | JSON 結構化日誌。Structured JSON logging. |
| `scripts/` | 初始化、密碼雜湊、host key 產生工具。Setup utilities. |
| `config/` | 使用者與命令白名單設定範本。Config templates. |
| `test/` | 單元與整合測試。Unit and integration tests. |

## 安全注意事項 Security Notes

- 不要把 `keys/`、`.env`、`config/users.json`、`config/commands.json` 提交到版本控制。Never commit secrets.
- 不要在 `commands.json` 加入 shell 包裝器，例如 `sh -c`、`cmd /c`、`powershell -Command`。Do not add shell wrappers to the whitelist.
- 只有可信使用者才建議啟用 `SSH_ENABLE_SHELL=true`，因為互動 shell 等同開放該服務帳號的任意命令執行能力。Only enable the shell for trusted users.
- 若要開放參數，請只對低風險命令設定 `allowClientArgs: true`。Enable `allowClientArgs` only for low-risk commands.
- SFTP 根目錄建議放在獨立資料夾，並限制 OS 檔案權限。Keep the SFTP root isolated with strict OS permissions.
- 對外部署請搭配防火牆，只允許可信 IP 連線。Pair public deployments with IP allow-listing.

回報安全漏洞請見 [`SECURITY.md`](./SECURITY.md)。To report a vulnerability, see [`SECURITY.md`](./SECURITY.md).

## 驗證 Verification

```bash
npm run check
```

此指令會執行 Node 語法檢查與 `node --test`。Runs syntax checks plus the `node --test` suite.

## 貢獻 Contributing

歡迎 issue 與 PR，請先閱讀 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 與 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)。
Contributions are welcome—please read the contributing guide and code of conduct first.

## 授權 License

本專案採用 [GNU General Public License v3.0 (or later)](./LICENSE)。
Licensed under the GNU General Public License v3.0 (or later).
