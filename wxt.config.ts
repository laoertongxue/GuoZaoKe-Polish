import { defineConfig } from 'wxt';
export default defineConfig({
  manifest: {
    name: 'GuoZaoKe Polish',
    description: '为过早客添加现代界面、嵌套回复、热门回复、主题预览、用户标签与稍后阅读。',
    permissions: ['storage', 'contextMenus'],
    host_permissions: ['https://www.guozaoke.com/*', 'https://guozaoke.com/*'],
    optional_host_permissions: ['https://api.imgur.com/*', 'https://*/*', 'http://*/*'],
    action: { default_title: 'GuoZaoKe Polish' },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    web_accessible_resources: [{ resources:['author-avatar.jpeg'],matches:['https://www.guozaoke.com/*','https://guozaoke.com/*'] }],
  },
});
