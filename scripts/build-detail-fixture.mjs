import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
await build({entryPoints:{'detail-audit':'tests/browser/detail-audit.ts',options:'entrypoints/options/main.ts',popup:'entrypoints/popup/main.ts'},outdir:'tests/browser/generated',bundle:true,format:'iife',target:'chrome120',alias:{'wxt/browser':resolve('tests/browser/detail-api.ts')},plugins:[{name:'inline-css',setup(build){build.onResolve({filter:/\.css\?inline$/},args=>({path:resolve(args.resolveDir,args.path.replace('?inline','')),namespace:'inline-css'}));build.onLoad({filter:/.*/,namespace:'inline-css'},async args=>({contents:await readFile(args.path,'utf8'),loader:'text'}));}}]});
