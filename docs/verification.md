# 验证范围 / Verification scope

## 0.4.4 DeepSeek 输出额度修复（本地包，2026-09-24 再次打包核对）

- 2026-09-24 再次打包：51 个测试文件通过，619 项测试通过、1 项因未附完整本地研究原件而跳过；类型检查、生产打包和差异空白检查通过。
- 回归覆盖 64K 从配置传到任务和 HTTP、自动/手动额度、旧配置读取迁移、官方地址识别、官方模型名大小写不敏感、384K 上限、跨越旧 60 秒限制、主动取消、5 分钟超时、大响应读取及新旧结果分离。模拟 HTTP 不代表真实 DeepSeek 输出或已安装扩展已通过验收。
- ZIP：`GuoZaoKe-Polish-0.4.4-chrome.zip`，816670 字节、31 个条目，根 manifest 为 0.4.4，权限与 0.4.3 相同；归档完整性、排除测试/研究/环境文件及常见 Key 形态扫描通过。
- SHA-256：`45c7f560d501d131fea38eac8d7f25756fc89f714ccdf99643704c65de86e0ea`。
- 此轮生成本地安装包，未发布 GitHub Release 或提交 Chrome 应用商店；真实 API 仍待更新扩展后验证。

## 0.4.3 一键分析 / One-click analysis

- 2026-09-17：全量 50 个测试文件、610 项通过，类型检查与生产打包通过；最后的入口/侧栏/简单模式回归 29 项通过。
- 覆盖点击启动、单一及多配置默认模型、保存配置后继续、缺 Key 换模型重跑、取消采集、失败重试、旧报告保留、重复点击、历史跨帖激活、合成点击拦截与一次性启动令牌。原生侧栏通过消息唤起已有文档，后台与工作区相关回归通过。
- 本地浏览器使用合成帖子与模拟响应，验证自动开始、网络失败提示、重试、4 类模型阶段自动衔接、结论与回复观察展示；440×900 视口下可读。实际 API 调用为 0，不能据此证明真实 DeepSeek 回答质量或 Chrome 原生侧栏生命周期已验收。
- ZIP：`GuoZaoKe-Polish-0.4.3-chrome.zip`，815863 字节、31 个条目，根 manifest 版本为 0.4.3。归档校验通过，权限与 0.4.2 完全一致，不包含研究原件、测试、Git、环境文件或 source map；常见 Key 形态无匹配。
- SHA-256：`131992fa389553f4e2653f9946edbfa538fd12c8222f0675438b2b0cd9d80cdc`。
- 下载：[v0.4.3 Releases](https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.4.3)。此版本为 GitHub 预发布，Chrome 应用商店单独更新。

610 local tests across 50 files, type checking, and packaging passed. The local browser fixture verifies the simplified workflow and narrow layout with synthetic responses. It does not establish installed-extension or real-provider acceptance. No permissions were added. Earlier validation records below describe their respective versions.

## 0.4.2 讨论分析与 B 站图床预发布 / Analysis and upload prerelease

- 2026-09-17 最终运行 `npm test -- --maxWorkers=4`：47 个文件、590 项测试通过；`npm run typecheck`、`npm run zip`、`git diff --check` 通过。完整本地冻结样板有 1 项条件测试，公开仓库未附整帖原件时会跳过；其余回归使用随仓库提供的夹具。
- 讨论分析包括原文采集与定位、固定主张结构、检索与原件读取、关系判断、R/E/L/B 回复观察、预算、取消恢复、历史、固定输入对比与试验准入。侧栏展示具体结论，并复用受信工作区。API Key 只放会话存储，网页不能取得 Key。
- 新增 B 站浏览器登录态上传（试用），保留 Imgur 和已有图片链接；Cookie 权限为可选。上传中关闭会保留弹窗，成功后正常关闭，失败显示错误并保留剩余文件。该问题先由新增回归复现失败，修复后通过独立复审。
- 本地浏览器夹具验证了分析窄屏/深色布局、恢复/取消、结果展示与图床设置的授权拒绝提示。夹具不等于已安装 Chrome 扩展或真实模型、检索、上传服务的全链路验收。
- 最终 ZIP 为 0.4.2、811084 字节、31 个条目；根目录 manifest、原生侧栏权限、PDF worker 与许可证、可选 Cookie 权限及归档完整性通过。包内未包含测试、研究记录、source map、Git 或环境配置文件；常见凭据形态扫描无匹配。
- SHA-256：`2e85a9235e95b7858113fc35f2dcd648255828f4700cac029c18fcc140bfff18`。下载包与校验文件见 [v0.4.2 Releases](https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.4.2)。
- 真实 DeepSeek/API 调用、真实多模型准入、B 站与 Imgur 账号上传、外链访客可见性仍待验收，因此此版标为预发布；Chrome 应用商店需要单独提交。详细记录见 [讨论分析](analysis-validation.md) 与 [B 站上传](bilibili-upload.md)。

