# 貢獻指南 Contributing Guide

感謝你願意貢獻！Thanks for your interest in contributing!

## 開發環境 Development Setup

需求 Requirements：Node.js >= 20。

```bash
git clone https://github.com/s12ryt/s12ryt-nodejs-ssh.git
cd s12ryt-nodejs-ssh
npm install
npm run dev:setup
npm run generate:host-key
```

## 開發流程 Workflow

1. Fork 並建立功能分支。Fork and create a feature branch（`git checkout -b feat/your-feature`）。
2. 進行修改，保持單一職責的小型 commit。Make focused, single-purpose commits.
3. 確保所有測試通過。Ensure the full check passes：

   ```bash
   npm run check
   ```

4. 為新功能或 bug 修復補上對應測試。Add tests for new features and bug fixes.
5. 發 Pull Request，描述動機與變更內容。Open a PR describing motivation and changes.

## 程式碼規範 Code Style

- 使用 ES Modules（`type: module`），Node 20 原生語法。Use ES Modules and native Node 20 syntax.
- 不引入非必要的相依套件。Avoid unnecessary dependencies.
- 函式保持小而專注，命名清楚。Keep functions small, focused, and clearly named.
- 任何涉及認證、命令執行、SFTP 路徑的改動，務必附上測試。Security-sensitive changes (auth, command execution, SFTP paths) must include tests.

## 安全相關貢獻 Security Contributions

若你發現的是安全漏洞，請**不要**開公開 issue，改依 [`SECURITY.md`](./SECURITY.md) 私下回報。
For security vulnerabilities, do **not** open a public issue—follow `SECURITY.md` instead.

## 提交訊息 Commit Messages

建議使用簡潔的祈使句，可參考 Conventional Commits Recommended format (Conventional Commits)：

```
feat: add rate limiting for failed auth attempts
fix: prevent SFTP handle id reuse
docs: clarify shell enablement risks
```

## 行為準則 Code of Conduct

參與本專案即表示你同意遵守 [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)。
By participating you agree to abide by the code of conduct.

## 授權 License

提交貢獻即表示你同意你的貢獻以 GPL-3.0-or-later 授權釋出。
By contributing, you agree that your contributions are licensed under GPL-3.0-or-later.
