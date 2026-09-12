import { Marked, marked, type Token } from 'marked';
import { button, el, modal, richHtml } from '../shared/ui';
import pickerStyles from '../styles/emoji.css?inline';

// Public image addresses are compatibility data. No image files or upload
// credentials from the reference extension are included in this project.
const imageRows = [
  ['脱单doge', 'L62ZP7V', '3mPhudo'], ['doge', 'agAJ0Rd', 'HZL0hOa'],
  ['打call', 'pmNOo2w', '4GfTlV0'], ['星星眼', '2spsghH', 'oEIJRru'],
  ['吃瓜', 'Ug1iMq4', 'Gy3nwkC'], ['OK', '6DMydmQ', 'PE2dyjY'],
  ['哦呼', 'km62MY2', 'CXXgF4E'], ['思考', 'MAyk5GN', 'eRJTCx7'],
  ['疑惑', 'U3hKhrT', '3gCygBS'], ['辣眼睛', 'n119Wvk', 'A5WXoZJ'],
  ['傲娇', 'TkdeN49', 'm7IlCrD'], ['捂脸', '14cwgsI', 'fLp3t8s'],
  ['无语', 'e1q9ScT', 'wMfcBqD'], ['大哭', 'YGIx7lh', 'SNHJxtv'],
  ['酸了', '5FDsp6L', 'wnQBodT'], ['歪嘴', 'XzEYBoY', '84ycU43'],
  ['调皮', 'O6ZZSLk', 'ggHTLzH'], ['笑哭', 'NIvxivj', 'h8edr5G'],
  ['嗑瓜子', 'rjR4rdr', 'GMzq0tq'], ['喜极而泣', 'N9E3iZ2', 'L1N27tb'],
  ['惊讶', 'aptfuiN', 'cuzxGOI'], ['给心心', '4aXVwxJ', 'q663Mor'],
  ['呆', 'c1Q76Cd', 'xMXlmxm'], ['跪了', 'TYtySHv', '0pjsMf0'],
  ['响指', 'Ac88cMm', 'nkoevMu'], ['哇R', 'OZySWIG', 'ngoi2I6'],
  ['萌萌哒R', 'Ue1kikn', 'vOHzwus'], ['害羞R', 'OVQjxIr', '1PeoVR5'],
  ['偷笑R', 'aF7QiE5', 'WneGpK9'], ['哭惹R', 'HgxsUD2', '0aOdQJd'],
  ['汗颜R', 'jrVZoLi', 'O8alqc1'],
] as const;

export const imageEmoji = new Map(imageRows.map(([name, ld, hd]) => [
  `[${name}]`, { ld: `https://i.imgur.com/${ld}.png`, hd: `https://i.imgur.com/${hd}.png` },
]));

const groups = [
  { title: '流行', values: Array.from(imageEmoji.keys()) },
  { title: '小黄脸', values: ['😀','😁','😂','🤣','😅','😊','😋','😘','🥰','😗','🤩','🤔','🤨','😐','😑','🙄','😏','😪','😫','🥱','😜','😒','😔','😨','😰','😱','🥵','😡','🥳','🥺','🤭','🧐','😎','🤓','😭','🤑','🤮'] },
  { title: '手势', values: ['🙋','🙎','🙅','🙇','🤷','🤏','👉','✌️','🤘','🤙','👌','🤌','👍','👎','👋','🤝','🙏','👏'] },
  { title: '庆祝', values: ['✨','🎉','🎊'] },
  { title: '其他', values: ['👻','🤡','🐔','👀','💩','🐴','🦄','🐧','🐶','🐒','🙈','🙉','🙊','🐵'] },
  { title: '颜文字', values: ['(๑•̀ㅂ•́)و✧','(╯°□°）╯︵ ┻━┻','(￣▽￣)','¯\\_(ツ)_/¯','(´･ω･`)'] },
];

// Names and URL format observed in the target site's emoji autocomplete.
const siteEmoji = new Set('+1 -1 100 angel anger beer blush boom bow broken_heart clap cold_sweat confounded cool cow dog eggplant eyes flushed ghost gun heart_eyes joy kiss kissing_heart laughing mask moneybag muscle ng octocat ok_hand paw_prints pig pill pray santa shit smirk sob sos sparkles stuck_out_tongue_winking_eye swimmer trollface underage v vs watermelon zzz hsk fire'.split(' '));
const enabled = () => !document.documentElement.classList.contains('gzk-disabled');

