# 贡献指南 / Contributing

## 中文

欢迎通过 Issue 报告问题或提出建议，提交聚焦单个问题的 Pull Request。

1. 使用 Node.js 26 和 npm，运行 `npm ci`。
2. 说明复现页面类型、预期与实际表现。UI 改动提供参考截图，并考虑键盘操作、三套主题和窄屏。
3. 运行 `npm test`、`npm run typecheck`、`npm run zip`。
4. 在 Chrome 加载 `.output/chrome-mv3`，用独立标签页验证。区分实际扩展与本地模拟组件。
5. 保留原站节点、草稿、选区和处理器；检查停用、关闭弹层、切页及重挂载后的恢复。

`tests/fixtures/` 保留必要页面结构，正文和资料为演示内容。本地浏览器夹具：

```sh
node scripts/build-detail-fixture.mjs
npx vite --config tests/browser/detail-vite.config.ts
```

打开 `http://127.0.0.1:5180/`。夹具使用模拟扩展 API 和虚构数据；原站样式与部分图片从公开来源加载，视觉检查需要网络。不要向社区提交测试内容。

不要提交凭证、Cookie、Client ID、私信、私人页面、研究快照、构建产物或个人验收日志；截图请遮盖私人内容。文档变更同步更新中英文版本。本项目暂未选择开源许可证，较大贡献请先在 Issue 沟通范围与许可安排。

## English

Use Issues for reports and proposals, or submit focused pull requests.

1. Use Node.js 26 and npm, then run `npm ci`.
2. Describe page type, reproduction, expected and actual behavior. Include UI references and consider keyboard access, all themes, and narrow layouts.
3. Run `npm test`, `npm run typecheck`, and `npm run zip`.
4. Load `.output/chrome-mv3` in Chrome and test in a separate tab. Distinguish installed-extension checks from local mock components.
5. Preserve native nodes, drafts, selections, and handlers. Check cleanup on disable, modal close, navigation, and remount.

`tests/fixtures/` retains sanitized structure with synthetic post bodies and profile details. Run the commands above for browser fixtures at `http://127.0.0.1:5180/`. They use synthetic extension APIs/data, but load some public styles/images over the network. Do not submit fixture content to the community.

Do not commit credentials, cookies, Client IDs, private messages/pages, research snapshots, build output, or personal acceptance logs. Redact screenshots and update both languages. No open-source license is selected yet; discuss scope and licensing before substantial contributions.
