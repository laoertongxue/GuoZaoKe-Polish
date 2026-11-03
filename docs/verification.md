# 验证范围 / Verification scope

0.5.7 发布附件见 [GitHub Release v0.5.7](https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.5.7)：Chrome 安装 ZIP、SHA-256 校验文件、验收报告与结构化测量结果。本次发布包含 0.5.3–0.5.7 的累计改动；下方各阶段记录保留当时的版本和未完成状态，最新结果以 0.5.7 实站复验为准。公开附件使用布局及控件测量，不包含账户截图、表单值、登录信息或本机绝对路径。本次未提交 Chrome 应用商店。

## 0.5.7 实站 UI 验收续检与预览焦点修复（2026-11-03）

### 已完成的真实页面验收

用户确认重新加载 0.5.6 并选择晨曦，真实页面读取到 `data-gzk-theme=dawn`、`data-gzk-mounted=true`。本节更新了下方 0.5.6 阶段暂未完成的晨曦及弹窗检查；此前浅色/深色首页检查是在运行中的 0.5.5 完成，不能据此宣称所有页面、所有主题都在最新包中重新跑过。

| 环境与场景 | 实际结果 |
| --- | --- |
| 晨曦：首页、主题 `/t/134112`、公开个人页 `/u/guozaoke`、搜索 `q=AI`，各测 1440 / 390 / 320px | 12 组布局测量均无水平溢出。主题页保留 5 条真实回复；搜索页使用当前原生 article 结构。 |
| 晨曦：真实主题预览、插件图床、标签弹窗，各测 1440 / 390 / 320px | 9 组测量均无横向溢出，弹窗在 844px 高视口内；有关闭按钮的弹窗，其按钮在屏幕内。 |
| 真实图片预览，320px | 图片宽 272px、对话框宽 320px；放大可操作，Esc 可关闭。未上传图片。 |
| 图床及标签弹窗 | 图床 Shift+Tab 焦点仍在弹窗内，点击关闭正常；标签输入框显示 2px 焦点轮廓，关闭后回到「设置用户标签」按钮，未保存标签。 |
| 真实编辑器 | 键盘焦点轮廓为 2px，未输入或提交正文。 |
| 320×240 短窗口 | 工具箱顶部 132px、高 96px；图床弹窗顶部 18px、底部 222px，关闭按钮底部 66px，可正常关闭。 |
| 横向阅读 | 1440px 时正文右边 561px、回复左边 585px，页面无溢出；320px 正常回落单列，并显示宽屏生效说明。检查后已恢复原纵向设置。 |

实站截图与测量保存在本机 `release/verification-0.5.6/`：`live-ui-completed-056.json`、`live-home-dawn-390.png`、`live-topic-dawn-390.png`、`live-search-dawn-390.png`、`live-preview-dawn-390.png`、`live-upload-dawn-390.png`、`live-tags-dawn-390.png`、`live-image-preview-dawn-320.png`。仅保存本机，没有上传。

### 实站发现并修复的焦点问题

同尺寸重复两次确认：键盘聚焦列表「预览」按钮，打开弹窗后按 Esc，焦点落到 BODY。原因是鼠标离开列表后，父容器 `visibility:hidden` 导致共享弹窗清理函数对原按钮调用 focus 无法生效。

修复仅改两条共享显示规则：未悬停时改用 `opacity:0;pointer-events:none`，悬停或行内有焦点时恢复 `opacity:1;pointer-events:auto`。按钮仍可获得键盘焦点，关闭弹窗后重新可见。主题列表和热议侧栏共用这两条规则，不改弹窗业务逻辑。

在本地浏览器使用实际组件和内存 API 回归，三种主题 × 1440 / 320px，共 6 组均返回「预览」BUTTON、父容器 opacity=1、无残留弹窗。记录在 `release/verification-0.5.6/focus-regression-local.json`。这是修复的本地回归。随后用户确认重新加载 0.5.7，已完成下述实站复验。

### 修复包与验收边界

