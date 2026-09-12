export function encodeBase64(value:string):string {
  return btoa(Array.from(new TextEncoder().encode(value),c=>String.fromCharCode(c)).join(''));
}
export function decodeBase64(value:string):string {
  const clean=value.trim().replace(/\s/g,'').replace(/-/g,'+').replace(/_/g,'/');
  if(!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length%4===1) throw new Error('所选内容不是有效的 Base64');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(clean),c=>c.charCodeAt(0)));}catch{throw new Error('无法解码为 UTF-8 文本');}
}
