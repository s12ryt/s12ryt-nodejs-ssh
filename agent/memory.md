# Memory

- 專案目標：建立可部署到生產環境的 Node.js 20 SSH server。
- 安全策略：預設採命令白名單，互動 shell 預設關閉且需 `SSH_ENABLE_SHELL=true` 才開放；SFTP 路徑需限制在指定根目錄內。
- 認證策略：支援密碼雜湊與 SSH authorized keys 公鑰認證。
- 目前狀態：已完成 `ssh2` server、bcrypt 密碼認證、公鑰認證、白名單 exec、可選互動 shell + `node-pty` 真 PTY、SFTP 根目錄限制、systemd 範本與整合測試。
- 驗證紀錄：Windows 環境 `npm run check` 通過 9 個測試、跳過 1 個 Windows `node-pty` 真 PTY 整合測試；Linux/macOS 仍會執行真 PTY shell 測試。
- 自主疊代升級紀錄（不動功能，只修 bug/加固/優化）：
  - command-runner：exit 競態用 `settled` 旗標防護，timeout 統一回退碼 124（對齊 GNU timeout），signal-only 回 1。
  - sftp-server：handle ID 由 `handles.size+1` 改為單調遞增計數器（`nextHandleId`），修掉刪除後重用 ID 造成的 entry 覆蓋與 fd 洩漏。
  - auth：unknown user 也跑 dummy bcrypt（cost 10），消除用戶列舉時序側信道。
  - logger：record 改為 `...meta` 在前、系統欄位 time/level/message 在後，避免 meta 覆蓋系統欄位。
  - shell-runner：onData/onExit/stream.on('data') 都加 `exited` 防護，避免 shell 退出後 write-after-end。
  - 新增 command-runner 回歸測試：timeout(124)、啟動失敗退出碼(1)。