- 类型检查、35 个测试文件 / 261 项测试、生产打包及差异空白检查通过。
- `release/GuoZaoKe-Polish-0.5.7-chrome.zip` 为 215574 字节、20 个条目；与 0.5.6 逐文件比较，仅 `manifest.json` 版本及 `content-scripts/content.css` 有变化，脚本与权限完全一致。SHA-256：`410344fd23c98d7e66841d900b2c2a0a3b59c9d677166f4aaf0efab10f3c53f8`。
- 新解压目录 `release/GuoZaoKe-Polish-0.5.7-chrome/`，并同步更新用户原加载目录 `release/GuoZaoKe-Polish-0.5.5-chrome/`，不删除扩展或本机设置。历史 ZIP 保留。
- 用户确认重新加载 0.5.7 后，刷新真实页面，检查到修复后的 CSS（未悬停时 visibility=visible、opacity=0、pointer-events=none）。实站列表预览在浅色/深色 × 1440 / 320px 的 4 组检查，以及热议侧栏预览在浅色/深色桌面的 2 组检查，全部在 Esc 关闭后回到预览 BUTTON、opacity=1，弹窗数为 0，页面无水平溢出。
- 实站焦点修复共 6 组通过，记录为 `release/verification-0.5.7/live-focus-results.json`，截图为 `live-focus-restored-light-320.png`。本轮开始时页面为浅色，主题切换检查结束后回到浅色；临时视口恢复到原 2560px，纵向布局保持恢复。三种主题的实站覆盖来自前述分阶段检查，不将当前 6 组标记为三种主题全矩阵。
- 本次发现的焦点问题已在真实页面关闭，指定 UI、布局和弹窗检查无剩余待修复项。扩展管理页的警告列表仍受浏览器策略限制，未自动确认旧警告记录是否已清空；不影响对上述页面行为的直接观察。
- 未发帖、回复、点赞、上传或消费积分；未点击原生 AI 问答提交。扩展内部设置页及工具栏 popup 因协议访问策略未自动验收。实体移动设备、输入法与屏幕阅读器未测试；本节是指定页面及交互范围的验收，不是全站或完整可访问性认证。

## 0.5.6 Chrome 实际加载警告修复与实站验收进度（2026-11-03）

### 实际加载暴露的权限声明错误

用户截图确认 0.5.5 已加载并启用，Chrome 报告：`Permission 'declarativeNetRequest' cannot be listed as optional. This permission will be omitted.` 这是代码中的权限声明错误；此前 ZIP 完整性及 manifest 字段检查没有验证 Chrome 是否接受可选权限，不应视为已通过浏览器加载验收。

