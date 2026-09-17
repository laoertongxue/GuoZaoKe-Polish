# 更新日志 / Changelog

## 0.4.2 · 2026-09-17 · 预发布 / Prerelease

### 中文

- 新增讨论分析试用：配置自己的 AI 服务和模型，采集本帖原文，按固定结构提取主张、关联证据、展示可溯源数据与回复观察；保留不适用、待核与无法判断，不生成个人总分或跨帖画像。
- 在原生 Chrome 侧栏中直接展示主张、来源、支持或冲突理由和回复分析；支持预算、取消、阶段保存、历史恢复、冻结输入复跑和模型校准工作区。
- 新增 B 站图床试用：主动授权后使用本浏览器的登录态上传，免手工填写 Cookie；保留 Imgur 配置及已有图片链接。图片只插入草稿，不发布帖子或动态，不自动更换图床。
- 修复上传中关闭导致剩余文件和失败提示丢失；上传完成前保留弹窗，失败可继续处理剩余图片，已成功部分不重复插入。
- 更新中英文使用与隐私说明、分析/上传验收记录、PDF.js 第三方许可。新增必需 `sidePanel` 和可选 `cookies` 权限，具体目的域按操作授权；API Key 不进入同步或导出。

验证：本地 590 项测试（47 个文件）、类型检查、生产打包与归档检查通过。公开环境缺少完整本地研究样板时跳过 1 项条件测试。真实模型、已安装扩展流程、图床上传和访客外链仍待验收，因此本版作为 GitHub 预发布提供；不代表 Chrome 应用商店已经更新。

### English

- Added experimental discussion analysis using the user's own AI endpoint and model, with fixed claim structures, traceable sources, evidence tables, and thread-scoped reply observations. Unknown and inapplicable states remain explicit; no personal overall scores or cross-thread profiles.
- Added concrete analysis results in Chrome's native side panel, plus budgets, cancellation, saved stages, history recovery, frozen-input replays, and a model-calibration workspace.
- Added experimental Bilibili uploads through an explicitly authorized browser session, while retaining Imgur and existing image URLs. Uploads only insert links into drafts; they do not publish posts or switch providers automatically.
- Fixed lost queues and invisible errors when closing during upload. The dialog stays open until a result arrives, retaining failed files for retry without reinserting successful files.
- Updated bilingual documentation and privacy details, validation records, and the bundled PDF.js license. Added required `sidePanel` and optional `cookies` capabilities, with specific-origin grants on demand. API keys are excluded from sync and exports.

Validation: 590 local tests in 47 files, type checking, production packaging, and archive checks passed. One conditional test is skipped without the unpublished complete research fixture. Real model calls, installed-extension flows, live uploads, and visitor image visibility remain unverified. This GitHub prerelease does not update the Chrome Web Store listing.

[下载 / Download](https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.4.2) · [验证范围 / Verification](docs/verification.md) · [使用说明 / Analysis guide](docs/analysis.md)
