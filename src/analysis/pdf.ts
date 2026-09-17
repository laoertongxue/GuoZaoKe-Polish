import { getDocument, GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ProviderError } from './providers';
import type { PdfText } from './evidence';

// PDF.js 6 removed the former isEvalSupported option and its dynamic JS compiler.
// This module never requests PDF action JavaScript or loads the scripting sandbox.
// Vite emits this worker into the extension bundle. Never use a CDN worker.
GlobalWorkerOptions.workerSrc = workerUrl;

/** Extract text only. Do not render pages, annotations, actions or JavaScript. */
export async function parsePdfText(bytes: Uint8Array, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<PdfText> {
  if (options.signal?.aborted) throw new ProviderError('cancelled');
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new ProviderError('invalid_request');
  // Extension URLs have an opaque URL.origin in some engines. Letting PDF.js
  // construct the worker can create a blob wrapper, which MV3 CSP rejects.
  const port = typeof Worker !== 'undefined' ? new Worker(workerUrl, { type: 'module' }) : null;
  const worker = port ? PDFWorker.create({ port }) : undefined;
  let task: ReturnType<typeof getDocument>;
  try { task = getDocument({
    data: new Uint8Array(bytes), worker, disableFontFace: true, useSystemFonts: false,
    useWorkerFetch: false, useWasm: false, enableXfa: false,
    disableAutoFetch: true, disableStream: true, stopAtErrors: true,
    isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
  }); } catch (error) { worker?.destroy(); port?.terminate(); throw error; }
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    void task.destroy().catch(() => {});
    worker?.destroy();
    port?.terminate();
  };
  let reason: 'timeout' | 'cancelled' | null = null;
  let rejectAbort!: (error: Error) => void;
  const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const stop = (code: 'timeout' | 'cancelled') => { reason = code; rejectAbort(new ProviderError(code)); destroy(); };
  const abort = () => stop('cancelled');
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  const work = async (): Promise<PdfText> => {
    const pdf = await task.promise;
    const limitations = ['仅提取 PDF 文字层；未核对图片、图表、批注或交互内容。', '文字层顺序不保证等同视觉阅读顺序；多栏排版、表格和上下标可能错序，数值与单位须对照原页确认。'];
    const pageLimit = Math.min(pdf.numPages, 50);
    const pages: string[] = [];
    let total = 0, pagesRead = 0;
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
      if (reason) throw new ProviderError(reason);
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const lines: string[] = [];
        let line = '', lastY: number | null = null;
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const y = item.transform[5] as number;
          if (lastY !== null && Math.abs(y - lastY) > 2 && line) { lines.push(line.trimEnd()); line = ''; }
          line += item.str;
          if (item.hasEOL) { lines.push(line.trimEnd()); line = ''; }
          lastY = y;
        }
        if (line) lines.push(line.trimEnd());
        const text = lines.join('\n').trim();
        pagesRead++;
        if (text) pages.push(`[页 ${pageNumber}]\n${text}`);
        else limitations.push(`第 ${pageNumber} 页无可提取文字，可能为空白或扫描图片。`);
        total += text.length;
        if (total > 1_500_000) { limitations.push('PDF 文字达到读取上限，后续页面未读取。'); break; }
      } finally { page.cleanup(); }
    }
    let title = '';
    try { const metadata = await pdf.getMetadata(); const info = metadata.info as { Title?: unknown }; if (typeof info.Title === 'string') title = info.Title; } catch { /* Publication date and publisher remain unknown. */ }
    return { text: pages.join('\n\n'), title, pageCount: pdf.numPages, pagesRead, limitations };
  };
  try { return await Promise.race([work(), abortPromise]); }
  catch (error) { if (reason) throw new ProviderError(reason); throw error; }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    destroy();
  }
}
