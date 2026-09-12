import { expect,it } from 'vitest';
import { encodeBase64,decodeBase64 } from '../src/features/encoding';
import { richHtml } from '../src/shared/ui';
it('Base64支持中文和emoji，拒绝无效编码',()=>{
  expect(decodeBase64(encodeBase64('过早客 🍜'))).toBe('过早客 🍜');
  expect(()=>decodeBase64('this is not base64!')).toThrow();
});
it('主题预览保留格式同时移除脚本、事件、危险地址和表单',()=>{
  const target=document.createElement('div');
  richHtml(target,'<p>正文<strong>加粗</strong><img src="/a.png" onerror="alert(1)"><a href="javascript:alert(1)">危险</a><script>alert(1)</script><form><input></form></p>');
  expect(target.querySelector('strong')?.textContent).toBe('加粗');
  expect(target.querySelector('script,input,form')).toBeNull();
  expect(target.querySelector('img')?.getAttribute('onerror')).toBeNull();
  expect(target.querySelector('a')?.hasAttribute('href')).toBe(false);
  expect(target.querySelector('img')?.src).toBe('https://www.guozaoke.com/a.png');
});