export function showEmojiPicker(insert: (value: string) => void, restoreFocus: () => void) {
  if (!enabled()) return;
  const view = modal('选择表情');
  const style = el('style'); style.textContent = pickerStyles; view.root.append(style);
  view.dialog.classList.add('gzk-emoji-dialog');
  view.dialog.addEventListener('close', restoreFocus, { once: true });
  view.dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); view.close(); }
  });
  for (const group of groups) {
    const section = el('section', '', 'gzk-emoji-group');
    section.setAttribute('aria-label', group.title);
    const grid = el('div', '', `gzk-emoji-grid${group.title === '颜文字' ? ' gzk-kaomoji' : ''}`);
    for (const value of group.values) {
      const choice = button('', () => { if (enabled()) insert(value); }, 'gzk-emoji-choice');
      choice.setAttribute('aria-label', value); choice.title = value;
      const url = imageEmoji.get(value)?.hd;
      if (url) {
        const img = el('img'); img.alt = ''; img.width = 36; img.height = 36;
        img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; img.src = url;
        img.addEventListener('error', () => img.remove(), { once: true });
        choice.append(img, el('span', value, 'gzk-emoji-code'));
      } else choice.textContent = value;
      grid.append(choice);
    }
    grid.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(grid.querySelectorAll('button'));
      const index = buttons.indexOf(view.root.activeElement as HTMLButtonElement);
      if (index < 0) return;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
      event.preventDefault(); buttons[next]?.focus();
    });
    section.append(el('h3', group.title), grid); view.body.append(section);
  }
  view.body.querySelector<HTMLButtonElement>('button')?.focus();
  return view;
}

export function openEditorEmojiPicker(input: HTMLTextAreaElement) {
  if (!enabled() || input.readOnly || input.matches(':disabled')) return;
  // Chrome can reset selection on the inert textarea behind a modal dialog.
  // Keep the insertion range until the picker closes, including replacements.
  let start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
  return showEmojiPicker(value => {
    if (!enabled() || input.readOnly || input.matches(':disabled')) return;
    input.setRangeText(value, start, end, 'end');
    start += value.length; end = start; direction = 'none';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, () => {
    input.focus(); input.setSelectionRange(start, end, direction);
  });
}

const replaceCodes = (text: string, atFormattingEnd: boolean) => text.replace(/\[[^\]\r\n]+\]/g, (code, offset: number) => {
  const emoji = imageEmoji.get(code);
  // A space directly before an emphasis closing delimiter would turn that
  // delimiter into plain text. Keep separation between adjacent images only.
  const suffix = atFormattingEnd && offset + code.length === text.length ? '' : ' ';
  return emoji ? emoji.ld + suffix : code;
});

