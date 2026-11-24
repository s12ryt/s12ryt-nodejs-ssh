# 安全政策 Security Policy

## 支援版本 Supported Versions

| 版本 Version | 是否支援 Supported |
| --- | --- |
| 0.1.x | :white_check_mark: |

## 回報漏洞 Reporting a Vulnerability

本專案是一個可對外開放的 SSH server，安全性至關重要。**請勿在公開 issue 中揭露安全漏洞。**
This project is a network-facing SSH server, so security matters. **Please do not disclose security vulnerabilities in public issues.**

請以 email 私下回報 Please report privately via email：

- **s12ryt** — yoyo20110918@gmail.com

回報時請盡量提供 Please include when possible：

- 漏洞描述與影響範圍。A description of the vulnerability and its impact.
- 重現步驟或 PoC。Steps to reproduce or a proof of concept.
- 受影響的版本 / commit。Affected version or commit.
- 任何建議的修補方向。Any suggested remediation.

## 回應時程 Response Targets

- **確認收到 Acknowledgement**：3 個工作天內 within 3 business days。
- **初步評估 Initial assessment**：7 個工作天內 within 7 business days。
- 修補完成後會在 CHANGELOG 與 release notes 中註記（可選擇是否署名回報者）。Fixes are noted in the changelog and release notes, with optional credit to the reporter.

## 範圍 Scope

特別關注以下面向 We are especially interested in：

- 認證繞過（密碼 / 公鑰）。Authentication bypass (password / public key).
- 命令白名單繞過或注入。Command whitelist bypass or injection.
- 關閉 `SSH_SFTP_FOLLOW_SHELL_CWD` 時的 SFTP 路徑逃逸（跳出 `SSH_SFTP_ROOT`）。SFTP path traversal escaping `SSH_SFTP_ROOT` when shell-cwd following is disabled.
- 互動 shell 權限提升。Interactive shell privilege escalation.
- 阻斷服務 / 資源耗盡。Denial of service / resource exhaustion.
- 敏感資訊（密碼 hash、host key）洩漏。Leakage of secrets such as password hashes or host keys.

## 硬化基線 Hardening Baseline

- Runtime 必須是 Node.js 24 LTS 或更新版本；Node 20 已於 2026-04-30 EOL，不再接收安全修補。Node.js 24 LTS or newer is required.
- `ssh2` 釘選在 `1.16.0`；升級前請先確認 CVE-2025-70034 已有上游修補。`ssh2` is pinned to 1.16.0 pending a fix for CVE-2025-70034.
- 密碼上限為 UTF-8 72 bytes，避免 bcrypt 靜默截斷。Passwords are capped at 72 UTF-8 bytes.
- 連線限額由 `SSH_MAX_CLIENTS`、`SSH_MAX_CLIENTS_PER_IP`、`SSH_MAX_AUTH_FAILURES`、`SSH_MAX_SESSIONS_PER_CLIENT` 控制。Connection limits are configurable.
- CI 以 `npm audit --audit-level=high` 與 Trivy 映像掃描作為發布前 gate。CI gates on npm audit and Trivy.
