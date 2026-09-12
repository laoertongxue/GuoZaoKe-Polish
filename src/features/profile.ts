import { el } from '../shared/ui';

// Retain native links, data and handlers while arranging the same fields as the
// reference profile. Restore moved fields when the extension is disabled.
export function enhanceProfile(enabled: boolean, pathname = location.pathname) {
  const profile = document.querySelector<HTMLElement>('.sidebar-left .user-page .profile');
  const header = profile?.querySelector<HTMLElement>(':scope > .ui-header');
  const content = profile?.querySelector<HTMLElement>(':scope > .ui-content');
  const route = pathname.match(/^\/u\/([\w-]+)(?:\/(topics|replies|favorites))?\/?$/);
  const username = header?.querySelector('.username')?.textContent?.trim() || route?.[1];
  const fields = Array.from(content?.querySelectorAll<HTMLDListElement>(':scope > dl') ?? []);
  const signature = fields.find(field => field.querySelector('dt')?.textContent?.trim() === '签名');
  const identity = fields.find(field => field.querySelector('dt')?.textContent?.trim() === 'ID' && field.querySelector('dd')?.textContent?.trim() === username);
  const placeholder = signature ? document.createComment('gzk-profile-signature') : undefined;
  if (signature && placeholder) signature.before(placeholder);
  signature?.classList.add('gzk-profile-signature');
  identity?.classList.add('gzk-profile-identity');

  const listHeader = profile?.parentElement?.querySelector<HTMLElement>(':scope > :is(.topic-lists,.replies-lists) > .ui-header') || (route ? document.querySelector<HTMLElement>('.sidebar-left > .container-box > .ui-header') : null);
  const home = header?.querySelector<HTMLAnchorElement>('a[href]');
  let navigation: HTMLElement | undefined;
  if (listHeader && username && (home || route)) {
    navigation = el('nav', '', 'gzk-profile-nav');
    navigation.setAttribute('aria-label', '个人内容');
    const sidebarHeader = document.querySelector('.sidebar-right .usercard > .ui-header');
    const avatar = header?.querySelector<HTMLImageElement>('.avatar') || (sidebarHeader?.querySelector('.username')?.textContent?.trim() === username ? sidebarHeader.querySelector<HTMLImageElement>('.avatar') : null);
    if (avatar) { const copy = avatar.cloneNode() as HTMLImageElement; copy.alt = ''; navigation.append(copy); }
    const base = home?.getAttribute('href') || `/u/${username}`;
    const sources = [{ label: username, href: base }];
    for (const [status, label] of [['topic', '主题'], ['reply', '回复'], ['favorite', '收藏']]) {
      const link = document.querySelector<HTMLAnchorElement>(`.sidebar-right .usercard .status-${status} a[href]`);
      if (profile && link) sources.push({ label: label!, href: link.getAttribute('href')! });
      else if (!profile) sources.push({ label: label!, href: `${base}/${status === 'topic' ? 'topics' : status === 'reply' ? 'replies' : 'favorites'}` });
    }
    for (const source of sources) {
      const link = el('a', source.label);
      link.setAttribute('href', source.href);
      if (new URL(source.href, location.origin).pathname === pathname) {
        link.classList.add('active'); link.setAttribute('aria-current', 'page');
      }
      navigation.append(link);
    }
    listHeader.classList.add('gzk-profile-list-header');
    listHeader.parentElement?.classList.add('gzk-profile-list');
    listHeader.append(navigation);
  }
  function update(active: boolean) {
    if (signature && placeholder) {
      if (active) header?.append(signature);
      else placeholder.after(signature);
    }
    if (navigation) navigation.hidden = !active;
  }
  update(enabled);
  return {
    update,
    destroy() {
      update(false);
      placeholder?.remove(); navigation?.remove();
      signature?.classList.remove('gzk-profile-signature');
      identity?.classList.remove('gzk-profile-identity');
      listHeader?.classList.remove('gzk-profile-list-header');
      listHeader?.parentElement?.classList.remove('gzk-profile-list');
    },
  };
}
