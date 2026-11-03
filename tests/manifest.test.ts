import { expect, it, vi } from 'vitest';
vi.mock('wxt',()=>({defineConfig:(config:unknown)=>config}));
import config from '../wxt.config';

it('请求头权限采用 Chrome 支持的声明，B 站 Cookie 与主机仍按需授权',()=>{
  const manifest=config.manifest as {permissions:string[];optional_permissions:string[];host_permissions:string[]};
  expect(manifest.permissions).toContain('declarativeNetRequestWithHostAccess');
  expect(manifest.optional_permissions).toEqual(['cookies']);
  expect(manifest.host_permissions).not.toContain('https://api.bilibili.com/*');
});
