# 验证范围 / Verification scope

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
