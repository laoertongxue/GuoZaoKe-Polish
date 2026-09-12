import { button, el } from '../shared/ui';
import { footerAuthor } from '../shared/author';

export function createSiteFooter(actions: { reading: () => unknown; options: () => unknown; top: () => unknown }) {
  const footer = el('div', '', 'gzk-site-footer');
  const logo = el('span', '早', 'gzk-footer-logo');
  logo.setAttribute('aria-hidden', 'true');
  const name = footerAuthor();
  const links = el('nav', '', 'gzk-footer-tools');
  links.setAttribute('aria-label', '扩展工具');
  links.append(button('稍后阅读', actions.reading), button('选项设置', actions.options), button('回到顶部', actions.top));
  const brand = el('div', '', 'gzk-footer-brand');
  const reference = el('a', '', 'gzk-footer-reference');
  reference.href = 'https://github.com/laoertongxue/GuoZaoKe-Polish';
  reference.target = '_blank';
  reference.rel = 'noopener noreferrer';
  reference.title = 'GuoZaoKe Polish · GitHub';
  reference.setAttribute('aria-label', reference.title);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23A11.5 11.5 0 0 1 12 6.3c1.02 0 2.04.14 3 .4 2.29-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.63-5.49 5.93.43.37.82 1.1.82 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z');
  svg.append(path);
  reference.append(svg);
  brand.append(reference);
  footer.append(logo, name, links, brand);
  return footer;
}
