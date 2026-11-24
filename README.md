# Node.js SSH Server

[![CI](https://github.com/s12ryt/s12ryt-nodejs-ssh/actions/workflows/ci.yml/badge.svg)](https://github.com/s12ryt/s12ryt-nodejs-ssh/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org/)

> 生產級 Node.js 24 LTS SSH server，支援密碼認證、公鑰認證、白名單命令執行、預設互動式 shell 與 SFTP，互動 shell 與 SFTP 登入皆以使用者家目錄 `/home/<user>`（`root` → `/root`）為起點。
>
> A production-ready Node.js 24 LTS SSH server with password / public-key auth, whitelisted command execution, an interactive shell, and shell-aware SFTP.

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
- **互動 shell Interactive shell**：預設啟用，使用預編譯真實 PTY 支援互動程式與視窗 resize，登入後以使用者家目錄 `/home/<user>`（`root` → `/root`）為工作目錄。Prebuilt real-PTY shell enabled by default starting in the user home directory `/home/<user>` (`root` → `/root`).
- **SFTP**：預設跟隨同一 SSH connection 的 shell 工作目錄，登入時落在家目錄 `/home/<user>`（`root` → `/root`），檔案屬性與 `ls -l` 清單比照真實主機，並支援符號連結、硬連結與 chmod/chown/utime；亦可關閉跟隨模式恢復 `SSH_SFTP_ROOT` 沙箱。Follows the shell cwd on the same SSH connection by default, lands in the user home directory, reports real ownership with `ls -l` style listings and supports symlinks, hard links and attribute changes, with an optional sandboxed mode.
- **資源生命週期 Resource lifecycle**：SSH channel 中斷會釋放 child process、PTY subscription、SFTP handle、socket listener 與 timer；大型目錄與命令輸出使用有界緩衝。Disconnected channels release child processes, PTY subscriptions, SFTP handles, socket listeners, and timers; large directories and process output use bounded buffers.
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

`npm start` 會透過 `start.js` 自動建立缺少的 `.env`、`config/commands.json`、開發用 `config/users.json` 與 SSH host key，再啟動 server。
`npm start` uses `start.js` to create missing `.env`, `config/commands.json`, development `config/users.json`, and the SSH host key before starting the server.

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

> ⚠️ `config/users.json`、`config/commands.json`、`.env`、`keys/` 都已列入 `.gitignore`，請勿提交。These files are git-ignored and must never be committed.

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

互動式 shell 預設開啟，使用者登入後的工作目錄是家目錄 `/home/<user>`（`root` → `/root`，不存在時自動建立；若因 OS 權限無法建立或不可存取，改以服務帳號的家目錄代替）。例如在 SSH 裡執行 `npm install`、下載檔案或建立專案，檔案會落在該家目錄。
Interactive shell is enabled by default, and the working directory after login is the user home directory `/home/<user>` (`root` → `/root`, created on demand; falls back to the service account home directory when OS permissions block it). Files created by commands such as `npm install`, downloads, or generated projects are placed in that home directory.

可用以下環境變數調整 shell 行為。You can tune shell behavior with these variables:

```bash
SSH_ENABLE_SHELL=true
SSH_SHELL_PATH=/bin/bash
```

Windows 不會被模擬成 Linux；若未指定 `SSH_SHELL_PATH`，Windows 會使用系統預設 shell，Linux/macOS 會優先使用 `/bin/bash`、`/usr/bin/bash`、`/bin/zsh` 或 `/usr/bin/zsh`，最後才退回 `$SHELL` / `/bin/sh`。這可支援方向鍵歷史與 `bash <(curl -sL ...)` 這類 process substitution；你已要求不要使用 WSL，所以這裡不會啟動 WSL。
Windows is not emulated as Linux. Without `SSH_SHELL_PATH`, Windows uses the system default shell, while Linux/macOS prefer `/bin/bash`, `/usr/bin/bash`, `/bin/zsh`, or `/usr/bin/zsh` before falling back to `$SHELL` / `/bin/sh`. This supports arrow-key history and process substitution such as `bash <(curl -sL ...)`. WSL is not used.

互動 shell 的 OS 權限取決於 Node.js 服務程序的實際 UID，不取決於 `config/users.json` 裡的 SSH 登入名稱。若服務程序的有效 UID 是 0，shell 會使用 `USER=root`、`LOGNAME=root`、`HOME=/root`；把 SSH 帳號命名為 `root` 不會讓非 root 的容器程序取得 root 權限。在 shell 內提權時請使用 `su -` 或 `sudo -i`，讓工具同時切換 `HOME` 等登入環境。
The interactive shell inherits the real OS privileges of the Node.js service process, not the SSH login name from `config/users.json`. An effective UID of 0 gets `USER=root`, `LOGNAME=root`, and `HOME=/root`; naming an SSH account `root` does not elevate a non-root container process. Use `su -` or `sudo -i` when elevating inside the shell so login environment variables are updated too.

`SSH_SFTP_FOLLOW_SHELL_CWD` 預設為 `true`。同一 SSH connection 已開啟 shell 時，SFTP 相對路徑會跟隨該 shell 的目前目錄；尚未開啟 shell 時從使用者家目錄開始（`root` → `/root`，其他 → `/home/<帳號>`，不存在時自動建立；若因 OS 權限無法建立或不可存取，改以服務帳號的家目錄代替）。此模式不套用 `SSH_SFTP_ROOT` 沙箱，SFTP 虛擬根目錄即機器根目錄，絕對路徑直接對應主機檔案系統，例如 `/root`，但仍受 Node.js 程序的實際 OS 權限限制。檔案屬性回報真實 uid/gid 與權限，清單以 `ls -l` 格式顯示擁有者、群組與符號連結目標，並支援 READLINK / SYMLINK / LINK / SETSTAT / FSETSTAT（chmod、chown、utime，同樣受 OS 權限限制）。設為 `false` 可恢復原本的 SFTP 根目錄限制。
`SSH_SFTP_FOLLOW_SHELL_CWD` defaults to `true`. Relative SFTP paths follow the current shell directory on the same SSH connection, or start at the user home directory when no shell is active (`root` → `/root`, others → `/home/<user>`, created on demand; falls back to the service account home directory when OS permissions block it). This mode bypasses the `SSH_SFTP_ROOT` sandbox: the SFTP virtual root is the machine root and absolute paths such as `/root` map directly to the host filesystem, while still enforcing the Node.js process's OS permissions. Attributes report the real uid/gid and permission bits, listings use `ls -l` style owner, group and symlink targets, and READLINK / SYMLINK / LINK / SETSTAT / FSETSTAT are supported within the same OS permissions. Set it to `false` to restore the SFTP root sandbox.

若同 connection 的前景 shell 由 [Mytai20100/freeroot](https://github.com/Mytai20100/freeroot) 啟動，server 會從 `/proc/<pid>/environ` 自動讀取 `PROOT_CONFIG`，解析 FreeRoot 產生的 `proot.yml`，並套用其中的 `rootfs`、`cwd` 與 `bindings`。例如 guest `/root/file` 會映射到 `${ROOTFS_DIR}/root/file`，SFTP 顯示的仍是 guest 路徑；不需要另外填 rootfs 設定。
For Mytai20100/freeroot shells, the server automatically discovers `PROOT_CONFIG` from the foreground process, parses FreeRoot's `proot.yml`, and applies its `rootfs`, `cwd`, and `bindings`. A guest path such as `/root/file` maps to `${ROOTFS_DIR}/root/file` while SFTP continues to display the guest path.

互動 shell 依賴 `@homebridge/node-pty-prebuilt-multiarch`，它會優先下載 Linux x64 / arm64 等平台的預編譯 PTY binary，避免在 FeatherPanel 這類低磁碟容器中每次 `npm install` 都現場編譯 `node-pty`。若 npm log 仍出現 `node-gyp` 與 `ENOSPC`，代表預編譯 binary 無法下載或該平台沒有對應檔案，請先清空 `node_modules` 與 npm cache，並確認容器仍有足夠磁碟空間。
Interactive shell depends on `@homebridge/node-pty-prebuilt-multiarch`, which prefers prebuilt PTY binaries for platforms such as Linux x64 / arm64. This avoids rebuilding `node-pty` on every `npm install` in low-disk containers such as FeatherPanel. If npm still logs `node-gyp` and `ENOSPC`, the prebuilt binary could not be downloaded or is unavailable for the platform; clear `node_modules` and the npm cache, then make sure the container still has enough disk space.

若關閉 shell，shell request 會被拒絕，仍可使用白名單 `exec` 與 SFTP。
When shell is disabled, shell requests are rejected while whitelisted `exec` and SFTP keep working.

若使用 `ssh2` client 呼叫 `client.shell()`，請先檢查 callback 的 `error`；當你用 `SSH_ENABLE_SHELL=false` 關閉 shell 時，`stream` 會是 `undefined`，直接呼叫 `stream.setEncoding()` 會造成 `TypeError`。
When using the `ssh2` client with `client.shell()`, check the callback `error` first. When shell is disabled with `SSH_ENABLE_SHELL=false`, `stream` is `undefined`; calling `stream.setEncoding()` directly will throw `TypeError`.

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
| `SSH_DEFAULT_PASSWORD` | `ChangeMe123!` | 自動建立開發用 `config/users.json` 時使用的初始密碼，至少 8 字元且不超過 72 bytes（bcrypt 上限）；server 首次載入後會自動 hash。Initial password for the auto-created development users file, 8 characters minimum and 72 bytes maximum (bcrypt limit); auto-hashed on first server load. |
| `SSH_HOST_KEY_PATH` | `./keys/ssh_host_ed25519_key` | Host key 路徑；路徑只是檔名，`ssh-keygen` 可用時生成 `ssh-ed25519`，否則 fallback 為 `ecdsa-sha2-nistp256` Host key path; the filename is arbitrary, generated as `ssh-ed25519` when `ssh-keygen` is available and `ecdsa-sha2-nistp256` otherwise |
| `SSH_USERS_FILE` | `./config/users.json` | 使用者設定 Users file |
| `SSH_COMMANDS_FILE` | `./config/commands.json` | 命令白名單 Commands file |
| `SSH_SFTP_ROOT` | 機器根目錄 `/` | 關閉 shell cwd 跟隨模式時使用的 SFTP 虛擬根目錄；未設定時即機器根目錄 |
| `SSH_SFTP_FOLLOW_SHELL_CWD` | `true` | 同一 SSH connection 的 SFTP 是否跟隨 shell cwd；無 shell 時落在家目錄 `/home/<帳號>`，開啟時可存取 Node.js OS 權限允許的絕對路徑 |
| `SSH_ENABLE_SHELL` | `true` | 是否啟用互動 shell |
| `SSH_SHELL_PATH` | OS 預設 | 互動 shell 程式；Linux/macOS 未指定時優先使用 Bash/Zsh |
| `SSH_MAX_CLIENTS` | `64` | 最大同時連線數 Max clients |
| `SSH_MAX_CLIENTS_PER_IP` | `8` | 單一來源 IP 的同時連線上限 Per-IP connection limit |
| `SSH_MAX_AUTH_FAILURES` | `5` | 單一連線允許的認證失敗次數，超過即斷線 Auth failures before disconnect |
| `SSH_MAX_SESSIONS_PER_CLIENT` | `8` | 單一連線可開啟的 session/channel 上限 Channel limit per connection |
| `SSH_READY_TIMEOUT_MS` | `20000` | 握手逾時 Handshake timeout |
| `SSH_LOG_LEVEL` | `info` | 日誌等級 Log level |

## Container Image

每次 push 到 `main` 或推送 `v*.*.*` tag 時，GitHub Actions 會自動建置並推送 GHCR image。
GitHub Actions automatically builds and pushes the GHCR image on pushes to `main` and `v*.*.*` tags.

映像名稱 Image name:

```bash
docker pull ghcr.io/s12ryt/s12ryt-nodejs-ssh:latest
```

### Docker 部署教學 Docker Deployment

容器內固定使用 `/app` 作為工作目錄，SSH 服務預設監聽容器內 `2222` port。正式部署時，請把 runtime 檔案從主機掛載進容器，不要把真實密碼、host key 或使用者工作檔案放進 image。
The container uses `/app` as its working directory and listens on container port `2222` by default. Mount runtime files from the host in production; do not bake real passwords, host keys, or user workspace files into the image.

> ⚠️ 不要把主機目錄掛載到 `/app`。例如 `-v $(pwd):/app` 或 Compose 的 `.:/app` 會覆蓋 image 內建的 `package.json`、`start.js`、`src/`，造成 `npm ERR! path /app/package.json` 或找不到啟動檔。只掛載下方範例列出的單一 runtime 檔案與資料夾。
> Do not mount a host directory to `/app`. Mounts such as `-v $(pwd):/app` or `.:/app` overwrite the image's `package.json`, `start.js`, and `src/`, causing errors like `npm ERR! path /app/package.json` or missing startup files. Mount only the runtime files and directories shown below.

1. 建立部署目錄。Create a deployment directory:

```bash
mkdir -p s12ryt-ssh/config s12ryt-ssh/keys
cd s12ryt-ssh
```

2. 建立 `config/users.json`。Create `config/users.json`:

```bash
cat > config/users.json <<'JSON'
[
  {
    "username": "root",
    "password": "ChangeMe123!",
    "authorizedKeys": []
  }
]
JSON
```

第一次啟動後，`password` 會自動改寫成 bcrypt hash。請把範例密碼換成自己的強密碼。
After the first startup, `password` is rewritten as a bcrypt hash. Replace the example password with your own strong password.

3. 建立 `config/commands.json`。Create `config/commands.json`:

```bash
cat > config/commands.json <<'JSON'
{
  "whoami": {
    "executable": "whoami",
    "args": [],
    "allowClientArgs": false,
    "timeoutMs": 5000
  }
}
JSON
```

互動式 shell 預設已啟用；`commands.json` 只影響 `ssh user@host command` 這類 exec 命令。
Interactive shell is enabled by default; `commands.json` only affects exec commands such as `ssh user@host command`.

4. 啟動容器。Start the container:

```bash
docker run -d --name s12ryt-ssh \
  --restart unless-stopped \
  -p 2222:2222 \
  -e NODE_ENV=production \
  -v ./config/users.json:/app/config/users.json:ro \
  -v ./config/commands.json:/app/config/commands.json:ro \
  -v ./keys:/app/keys \
  ghcr.io/s12ryt/s12ryt-nodejs-ssh:latest
```

`keys/` 掛載為可寫，讓 `start.js` 能在第一次啟動時自動產生 SSH host key。互動 shell 與 SFTP 都以家目錄 `/home/<user>` 為起點，該處的檔案位於容器內，需另行掛載 `/home` 才會保留。
`keys/` is mounted writable so `start.js` can generate the SSH host key on first startup. Both the interactive shell and SFTP sessions start in the home directory `/home/<user>`, and files created there stay inside the container unless `/home` is mounted.

在 FeatherPanel 這類容器環境中，如果 `ssh-keygen` 因為 `No user exists for uid ...` 失敗，`start.js` 會自動改用 Node.js crypto 產生 `ecdsa-sha2-nistp256` host key。請仍然持久保存 `keys/`，避免每次重啟都換 host key。
In container environments such as FeatherPanel, if `ssh-keygen` fails with `No user exists for uid ...`, `start.js` falls back to a Node.js crypto-generated ecdsa-sha2-nistp256 host key. Keep `keys/` persistent so the host key does not change on every restart.

5. 檢查日誌與連線。Check logs and connect:

```bash
docker logs -f s12ryt-ssh
ssh -p 2222 root@127.0.0.1
sftp -P 2222 root@127.0.0.1
```

若部署在遠端主機，請把 `127.0.0.1` 換成主機 IP 或網域。
When deployed on a remote host, replace `127.0.0.1` with the server IP or domain.

### Docker Compose

```yaml
services:
  ssh:
    image: ghcr.io/s12ryt/s12ryt-nodejs-ssh:latest
    container_name: s12ryt-ssh
    restart: unless-stopped
    ports:
      - "2222:2222"
    environment:
      NODE_ENV: production
      SSH_HOST: 0.0.0.0
      SSH_PORT: 2222
      SSH_USERS_FILE: /app/config/users.json
      SSH_COMMANDS_FILE: /app/config/commands.json
      SSH_HOST_KEY_PATH: /app/keys/ssh_host_ed25519_key
      SSH_SFTP_FOLLOW_SHELL_CWD: "true"
      SSH_ENABLE_SHELL: "true"
      SSH_MAX_CLIENTS: 64
    volumes:
      - ./config/users.json:/app/config/users.json:ro
      - ./config/commands.json:/app/config/commands.json:ro
      - ./keys:/app/keys
```

啟動與查看狀態。Start and inspect:

```bash
docker compose up -d
docker compose logs -f ssh
docker compose ps
```

### 更新容器 Update

```bash
docker pull ghcr.io/s12ryt/s12ryt-nodejs-ssh:latest
docker stop s12ryt-ssh
docker rm s12ryt-ssh
docker run -d --name s12ryt-ssh \
  --restart unless-stopped \
  -p 2222:2222 \
  -e NODE_ENV=production \
  -v ./config/users.json:/app/config/users.json:ro \
  -v ./config/commands.json:/app/config/commands.json:ro \
  -v ./keys:/app/keys \
  ghcr.io/s12ryt/s12ryt-nodejs-ssh:latest
```

使用 Compose 時：With Compose:

```bash
docker compose pull
docker compose up -d
```

### 權限與安全 Permissions and Security

- `config/users.json` 可能在第一次啟動前短暫包含明文密碼，請限制主機上的檔案權限。
- `keys/` 內的 host key 必須持久保存；刪除後重新產生會讓 SSH client 出現 host key changed 警告。
- 家目錄 `/home/<user>` 會保存使用者透過 shell 或 SFTP 建立、下載或安裝的檔案，但位於容器層，需要保留時請掛載 `/home`。
- `SSH_SFTP_FOLLOW_SHELL_CWD=true` 時 SFTP 不受 `SSH_SFTP_ROOT` 沙箱限制，可讀寫 Node.js 程序有權存取的整個主機檔案系統，並可建立符號連結、硬連結與修改權限、時間戳；只應提供給完全可信的帳號。
- 若要對外開放 `2222`，請搭配防火牆或雲端 security group，只允許可信 IP。
- `config/commands.json` 不要加入 `sh -c`、`cmd /c`、`powershell -Command` 這類 shell 包裝器。

### 常見問題 Troubleshooting

| 問題 Problem | 檢查方式 Check |
| --- | --- |
| 容器馬上退出 | 執行 `docker logs s12ryt-ssh`，通常是缺少或格式錯誤的 `config/users.json` / `config/commands.json`。 |
| SSH 連不上 | 確認 `docker ps` 有 `0.0.0.0:2222->2222/tcp`，並檢查主機防火牆。 |
| 密碼登入失敗 | 確認 SSH 用戶名等於 `config/users.json` 的 `username`，且 `password` 至少 8 字元或已是 bcrypt hash。 |
| SFTP 看不到預期檔案 | 跟隨模式開啟但尚無 shell 時，起點是家目錄 `/home/<帳號>`（`root` → `/root`）；跟隨模式關閉時，根目錄是 `SSH_SFTP_ROOT`（預設機器根目錄），登入同樣落在家目錄。修改設定後需重啟服務並重新連線。 |
| SFTP 無法讀寫 `/root` | 確認 `SSH_SFTP_FOLLOW_SHELL_CWD=true`，並以 `ps -eo uid,user,args | grep '[n]ode'` 確認 Node.js 程序本身具有 root 權限；shell 子程序提權不會提升 SFTP server 的權限。 |
| FreeRoot 裡的 `/root` 與 SFTP 不一致 | 確認 SFTP 與 FreeRoot shell 使用同一 SSH connection，且前景程序環境仍有 `PROOT_CONFIG`；新版會自動把 guest `/root` 映射到 FreeRoot `${ROOTFS_DIR}/root`。 |
| 方向上鍵或 `bash <(curl ...)` 不能用 | 確認容器內有 `/bin/bash` 或 `/usr/bin/bash`，或明確設定 `SSH_SHELL_PATH=/bin/bash`；只有 `/bin/sh` 的環境不支援 Bash process substitution 與完整歷史操作。 |
| root shell 執行腳本仍寫入 `/home/container` | 更新至新版後重啟 Node.js 服務；有效 UID 為 0 時會自動設定 `HOME=/root`。若是在 shell 內提權，請使用 `su -` / `sudo -i`，或先執行 `export HOME=/root; cd /root`。 |
| SSH client 警告 host key changed | 檢查 `./keys` 是否被刪除或換過；需要保留同一份 host key。 |
| `No user exists for uid ...` | 這是容器使用者沒有 `/etc/passwd` 記錄導致 `ssh-keygen` 失敗；新版 `start.js` 會自動 fallback 到 Node.js crypto 產生 `ecdsa-sha2-nistp256` host key。 |
| `npm ERR! path /app/package.json` | 檢查 `docker run` / Compose 是否把主機目錄掛到 `/app`，請移除 `-v ...:/app` 或 `.:/app`，只保留 `config/users.json`、`config/commands.json`、`keys/`、`/home` 這幾個掛載。 |
| `[start] Missing template file: .env.example` | 代表 image 內缺少啟動範本檔。請重新拉取或重新 build 最新 image；不要用舊版 image 搭配新版部署文件。 |

## 專案結構 Project Structure

| 路徑 Path | 用途 Purpose |
| --- | --- |
| `src/index.js` | 進入點與 graceful shutdown。Entry point and graceful shutdown. |
| `src/server.js` | SSH server 主流程與 session 路由。Main server flow and session routing. |
| `src/auth.js` | 密碼與公鑰認證。Password and public-key auth. |
| `src/command-runner.js` | 白名單命令執行。Whitelisted command execution. |
| `src/sftp-server.js` | SFTP 協議實作。SFTP protocol implementation. |
| `src/fs-safe.js` | SFTP 路徑沙箱。SFTP path sandboxing. |
| `src/connection-guard.js` | 全域/per-IP 連線、認證失敗與 channel 限額。Connection, auth-failure and channel limits. |
| `src/sftp-fs.js` / `src/sftp-extended.js` | SFTP 檔案系統對應與擴充請求。SFTP filesystem mapping and extended requests. |
| `src/proot-paths.js` | FreeRoot/PRoot guest 路徑映射。FreeRoot guest path mapping. |
| `src/shell-runner.js` | 預設啟用的 PTY 互動 shell。PTY interactive shell enabled by default. |
| `src/config.js` | 環境變數讀取與驗證。Env config loading/validation. |
| `src/host-key.js` | ssh-keygen 優先、失敗 fallback 到 ecdsa-sha2-nistp256 的 host key 產生。Host key generation with an EC P-256 fallback. |
| `src/dev-credentials.js` | 開發用預設帳密解析與密碼政策（8 字元下限 / 72 byte 上限）。Development credential policy. |
| `src/logger.js` | JSON 結構化日誌。Structured JSON logging. |
| `scripts/` | 初始化、密碼雜湊、host key 產生工具。Setup utilities. |
| `config/` | 使用者與命令白名單設定範本。Config templates. |
| `.github/workflows/ghcr.yml` | 自動建置並推送 GHCR container image。Builds and pushes the GHCR container image. |
| `test/` | 單元與整合測試。Unit and integration tests. |

## 安全注意事項 Security Notes

- 不要把 `keys/`、`.env`、`config/users.json`、`config/commands.json` 提交到版本控制。Never commit secrets.
- 使用者家目錄 `/home/<user>` 是 shell 與 SFTP 的工作目錄，可能包含下載、安裝或產生的檔案，位於主機根目錄下而非專案內。The home directory `/home/<user>` is the working directory for shell and SFTP sessions and lives outside the project folder.
- 不要在 `commands.json` 加入 shell 包裝器，例如 `sh -c`、`cmd /c`、`powershell -Command`。Do not add shell wrappers to the whitelist.
- 互動 shell 預設開啟，請只給可信使用者帳號；互動 shell 等同開放該服務帳號的任意命令執行能力。Interactive shell is enabled by default; only create accounts for trusted users.
- 若要開放參數，請只對低風險命令設定 `allowClientArgs: true`。Enable `allowClientArgs` only for low-risk commands.
- 若要限制 SFTP 路徑，請設定 `SSH_SFTP_FOLLOW_SHELL_CWD=false`，並將 `SSH_SFTP_ROOT` 指向獨立資料夾且限制 OS 權限（預設為機器根目錄；沙箱內的 `..` 會正規化，無法離開根目錄）。Disable shell-cwd following and point `SSH_SFTP_ROOT` at an isolated directory when path sandboxing is required.
- 對外部署請搭配防火牆，只允許可信 IP 連線。Pair public deployments with IP allow-listing.

回報安全漏洞請見 [`SECURITY.md`](./SECURITY.md)。To report a vulnerability, see [`SECURITY.md`](./SECURITY.md).

## 驗證 Verification

```bash
npm run check
```

此指令會執行 Node 語法檢查與 `node --test`。Runs syntax checks plus the `node --test` suite.

資源回歸測試涵蓋 exec 中斷與強制終止與 PTY/SFTP channel 清理；SFTP 單次 read 上限為 64 KiB、目錄每批最多 50 筆。供應鏈守衛測試另外檢查 Node.js 版本、ssh2 釘選版本、CI `npm audit` gate、映像掃描與 Dependabot 設定，並驗證密碼 72-byte 上限、顯式演算法白名單與連線限額。
Resource regression tests cover interrupted exec processes, PTY/SFTP cleanup, and bounded SFTP reads.

## 貢獻 Contributing

歡迎 issue 與 PR，請先閱讀 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 與 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)。
Contributions are welcome—please read the contributing guide and code of conduct first.

## 授權 License

本專案採用 [GNU General Public License v3.0 (or later)](./LICENSE)。
Licensed under the GNU General Public License v3.0 (or later).
