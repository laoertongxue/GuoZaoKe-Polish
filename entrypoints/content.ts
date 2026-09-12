import { defineContentScript } from 'wxt/utils/define-content-script';
import '../src/styles/content.css';
import { startPage } from '../src/features/page';
import { bootstrapPage } from '../src/features/page-bootstrap';
import { readStoredState } from '../src/shared/storage';
export default defineContentScript({
  matches: ['https://www.guozaoke.com/*', 'https://guozaoke.com/*'],
  runAt: 'document_start',
  main(ctx) {
    const boot = bootstrapPage(readStoredState, state => startPage(ctx, state));
    ctx.onInvalidated(boot.destroy);
    void boot.ready.catch(error => console.error('GuoZaoKe Polish 启动失败', error));
  },
});
