import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { publicImageUrl, readShareImage } from '../src/site/share-images';
afterEach(() => vi.unstubAllGlobals());
it('分享图片读取只接受公共HTTP图片地址，拒绝本机、内网、凭证和异常端口', () => {
  for (const url of ['file:///etc/passwd','data:image/png;base64,a','https://localhost/x','http://127.1/x','https://10.0.0.1/a','http://169.254.169.254/a','https://[::1]/x','https://[::ffff:127.0.0.1]/x','http://192.168.1.1/x','https://a.local/x','https://user:pass@img.example.com/a','https://img.example.com:8443/a']) expect(() => publicImageUrl(url)).toThrow();
  expect(publicImageUrl('https://i.imgur.com/test.png').origin).toBe('https://i.imgur.com');
});
it('公开图片可经CORS读取；请求不带凭证、不跟随重定向，输出内联数据', async () => {
  const bytes = readFileSync('public/icon/16.png');
  const request = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', request);
  const result = await readShareImage('https://i.imgur.com/test.png', async () => false);
  expect(result).toEqual({ data: `data:image/png;base64,${bytes.toString('base64')}` });
  expect(request).toHaveBeenCalledWith('https://i.imgur.com/test.png', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
});
it('SVG响应保留原始字节和MIME，只返回data URL，不作为HTML解析',async()=>{
  const source='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text x="2" y="25">过早客</text></svg>';
  const bytes=Buffer.from(source,'utf8'),request=vi.fn(async()=>new Response(bytes,{headers:{'content-type':'image/svg+xml; charset=utf-8'}}));
  vi.stubGlobal('fetch',request);
  expect(await readShareImage('https://image.example.com/vector.svg',async()=>false)).toEqual({data:`data:image/svg+xml;base64,${bytes.toString('base64')}`});
  expect(request).toHaveBeenCalledWith('https://image.example.com/vector.svg',expect.objectContaining({credentials:'omit',redirect:'error'}));
});
it.each(['','<?xml version="1.0" encoding="ISO-8859-1"?>'])('按HTTP字符集将SVG%s规范为UTF8，并同步XML声明',async declaration=>{
  const source=`${declaration}<svg xmlns="http://www.w3.org/2000/svg"><text>café</text></svg>`,bytes=Buffer.from(source,'latin1');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes,{headers:{'content-type':'image/svg+xml; charset="ISO-8859-1"'}})));
  expect(await readShareImage('https://image.example.com/latin.svg',async()=>false)).toEqual({data:`data:image/svg+xml;base64,${Buffer.from(source.replace('ISO-8859-1','UTF-8'),'utf8').toString('base64')}`});
});
it('SVG未知字符集或声明UTF8但包含非法字节时明确失败，不替换成乱码',async()=>{
  for(const charset of ['not-a-real-charset','utf-8']){
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([0xe9]),{headers:{'content-type':`image/svg+xml; charset=${charset}`}})));
    await expect(readShareImage('https://image.example.com/bad-charset.svg',async()=>false)).rejects.toThrow('SVG 字符集');
  }
});
it('SVG接受TextDecoder支持的带冒号字符集别名，并忽略其他参数里的charset字样',async()=>{
  const source='<svg xmlns="http://www.w3.org/2000/svg"><text>café</text></svg>';
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(Buffer.from(source,'latin1'),{headers:{'content-type':'image/svg+xml; name="example; charset=utf-8"; charset="iso_8859-1:1987"'}})));
  expect(await readShareImage('https://image.example.com/alias.svg',async()=>false)).toEqual({data:`data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`});
});
it.each(['le','be'])('通用UTF16 SVG按%s的BOM解码，转为UTF8且更新声明',async byteOrder=>{
  const source='<?xml version="1.0" encoding="UTF-16"?><svg xmlns="http://www.w3.org/2000/svg"><text>过早客 café</text></svg>';
  const bytes=Buffer.from('\ufeff'+source,'utf16le');if(byteOrder==='be')bytes.swap16();
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes,{headers:{'content-type':'image/svg+xml; charset=UTF-16'}})));
  expect(await readShareImage('https://image.example.com/utf16.svg',async()=>false)).toEqual({data:`data:image/svg+xml;base64,${Buffer.from(source.replace('UTF-16','UTF-8')).toString('base64')}`});
});
it('SVG的UTF8 BOM优先于不一致的HTTP字符集',async()=>{
  const source='<svg xmlns="http://www.w3.org/2000/svg"><text>过早客 café</text></svg>';
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(Buffer.from('\ufeff'+source),{headers:{'content-type':'image/svg+xml; charset=iso-8859-1'}})));
  expect(await readShareImage('https://image.example.com/bom.svg',async()=>false)).toEqual({data:`data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`});
});
it('缺少来源权限并且读取失败时返回明确的单一来源，不授权也不伪造图片', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  expect(await readShareImage('https://image.example.com/a.png', async () => false)).toEqual({ permission: 'https://image.example.com/*' });
  await expect(readShareImage('https://image.example.com/a.png', async () => true)).rejects.toThrow('读取图片失败');
});
it('拒绝非图片内容与超限响应', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<script>bad</script>', { headers: { 'content-type': 'text/html' } })));
  await expect(readShareImage('https://image.example.com/a.png', async () => true)).rejects.toThrow('不支持');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { headers: { 'content-type': 'image/png', 'content-length': String(20*1024*1024) } })));
  await expect(readShareImage('https://image.example.com/a.png', async () => true)).rejects.toThrow('12 MB');
});
it('拒绝异常响应时取消响应体，及时停止下载', async () => {
  const cases: ResponseInit[] = [{status:403}, {headers:{'content-type':'text/html'}}, {headers:{'content-type':'image/png','content-length':String(20*1024*1024)}}];
  for (const options of cases) {
    const cancel = vi.fn();
    vi.stubGlobal('fetch',vi.fn(async()=> new Response(new ReadableStream({cancel}),options)));
    await expect(readShareImage('https://image.example.com/a.png',async()=>true)).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  }
});
