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
- [Container Image](#container-image)
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
- **互動 shell Interactive shell**：預設啟用，使用真實 PTY 支援互動程式與視窗 resize，工作目錄預設為 `s12ryt/`。Real-PTY shell enabled by default with `s12ryt/` as the default workspace.
- **SFTP**：所有檔案操作限制在 `SSH_SFTP_ROOT` 內，路徑逃逸會被擋下。All file operations are sandboxed to the SFTP root.
- **生產部署 Production**：環境變數設定、graceful shutdown、JSON log、最大連線數限制。Env-based config, graceful shutdown, JSON logs, max-connection limiting.

## 快速開始 Quick Start

```bash
npm install
npm start
```

測試連線 Test the connection：

```bash
ssh -p 2222 deploy@127.0.0.1 whoami
sftp -P 2222 deploy@127.0.0.1
```

`npm start` 會透過 `start.js` 自動建立缺少的 `.env`、`config/commands.json`、開發用 `config/users.json`、`s12ryt/` 工作目錄與 SSH host key，再啟動 server。
`npm start` uses `start.js` to create missing `.env`, `config/commands.json`, development `config/users.json`, the `s12ryt/` workspace, and the SSH host key before starting the server.

預設開發帳號為 `.env` 的 `SSH_DEFAULT_USERNAME` / `SSH_DEFAULT_PASSWORD`。正式環境設定 `NODE_ENV=production` 時，若缺少 `config/users.json` 會直接中止，不會自動建立預設密碼帳號。
The default development account is `SSH_DEFAULT_USERNAME` / `SSH_DEFAULT_PASSWORD` from `.env`. With `NODE_ENV=production`, missing `config/users.json` stops startup instead of creating a default-password account.

若已存在 `config/users.json`，修改 `SSH_DEFAULT_USERNAME` 或 `SSH_DEFAULT_PASSWORD` 不會覆蓋既有帳號；請手動更新 `config/users.json` 的 `username` 或 `password`。
If `config/users.json` already exists, changing `SSH_DEFAULT_USERNAME` or `SSH_DEFAULT_PASSWORD` does not overwrite existing users; update `username` or `password` in `config/users.json` manually.

## 正式環境設定 Production Setup

1. 複製 `.env.example` 為 `.env`。Copy `.env.example` to `.env`.
2. 執行 `npm run generate:host-key` 產生 host key。Generate the host key.
3. 複製 `config/users.example.json` 為 `config/users.json`，填入使用者、密碼與公鑰。Fill in users, passwords, and public keys.
4. 複製 `config/commands.example.json` 為 `config/commands.json`，只加入需要開放的命令。Add only the commands you want to expose.
5. 確認 `keys/`、`config/users.json`、`.env` 權限只有服務帳號可讀。Restrict file permissions so only the service account can read secrets.

也可以執行 `npm start` 讓 `start.js` 補齊非敏感範本與 host key；正式環境仍需先自行建立 `config/users.json`。
You can also run `npm start` so `start.js` fills non-sensitive templates and the host key; production still requires you to create `config/users.json` first.

> ⚠️ `config/users.json`、`config/commands.json`、`.env`、`keys/`、`storage/` 都已列入 `.gitignore`，請勿提交。These files are git-ignored and must never be committed.

### 建立 `config/users.json` Create Users File

`users.json` 是 SSH 登入帳號清單。新建使用者時可以直接填 `password` 明文；server 第一次載入時會自動把它轉成 bcrypt hash 並寫回同一個 `password` 欄位。
`users.json` stores SSH login accounts. For a new user, put the plaintext value in `password`; on first load, the server automatically converts it to a bcrypt hash and writes it back to the same `password` field.

建立檔案 Create the file:

```bash
cp config/users.example.json config/users.json
```

最小範例 Minimal example:

```json
[
  {
    "username": "root",
    "password": "ChangeMe123!",
    "authorizedKeys": []
  }
]
```

啟動後會自動變成類似下面這樣。After startup it is rewritten like this:

```json
[
  {
    "username": "root",
    "password": "$2a$12$exampleHashGeneratedByTheServer",
    "authorizedKeys": []
  }
]
```

連線帳號要對應 `username`。The SSH login name must match `username`:

```bash
ssh -p 2222 root@127.0.0.1 whoami
sftp -P 2222 root@127.0.0.1
```

新增多個使用者時，在陣列中加入多筆物件。To add multiple users, add multiple objects:

```json
[
  {
    "username": "root",
    "password": "ChangeMe123!",
    "authorizedKeys": []
  },
  {
    "username": "deploy",
    "password": "AnotherStrongPassword123!",
    "authorizedKeys": [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleReplaceThisKey deploy@example"
    ]
  }
]
```

欄位說明 Field reference:

| 欄位 Field | 必填 Required | 說明 Description |
| --- | --- | --- |
| `username` | 是 Yes | SSH 連線用戶名，例如 `root` 對應 `ssh root@host -p 2222`。SSH login username. |
| `password` | 否 No | 密碼或已產生的 bcrypt hash；明文至少 8 字元，啟動後會自動 hash。Plain password or bcrypt hash; plaintext must be at least 8 characters and is auto-hashed on startup. |
| `authorizedKeys` | 否 No | SSH 公鑰清單；不用公鑰登入時可填空陣列。SSH public keys; use an empty array when not using key auth. |

注意事項 Notes:

- 不要再使用 `passwordHash`；舊檔案仍會自動遷移成 `password`，但新檔案請只填 `password`。
- `password` 欄位若已是 bcrypt hash，server 不會重複 hash。
- 修改密碼時，可以直接把 `password` 改回新的明文密碼，重啟 server 後會自動 hash。
- 正式環境請限制 `config/users.json` 權限，因為第一次啟動前檔案內可能短暫含有明文密碼。
- Do not use `passwordHash` for new files; legacy files are migrated automatically.
- If `password` is already a bcrypt hash, the server will not hash it again.
- To change a password, replace `password` with a new plaintext password and restart the server.
- Restrict `config/users.json` permissions in production because it may briefly contain plaintext before first startup.

## 互動式 Shell Interactive Shell

互動式 shell 預設開啟，使用者登入後的工作目錄預設是專案內的 `s12ryt/`。例如在 SSH 裡執行 `npm install`、下載檔案或建立專案，檔案會落在 `{project}/s12ryt`。
Interactive shell is enabled by default, and the default working directory is the project-local `s12ryt/` directory. Files created by commands such as `npm install`, downloads, or generated projects are placed under `{project}/s12ryt`.

可用以下環境變數調整 shell 行為。You can tune shell behavior with these variables:

```bash
SSH_ENABLE_SHELL=true
SSH_SHELL_PATH=/bin/bash
SSH_SHELL_CWD=./s12ryt
```

Windows 不會被模擬成 Linux；若未指定 `SSH_SHELL_PATH`，Windows 會使用系統預設 shell，Linux/macOS 會使用 `/bin/sh` 或 `$SHELL`。你已要求不要使用 WSL，所以這裡不會啟動 WSL。
Windows is not emulated as Linux. Without `SSH_SHELL_PATH`, Windows uses the system default shell, while Linux/macOS use `/bin/sh` or `$SHELL`. WSL is not used.

若關閉 shell，shell request 會被拒絕，仍可使用白名單 `exec` 與 SFTP。
When shell is disabled, shell requests are rejected while whitelisted `exec` and SFTP keep working.

若使用 `ssh2` client 呼叫 `client.shell()`，請先檢查 callback 的 `error`；預設未啟用 shell 時 `stream` 會是 `undefined`，直接呼叫 `stream.setEncoding()` 會造成 `TypeError`。
When using the `ssh2` client with `client.shell()`, check the callback `error` first. With shell disabled by default, `stream` is `undefined`; calling `stream.setEncoding()` directly will throw `TypeError`.

```js
client.shell((error, stream) => {
  if (error) {
    throw error;
  }
  stream.setEncoding('utf8');
});
```

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
| `SSH_DEFAULT_USERNAME` | `deploy` | 自動建立開發用 `config/users.json` 時使用的連線帳號，例如 `root`。Username used only when auto-creating the development users file. |
| `SSH_DEFAULT_PASSWORD` | `ChangeMe123!` | 自動建立開發用 `config/users.json` 時使用的初始密碼，至少 8 字元；server 首次載入後會自動 hash。Initial password for the auto-created development users file, minimum 8 characters; auto-hashed on first server load. |
| `SSH_HOST_KEY_PATH` | `./keys/ssh_host_ed25519_key` | Host key 路徑 |
| `SSH_USERS_FILE` | `./config/users.json` | 使用者設定 Users file |
| `SSH_COMMANDS_FILE` | `./config/commands.json` | 命令白名單 Commands file |
| `SSH_SFTP_ROOT` | `./s12ryt` | SFTP 根目錄 SFTP root |
| `SSH_ENABLE_SHELL` | `true` | 是否啟用互動 shell |
| `SSH_SHELL_PATH` | OS 預設 | 互動 shell 程式 |
| `SSH_SHELL_CWD` | `./s12ryt` | 互動 shell 工作目錄 |
| `SSH_MAX_CLIENTS` | `3` | 最大同時連線數 Max clients |
| `SSH_READY_TIMEOUT_MS` | `20000` | 握手逾時 Handshake timeout |
| `SSH_LOG_LEVEL` | `info` | 日誌等級 Log level |

## Container Image

每次 push 到 `main` 或推送 `v*.*.*` tag 時，GitHub Actions 會自動建置並推送 GHCR image。
GitHub Actions automatically builds and pushes the GHCR image on pushes to `main` and `v*.*.*` tags.

```bash
docker pull ghcr.io/s12ryt/s12ryt-nodejs-ssh:latest
```

常用執行範例 Example run:

```bash
docker run --rm -p 2222:2222 \
  -v ./config/users.json:/app/config/users.json:ro \
  -v ./config/commands.json:/app/config/commands.json:ro \
  -v ./keys:/app/keys \
  -v ./s12ryt:/app/s12ryt \
  ghcr.io/s12ryt/s12ryt-nodejs-ssh:latest
```

正式環境請自行掛載 `config/users.json`、`config/commands.json`、`keys/` 與 `s12ryt/`；不要把真實密碼、公鑰、host key 或使用者工作檔案 bake 進 image。
Mount `config/users.json`, `config/commands.json`, `keys/`, and `s12ryt/` in production; do not bake real credentials, host keys, or user workspace files into the image.

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
| `.github/workflows/ghcr.yml` | 自動建置並推送 GHCR container image。Builds and pushes the GHCR container image. |
| `test/` | 單元與整合測試。Unit and integration tests. |

## 安全注意事項 Security Notes

- 不要把 `keys/`、`.env`、`config/users.json`、`config/commands.json` 提交到版本控制。Never commit secrets.
- `s12ryt/` 是使用者 SSH/SFTP 工作目錄，可能包含下載、安裝或產生的檔案，預設已忽略。`s12ryt/` is the SSH/SFTP workspace and is git-ignored by default.
- 不要在 `commands.json` 加入 shell 包裝器，例如 `sh -c`、`cmd /c`、`powershell -Command`。Do not add shell wrappers to the whitelist.
- 互動 shell 預設開啟，請只給可信使用者帳號；互動 shell 等同開放該服務帳號的任意命令執行能力。Interactive shell is enabled by default; only create accounts for trusted users.
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
