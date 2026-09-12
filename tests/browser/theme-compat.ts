import { createSiteFooter } from '../../src/features/site-footer';
import { enhanceProfile } from '../../src/features/profile';

document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach(button => {
  button.addEventListener('click', () => {
    document.documentElement.dataset.gzkTheme = button.dataset.theme;
  });
});

const compactToggle = document.querySelector<HTMLButtonElement>('#compact-toggle')!;
compactToggle.addEventListener('click', () => {
  const compact = document.documentElement.classList.toggle('gzk-compact');
  compactToggle.setAttribute('aria-pressed', String(compact));
});

const sidebarWrapper = document.createElement('div');
sidebarWrapper.className = 'user-page';

document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll<HTMLElement>('[data-fixture-page]').forEach(page => {
      page.hidden = page.dataset.fixturePage !== button.dataset.page;
    });
    const sidebar = document.querySelector<HTMLElement>('.sidebar-right')!;
    if (button.dataset.page === 'profile' && sidebarWrapper.parentElement !== sidebar) {
      sidebarWrapper.append(sidebar.querySelector('.usercard')!);
      const tools = sidebar.querySelector('.gzk-toolbox'); if (tools) sidebarWrapper.append(tools);
      sidebar.prepend(sidebarWrapper);
    } else if (button.dataset.page !== 'profile' && sidebarWrapper.parentElement === sidebar) {
      sidebar.prepend(...sidebarWrapper.children); sidebarWrapper.remove();
    }
    sidebar.querySelector<HTMLElement>('.usercard > .ui-header')!.hidden = button.dataset.page === 'profile';
    sidebar.querySelectorAll<HTMLElement>(':scope > .sidebox').forEach(card => card.hidden = button.dataset.page === 'profile');
  });
});

const replies = document.querySelector<HTMLElement>('#fixture-replies')!;
let parent = replies;
for (let floor = 1; floor <= 6; floor++) {
  const reply = document.createElement('div');
  reply.className = 'reply-item';
  reply.id = `fixture-reply-${floor}`;
  reply.innerHTML = `<a href="#"><img class="avatar" src="./preview-fixture.svg" alt="测试回复头像"></a><div class="main"><div class="meta"><a class="reply-username" href="#"><span class="username">demo_${floor}</span></a><span class="time">刚刚</span><span class="fr floor">#${floor}</span><span class="fr reply-to floor"><a href="#">赞 0</a></span><button class="gzk-button gzk-reply-action" type="button">回复</button></div><span class="content"><p>${floor === 1 ? '这是第一条回复。正文不应叠加原站的 60px 内边距。' : '这是子回复。小头像、作者和正文应保持对齐，长楼中楼仍然有足够阅读空间。'}</p></span></div>`;
  parent.append(reply);
  if (floor < 5) {
    const children = document.createElement('div');
    children.className = 'gzk-reply-children';
    reply.append(children);
    parent = children;
  }
}

document.querySelector('#align-toggle')?.addEventListener('click', () => {
  replies.classList.toggle('gzk-align');
});

document.querySelector('#horizontal-toggle')?.addEventListener('click', () => {
  document.documentElement.classList.toggle('gzk-horizontal');
});

// This fixture only exercises native form preservation; it never sends a search.
document.querySelector('.J_search')?.addEventListener('submit', event => {
  event.preventDefault();
});
document.querySelector('#fixture-back-top')?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

const fixtureTools = document.querySelector<HTMLElement>('.gzk-toolbox')!;
const fixtureSidebar = document.querySelector<HTMLElement>('.sidebar-right')!;
const fixtureNarrow = matchMedia('(max-width:991px)');
function positionFixtureTools() {
  if (fixtureNarrow.matches) document.body.append(fixtureTools);
  else fixtureSidebar.querySelector('.usercard')!.after(fixtureTools);
}
fixtureNarrow.addEventListener('change', positionFixtureTools);
positionFixtureTools();

new ResizeObserver(() => {
  document.documentElement.style.setProperty('--gzk-tools-height', `${fixtureTools.getBoundingClientRect().height}px`);
}).observe(fixtureTools);

const fixtureMembers = document.querySelector('#fixture-members');
for (let index = 1; index <= 18; index++) {
  const member = document.createElement('div');
  member.className = 'member';
  member.innerHTML = `<a href="#"><img class="avatar" src="./preview-fixture.svg" alt="成员测试头像"></a><span class="username"><a href="#">${index === 4 ? 'demo_with_a_long_username' : `demo_${index}`}</a></span>`;
  fixtureMembers?.append(member);
}

const profileLayout = enhanceProfile(true, '/u/demo_user_with_a_long_name');
document.querySelector('body > .footer > .container')!.append(createSiteFooter({
  reading: () => { document.querySelector('#fixture-result')!.textContent = '稍后阅读入口已响应'; },
  options: () => { document.querySelector('#fixture-result')!.textContent = '选项设置入口已响应'; },
  top: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
}));
const fixtureResult = document.createElement('p');
fixtureResult.id = 'fixture-result';
document.querySelector('body > .container')!.prepend(fixtureResult);
document.querySelector<HTMLButtonElement>('#extension-toggle')!.addEventListener('click', event => {
  const disabled = document.documentElement.classList.toggle('gzk-disabled');
  if (disabled) delete document.documentElement.dataset.gzkTheme;
  else document.documentElement.dataset.gzkTheme = 'light';
  profileLayout.update(!disabled);
  (event.currentTarget as HTMLButtonElement).textContent = disabled ? '启用增强' : '停用增强';
});
