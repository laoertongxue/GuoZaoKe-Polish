<div align="center">
  <img src="public/icon/128.png" width="80" height="80" alt="GuoZaoKe Polish">
  <h1>GuoZaoKe Polish</h1>
  <p>让过早客的浏览与阅读更从容。</p>
  <p>A more comfortable way to browse and read Guozaoke.</p>
  <p><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
  <p><a href="https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.4.2">下载安装包</a> · <a href="https://github.com/laoertongxue/GuoZaoKe-Polish/issues">反馈问题</a> · <a href="docs/privacy.md">隐私说明</a></p>
</div>

---

为 [过早客](https://www.guozaoke.com/) 开发的 Chrome 扩展，以 [V2EX Polish](https://github.com/coolpace/V2EX_Polish) 的阅读体验为参考，使用 **WXT、TypeScript 和原生 DOM/CSS 独立实现**。改善原有社区页面的排版、主题和交互，保留原站内容与操作入口。

**0.4.2 为 GitHub 预发布版**，新增讨论分析侧栏和 B 站图床试用接入。下载与更新方式见下方；GitHub 版本与 Chrome 应用商店分开发布，商店状态以商店页面为准。完整的实站兼容性与参考体验对齐范围见 [验证范围](docs/verification.md)。

讨论分析支持个人 API、受控采集与材料读取、可追溯数据、逐段回复观察、历史与冻结输入复跑。模型试验条件通过不等于事实认证；真实多模型准入仍待验证。使用方法见 [讨论分析说明](docs/analysis.md)，进度见 [验收记录](docs/analysis-validation.md)。

## 功能

| 方向 | 已实现的能力 |
| --- | --- |
| 阅读界面 | 浅色、深色、晨曦主题；跟随系统；紧凑间距与横向阅读；统一导航、卡片、分页和页脚。 |
| 广告隐藏 | 默认隐藏过早客的侧栏推广、Google 浮动广告及收起按钮，并清理广告占位；可在控制选项关闭。仅隐藏页面元素，不拦截广告网络请求。 |
| 主题浏览 | 主题预览、稍后阅读、已读状态；扩展面板中的最热、最新主题与消息。 |
| 回复阅读 | 楼中楼缩进、靠左对齐、原始楼层；热门回复、长回复折叠和楼层跳转。 |
| 分页增强 | 在主题第一页按设置合并后续最多两页回复，去重并标识已合并页码；保留原站分页链接。 |
| 用户信息 | 用户卡片、自定义标签；个人页、主题、回复、收藏导航。 |
| 编辑辅助 | 31 种流行图片表情、Unicode 表情、颜文字；Markdown 预览、Base64 编解码；图片选择、粘贴和拖放。 |
| 讨论分析（试用） | 自有 AI 接口、帖子采集、主张与证据表、仅限本帖的回复观察、分析侧栏、历史恢复及固定输入复跑；真实模型准入仍待验证。 |
| 图片上传（试用） | B 站浏览器登录态上传；保留 Imgur 和已有链接；手动授权及上传，失败保留队列，不自动换图床。 |
| 图片与分享 | 全屏图片预览及缩放；本地生成富文本分享图、二维码与长文分图。 |
| 数据管理 | 设置同步、标签管理、JSON 备份与导入；右键菜单入口。 |

首次使用默认浅色、站内打开主题、纵向布局，关闭回复预加载。已有设置不会因升级重置。回复层级依据楼层引用与提及推断，过早客没有提供真实父评论字段。

## 安装与更新

1. 打开 [v0.4.2 Releases](https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.4.2)，下载 `GuoZaoKe-Polish-0.4.2-chrome.zip` 并解压。
2. 在 Chrome 地址栏输入 `chrome://extensions/`，打开「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后**直接包含 `manifest.json`** 的目录。
4. 新开一个 [过早客](https://www.guozaoke.com/) 页面。点击扩展图标打开面板，通过「控制选项」调整设置。

更新时，将新文件解压到原先加载的目录，在扩展管理页点击重新加载，再新开过早客页面。已有页面可在保存草稿、结束阅读后自行刷新。可先在设置页导出 JSON 备份。

## 从源码构建

使用 Node.js 26（见 `.nvmrc`）和 npm：

```sh
git clone https://github.com/laoertongxue/GuoZaoKe-Polish.git
cd GuoZaoKe-Polish
npm ci
npm run build
```

在 Chrome 加载 `.output/chrome-mv3`。`npm run zip` 生成 `.output/guozaoke-polish-0.4.2-chrome.zip`，仅供试用验证。

## 图片上传与分享

编辑器只修改草稿，不自动提交帖子或回复。插入已有图片链接无需配置图床。

B 站图床为试用功能：在控制选项的图床配置中点击「启用 B 站上传」，授予 Cookie 与 `https://api.bilibili.com/*` 访问权限，并在同一普通浏览器窗口登录 B 站。上传时仅临时读取防伪标记，浏览器自动携带已有登录会话；不填写、不保存、不导出 SESSDATA，不代发动态。也可继续使用 Imgur 或直接插入图片链接。

使用 Imgur 时，在控制选项填写自己的 [Imgur Client ID](https://api.imgur.com/oauth2/addclient)，点击「授权并保存」，再在图片对话框中明确点击上传。支持 PNG、JPEG、GIF、WebP，单张最多 10 MB；上传后生成公开图片链接。Client ID 仅保存在本机，不进入同步或 JSON 备份。

分享图和二维码在本机生成。公开正文图片通过后台读取且不携带 Cookie；如果某个来源需要权限，会先列出具体来源，由用户点击授权。读取或解码失败会明确报错。目前尚未用真实 B 站或 Imgur 账户完成端到端上传验收。B 站上传实现不使用旧项目已返回 404 的接口；新接口与外链显示仍需真实浏览器验收。详情见 [B 站上传接入说明](docs/bilibili-upload.md)。

## 隐私与权限

- 没有分析统计 SDK、广告 SDK 或自建遥测服务器。
- 必需权限为 `storage`、`contextMenus`、`sidePanel` 和过早客站点访问权限；B 站上传另需用户主动授予可选 `cookies` 权限。
- 图片上传、分享图、讨论分析的模型/检索/来源读取按操作申请精确域名的可选权限。
- 讨论分析由用户主动开始；选定材料会发送至自己的模型服务。API Key 仅在受信扩展上下文的会话存储保留，不进入同步或导出。
- 设置与标签使用 Chrome 同步存储；稍后阅读和图床配置保存在本机。

完整数据流、权限范围和清理方式见 [中文隐私说明](docs/privacy.md) / [Privacy details](docs/privacy.en.md)。

## 开发与验证

```sh
npm run dev        # 开发模式
npm test           # 单元与 DOM 回归测试
npm run typecheck  # WXT 类型生成与 TypeScript 检查
npm run build      # Chrome MV3 生产构建
npm run zip        # 构建并打包
```

0.4.2 发布验证见 [验证范围](docs/verification.md)，更新内容见 [更新日志](CHANGELOG.md)。GitHub Actions 在 push / pull request 时执行安装、类型检查、测试和打包。测试替身不等同于完整 Chrome 扩展、站点写操作或真实上传验收。

`entrypoints/` 为扩展入口，`src/features/` 为页面增强，`src/site/` 为站点适配，`src/analysis/` 为讨论分析与校准，`src/shared/` 为设置和组件，`src/styles/` 为样式，`tests/` 为回归与浏览器夹具。贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 作者

<img src="public/author-avatar.jpeg" width="72" height="72" alt="拾贰画生的头像">

**Made by [拾贰画生](https://www.shierhuasheng.cn)**<br>
有那么点儿追求的中年男人<br>
博客：[www.shierhuasheng.cn](https://www.shierhuasheng.cn)

## 参考与项目边界

感谢 [V2EX Polish](https://github.com/coolpace/V2EX_Polish) 提供体验参考。本项目不隶属于 V2EX Polish 或过早客，使用独立实现；研究快照、参考项目源码与品牌素材不进入仓库或扩展包。站点没有已确认的独立每日签到奖励入口，因此目前不提供自动签到。

本项目目前未设置开源许可证。第三方依赖、站点标识、表情图片及作者头像保留各自权利归属，见 [第三方说明](THIRD_PARTY_NOTICES.md)。