已按 [Chrome permissions 文档](https://developer.chrome.com/docs/extensions/reference/api/permissions)与 [DNR 权限文档](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)修复：必需权限使用 `declarativeNetRequestWithHostAccess`，可选权限保留 `cookies`；启用/检查/停用 B 站上传只请求/检查/撤销 Cookie 与 B 站主机访问。主机声明范围与 0.5.5 相同，未把 B 站改为默认授权。同步修改设置文案、README、隐私与图床文档，删除 `as never[]`。新增 `tests/manifest.test.ts` 防止该无效可选声明再次出现，现有授权拒绝/启用/撤销测试继续覆盖。

### 已完成的真实 Chrome 页面检查（运行中的版本为 0.5.5）

- 新开真实 `https://www.guozaoke.com/`，确认 `data-gzk-mounted=true`，不是本地回放或注入替身。首页在浅色/深色、1440 / 390 / 320px 宽度下均无水平溢出；只显示对应尺寸的一个搜索入口，最近浏览可见。记录共 9 次，包含重复主题状态，不将其计作三种主题或 9 个独立组合。
- 点击真实插件主题切换按钮确认其在浅色/深色间切换；晨曦需从控制选项选择，目前尚未完成晨曦的实站检查。
- 通过键盘焦点进入真实主题的「预览」按钮，打开 `/t/134112` 的真实预览弹窗并读到当前内容；后续尺寸测量和关闭操作尚未完成，不记为弹窗验收通过。
- `release/verification-0.5.6/live-ui-progress.json` 保存结构测量；`live-home-light-390.png`、`live-home-dark-390.png` 为真实已加载扩展的截图。截图只保存在本机，未上传。

### 修复包与等待事项

- 35 个测试文件、261 项测试通过，类型检查、生产打包及差异空白检查通过。新的权限回归和原有授权流程检查通过不等于真实 B 站上传验收。
- ZIP：`release/GuoZaoKe-Polish-0.5.6-chrome.zip`，215571 字节、20 个条目；归档完整、版本/权限声明、开发文件排除与主机范围核对通过。SHA-256：`cc808839d6d9f8d0803833d7ebaa74efdfeac5a9b2809016742808da4c7a1a0c`。`content.js` 和 `content.css` 与 0.5.5 字节一致。
- 新解压目录为 `release/GuoZaoKe-Polish-0.5.6-chrome/`。为保留现有扩展 ID 和本机设置，也将相同内容更新到用户实际加载的 `release/GuoZaoKe-Polish-0.5.5-chrome/`；原目录名保留，内部 manifest 为 0.5.6。0.5.5 ZIP 历史包未覆盖。
- 浏览器安全策略禁止访问 `chrome://extensions/` 和 `chrome-extension://…/options.html`，明确禁止绕过，因此重新加载及晨曦选择交由用户手动完成。后续 Chrome 又报告另一个扩展界面打开、暂时阻止自动化，已请求关闭该界面后继续。未尝试替代控制通道。
- **待用户重新加载 0.5.6 后确认警告是否消失；待完成晨曦、真实弹窗尺寸/焦点/关闭、主题详情及其它页面的实站验收。** 当前不宣称这批事项已通过。源码未提交、未推送、未发布商店；未发帖、回复、点赞、上传或消费积分。

## 0.5.5 UI、布局、样式两轮专项对抗审查（2026-11-03，本地构建）

### 检查方法与当前站点来源

本轮刷新当前首页和可访问主题 `/t/134112`，核对原生导航、搜索、近期浏览与编辑器结构，结合当前公开个人页、搜索页和站点样式，制作本地回放。帖子及回复正文替换为合成内容，表单值清空，移除原站业务脚本与提交行为；扩展 API 和资料请求使用内存替身。最近浏览记录为明确标注的模拟数据。三种插件主题使用当前原站主题脚本共同运行，样式表加载成功才计为通过。

两轮均先构造可复现失效情形，再针对原有组件作最小修复，最后交叉复验。浏览器组合检查共 116 项：页面/断点/主题布局 85 项、控件及极端状态 15 项、弹窗及 popup 13 项、导航文字和开关配色 3 项，全部无失败。组合项包含多条断言，不代表 116 个独立业务流程，也不代表完整 WCAG 认证。

### 第一轮：窄屏、原生新版布局和超长内容

| 编号 | 复现结果 | 修复后结果 |
| --- | --- | --- |
| UI-R1-1 / P2 | 原生完整搜索框与移动搜索入口在 992px 以下重复显示，插件伪元素还会叠加一个搜索图标。 | 尊重原生移动入口，只显示一个搜索入口；原生按钮独占图标，右侧导航保持对齐。 |
| UI-R1-2 / P2 | 320px 设置导航被压成逐字竖排，链接高度达 86px。 | 导航以完整项目换行，链接高度约 37px，页面无水平溢出。 |
| UI-R1-3 / P2 | 长作者名加信用徽章把 320px 主题页撑到 532px。 | 作者容器改为可断行的内联文本，页面宽度回到 320px。 |
| UI-R1-4 / P2 | 长资料卡高约 1565px，底部到 1935px，操作链接无法在 700px 视口内使用。 | 卡片内部滚动，320×700 下底部 688px、右边 308px；聚焦个人主页链接可见。窗口尺寸改变会关闭旧位置卡片，增加生命周期回归测试。 |
| UI-R1-5 / P2 | 插件旧的移动侧栏隐藏规则把原站新增的「最近浏览」一起隐藏。 | 991px 以下保留最近浏览容器，其余原有侧栏隐藏规则不变。390px 下记录区宽 360px。 |

### 第二轮：颜色、焦点、失败反馈与修复边界

| 编号 | 复现结果 | 修复后结果 |
| --- | --- | --- |
| UI-R2-1 / P2 | 主要按钮文字对比度约为浅色 2.54、深色 1.92、晨曦 3.42；浅色/晨曦导航和已读文字过淡。 | 复用主题正文/面板色作为主要按钮前景背景，对比度为 14.63 / 7.60 / 6.96；非当前导航为 5.19 / 6.38 / 5.23；开关滑块与轨道对比度最低 3.43。去掉背景色过渡，避免切换主题瞬间前景与背景不匹配。 |
| UI-R2-2 / P2 | 深色错误提示文字颜色对比度约 3.2。 | 三种主题共享语义错误色，对比度为 6.47 / 7.92 / 7.26。 |
| UI-R2-3 / P2 | 超长错误提示可见宽 270px、内部横向内容达 3883px。 | 连续文本可换行，横向内容等于可见宽度；320×700 下顶部 362px、底部 670px，长内容在提示内部滚动。 |
| UI-R2-4 / P2 | 编辑器和标签输入框进入键盘焦点状态后，后面的 focus 重置规则使轮廓仍为 0。 | 增加优先级明确的 focus-visible 轮廓，两处实测均至少 2px，三种主题通过；设置页控件保留 3px 轮廓。 |
| UI-R2-5 / P2 | 320×240 短窗口工具箱高 140px、顶部 88px，覆盖阅读区域中央。 | 工具箱限制高度并内部滚动，顶部 132px、高 96px，不占据视口中央。 |
| UI-R2-6 / P2 | 24 列表格使整个弹窗横向滚动，滚到最右侧关闭按钮左边变成 -131px；主题正文也可把 320px 页面撑到 389px。 | 横向滚动限制在表格内部。弹窗宽 284px，关闭按钮在 250–282px；正文表格可见宽 262px、内部内容宽 360px，页面保持 320px。正文与回复表格共用同一规则。 |

颜色检查参考 W3C 的[文字对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)与[非文字对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。这些是所测控件和状态的计算样式检查，未覆盖所有文本、所有交互状态或辅助技术。

### 最终验证、证据与安装包

- `npm run typecheck`、34 个测试文件 / 260 项测试、`npm run zip` 通过；本轮新增资料卡 resize 清理回归。无新增依赖、权限或数据格式迁移。
- 布局组合覆盖首页、主题、个人页、搜索页；宽度 320 / 390 / 768 / 991 / 992 / 1024 / 1440，浅色 / 深色 / 晨曦；另测主题横向布局、设置导航、popup、长资料卡、长错误提示、宽表格、编辑器键盘焦点、标签弹窗与 240px 高短窗口。
- 本机 `release/verification-0.5.5/` 保存 `layout-results.json`（85）、`states-results.json`（15）、`dialogs-results.json`（13）、`palette-results.json`（3）及三个浏览器检查驱动；before/after 截图与 `package-audit.json` 同目录。`after-modal-320.png` 缩短合成说明文本，以显示滚到最右侧的宽表格与关闭按钮；长正文仍由组合检查覆盖。
- 最终截图：`after-options-390.png`、`after-options-320.png`、`after-topic-320.png`、`after-modal-320.png`、`after-toast-dark.png`。本地夹具一个原生回复图标的相对路径曾导致 404，已修正为原站地址并确认图标加载；原站旧 viewport 字段 `target-densitydpi` 的浏览器警告未修改。
- 安装包 `release/GuoZaoKe-Polish-0.5.5-chrome.zip`，215570 字节、20 个条目；完整性、根 manifest 版本、站点/CDN 权限和内容匹配通过；与 0.5.4 的 manifest 除版本号外一致，未包含开发夹具或环境文件。已解压加载目录为 `release/GuoZaoKe-Polish-0.5.5-chrome/`。
- SHA-256：`c8895de799fb48092ef9e23b262a890bf6b7d66daa3f58c62f93d1a4d1aa8e07`。
- 两轮列出的问题均已修复并复验，本轮范围未留待修复的阻断项。源码未提交、未推送；未发布 GitHub Release 或 Chrome 商店。

### 验证限制

实时检查用于确认当前原生结构，运行验证使用脱敏回放。原账户浏览器控制通道中途停滞，未反复重试或绕过限制；后续检查在独立的无账户测试上下文完成。尚未将安装包加载到真实 Chrome 扩展环境进行完整实站验收，未测试实体移动设备、输入法或屏幕阅读器；未执行真实发帖、回复、点赞、图片上传、积分消费或账户设置保存。以上 UI 检查不作为这些业务写入流程的验收证据。

## 0.5.4 实时实站核查与两轮对抗审查（2026-11-03，本地构建）

### 实站检查范围与证据

本轮直接访问当前登录态网页，不以公告列出的功能为边界。记录 18 份页面结构、覆盖 17 条不同路由：首页、主题、发帖、独立图片上传、空搜索与 `q=AI` 结果、个人设置、隐私设置、图片托管设置、我的早点、早点铺、消息、个人页及其主题/回复/收藏子页、节点、成员。搜索结果有 20 项；成员页有 108 个原生成员条目。搜索页还存在原生 AI 问答入口，积分导航含置顶、流转、悬赏等入口。

同时从实站页面发现的地址获取 20 个站点自有脚本/样式，均返回 200，并记录 URL、类型、字节数与 SHA-256。结构快照只记录字段名称、类型及控件，不记录 Cookie、表单值、Token 或密码。证据在本机 `release/verification-0.5.4/live-structure-audit.json`。这批地址和内容哈希代表本轮检查时的版本，后续站点变化需要重新核查。

### 第一轮：主动构造失效场景，修复后再测

按单个浏览器页面、当前页加最多两页预加载的使用量审查。以下问题均已修复；三个生命周期回归用例在修复前失败、修复后通过。

| 编号 | 可复现的问题与后果 | 修复与验证 |
| --- | --- | --- |
| R1-1 / P2 | 插件在原站启动脚本前接管主题，会把 HTML 默认浅色误记为原站偏好；停用后恢复错误颜色。 | 启动保护阶段只应用插件标记，原站主题接管延至 DOM 就绪后的页面挂载。`tests/page-bootstrap.test.ts` 模拟原站随后恢复深色偏好。 |
| R1-2 / P2 | 挂载失败后只解除页面隐藏，插件主题和广告标记仍留着，不能正常降级。 | 启动失败或销毁时撤销外观标记并恢复原站主题。`tests/page-bootstrap.test.ts` 覆盖失败降级。 |
| R1-3 / P2 | 另一标签页触发原站主题存储事件后，原站属性与内联颜色覆盖插件主题，出现混合样式。 | 仅观察根节点主题/样式变化；保留原站最新偏好后重新应用插件主题，停用时恢复该偏好。`tests/ui.layout.test.ts` 和原站真实主题脚本的本地回放均通过。 |
| R1-4 / 验证缺口 | 上传按钮测试额外绑定了直接调用上传函数的假处理器，即使真实按钮失效也可能通过。 | 删除假处理器，点击真实插件按钮并等待真实异步回调；修正后的测试通过。 |

### 第二轮：复查修复边界、原生数据和失败清理

以下问题均已修复并复验。回复身份/合并保真与末尾存储失败的回归用例在修复前失败、修复后通过；账户隐藏使用浏览器计算样式验证。

| 编号 | 可复现的问题与后果 | 修复与验证 |
| --- | --- | --- |
| R2-1 / P2 | 合并后续分页时重建回复壳，丢掉原站 `r…` 锚点，原生定位地址失效。 | 仅保留与解析回复编号一致的原生锚点。`tests/replies.test.ts` 验证编号和 DOM 锚点一致。 |
| R2-2 / P2 | 没有点赞链接的原生回复退化成楼层编号；合并时还会补出原站没有的点赞按钮。 | 从原生锚点补充回复身份，只为原来有点赞入口的回复构建按钮。`tests/site.test.ts`、`tests/replies.test.ts` 覆盖。 |
| R2-3 / P2 | 合并回复只复制第一项 `.time`，新结构中的发帖时间、楼主标记或地区字段丢失。 | 按原顺序复制全部原生时间类元数据；显示仍遵循原有“隐藏回复时间”设置。`tests/replies.test.ts` 核对复制前后字段。 |
| R2-4 / P2 | “隐藏账户”只覆盖旧用户名、头像和网站，新签名/年代及早点卡片仍可见。 | 将新身份容器和早点卡片纳入视觉模糊处理；浏览器计算样式均为 `blur(5px)`，关闭选项可恢复。该功能用于视觉专注，不是安全脱敏。 |
| R2-5 / P2 | 第一轮只撤销外观仍不充分：控件装好后保存已读状态失败，会留下工具箱、主题监听与挂载标记。 | 在末尾异步初始化前注册统一销毁函数，失败时运行该清理。`tests/ui.layout.test.ts` 验证工具箱移除、挂载标记清除、原站按钮可继续接收点击。 |

### 最终检查与交付

- 34 个测试文件、259 项测试通过；`npm run typecheck`、`npm run zip`、`git diff --check` 通过。无新增依赖或数据格式迁移。
- 本轮补充当前搜索与商城的脱敏片段回放，使用当前原站样式和原站主题脚本，扩展 API 为内存替身。覆盖 2560 像素桌面和 390×844 窄屏；20 项搜索结果、2 个商城原生表单保留，没有页面水平溢出；主题事件、停用恢复和新增账户区域的视觉隐藏通过。
- 截图：本机 `release/verification-0.5.4/search-mobile-dawn.jpg`、`points-mobile-dark.jpg`、`points-desktop-account-mask.jpg`。
- ZIP：`GuoZaoKe-Polish-0.5.4-chrome.zip`，215187 字节、20 个条目；根 manifest 为 0.5.4，站点、裸域、CDN 权限和资源匹配正确；归档完整且没有开发夹具或环境文件。
- SHA-256：`992067824180bf479faa00d872267c47d67afccb3ba07447996ef6f849490716`。包和已解压加载目录位于本机 `release/`。
- 两轮所列问题已关闭，本轮范围内未留待修复的阻断项。源码未提交、未推送；未发布 GitHub Release 或 Chrome 商店。

### 验证限制

实站核查为当前登录态页面结构和资源读取。尝试在审查标签临时注入运行验证时，浏览器调试通道报告文档响应仍受浏览器控制层管理，CDP 不可用；未绕过此限制。运行态复验因此采用本地脱敏回放与 DOM 回归，尚未完成把安装包加载进 Chrome 后的实站完整验收。未执行真实发帖、回复、点赞、图床上传、隐私设置保存或积分消费，也未测试另一账号的私密资料授权结果。

## 0.5.3 论坛新版兼容（本地构建，2026-11-03）

- 只读核对 [论坛更新公告](https://www.guozaoke.com/t/134215)、当前首页/主题/个人页，以及原站主题、点赞、预览、图片上传脚本；在现有登录态浏览器中只读检查回帖编辑器结构，未提交草稿或执行点赞、上传、积分操作。
- 34 个测试文件、253 项测试通过；`npm run typecheck`、`npm run zip`、`git diff --check` 通过。
- 新增/更新回归：信用等级与作者名分离；原生回复锚点保留；图片粘贴/拖放让给原站上传组件；原站实时预览不重复；新版个人卡片签名与身份结构保留；主题切换/停用还原；POST 点赞/取消点赞、防伪字段、登录失效、无效响应与服务端赞数。
- 浏览器渲染核查使用当前公开页面结构与样式的本地副本（扩展 API 为内存替身，主题页仅在验证包中将本地路径转换为站点主题路径），覆盖桌面与 390×844 窄屏。确认主题开关联动、停用恢复、34 条原生回复锚点、信用徽章可读及无水平溢出。截图在本机 `release/verification-0.5.3/`。这不是安装后的完整 Chrome 扩展端到端验收。
- ZIP：`GuoZaoKe-Polish-0.5.3-chrome.zip`，215013 字节、20 个条目；根 manifest 为 0.5.3，站点、裸域、CDN 权限及资源匹配已核对；归档完整且不含开发夹具、研究目录或环境文件。
- SHA-256：`684b8950ea35368c824607217d523ef1cfcc9ebe329a8f1c07f2af3653a3a9eb`。
- 设置与本机数据格式未变；更新因站点权限域名修正可能需要 Chrome 重新确认站点访问权限。
- 0.5.3 尚未发布 GitHub Release 或 Chrome 应用商店。真实点赞写入、原站 ImgURL / B 站 / Imgur 上传、评分自动回帖及积分兑换未执行；积分、隐私、搜索与视频播放仍由原站处理，本次不宣称这些业务闭环已验收。

## 0.5.2 全量核查与实站修复（本地包，2026-10-13）

- 2026-10-13：34 个测试文件通过、243 项测试通过；类型检查与生产打包通过。
- 回归覆盖：真实回帖表单 `action=""` 解析与隐藏字段透传；评分启发式分值分布；B 站上传 DNR 会话规则（UA/Referer）与可选权限集；同名上传占位隔离；成员卡片卡内悬停；回复区缺标题降级；个人页头像 `src` 消毒；`reading:remove` 校验；点赞网络/JSON 异常友好提示；选项页评分配置归一化。
- 权限变化：`host_permissions` 增加 `https://static.guozoke.com/*`；`optional_permissions` 增加 `declarativeNetRequest`（仅与 Cookie、`api.bilibili.com` 一并由用户在启用 B 站上传时授予）。从 0.5.1 升级的 B 站用户需重新点一次「启用 B 站上传」。
- 真实站点只读验收（0.5.2 前，账号 `tuzhishigou`）：`loggedInUsername` 从真实 HTML 正确解析；表单为 `action=""` + `tid` + `_xsrf` + `textarea.J_replyContent[name=content]`。**自动回帖 POST 返回 200 但内容未落库**——用浏览器原生表单提交同样被丢弃，判定为站点侧账号限制，非扩展代码问题；仍待第二个账号完成 trigger→扫描→回帖闭环。
- ZIP：`GuoZaoKe-Polish-0.5.2-chrome.zip`，213833 字节、20 个条目，根 manifest 为 0.5.2；`host_permissions` 含 `static.guozoke.com`，`optional_permissions` 含 `declarativeNetRequest`；归档完整性、排除测试/研究/环境文件及常见 Key 形态扫描通过。
- SHA-256：`bbe29b9f0054eaacbb232b4ba4ff8c5fefc1974aa33936d1b2b82811a7b50f9f`。
- GitHub Release v0.5.2：见 [v0.5.2](https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.5.2)。本次仍未提交 Chrome 应用商店。B 站真实上传与自动回帖闭环仍待真实浏览器/第二账号验收。

## 0.5.1 0.5.0 真实环境修复（本地包，2026-10-12 重新打包）

- 2026-10-12：34 个测试文件通过、234 项测试通过；类型检查、生产打包和差异空白检查通过。
- 回归覆盖：选项页 nav 重复 bug 修复（删迁移遗留的 `analysisLink`，左侧导航仅保留 star 图标入口）；评分助手分步说明内置到选项页（注册 → 登录 → @ 触发 → 扫描 → 错误码对照）；B 站图床补发 Chrome `User-Agent`，412 错误信息区分反爬与其它失败；验证文档同步 5 类回帖失败原因对照表与 412 排查指引。
- ZIP：`GuoZaoKe-Polish-0.5.1-chrome.zip`，213330 字节、20 个条目，根 manifest 为 0.5.1，权限与 0.5.0 相同；归档完整性、排除测试/研究/环境文件及常见 Key 形态扫描通过。
- SHA-256：`5ae505d676aa3adc1b2bb2d743d4f0bbc59c56d8e91d5e933c2833fc8c8f722f`。
- GitHub Release v0.5.1 已发布（[v0.5.1](https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.5.1)）：ZIP `GuoZaoKe-Polish-0.5.1-chrome.zip`、213330 字节、SHA-256 `5ae505d676aa3adc1b2bb2d743d4f0bbc59c56d8e91d5e933c2833fc8c8f722f`、20 个条目。本次仍未提交 Chrome 应用商店。真实过早客 / B 站环境仍待新安装包在真实浏览器中验收。

## 0.5.0 删除讨论分析 + 粘贴自动上传 + 评分助手（本地包，2026-10-09 重新打包）

- 2026-10-09：31 个测试文件通过、209 项测试通过；类型检查、生产打包和差异空白检查通过。
- 回归覆盖：讨论分析整套删除（含 `sidePanel` 权限与 PDF.js 依赖移除）；图片粘贴/拖放改为自动上传（占位 → 上传 → 替换/失败清除）；评分助手（`src/rating/`）启发式分（赞同/长度/独特词/密度）、`@<assistant>` 触发识别、cookie-strict 模拟发回帖（仅在 `/t/*` 终点 POST 评分回帖，不持久化 Cookie）。
- 模拟 HTTP、模拟 Cookie 与模板化的过早客表单不代表真实过早客写操作；助手账号必须在与扩展同一浏览器窗口登录且未隐身。
- ZIP：`GuoZaoKe-Polish-0.5.0-chrome.zip`，214953 字节、20 个条目，根 manifest 为 0.5.0，权限移除 `sidePanel`，`cookies` 仍为可选；归档完整性、排除测试/研究/环境文件及常见 Key 形态扫描通过。
- SHA-256：`62396447f07ba1fdead43119cae6ac1e00b385d298fb010226486adaad3d7e9b`。
- GitHub Release v0.5.0 已发布（[v0.5.0](https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.5.0)）：ZIP `GuoZaoKe-Polish-0.5.0-chrome.zip`、214953 字节、SHA-256 `62396447f07ba1fdead43119cae6ac1e00b385d298fb010226486adaad3d7e9b`、20 个条目。本次仍未提交 Chrome 应用商店。真实图床与过早客写操作仍待新安装包在真实浏览器中验收。

### 评分助手真实使用步骤

1. 在扩展选项页 → 左侧「评分助手」标签 → 填写助手账号名（与过早客注册的用户名一致，不带 `@`），保存配置。
2. 在过早客注册同名小号；在同一浏览器的普通窗口（非隐身模式）登录该小号。隐身窗口评论邮件过期会被当作未登录。
3. 打开任意帖子页，右侧工具栏点「扫描评分」。若帖内有 `@助手账号名` 的回帖，会被启发式打分；如开启了「评分后发回帖」，会以助手账号发一条 `[GuoZaoKe 评分 · X/10] …` 的公开回帖。
4. 评分回帖失败时页面右上角 toast 会显示具体原因：
   - `未登录过早客，未发回帖`：当前浏览器未登录过早客，或 `PostReply` 关闭后扫描但该助手账号未登录。
   - `当前登录账号与助手账号不一致，未发回帖`：填写的助手账号名与浏览器登录的用户名不一致。
   - `未找到站点回帖表单，未发回帖`：过早客当前主题页未解析到回复表单（罕见，通常与站结构升级相关）。
   - `站点拒绝了回帖请求`：HTTP 非 2xx 或被风控拦截。
   - `回帖请求已提交，但未能确认发布结果，请到帖子中核对`：扩展认为 POST 成功但响应 HTML 中没回显评分 marker，可能仍已发布或被风控静默丢弃。

### B 站图床 HTTP 412 说明

B 站 2024 年升级反爬策略后，`upload_bfs` 接口在没有浏览器 Referer、设备指纹头或登录态缺失时会返回 412 Precondition Failed。0.5.1 曾尝试用 `fetch` 附加 `User-Agent`，但该头属于浏览器禁止头，会被静默丢弃。**0.5.2 起改为通过可选 `declarativeNetRequest` 会话规则，在上传期间对 `api.bilibili.com` 改写 `User-Agent` 与 `Referer`。** 仍无法伪造 `X-Bili-Device-Fingerprint` 等设备指纹。遇到 412 时：

- 确认本浏览器普通窗口（非隐身）已登录 B 站；`bili_jct` Cookie 存在且未过期。
- 从 0.5.1 升级后，在选项 → 图床配置中重新点击「启用 B 站上传」以授予 `declarativeNetRequest`。
- 在选项 → 图床配置中点击「停用 B 站上传」后改用 Imgur；Imgur 不受 B 站风控影响。
- 真实环境抓包以 DevTools Network 为准；若确认已登录且权限齐全但仍 412，多半是 B 站风控拦截，可稍后重试或换 Imgur。

## 0.4.4 DeepSeek 输出额度修复（本地包，2026-09-24 再次打包核对）

- 2026-09-24 再次打包：51 个测试文件通过，619 项测试通过、1 项因未附完整本地研究原件而跳过；类型检查、生产打包和差异空白检查通过。
- 回归覆盖 64K 从配置传到任务和 HTTP、自动/手动额度、旧配置读取迁移、官方地址识别、官方模型名大小写不敏感、384K 上限、跨越旧 60 秒限制、主动取消、5 分钟超时、大响应读取及新旧结果分离。模拟 HTTP 不代表真实 DeepSeek 输出或已安装扩展已通过验收。
- ZIP：`GuoZaoKe-Polish-0.4.4-chrome.zip`，816670 字节、31 个条目，根 manifest 为 0.4.4，权限与 0.4.3 相同；归档完整性、排除测试/研究/环境文件及常见 Key 形态扫描通过。
- SHA-256：`45c7f560d501d131fea38eac8d7f25756fc89f714ccdf99643704c65de86e0ea`。
- GitHub Release v0.4.4 已发布（[v0.4.4](https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.4.4)）：ZIP `GuoZaoKe-Polish-0.4.4-chrome.zip`、816670 字节、SHA-256 `45c7f560d501d131fea38eac8d7f25756fc89f714ccdf99643704c65de86e0ea`、31 个条目。本次未提交 Chrome 应用商店。真实 API 仍待更新扩展后验证。

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
