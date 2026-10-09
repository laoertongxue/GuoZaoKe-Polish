# Data and permissions

[简体中文](privacy.md) · **English**

Product: GuoZaoKe Polish. Updated: October 9, 2026. The Bilibili image-hosting and image upload terms continue to apply.

## Data handled and its purposes

To improve browsing, reading, and composing on Guozaoke, the extension processes usernames, avatars, topic and reply content, editor drafts, saved topic URLs, read status, and custom user tags in the browser. The absence of a developer-operated collection server does not mean that the extension handles no user data.

Page content supports previews, reply layouts, member cards, and share images. Usernames and tags support member labels; topic URLs and read status support read-later. The extension does not read Chrome's global browsing history. Selected local images are used for previews, insertion, and explicitly initiated uploads.

## Data flows

- Topics, member information, lists, and notifications are read using the site's existing session. The extension does not collect site passwords, cookie contents, or site access tokens. The current version does not accept or store third-party API keys, and does not send topic content to any model service.
- Settings and tags use Chrome `storage.sync`; cross-device synchronization depends on Chrome settings.
- Read-later entries, the preferred image host, and the Imgur Client ID use `storage.local`. Read-later stores metadata rather than complete topic bodies.
- JSON backups include settings, tags, and read-later entries, excluding login state and the Client ID.
- Share images and QR codes are generated locally. Avatars and content images are fetched without cookies or redirects, then inlined for preview and export. Topic content is not sent to an external share-generation service.
- Image emoji connect to public image origins such as `i.imgur.com`, without a page Referrer. Emoji codes become image links when the user submits; the extension does not publish posts without a user action.
- The rating assistant runs only when the user clicks "Scan rating" in the topic toolbar. Scores are computed locally by a heuristic and no model service is called. If the opt-in "post reply after rating" setting is enabled (off by default), the extension first reads the topic page, confirms that the logged-in account matches the assistant account, and then submits one public reply to www.guozaoke.com using the browser session. The browser attaches cookies; the extension does not read, store, or export them. The assistant account name and the record of rated floors are stored in `storage.local`.
- Files are sent to the selected Bilibili or Imgur service only after the user clicks upload. Returned image URLs are public. Failures never automatically transfer images to another provider.
- Bilibili uploads require separate `cookies` and `https://api.bilibili.com/*` permissions. On an explicit upload, the background temporarily reads the `bili_jct` CSRF cookie for that origin and sends it to the fixed Bilibili image-upload endpoint. The browser attaches its existing Bilibili session cookies. The extension does not read SESSDATA values, copy or persist login cookies, sync/export/log CSRF values, or pass credentials to content scripts or the author. It does not publish Bilibili dynamic posts. Uploads from incognito tabs are rejected to avoid using a different account session.
- Starting with 0.5.0, pasting or dropping an image in the editor **automatically** uploads it to the selected host without opening any dialog. A placeholder line is replaced with the resulting image link on success, or removed with a toast on failure. The same upload endpoint and the same Cookie / Imgur Client ID policy apply.
- No analytics SDK, advertising SDK, or project-operated telemetry server is included.
- Ad hiding uses local styles and DOM adjustments to hide native sidebar promotions, recognized Google ads and floating controls on Guozaoke, and restore page spacing before ad insertion. It adds no permissions or data transmission and does not block the site's ad scripts or network requests. It is enabled by default and can be disabled in settings.

## Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Preferences, tags, read-later entries, upload configuration, and session credentials. |
| `contextMenus` | Decoding, saving topics, and settings shortcuts. |
| `https://www.guozaoke.com/*`, `https://guozaoke.com/*` | Page enhancements and site content reads. |
| Optional `cookies` and `https://api.bilibili.com/*` | Read the Bilibili CSRF cookie and upload selected images only after explicit enablement; revocable in image-hosting settings. |
| Optional `https://api.imgur.com/*` | Configured and authorized image uploads. |
| Optional `https://*/*`, `http://*/*` declarations | Reserve access to image hosts and specific image origins. These wildcard ranges are never requested at once; a user action grants the exact origins shown. |

Chrome cookie access combines the `cookies` capability with granted host permissions; it is not a per-cookie isolation boundary. This implementation only reads the Bilibili CSRF cookie above and does not enumerate other websites' cookies.

The image reader rejects localhost, known private IP ranges, credential-bearing URLs, unsupported schemes, and unusual ports. This URL check does not perform a DNS audit. SVG is rendered in image mode rather than inserted as an active document; external resources follow browser image-mode restrictions. Origin access can be revoked in Chrome's extension settings.

## Clearing data

Settings supports tag management, backup export, and removal of upload configuration. Resetting preferences does not delete tags or read-later entries. Chrome removes extension-local data when the extension is uninstalled. Previously uploaded Bilibili or Imgur images are not deleted by uninstalling the extension.

Removing local records or uninstalling does not delete data already sent to image providers.

## Limited Use

GuoZaoKe Polish's use and transfer of user data adhere to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data), including its Limited Use requirements. Data is used only to provide the user-facing features described here. It is not sold to third parties, used for advertising targeting, used for creditworthiness or lending decisions, or used for unrelated purposes. The developer does not receive or manually inspect browsing content, tags, drafts, or backups through the extension.

Necessary transfers include requests to Guozaoke, Chrome settings synchronization, third-party public images, and explicitly initiated Bilibili or Imgur uploads. Those services handle requests under their own policies; images uploaded to Bilibili or Imgur are accessible through public links. Information voluntarily submitted to GitHub support is visible according to that channel's visibility. Do not attach passwords, private drafts, API keys, or complete backups to public issues.

## Contact

Author: 拾贰画生 (Shier Huasheng). Blog: [www.shierhuasheng.cn](https://www.shierhuasheng.cn). Privacy questions can be raised through the [project issue tracker](https://github.com/laoertongxue/GuoZaoKe-Polish/issues).
