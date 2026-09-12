# Chrome 应用商店填写材料

适用版本：0.3.12。整理日期：2026-09-13。

这是供开发者控制台粘贴的材料，不是提交成功回执。控制台当前字段未能读取：浏览器工具返回 `The extensions gallery cannot be scripted.`。下面的分类与字段名称需按实际界面匹配。

## 安装包与图片

- 上传 `release/GuoZaoKe-Polish-0.3.12-chrome.zip`，不要上传 GitHub 的 Source code ZIP。
- ZIP 内 `manifest.json` 位于根目录，版本 0.3.12。
- SHA-256：`2ffb22c7f027a29004396bdb8ed00ad42a3afc931f642cb202e614373aa93579`。
- 商店图标：`public/icon/128.png`。
- 已准备 4 张真实功能截图：本地 `release/chrome-web-store/screenshots/`，均为 1280 × 800 JPEG。截图来自 0.3.11；0.3.12 调整的是项目链接，这 4 张截图展示的页面外观不变。
- 仍需准备 440 × 280 小型宣传图；1400 × 560 大型宣传图为可选项。

## 商店详情

| 字段 | 内容 |
| --- | --- |
| 名称 | GuoZaoKe Polish |
| 主要语言 | 简体中文 |
| 分类建议 | 社交媒体与社交网络 / Social Media & Networking（以实际菜单为准） |
| 官方网址 | 未验证网站所有权时保留“无”；仅可选择 Search Console 中已验证的网站 |
| 首页网址 | https://github.com/laoertongxue/GuoZaoKe-Polish |
| 支持网址 | https://github.com/laoertongxue/GuoZaoKe-Polish/issues |
| 隐私政策网址 | https://github.com/laoertongxue/GuoZaoKe-Polish/blob/main/docs/privacy.md |
| 作者博客（如有对应字段） | https://www.shierhuasheng.cn |

### 中文简短说明

```text
为过早客添加现代界面、嵌套回复、热门回复、主题预览、用户标签与稍后阅读。
```

### 中文详细说明

```text
GuoZaoKe Polish，让过早客的浏览与阅读更从容。

专为 guozaoke.com 打造的社区体验增强扩展，在原有内容与操作入口上，改善页面排版、主题浏览、回复阅读与编辑体验。

更舒适的阅读界面
• 浅色、深色与晨曦主题，支持跟随系统。
• 统一导航、卡片、分页与页脚，提供紧凑间距和横向阅读选项。

更顺手的主题浏览
• 在列表中预览主题内容，先看摘要再决定是否打开。
• 将感兴趣的主题加入稍后阅读，管理阅读状态。
• 通过扩展面板查看最新主题、热门主题和站点通知。

更清晰的讨论脉络
• 多种回复布局、热门回复、长回复折叠与楼层跳转。
• 按设置合并后续最多两页回复，并保留原站分页入口。
• 楼中楼关系依据引用与提及推断，便于梳理讨论。

更方便的编辑与分享
• 图片表情、Unicode 表情、颜文字、Markdown 预览及 Base64 编解码。
• 图片查看与缩放，在本机生成主题分享图和二维码。
• 可选 Imgur 上传，需要自行配置 Client ID 并授权；仅在主动点击上传时发送所选图片，生成的图片链接为公开链接。
• 编辑辅助只操作草稿，不会自动提交帖子或回复。

自己的阅读习惯，自己管理
• 自定义用户标签、设置同步与 JSON 备份导入导出。
• 设置与标签使用 Chrome 同步存储，稍后阅读保存在本机。
• 不含分析统计 SDK、广告 SDK 或作者自建遥测服务器。扩展会为上述功能处理站点内容、用户名与阅读记录；完整数据流见隐私政策。

安装后打开过早客，通过扩展面板中的“控制选项”调整功能。浏览公开主题无需另外注册扩展账号；站点通知及发帖等功能遵循过早客自身的登录要求。界面语言为简体中文。

这是独立开发的第三方扩展，不隶属于过早客或 V2EX Polish。体验参考 V2EX Polish，功能与适配持续完善，站点改版可能影响部分功能。

Made by 拾贰画生
有那么点儿追求的中年男人
博客：https://www.shierhuasheng.cn
反馈：https://github.com/laoertongxue/GuoZaoKe-Polish/issues
隐私：https://github.com/laoertongxue/GuoZaoKe-Polish/blob/main/docs/privacy.md
```

