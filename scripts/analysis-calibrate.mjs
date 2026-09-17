#!/usr/bin/env node
// Bundle in memory only: preview/help must not create generated files or load keys.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const controller = new AbortController();
const cancel = () => controller.abort();
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
try {
  const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
  const bundled = await build({
    stdin: { contents: "export { runCalibrationCli } from './scripts/analysis-calibrate.ts';", resolveDir: projectDirectory, sourcefile: 'calibration-cli-entry.ts', loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  });
  const { runCalibrationCli } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  process.exitCode = await runCalibrationCli(process.argv.slice(2), { projectDirectory, signal: controller.signal });
} catch {
  // Avoid esbuild/provider/path errors echoing credentials or raw remote content.
  process.stdout.write('{"mode":"error","code":"cli_start_failed"}\n');
  process.exitCode = 1;
} finally {
  process.off('SIGINT', cancel);
  process.off('SIGTERM', cancel);
}
