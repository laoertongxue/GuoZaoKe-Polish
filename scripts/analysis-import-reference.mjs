#!/usr/bin/env node
/**
 * Export the locally held research reference without making any network or model call.
 * Usage: node scripts/analysis-import-reference.mjs <reference-directory> [artifacts/output-directory]
 * esbuild is already part of the WXT toolchain; bundling allows the same TypeScript
 * converter and production contract checks to run in Node without another runner.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const inputDirectory = process.argv[2];
if (!inputDirectory || process.argv.length > 4) {
  console.error('Usage: node scripts/analysis-import-reference.mjs <reference-directory> [artifacts/output-directory]');
  process.exitCode = 1;
} else {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const outputDirectory = resolve(project, process.argv[3] ?? 'artifacts/analysis-real-thread-121894');
  const relativeOutput = relative(resolve(project, 'artifacts'), outputDirectory);
  if (relativeOutput.startsWith('..') || isAbsolute(relativeOutput)) throw new Error('reference_output: export only inside development artifacts/, never public/ or an extension package');
  const input = resolve(inputDirectory);
  const files = await Promise.all(['snapshot.json', 'analysis.json'].map(name => readFile(resolve(input, name))));
  const snapshot = JSON.parse(files[0].toString('utf8'));
  const analysis = JSON.parse(files[1].toString('utf8'));
  const bundled = await build({
    stdin: { contents: "export { convertReference } from './scripts/analysis-import-reference.ts'; export { exportPackage } from './src/analysis/contracts.ts';", resolveDir: project, sourcefile: 'reference-import-entry.ts', loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false,
  });
  const { convertReference, exportPackage } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const result = await convertReference(snapshot, analysis);
  const envelope = await exportPackage(result.package);
  const receipt = {
    ...result.audit,
    referenceFileHashes: Object.fromEntries(['snapshot.json', 'analysis.json'].map((name, i) => [name, createHash('sha256').update(files[i]).digest('hex')])),
    verification: 'Production assertPackage and exportPackage passed. No model, web request, source re-reading, fact certification or rating replay performed.',
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'package.json'), envelope + '\n', 'utf8');
  await writeFile(resolve(outputDirectory, 'conversion-audit.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ output: relative(project, outputDirectory), messages: receipt.messagesImported, claims: receipt.claimsImported, sources: receipt.sourceStatusCounts, numericFactsOmitted: receipt.numericFactsOmitted.length, ratingsImported: 0, packageHash: receipt.packageHash }, null, 2));
}