### English short description

```text
A more comfortable Guozaoke experience with themes, reply layouts, topic previews, user tags, and read-later.
```

### English detailed description

```text
GuoZaoKe Polish makes browsing and reading Guozaoke more comfortable.

Designed for guozaoke.com, this extension improves the community's page layouts, topic browsing, reply reading, and composing experience while retaining the site's content and navigation.

Comfortable reading
• Light, dark, and dawn themes, with a system theme option.
• Consistent navigation, cards, pagination, and footer styling, plus compact spacing and horizontal reading options.

Convenient topic browsing
• Preview topics from the topic list.
• Save topics to read later and manage read status.
• Access recent topics, popular topics, and site notifications from the extension panel.

Clearer discussions
• Alternative reply layouts, popular replies, long-reply folding, and floor navigation.
• Optionally merge up to two following reply pages while keeping native pagination links.
• Nested relationships are inferred from references and mentions.

Composing and sharing
• Image emoji, Unicode emoji, kaomoji, Markdown preview, and Base64 encoding and decoding.
• Image viewing and zooming; share images and QR codes are generated locally.
• Optional Imgur uploads require your own Client ID and permission. Images are uploaded only after an explicit action, and the returned image links are public.
• Editing tools modify drafts; they do not automatically submit posts or replies.

Personal preferences
• Custom member tags, settings synchronization, and JSON backup import/export.
• Settings and tags use Chrome sync storage; read-later entries stay in local extension storage.
• No analytics SDK, advertising SDK, or developer-operated telemetry server. Site content, usernames, and reading records are processed to provide the features above; see the privacy policy for details.

Open Guozaoke after installation and use the extension's settings to customize features. Public topics do not require a separate extension account. Notifications and posting follow the website's own sign-in requirements. The extension interface is currently in Simplified Chinese.

This independently developed third-party extension is not affiliated with Guozaoke or V2EX Polish. Its experience is inspired by V2EX Polish. Features and compatibility continue to improve, and website changes may affect functionality.

Made by 拾贰画生 (Shier Huasheng)
Blog: https://www.shierhuasheng.cn
Support: https://github.com/laoertongxue/GuoZaoKe-Polish/issues
Privacy: https://github.com/laoertongxue/GuoZaoKe-Polish/blob/main/docs/privacy.en.md
```

当前安装包没有 `_locales` 配置；英文文案作为备用翻译，不代表扩展已提供英文界面。若后台没有英文详情入口，先使用中文详情；不要填写为已支持英文界面。

## 隐私：单一用途

```text
增强 guozaoke.com 的社区浏览与阅读体验：在原站页面提供主题与排版优化、主题预览、回复阅读、稍后阅读、用户标签，以及配套的编辑和本地分享辅助。全部功能围绕用户在过早客阅读和参与讨论展开。
```

## 隐私：权限理由

### storage

```text
保存扩展功能所需的用户设置、用户标签和稍后阅读记录。设置及标签使用 chrome.storage.sync；稍后阅读的主题元数据、阅读状态及用户自行配置的 Imgur Client ID 使用 chrome.storage.local。Client ID 不进入同步或 JSON 备份。
```

### contextMenus

```text
仅在 guozaoke.com 页面提供右键快捷入口：将主题加入稍后阅读、对选中的文本进行 Base64 解码，以及打开扩展控制选项。菜单通过 documentUrlPatterns 限制在目标站点。
```

### 主机权限：过早客及可选图片来源（若后台合并成一个输入框）

```text
https://www.guozaoke.com/* 和 https://guozaoke.com/* 用于在过早客页面注入界面与阅读增强，并读取主题、回复、用户信息及通知，以实现主题预览、回复布局、稍后阅读和用户面板。站点请求使用浏览器已有登录态，扩展不读取或保存 Cookie 值。

可选 https://api.imgur.com/* 仅用于用户自行配置 Client ID 并授权后，主动点击上传时把所选图片发送到 Imgur。

可选 https://*/* 和 http://*/* 用于分享图包含的公开头像及正文图片。图片可来自不同来源，扩展不会一次请求这些通配范围；用户先看到需要访问的图片来源列表，再通过明确操作只授权所列出的具体 origin。外部图片请求不携带 Cookie、不跟随重定向；这些来源不注入内容脚本、不用于读取其他网页或全局浏览历史。分享图在本机生成。
```

