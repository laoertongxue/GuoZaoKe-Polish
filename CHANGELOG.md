# 更新日志 / Changelog

## 0.4.4 · 2026-09-24 · 本地修复版

- DeepSeek 官方 Flash / V4 Pro 的自动输出上限改为 65,536 Token；按型号与官方地址识别，不把其他服务商同名模型误当成官方接口。
- 读取旧版官方 DeepSeek 4,096 默认配置时自动升级；自定义额度保留。高级参数留空使用自动额度，填写数值使用手动额度。
- 移除 32K 配置硬上限，配置与任务预算允许最多 393,216 Token；实际支持范围仍由服务商决定，1M 上下文不能当作单次输出额度。
- 新任务冻结实际输出上限，旧失败任务在额度变更后建立新结果；历史记录和原有调用占用保留，资格按新参数重新匹配。
- 大输出请求等待上限延长至 5 分钟，响应字节限制随额度调整且有硬上限；仍可取消，截断的 JSON 不会作为完整结论保存，没有新增自动重试。

Raised the automatic output allowance for official DeepSeek Flash / V4 Pro to 64K, migrated the legacy 4K default, and aligned configuration, run budgets, timeouts and bounded response handling. Historical results remain unchanged. Real-provider verification is still pending.

## 0.4.3 · 2026-09-17 · 预发布 / Prerelease

- 点击「讨论分析」自动采集并分析，直接展示结论；缺少配置时引导设置并继续，单一模型自动默认，多个模型可指定默认。
- 结果页支持切换模型重新分析，旧报告保留；预算、采集检查、导出和校准移入高级工作区，来源与待核限制仍可查看。
- 防止网页合成点击启动付费分析；已有侧栏通过消息激活，避免重复导航打断请求。刷新不重复消费启动令牌，同帖并发受到任务锁保护。
- 修复模型错误在消息传递中丢失类型、只显示 `stage_failed` 的问题；回答截断时拒绝保存不完整结论，展示明确重试提示。
- 更新中英文说明与隐私政策。Key 仍仅在本次浏览器会话保存，没有新增权限。

Click once to analyze with the default model. Missing configuration opens setup, one model becomes the default automatically, and switching models preserves earlier results. Advanced workflow controls are separate from everyday results. Synthetic clicks are rejected, existing panels keep active requests, and provider failures retain actionable error types. Truncated responses cannot become conclusions. No new permissions; keys remain session-only.

验证详情见 [验证范围](docs/verification.md)。真实 DeepSeek 响应与已安装原生侧栏的端到端验收仍待进行。

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
