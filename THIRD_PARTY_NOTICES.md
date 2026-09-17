# 第三方说明 / Third-party notices

体验参考来自 [V2EX Polish](https://github.com/coolpace/V2EX_Polish)，本项目独立实现，不分发参考项目源码、研究快照或品牌资产，与 V2EX Polish 及过早客无隶属关系。

The experience reference is [V2EX Polish](https://github.com/coolpace/V2EX_Polish). This independent implementation does not distribute reference source, research snapshots, or branding and is not affiliated with V2EX Polish or Guozaoke.

| Runtime dependency | Locked version | Declared license |
| --- | --- | --- |
| DOMPurify | 3.4.15 | MPL-2.0 OR Apache-2.0 |
| html-to-image | 1.11.13 | MIT |
| marked | 16.4.2 | MIT |
| qrcode | 1.5.4 | MIT |
| pdfjs-dist | 6.3.289 | Apache-2.0 |

讨论分析中的文字 PDF 解析使用 Mozilla PDF.js；解析器和 worker 随扩展打包。完整 Apache 2.0 许可一并分发于 [public/licenses/pdfjs-dist-LICENSE.txt](public/licenses/pdfjs-dist-LICENSE.txt)。

Text PDF extraction uses Mozilla PDF.js, bundled with its worker. Its Apache 2.0 license is included in the extension under `licenses/pdfjs-dist-LICENSE.txt`.

依赖完整许可文本位于相应安装包中，构建和测试依赖保留各自许可证。表情通过公开图片 URL 加载，本项目不主张其素材版权；作者提供的头像用于作者信息展示。站点名称与标识属于各自权利人。本项目自身代码尚未选择开源许可证。

Full dependency licenses are included in the respective packages. Build/test dependencies retain their own licenses. Emoji use public image URLs; the project does not claim ownership of those images. The author supplied the avatar for attribution. Site identities belong to their owners. No open-source license is selected for the project's own code yet.
