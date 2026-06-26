# Deep Todos

- [x] 釐清需求：Node.js 20 SSH server，支援密碼、公鑰、命令執行、SFTP，生產部署，2~3 併發。
- [x] 建立專案骨架與依賴。
- [x] 實作 SSH server 核心功能。
- [x] 補齊安全設定與部署文件。
- [x] 執行驗證：`npm run check`、`npx -y node@20 scripts/check-syntax.js && npx -y node@20 --test` 均通過。
- [x] 補互動 shell 與 PTY：新增 `node-pty` shell runner、`SSH_ENABLE_SHELL` 開關、PTY/window-change 處理、文件與整合測試。
- [x] 自主疊代升級（不動既有功能）：
  - 修復 `command-runner.js` exit 競態（`settled` 旗標防重複 exit、timeout 統一回退碼 124、signal-only 回 1）。
  - 修復 `sftp-server.js` handle ID 重複 bug（改單調遞增計數器 + uint32 環繞保護，杜絕 fd 洩漏與 entry 覆蓋）。
  - 加固 `auth.js` 用戶列舉時序攻擊（unknown user 也跑 dummy bcrypt，回應時間一致）。
  - 修復 `logger.js` meta 覆蓋系統欄位（time/level/message）的日誌污染。
  - 加固 `shell-runner.js` shell 退出後對已 end stream 的寫入競態。
  - 新增 3 個 command-runner 回歸測試（timeout 124、啟動失敗退出碼、無碰撞）。
  - 驗證：`npm run check` 全綠（16 檔語法檢查、9 pass / 1 skip / 0 fail）。
