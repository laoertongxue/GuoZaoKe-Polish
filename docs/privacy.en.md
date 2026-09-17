# Data and permissions

[简体中文](privacy.md) · **English**

Product: GuoZaoKe Polish. Updated: September 17, 2026. Discussion-analysis and Bilibili-upload terms apply to 0.4.2 and builds containing the corresponding trial features.

## Data handled and its purposes

To improve browsing, reading, and composing on Guozaoke, the extension processes usernames, avatars, topic and reply content, editor drafts, saved topic URLs, read status, and custom user tags in the browser. The absence of a developer-operated collection server does not mean that the extension handles no user data.

Page content supports previews, reply layouts, member cards, and share images. Usernames and tags support member labels; topic URLs and read status support read-later. The extension does not read Chrome's global browsing history. Selected local images are used for previews, insertion, and explicitly initiated uploads.

## Data flows

- Topics, member information, lists, and notifications are read using the site's existing session. The extension does not collect site passwords, cookie contents, or site access tokens. User-provided third-party API keys are described below.
- Settings and tags use Chrome `storage.sync`; cross-device synchronization depends on Chrome settings.
- Read-later entries, the preferred image host, and the Imgur Client ID use `storage.local`. Read-later stores metadata rather than complete topic bodies.
- JSON backups include settings, tags, and read-later entries, excluding login state and the Client ID.
- Share images and QR codes are generated locally. Avatars and content images are fetched without cookies or redirects, then inlined for preview and export. Topic content is not sent to an external share-generation service.
- Image emoji connect to public image origins such as `i.imgur.com`, without a page Referrer. Emoji codes become image links when the user submits; the extension does not automatically publish posts.
- Files are sent to the selected Bilibili or Imgur service only after the user clicks upload. Returned image URLs are public. Failures never automatically transfer images to another provider.
- Bilibili uploads require separate `cookies` and `https://api.bilibili.com/*` permissions. On an explicit upload, the background temporarily reads the `bili_jct` CSRF cookie for that origin and sends it to the fixed Bilibili image-upload endpoint. The browser attaches its existing Bilibili session cookies. The extension does not read SESSDATA values, copy or persist login cookies, sync/export/log CSRF values, or pass credentials to content scripts or the author. It does not publish Bilibili dynamic posts. Uploads from incognito tabs are rejected to avoid using a different account session.
- No analytics SDK, advertising SDK, or project-operated telemetry server is included.
- Ad hiding uses local styles and DOM adjustments to hide native sidebar promotions, recognized Google ads and floating controls on Guozaoke, and restore page spacing before ad insertion. It adds no permissions or data transmission and does not block the site's ad scripts or network requests. It is enabled by default and can be disabled in settings.

## Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Preferences, tags, read-later entries, upload configuration, analysis history, and separate session credentials. |
| `contextMenus` | Decoding, saving topics, and settings shortcuts. |
| `sidePanel` | Displays the thread-analysis workspace in a Chrome extension side panel opened by the user. This permission itself grants no additional website access. |
| `https://www.guozaoke.com/*`, `https://guozaoke.com/*` | Page enhancements and site content reads. |
| Optional `cookies` and `https://api.bilibili.com/*` | Read the Bilibili CSRF cookie and upload selected images only after explicit enablement; revocable in image-hosting settings. |
| Optional `https://api.imgur.com/*` | Configured and authorized image uploads. |
| Optional `https://*/*`, `http://*/*` declarations | Reserve access to image hosts, specific image origins and user-selected model, search, and source services. These wildcard ranges are never requested at once; a user action grants the exact origins shown. External discussion-analysis requests require HTTPS. |

Chrome cookie access combines the `cookies` capability with granted host permissions; it is not a per-cookie isolation boundary. This implementation only reads the Bilibili CSRF cookie above and does not enumerate other websites' cookies.