The final local run passed 590 tests across 47 files, type checking, production packaging, and diff checks. One test requires a complete local frozen reference and is skipped when those unpublished originals are absent. The ZIP contains 31 entries and passes integrity, manifest, permission, PDF-license, and credential-pattern checks. Analysis side-panel behavior and upload recovery were tested locally; actual provider calls, installed-extension flows, live uploads, and external image display remain pending. This is a GitHub prerelease, separate from Chrome Web Store submission.


## 0.3.14 广告残留修复 / Ad remnants

- 根据实站 DOM 确认原生推广使用 `.sidebar-right > .sidebox > .ui-content.ad`，卡片链接为 `/ad/3`、`/ad/4`。仅隐藏内部图片会留下整张卡片的空间。
- 核对站点引用的 [Google 浮动广告模块](https://pagead2.googlesyndication.com/pagead/managed/js/adsense/m202609080101/reactive_library.js)：其 `grippy-host` 使用封闭 Shadow DOM，广告有内联高优先级样式，页面边距另写在 body 上。修复同时覆盖这些外壳与占位，关闭后恢复原值。
- 回归夹具先复现旧规则失败。27 个测试文件、163 项用例、类型检查、生产打包通过；新包权限与 0.3.13 相同。
- Chrome 本地 [回归页面](../tests/browser/ads-audit.html) 验证：原生推广整卡及浮动广告高度为 0；Google 模拟刷新把底部占位从 130px 改为 180px 后，实际底部边距仍为 0；页脚后额外占位为 0。关闭过滤或总开关后恢复 180px 及广告原内联优先级。正常正文、回复、侧栏信息和普通 iframe 保留；深色模式通过。
- 本次检查实站时 Google 浮动广告已消失，未把无广告的页面当作新版安装包投放验收。安装 0.3.14 后的真实 Google 投放仍需复核。

The regression fixture first reproduced the old filter's failure. 163 tests in 27 files, type checks and production packaging passed. Chrome checks cover inline-important styles, closed-shadow grips, native promotion cards, delayed insertion, ad refreshes, dark mode and restoration. Ad space after the footer measured 0px while enabled and restored to 180px when disabled. The live site's native card markup and Google's public reactive module informed the fixture; live Google ad delivery with the installed 0.3.14 build remains to be verified. No permissions were added.

## 0.3.13 广告隐藏 / Ad hiding

- 27 个测试文件、160 项用例，以及类型检查和生产打包通过。
- Chrome 本地合成广告容器验证：默认隐藏、侧边与底部容器高度归零、延迟插入广告、深色模式、关闭过滤及总开关后的恢复；正文、回复、相关主题和普通 iframe 保留。
- 在过早客公开主题的原始 HTML 中确认存在 Google AdSense 脚本。本次查看用户现有标签页时广告未再次展示，因此本地容器验证不等于新安装包的实站广告投放验收。
- 功能仅隐藏已识别的广告元素，不拦截网络请求；权限范围未增加。用户需重新加载扩展后生效。

160 tests across 27 files, type checks, and production packaging passed. Local Chrome fixtures verified cosmetic hiding, collapsed ad containers, delayed insertion, dark mode, and restoration when disabled, while preserving normal content. The site's original public HTML includes AdSense, but ads were no longer present in the inspected live tab. Live ad delivery with the updated installed extension remains to be verified. No permissions were added; network requests are not blocked.

## 0.3.11 发布准备

- Node.js 26：26 个测试文件、158 项用例通过；发布前执行类型检查、Chrome MV3 构建和 ZIP 校验。
- 公开测试夹具保留 DOM、楼层和解析标识，替换原帖正文与资料，移除网页脚本；脱敏后重新执行全部回归。
- 0.3.10 的本地 Chrome 核查涵盖三套主题、分页尺寸、个人页四个入口、弹层、作者卡片，以及 390 / 768 / 1024px 无横向溢出。
- 本地普通与慢速深色启动采样中，可见原站样式帧为 0，不代表所有设备和网络条件下均无闪动。
- 0.3.11 相比 0.3.10 的扩展代码仅将页脚署名改为 `Made by 拾贰画生`。

实站曾取样检查扩展注入、分页链接、主题预览和部分回复交互。最新版全部页面验收、真实 Imgur 上传、后台授权、社区写操作与 Chrome Web Store 分发尚未全部完成。

## Publication preparation for 0.3.11

- Node.js 26: 158 passing tests across 26 files; type checks, the Chrome MV3 build, and ZIP checks run before publication.
- Public fixtures retain DOM structure, floors, and parsing identifiers. Post bodies and profiles are synthetic, page scripts are removed, and all regression tests were rerun.
- Local Chrome checks for 0.3.10 cover three themes, pagination measurements, four profile navigation entries, dialogs, the author card, and overflow at 390 / 768 / 1024px.
- Sampled normal and slow dark-theme startup showed no visible native-style frames, not a guarantee for all devices or networks.
- The only extension-code change from 0.3.10 to 0.3.11 is `Made by 拾贰画生` in the footer.

Live-site samples covered injection, pagination URLs, previews, and some reply interactions. Comprehensive current-package coverage, real Imgur uploads, background authorization, community writes, and Chrome Web Store distribution are not fully verified.
