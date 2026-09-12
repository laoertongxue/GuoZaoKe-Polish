import { mountShareWorkspace } from '../../src/features/share-card';
import { imageBytesToDataUrl } from '../../src/site/share-images';
const image = new URL('/icon/128.png', location.href).href;
const query = new URLSearchParams(location.search),long=query.has('long');
const vector=query.has('invalidSvg')?'share-invalid.svg':query.has('latin')?'share-latin.svg':query.has('svg')?'share-vector.svg':'';
const bodyImage=vector?new URL(vector,location.href).href:image;
const paragraphs = long ? Array.from({length:100},(_,index)=>`<p>长文段落 ${index+1}：这是明确标注的测试内容，用来检查分图边界、完整正文和最后一段。</p>`).join('') : '';
void mountShareWorkspace(document.getElementById('app')!, {
  id: '133068', url: 'https://www.guozaoke.com/t/133068', title: '把有用的讨论，完整分享给朋友',
  author: 'demo', avatar: image, node: '公开演示内容', replies: 0, time: '2026-09-12 12:00',
  html: `<p>这是用于检验分享功能的<strong>公开演示内容</strong>，包含正文格式、图片与本机生成的二维码。</p><h3>保留讨论的上下文</h3><ul><li>标题、作者和日期</li><li>正文中的强调、列表和链接</li><li>图片与长段落完整呈现</li></ul><blockquote>一张卡片，也能保留内容的层次。</blockquote><img src="${bodyImage}" alt="${vector?'本地 SVG 测试图':'本地 GZK 测试图标'}"><pre>const community = 'GuoZaoKe';\nconsole.log('一起分享，一起发现');</pre>${paragraphs}<p>这是示例末尾，用来检查生成的图片没有裁掉内容。</p>`, text: '公开演示内容',
}, {
  readImage: async url => {
    const local = new URL(url); if (local.origin !== location.origin || !['/icon/128.png','/tests/browser/share-vector.svg','/tests/browser/share-invalid.svg','/tests/browser/share-latin.svg'].includes(local.pathname)) throw new Error('本地验收只允许指定的测试图片');
    const response = await fetch(local.href, { credentials: 'omit' }); if (!response.ok) throw new Error('测试图片读取失败');
    const mime=local.pathname.endsWith('share-latin.svg')?'image/svg+xml;charset=iso-8859-1':local.pathname.endsWith('.svg')?'image/svg+xml':'image/png';
    return {data:imageBytesToDataUrl(new Uint8Array(await response.arrayBuffer()),mime)};
  },
  authorize: async () => { throw new Error('本地验收不会请求扩展图片来源权限'); },
}).then(() => {
  const evidence = document.createElement('section'); evidence.style.cssText='max-width:750px;margin:32px auto;padding:20px';
  const heading = document.createElement('h2'); heading.textContent='实际生成的 PNG（测试核验）';
  const images = document.createElement('div');images.className='generated-png-evidence';
  const decode=document.createElement('button');decode.type='button';decode.textContent='核验生成 PNG 的二维码';
  const decoded=document.createElement('pre');decoded.className='qr-decode-result';decoded.setAttribute('role','status');
  decode.addEventListener('click',()=>{void (async()=>{
    decode.disabled=true;
    try{
      const {default:jsQR}=await import('jsqr'),results:string[]=[];
      for(const img of images.querySelectorAll('img')){
        await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
        const context=canvas.getContext('2d')!;context.drawImage(img,0,0);
        const pixels=context.getImageData(0,0,canvas.width,canvas.height);
        const result=jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'});
        results.push(`${img.alt} (${pixels.width} × ${pixels.height}): ${result?.data||'未发现二维码'}`);
      }
      decoded.textContent=results.join('\n')||'请先生成 PNG';
    }catch(error){decoded.textContent=String(error);}finally{decode.disabled=false;}
  })();});
  evidence.append(heading,decode,decoded,images); document.body.append(evidence);
  const output = document.querySelector('.share-output')!;
  new MutationObserver(() => {
    decoded.textContent='';
    images.replaceChildren(...[...output.querySelectorAll<HTMLAnchorElement>('a[download]')].map(link => {
      const img = document.createElement('img'); img.src=link.href;img.alt=link.download;img.style.cssText='max-width:375px;width:100%;display:block;margin:16px auto';return img;
    }));
  }).observe(output,{childList:true,subtree:true});
});