The image reader rejects localhost, known private IP ranges, credential-bearing URLs, unsupported schemes, and unusual ports. This URL check does not perform a DNS audit. SVG is rendered in image mode rather than inserted as an active document; external resources follow browser image-mode restrictions. Origin access can be revoked in Chrome's extension settings.

## Optional discussion analysis

Visiting a thread alone never starts model analysis. Starting with 0.4.3, clicking Discussion Analysis authorizes capture and analysis using the default model; setup explains the sending scope and possible provider charges. Missing configuration or a session key opens setup, then continues after saving. A single model becomes the default; users select the default among multiple models. Completed reports reopen without new model calls. Choosing another model and clicking Analyze Again creates a new result and preserves earlier reports. The advanced workspace still allows separate capture and scope/budget review.

Analysis sends thread text, original links, extracted claims, verification questions, and selected source text to the configured model API. Usernames and mentions may remain in the original text; display aliases are not full anonymization. Site cookies, login credentials, editor drafts, and global browsing history are not sent.

Tavily search is optional. If configured, verification questions and search terms are sent to `api.tavily.com`. Search snippets remain leads. Public webpages and text PDFs are read from specifically authorized origins without cookies, Referrer, or redirects. Local files selected by the user are parsed in the extension; their extracted text is included in the model sending scope once added to an analysis. The PDF parser is bundled, without remote executable code.

Model and search keys are separated by purpose and destination origin in trusted-context-only `storage.session`. They are not returned to content scripts or included in `storage.local`, `storage.sync`, logs, reports, or exports. A model key is sent as authentication to the selected model service; the search key is sent to Tavily. Keys must be entered again after browser restart or extension reload. This boundary does not protect against a compromised device, browser, extension developer tools, or the service provider itself.

Non-secret model configuration, captured text, source text, analysis results, checkpoints, usage, and calibration receipts remain in local extension storage. Analysis exports are separate from ordinary settings backups and include thread and source text, but no keys. Review their contents before sharing. Cancellation stops scheduling further requests; requests already received by a provider may still be processed or billed.

Built-in calibration sends synthetic test materials only after an explicit start. Replays send the locally selected analysis materials. These data are not sent to the author. The extension does not provide cross-thread person scores or personality profiles. Model and search providers process received data under their own policies.

## Clearing data

Settings supports tag management, backup export, and removal of upload configuration. Resetting preferences does not delete tags or read-later entries. Chrome removes extension-local data when the extension is uninstalled. Previously uploaded Bilibili or Imgur images are not deleted by uninstalling the extension.

Analysis settings can clear session keys and delete model configurations. History can delete individual reports and their checkpoints. Calibration records currently remain locally until extension removal. Resetting ordinary preferences does not delete analysis records. Removing local records or uninstalling does not delete data already sent to model, search, or image providers.

Deleting an analysis clears its content, job and source budget while retaining a local deletion marker containing only its record ID. This prevents late checkpoints in another window from restoring the deleted record. The marker contains no text or API key and is removed when the extension is uninstalled.

## Limited Use

GuoZaoKe Polish's use and transfer of user data adhere to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data), including its Limited Use requirements. Data is used only to provide the user-facing features described here. It is not sold to third parties, used for advertising targeting, used for creditworthiness or lending decisions, or used for unrelated purposes. The developer does not receive or manually inspect browsing content, tags, drafts, or backups through the extension.

Necessary transfers include requests to Guozaoke, Chrome settings synchronization, third-party public images, explicitly initiated Bilibili or Imgur uploads, and model/search/source requests in deliberately started analysis. Those services handle requests under their own policies; images uploaded to Bilibili or Imgur are accessible through public links. Information voluntarily submitted to GitHub support is visible according to that channel's visibility. Do not attach passwords, private drafts, API keys, or complete backups to public issues.

## Contact

Author: 拾贰画生 (Shier Huasheng). Blog: [www.shierhuasheng.cn](https://www.shierhuasheng.cn). Privacy questions can be raised through the [project issue tracker](https://github.com/laoertongxue/GuoZaoKe-Polish/issues).
