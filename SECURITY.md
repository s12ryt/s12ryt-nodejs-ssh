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
- SFTP 路徑逃逸（跳出 `SSH_SFTP_ROOT`）。SFTP path traversal escaping the sandbox root.
- 互動 shell 權限提升。Interactive shell privilege escalation.
- 阻斷服務 / 資源耗盡。Denial of service / resource exhaustion.
- 敏感資訊（密碼 hash、host key）洩漏。Leakage of secrets such as password hashes or host keys.