function sourceRange(source: string, raw: string, cursor: number) {
  const exact = source.indexOf(raw, cursor);
  if (exact >= 0) return { offset: exact, raw };
  // Marked removes quote markers and list indentation from child token raws.
  // Match those prefixes while retaining the actual source for reconstruction.
  if (!raw.includes('\n')) return;
  const pattern = raw.split('\n').map(line => line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\n[ \t]*(?:>[ \t]*)*');
  const match = new RegExp(pattern).exec(source.slice(cursor));
  return match ? { offset: cursor + match.index, raw: match[0] } : undefined;
}

// Work only inside Markdown text tokens. In particular, link labels, escaped
// brackets, code blocks, HTML and existing URLs keep their original source.
function transformTokens(source: string, tokens: Token[], atFormattingEnd = false): string {
  let result = '', cursor = 0;
  for (const token of tokens) {
    const range = sourceRange(source, token.raw, cursor);
    if (!range) continue;
    result += source.slice(cursor, range.offset);
    let transformed = range.raw;
    if (!['link', 'image', 'code', 'codespan', 'html', 'escape', 'def'].includes(token.type)) {
      const isLast = token === tokens[tokens.length - 1];
      if ('tokens' in token && Array.isArray(token.tokens)) transformed = transformTokens(range.raw, token.tokens, ['em', 'strong', 'del'].includes(token.type) || (atFormattingEnd && isLast));
      else if (token.type === 'list') transformed = transformTokens(range.raw, token.items);
      else if (token.type === 'table') transformed = range.raw.split('\n').map(line => transformTokens(line, marked.Lexer.lexInline(line))).join('\n');
      else if (token.type === 'text') transformed = replaceCodes(range.raw, atFormattingEnd && isLast);
    }
    result += transformed; cursor = range.offset + range.raw.length;
  }
  return result + source.slice(cursor);
}

export function emojiSubmissionText(text: string): string {
  // Marked normalizes line endings. Retain each original newline in the payload.
  const endings = text.match(/\r\n|\r|\n/g) || [];
  const normalized = text.replace(/\r\n|\r/g, '\n');
  let line = 0;
  return transformTokens(normalized, marked.lexer(normalized)).replace(/\n/g, () => endings[line++] || '\n');
}

export function bindEmojiFormData(input: HTMLTextAreaElement) {
  const form = input.form;
  if (!form) return () => {};
  const onFormData = (event: FormDataEvent) => {
    if (!enabled() || input.matches(':disabled') || input.form !== form) return;
    // An unnamed editor does not own any submitted entry. Never infer its name
    // from the site's usual field name or an unrelated same-value hidden input.
    const name = input.name;
    if (!name) return;
    const values = event.formData.getAll(name);
    if (values.length !== 1 || values[0] !== input.value) return;
    const value = emojiSubmissionText(input.value);
    if (value !== input.value) event.formData.set(name, value);
  };
  form.addEventListener('formdata', onFormData);
  return () => form.removeEventListener('formdata', onFormData);
}

function previewImage(src: string, alt: string, size?: number): HTMLImageElement {
  const image = el('img'); image.alt = alt;
  image.referrerPolicy = 'no-referrer'; image.loading = 'lazy'; image.src = src;
  if (size) { image.width = size; image.height = size; image.className = 'gzk-inline-emoji'; }
  image.addEventListener('error', () => image.replaceWith(document.createTextNode(alt || src)), { once: true });
  return image;
}

const previewMarkdown = new Marked({ renderer: {
  text(token) {
    if (token.type !== 'escape') return false;
    // Keep escaped punctuation in a separate node so it cannot become an emoji
    // token again when the rendered text is traversed below.
    const literal = el('span', token.text); literal.dataset.gzkPreviewLiteral = 'true';
    return literal.outerHTML;
  },
} });

export function renderEditorPreview(target: HTMLElement, value: string) {
  // A template's owner document stays inert. Sanitize there, then set image
  // policies before moving any node into the live preview. DOMPurify strips
  // referrerpolicy, so adding it to the input HTML would not be sufficient.
  const template = el('template');
  const preview = template.content.ownerDocument.createElement('div');
  richHtml(preview, previewMarkdown.parse(value, { async: false, gfm: true, breaks: true }));
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest('a,code,pre,[data-gzk-preview-literal]')) nodes.push(node);
  }
  for (const node of nodes) {
    const fragment = document.createDocumentFragment(); let cursor = 0;
    for (const match of node.data.matchAll(/\[[^\]\r\n]+\]|:([+\-\w]+):/g)) {
      const [code, siteName] = match;
      const popular = imageEmoji.get(code);
      const src = popular?.hd || (siteName && siteEmoji.has(siteName) ? `https://static.guozaoke.com//static/emoji/${siteName}.png` : '');
      if (!src) continue;
      fragment.append(document.createTextNode(node.data.slice(cursor, match.index)), previewImage(src, code, popular ? 32 : 20));
      cursor = match.index + code.length;
    }
    if (cursor) { fragment.append(document.createTextNode(node.data.slice(cursor))); node.replaceWith(fragment); }
  }
  for (const link of preview.querySelectorAll('a')) {
    if (link.closest('code,pre') || link.textContent !== link.getAttribute('href')) continue;
    if (/\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i.test(new URL(link.href).pathname)) link.replaceWith(previewImage(link.href, link.textContent || link.href));
  }
  // Markdown images have already passed the shared DOMPurify and URL checks.
  for (const image of preview.querySelectorAll('img')) {
    image.referrerPolicy = 'no-referrer';
    if (!image.classList.contains('gzk-inline-emoji')) image.addEventListener('error', () => image.replaceWith(document.createTextNode(image.alt || image.src)), { once: true });
  }
  target.replaceChildren(...preview.childNodes);
}
