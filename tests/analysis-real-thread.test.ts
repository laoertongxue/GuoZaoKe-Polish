import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { convertReference, legacySnapshotHash, type LegacyAnalysis, type LegacySnapshot } from '../scripts/analysis-import-reference.ts';
import { assertPackage, exportPackage, importPackage, validatePackage } from '../src/analysis/contracts';
import { calibrationMaterialHash } from '../src/analysis/comparison';
import developmentMaterials from '../src/analysis/development-material-hashes.json';
import fixture from './fixtures/analysis/real-thread-121894-excerpts.json';

const input = () => structuredClone(fixture) as unknown as { snapshot: LegacySnapshot; analysis: LegacyAnalysis };
const sourceRoot = resolve(process.cwd(), '..', '..', 'docs/superpowers/specs/real-thread-121894-2026-09-15');
const fullAvailable = existsSync(resolve(sourceRoot, 'snapshot.json')) && existsSync(resolve(sourceRoot, 'analysis.json'));

describe('real thread 121894 development reference import (not held-out calibration)', () => {
  it('preserves exact quotations and Unicode coordinates, and exports a valid explicitly partial package', async () => {
    const { snapshot, analysis } = input();
    const { package: pkg, audit } = await convertReference(snapshot, analysis);
    expect(validatePackage(pkg)).toEqual([]);
    expect(pkg.claims).toHaveLength(7);
    expect(pkg.snapshot.messages).toHaveLength(4);
    expect(pkg.snapshot.completeness).toBe('partial');
    expect(pkg.status).toBe('partial');
    expect(pkg.evaluations).toEqual([]);
    expect(pkg.provenance.mode).toBe('exploratory');
    expect(pkg.provenance.model).toBe('not-run');
    expect(audit.use).toBe('development-regression-not-independent-holdout');
    expect(audit.numericFactsOmitted).toEqual(['F01']);
    expect(await importPackage(await exportPackage(pkg))).toEqual(pkg);
    const reply = pkg.snapshot.messages.find(m => m.id === 'reply-1398480')!;
    expect(reply.text).toBe('昨天才买了啊');
    expect(reply.authorId).toBe('P01');
    expect(pkg.snapshot.messages[0]!.authorId).toBe('P00');
    expect(pkg.claims.find(c => c.id === 'C04')!.spans).toContainEqual({ messageId: 'reply-1398480', start: 0, end: 6, quote: reply.text });
    expect(pkg.snapshot.messages.every(m => m.publishedAt === null)).toBe(true);
    expect(JSON.stringify(pkg)).not.toContain('"username"');
  });

  it('does not launder legacy access labels, facts, summaries or system evidence into read data or author credit', async () => {
    const { snapshot, analysis } = input();
    const { package: pkg, audit } = await convertReference(snapshot, analysis);
    expect(pkg.sources.find(s => s.id === 'S01')!.status).toBe('lead');
    expect(pkg.sources.find(s => s.id === 'S03')!.status).toBe('lead');
    expect(pkg.sources.find(s => s.id === 'S09')).toMatchObject({ status: 'unreadable', introducedBy: 'P10', introducedAtMessageId: 'reply-1398638' });
    expect(pkg.sources.every(s => s.text === '' && s.data.length === 0)).toBe(true);
    expect(pkg.relations.length).toBeGreaterThan(0);
    expect(pkg.relations.every(r => r.status === 'unresolved' && r.excerpt === '')).toBe(true);
    expect(audit.sourceStatusCounts).toEqual({ read: 0, lead: 2, unreadable: 1 });
    expect(pkg.unresolved.join('\n')).toContain('F01');
    expect(pkg.unresolved.join('\n')).toContain('未迁移');
    // Even an extra field containing a plausible excerpt cannot bypass this metadata-only adapter.
    (analysis.evidence[0] as unknown as Record<string, unknown>).text = '原始公告正文，28379210 千元';
    const again = await convertReference(snapshot, analysis);
    expect(again.package.sources.every(s => s.status !== 'read' && s.text === '')).toBe(true);
  });

  it('rejects changed snapshot fingerprints, reply content, claim anchors and reference ownership', async () => {
    const first = input(); first.snapshot.replies[0]!.text += '篡改';
    await expect(convertReference(first.snapshot, first.analysis)).rejects.toThrow('snapshot_fingerprint');
    const second = input(); second.analysis.snapshot_sha256 = '0'.repeat(64);
    await expect(convertReference(second.snapshot, second.analysis)).rejects.toThrow('reference_snapshot');
    const third = input(); third.analysis.claims[3]!.supporting_spans[0]!.end += 1;
    await expect(convertReference(third.snapshot, third.analysis)).rejects.toThrow('span_integrity');
    const fourth = input(); fourth.analysis.claims[3]!.participant = 'P99';
    await expect(convertReference(fourth.snapshot, fourth.analysis)).rejects.toThrow('claim_owner');
    const fifth = input(); fifth.analysis.claims[3]!.anchor_span.sha256 = '0'.repeat(64);
    await expect(convertReference(fifth.snapshot, fifth.analysis)).rejects.toThrow('span_integrity');
  });

  it('counts code points rather than UTF-16 units and accounts for non-whitespace outside known claim spans', async () => {
    const { snapshot, analysis } = input();
    const reply = snapshot.replies[0]!;
    reply.text = '😀' + reply.text + ' 补充内容';
    reply.sha256 = createHash('sha256').update(reply.text).digest('hex');
    const claim = analysis.claims.find(c => c.reply_id === reply.id)!;
    claim.span_start += 1; claim.span_end += 1;
    claim.anchor_span.start += 1; claim.anchor_span.end += 1;
    claim.supporting_spans[0]!.start += 1; claim.supporting_spans[0]!.end += 1;
    snapshot.content_sha256 = legacySnapshotHash(snapshot);
    analysis.snapshot_sha256 = snapshot.content_sha256;
    const { package: pkg } = await convertReference(snapshot, analysis);
    const spans = pkg.claims.find(c => c.id === claim.id)!.spans;
    expect(spans).toContainEqual({ messageId: `reply-${reply.id}`, start: 1, end: 7, quote: '昨天才买了啊' });
    expect(pkg.coverage.filter(c => c.span.messageId === `reply-${reply.id}` && c.disposition === 'uncertain').map(c => c.span.quote)).toEqual(['😀', ' 补充内容']);
    expect(pkg.unresolved.join('\n')).toContain('未映射原文');
  });

  it.skipIf(!fullAvailable)('converts the complete local frozen reference: 26 messages, 68 claims, 8 unverified sources, no recycled ratings', async () => {
    const bytes = ['snapshot.json', 'analysis.json'].map(name => readFileSync(resolve(sourceRoot, name)));
    for (const [i, name] of ['snapshot.json', 'analysis.json'].entries()) {
      expect(createHash('sha256').update(bytes[i]!).digest('hex')).toBe(fixture.referenceFiles[name as keyof typeof fixture.referenceFiles]);
    }
    const { package: pkg, audit } = await convertReference(JSON.parse(bytes[0]!.toString()), JSON.parse(bytes[1]!.toString()));
    assertPackage(pkg);
    expect(pkg.snapshot.messages).toHaveLength(26);
    expect(pkg.claims).toHaveLength(68);
    expect(pkg.questions).toHaveLength(6);
    expect(pkg.sources).toHaveLength(8);
    expect(pkg.relations).toHaveLength(26);
    expect(pkg.evaluations).toHaveLength(0);
    expect(audit.sourceStatusCounts).toEqual({ read: 0, lead: 6, unreadable: 2 });
    expect(audit.numericFactsOmitted).toHaveLength(7);
    expect(new Set(pkg.snapshot.messages.map(m => m.authorId)).size).toBe(21);
    for (const message of pkg.snapshot.messages) {
      const codepoints = Array.from(message.text);
      const covered = pkg.coverage.filter(c => c.span.messageId === message.id);
      expect(codepoints.every((char, at) => !char.trim() || covered.some(c => c.span.start <= at && c.span.end > at))).toBe(true);
    }
    expect(developmentMaterials.entries.filter(e => e.dataset === 'real-thread-121894').map(e => e.materialHash))
      .toContain(await calibrationMaterialHash(pkg));
    expect(pkg.snapshot.messages.map(m => m.floor)).not.toContain(26);
    expect(pkg.snapshot.gaps.join('\n')).toContain('26');
  });
});
