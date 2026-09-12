# Data and permissions

[简体中文](privacy.md) · **English**

Product: GuoZaoKe Polish. Updated: September 13, 2026.

## Data handled and its purposes

To improve browsing, reading, and composing on Guozaoke, the extension processes usernames, avatars, topic and reply content, editor drafts, saved topic URLs, read status, and custom user tags in the browser. The absence of a developer-operated collection server does not mean that the extension handles no user data.

Page content supports previews, reply layouts, member cards, and share images. Usernames and tags support member labels; topic URLs and read status support read-later. The extension does not read Chrome's global browsing history. Selected local images are used for previews, insertion, and explicitly initiated uploads.

## Data flows

- Topics, member information, lists, and notifications are read using the site's existing session. The extension does not collect passwords, cookie contents, or access tokens.
- Settings and tags use Chrome `storage.sync`; cross-device synchronization depends on Chrome settings.
- Read-later entries and the Imgur Client ID use `storage.local`. Read-later stores metadata rather than complete topic bodies.
- JSON backups include settings, tags, and read-later entries, excluding login state and the Client ID.
- Share images and QR codes are generated locally. Avatars and content images are fetched without cookies or redirects, then inlined for preview and export. Topic content is not sent to an external share-generation service.
- Image emoji connect to public image origins such as `i.imgur.com`, without a page Referrer. Emoji codes become image links when the user submits; the extension does not automatically publish posts.
- Files are sent to Imgur only after the user clicks upload. Returned image URLs are public.
- No analytics SDK, advertising SDK, or project-operated telemetry server is included.

## Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Preferences, tags, read-later entries, and upload configuration. |
| `contextMenus` | Decoding, saving topics, and settings shortcuts. |
| `https://www.guozaoke.com/*`, `https://guozaoke.com/*` | Page enhancements and site content reads. |
| Optional `https://api.imgur.com/*` | Configured and authorized image uploads. |
| Optional `https://*/*`, `http://*/*` declarations | Reserve the ability to request specific image origins. The extension does not request these wildcard ranges at once; the share page lists failed origins and requests those exact origins after a user action. |

The image reader rejects localhost, known private IP ranges, credential-bearing URLs, unsupported schemes, and unusual ports. This URL check does not perform a DNS audit. SVG is rendered in image mode rather than inserted as an active document; external resources follow browser image-mode restrictions. Origin access can be revoked in Chrome's extension settings.

## Clearing data

Settings supports tag management, backup export, and removal of upload configuration. Resetting preferences does not delete tags or read-later entries. Chrome removes extension-local data when the extension is uninstalled. Previously uploaded Imgur images are not deleted by uninstalling the extension.

## Limited Use

GuoZaoKe Polish's use and transfer of user data adhere to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data), including its Limited Use requirements. Data is used only to provide the user-facing features described here. It is not sold to third parties, used for advertising targeting, used for creditworthiness or lending decisions, or used for unrelated purposes. The developer does not receive or manually inspect browsing content, tags, drafts, or backups through the extension.

Necessary transfers include requests to Guozaoke, Chrome settings synchronization, loading third-party public images, and explicitly initiated Imgur uploads. Those services handle requests under their own policies; images uploaded to Imgur are accessible through public links. Information voluntarily submitted to GitHub support is visible according to that channel's visibility. Do not attach passwords, private drafts, or complete backups to public issues.

## Contact

Author: 拾贰画生 (Shier Huasheng). Blog: [www.shierhuasheng.cn](https://www.shierhuasheng.cn). Privacy questions can be raised through the [project issue tracker](https://github.com/laoertongxue/GuoZaoKe-Polish/issues).
