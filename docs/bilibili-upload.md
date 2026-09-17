# B 站图床接入（0.4.2 预发布版）

目标是免去手动填写 Key / Cookie，同时保留 Imgur 与已有图片 URL。此版本为试用接入，自动化验证不等于真实 B 站账号上传成功。

## 依据与边界

- 用户提供的 [PicGo 项目](https://github.com/glzjin/picgo-plugin-bilibili/blob/master/src/index.js) 使用 SESSDATA 和旧的 `api.vc.bilibili.com/api/v1/drawImage/upload`。2026-09-17 对旧地址的无凭证 GET 与不含图片的空表单 POST 均返回 HTTP 404，不继续使用该地址。
- 较新的 [公开上传实现](https://github.com/chenluQwQ/bilibili-ai-bot/blob/main/dynamic.py) 使用 `https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs`，字段为 `file_up`、`category=daily`、`csrf`，读取 `code` 与 `data.image_url`。本项目独立实现此协议，不调用发布动态接口，也不使用第三方中转服务。
- [Chrome 会话说明](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies) 说明扩展请求与主机权限、Cookie 的关系。请求使用 `credentials: include`；防伪标记通过可选 `cookies` 权限在后台按固定域名、固定名称读取。浏览器 Cookie 设置、站点风控、接口变化均可能影响上传。
- 不接受手动填写 SESSDATA；需要用户自行在浏览器登录 B 站，使用浏览器已有会话。

## 使用方式

1. 在控制选项 → 图床配置中点击「启用 B 站上传」，授予 Cookie 和 `https://api.bilibili.com/*` 的可选权限。
2. 在同一普通浏览器中登录 B 站；回到过早客编辑器，选择、粘贴或拖放图片。
3. 选择 B 站或 Imgur，主动点击上传后，成功链接插入当前草稿；不会发布帖子、回复或 B 站动态。
4. 失败会保留未完成的图片，已成功部分不重复上传；不自动重试或切换图床。超时可能意味着服务端已收到图片，界面会说明。
5. 停用 B 站会撤销该上传权限，保留已有 Imgur 配置；也可在对话框中明确选择图床。

已有 Imgur 配置继续作为原用户的默认图床；新用户默认显示 B 站。点击启用 B 站或保存 Imgur 配置会更新本机偏好，不进入同步/JSON 备份。

## 实现与验证步骤

- [x] 后台限定上传调用者、目标地址、图片类型和 10 MB 大小；拒绝隐身窗口、子框架与异常返回地址。
- [x] 浏览器自动携带登录态；只在后台临时读取防伪标记，不读取 SESSDATA、不持久化凭证、不向页面回传原始接口错误。
- [x] 上传对话框提供显式图床选择、登录入口、配置入口和失败恢复；处理期间锁定文件、图床选择及插入链接；关闭按钮、Esc 与遮罩关闭统一提示等待结果，避免丢失待传队列或错误反馈。
- [x] 设置页按用户点击请求精确权限，可撤销；中英文 README 和隐私说明同步更新。
- [x] 全量测试、类型检查和打包记录见 [验证范围](verification.md)；Cookie 为可选权限。
- [x] 本地浏览器检查图床设置布局、深链接定位和拒绝授权后的提示；使用测试 API，未读取真实登录态或上传图片。
- [ ] 用户重载后实际授权、真实小图片上传、退出登录重试、撤销权限重试。
- [ ] 使用返回链接验证过早客预览、正文及未安装本扩展的访客能否看到图片。

外链可能受 B 站防盗链或内容政策影响，不能承诺永久可用或匿名公共图床能力。若上传或外链不可用，可由用户明确选择已有 Imgur 配置。

安装包与 SHA-256 校验文件见 [v0.4.2 Releases](https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.4.2)。GitHub 预发布与 Chrome 应用商店版本分别管理。
