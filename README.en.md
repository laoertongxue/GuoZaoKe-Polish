<div align="center">
  <img src="public/icon/128.png" width="80" height="80" alt="GuoZaoKe Polish">
  <h1>GuoZaoKe Polish</h1>
  <p>A more comfortable way to browse and read Guozaoke.</p>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
  <p><a href="https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.3.14">Download</a> · <a href="https://github.com/laoertongxue/GuoZaoKe-Polish/issues">Report an issue</a> · <a href="docs/privacy.en.md">Privacy</a></p>
</div>

---

A Chrome extension for [Guozaoke](https://www.guozaoke.com/), inspired by the reading experience of [V2EX Polish](https://github.com/coolpace/V2EX_Polish). Built independently with **WXT, TypeScript, and native DOM/CSS**, it improves the site's layout, themes, and interactions while preserving its content and native controls.

**0.3.14 is a prerelease**, not yet listed in the Chrome Web Store. Automated tests and local browser component checks are available; comprehensive live-site compatibility and reference parity remain work in progress. See the [verification scope](docs/verification.md).

## Features

| Area | Capabilities |
| --- | --- |
| Reading interface | Light, dark, and dawn themes; system preference; compact spacing and horizontal reading; consistent navigation, cards, pagination, and footer. |
| Ad hiding | Hides native sidebar promotions and recognized Google ad units on Guozaoke by default, including floating controls and ad spacing. Reversible in settings; cosmetic filtering only, without blocking network requests. |
| Topics | Topic previews, read-later list, and read status; hot/latest topics and notifications in the extension popup. |
| Replies | Indented threads, aligned threads, and original order; popular replies, long-reply folding, and floor navigation. |
| Pagination | Optionally load up to two subsequent reply pages from the first topic page, deduplicate replies, and mark merged pages; retain native URLs. |
| Members | Profile cards, personal tags, and persistent profile/topics/replies/favorites navigation. |
| Editor | 31 popular image emoji, Unicode emoji, kaomoji, Markdown preview, Base64 tools, and image selection/paste/drop. |
| Images and sharing | Full-screen image preview and zoom; local rich-text share images, QR codes, and multi-image output for long posts. |
| Data | Settings sync, tag management, JSON backup/import, and context-menu shortcuts. |

Defaults use the light theme, same-tab navigation, vertical layout, and disabled reply preloading. Updates preserve preferences. Nesting is inferred from references and mentions because the site does not expose a parent-reply field.

## Installation and updates

1. Open the [v0.3.14 release](https://github.com/laoertongxue/GuoZaoKe-Polish/releases/tag/v0.3.14), download `GuoZaoKe-Polish-0.3.14-chrome.zip`, and extract it.
2. Enter `chrome://extensions/` in Chrome and enable **Developer mode**.
3. Select **Load unpacked** and choose the extracted folder that directly contains `manifest.json`.
4. Open a new [Guozaoke](https://www.guozaoke.com/) page. Use the popup's settings entry to customize preferences.

To update, extract the new build into the previously loaded folder, reload the extension, and open a new site tab. Save drafts before refreshing existing pages. You can export a JSON backup from settings first.

## Build from source

Use Node.js 26 (specified in `.nvmrc`) and npm:

```sh
git clone https://github.com/laoertongxue/GuoZaoKe-Polish.git
cd GuoZaoKe-Polish
npm ci
npm run build
```

Load `.output/chrome-mv3` in Chrome. `npm run zip` creates `.output/guozaoke-polish-0.3.14-chrome.zip`.

## Uploads and share images

Editor actions change drafts only; the extension does not automatically publish posts or replies. Existing image URLs can be inserted without an upload provider.

For uploads, configure your own [Imgur Client ID](https://api.imgur.com/oauth2/addclient), explicitly grant access, and confirm the upload in the image dialog. PNG, JPEG, GIF, and WebP are supported up to 10 MB per file. Uploaded images receive public URLs. The Client ID stays local and is excluded from sync and JSON backups.

Share images and QR codes are generated locally. Public content images are fetched without cookies. When an image origin needs access, that specific origin is shown before the user requests permission. Fetch and decoding failures are reported. End-to-end uploads with a real Imgur account have not yet been verified.

## Privacy and permissions

- No analytics SDK, advertising SDK, or project-operated telemetry server.
- Required permissions: `storage`, `contextMenus`, and access to Guozaoke.
- Uploads and external images use optional permissions requested for the operation.
- Settings and tags use Chrome sync storage; read-later entries and upload configuration stay local.

See [Privacy details](docs/privacy.en.md) / [中文隐私说明](docs/privacy.md) for data flows, permission boundaries, and deletion behavior.

## Development and verification

```sh
npm run dev        # Development mode
npm test           # Unit and DOM regression tests
npm run typecheck  # WXT types and TypeScript checking
npm run build      # Chrome MV3 production build
npm run zip        # Build and package
```

Publication preparation passed **158 tests across 26 files**. GitHub Actions runs installation, type checking, tests, and packaging on pushes and pull requests. Test doubles do not substitute for full extension, live-site write-operation, or real-upload verification.

`entrypoints/` contains extension entries, `src/features/` page enhancements, `src/site/` site adapters, `src/shared/` settings and components, `src/styles/` styles, and `tests/` regression and browser fixtures. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

<img src="public/author-avatar.jpeg" width="72" height="72" alt="Avatar of 拾贰画生">

**Made by [拾贰画生](https://www.shierhuasheng.cn)**<br>
有那么点儿追求的中年男人 — A middle-aged man with a little ambition.<br>
Blog: [www.shierhuasheng.cn](https://www.shierhuasheng.cn)

## Credits and scope

Thanks to [V2EX Polish](https://github.com/coolpace/V2EX_Polish) for the experience reference. This project is not affiliated with V2EX Polish or Guozaoke. Its implementation is independent; research snapshots, reference source, and reference branding are excluded from the repository and package. No confirmed independent daily check-in reward endpoint is available, so automatic check-in is not provided.

No open-source license has been selected for this project yet. Dependencies, site identities, emoji images, and the avatar retain their respective rights. See [third-party notices](THIRD_PARTY_NOTICES.md).