若后台按每个域名单独显示权限理由，将上述三个段落分别填入对应域名字段。可选权限仍需说明用途。

### 远程代码

选择：**否，不使用远程代码**。

若有解释栏，可填：

```text
所有扩展 JavaScript 和功能依赖均随安装包分发，在本地执行。远程请求用于读取过早客页面数据、公开图片或用户主动发起的 Imgur 上传；不会下载并执行远程 JavaScript 或 WebAssembly，也不会把获取的网页脚本作为扩展代码执行。
```

## 隐私：数据类型与使用认证

不要因为没有作者服务器就选择“完全不处理数据”。Google 要求披露本机处理和 Chrome 同步存储中的用户数据。以下依据当前实现整理；最终勾选应与后台字段的完整定义核对。

| 数据范围 | 当前实现 |
| --- | --- |
| 个人身份信息 | 处理站点用户名、头像和用户卡片信息；标签按用户名关联，标签与对应用户名可通过 Chrome 同步。应披露。 |
| 网站内容 | 处理主题、回复、编辑器草稿、图片及用户选择上传的文件。应披露。 |
| 网络记录 / 浏览活动 | 稍后阅读记录包括用户选择保存的主题 URL、元数据和阅读状态；不调用 Chrome history API。应披露这些功能所需的记录。 |
| 用户活动 | 处理用户主动保存、标记已读、设置标签和编辑草稿的操作；不生成鼠标、键盘或点击遥测日志。按后台对此项的具体定义核对。 |
| 身份验证信息 | 不读取或保存站点密码、Cookie 值或访问令牌；站点请求使用浏览器已有登录态。另有本机保存、用于 Imgur API 请求的用户自配 Client ID。需结合后台对此项的完整定义核定，不能概括成“从不使用认证”。 |
| 个人通信 | 不实现私信收发或电子邮件读取，但会读取原站通知页面。需按后台定义确认这些通知是否计入该类，不能因有“消息”按钮就假定是私信功能。 |
| 健康、支付、精确位置等 | 不提供这些领域的专门收集功能。普通网页和用户主动选择的图片可能包含此类内容，不应额外宣称扩展会识别或审查内容中的敏感信息。 |

按当前实现可作出的使用声明：不出售用户数据；不把数据用于与扩展单一用途无关的目的；不用于信用评估或借贷决策。提交时应阅读后台各项认证全文，并保持它们与隐私政策及实际功能一致。

## 审核员测试说明

```text
1. 安装扩展，打开 https://www.guozaoke.com/。浏览公开主题和基础界面增强不要求另外注册扩展账号。
2. 打开扩展面板中的控制选项，切换浅色、深色和晨曦主题；返回网站检查页面。可关闭扩展增强以检查原站恢复。
3. 在主题列表使用预览、稍后阅读；在阅读列表中标记已读或删除条目。
4. 打开含多条回复的主题，检查回复布局、热门回复和楼层跳转。用户标签、设置和 JSON 备份可在控制选项中管理。
5. 通过主题的分享入口生成图片或二维码；这些内容在本机生成。若正文图片来自尚未获准的外部来源，分享页会显示来源列表，点击后只申请对应的具体 origin。
6. 原站通知和编辑器需要用户自己的过早客账号，扩展不绕过站点登录。请勿为测试而公开发布帖子或回复。
7. 可选 Imgur 上传需在控制选项配置审核者自己的 Client ID，授权并保存后，选择图片并明确点击上传。图片会被发送到 Imgur，返回公开链接。当前未提供共享账号或 Client ID；尚未完成真实 Imgur 账户的端到端上传验收。
8. 源码和隐私政策： https://github.com/laoertongxue/GuoZaoKe-Polish 。未提供登录凭据；若审核必须使用测试账号，应由发布者通过控制台的专用测试凭据字段另行提供，不能放在公开说明里。
```

## 发布状态

- 当前安装包为预发布版本，完整实站兼容验收范围见 `docs/verification.md`。
- 本次未填写、保存或提交开发者控制台，未取得商店项目 ID 或审核回执。
- 账号身份、交易者声明、真实联系资料、发布地区和最终数据类型勾选，不能由账号昵称或个人博客推断。

## 官方填写依据

- [隐私字段与权限理由](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [用户数据 FAQ：本机处理也需披露](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [商店图像尺寸](https://developer.chrome.com/docs/webstore/images)
- [商店分类说明](https://developer.chrome.com/docs/webstore/best-practices)
