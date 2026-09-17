import { describe, expect, it } from 'vitest';
import { buildTrialSuite, trialCases } from '../src/analysis/calibration-suite';
import { assertPackage, hashValue } from '../src/analysis/contracts';
import { compareRatings, dimensionState } from '../src/analysis/comparison';
import developmentMaterials from '../src/analysis/development-material-hashes.json';

const caseById = (id: string) => trialCases().find(item => item.id === `reference-${id}`)!.reference;
const states = (id: string) => Object.values(caseById(id).evaluations[0]!.dimensions).map(dimensionState);

describe('bundled trial corpus', () => {
  it('has stable, closed, distinct reference cases with complete rating units', async () => {
    const first = await buildTrialSuite();
    expect((await buildTrialSuite()).hash).toBe(first.hash);
    const { hash, ...sealedPayload } = first;
    expect(hash).toBe(await hashValue(sealedPayload));
    // Deliberate resealing requires a new suite version and a new actual seal timestamp.
    expect(hash).toBe('1caac2f9cb130d97d02b0c738ad61ad4882155dc414bcfa4e3a35460c5b97406');
    expect(first.frozenAt).toBe('2026-09-15T08:25:22.000Z');
    expect(first.referenceLabel).toContain('候选规则试跑集');
    expect(first.referenceLabel).toContain('尚无独立人工专家标注');
    expect(first.referenceLabel).toContain('非正式留出认证');
    expect(first.cases).toHaveLength(21);
    expect(first.cases.filter(item => item.track === 'extraction')).toHaveLength(3);
    expect(first.cases.filter(item => item.track === 'rating')).toHaveLength(18);
    expect(Number.isFinite(Date.parse(first.frozenAt))).toBe(true);
    expect(first.frozenAt).not.toBe('2026-09-15T07:30:00.000Z');
    for (const item of trialCases()) {
      expect(() => assertPackage(item.reference)).not.toThrow();
      expect(item.reference.snapshot.id).toMatch(/^calibration-/);
      if (item.track === 'rating') {
        const comparison = await compareRatings(item.reference, item.reference);
        expect(comparison.counts.missingLeft).toBe(0);
        expect(comparison.counts.invalidUnits).toBe(0);
        expect(comparison.unexpectedLeft).toEqual([]);
      }
    }
  });

  it('includes the topic question in extraction and states the conditional classification convention', () => {
    const x2 = caseById('X02'); const topic = x2.snapshot.messages[0]!;
    expect(x2.claims.some(claim => claim.messageId === topic.id && claim.kind === 'question' && claim.adoption === 'questioned')).toBe(true);
    expect(x2.coverage.find(unit => unit.span.messageId === topic.id)?.disposition).toBe('claim');
    expect(x2.claims.find(claim => claim.kind === 'experience')!.qualifiers.unit).toBe('not_stated');
    expect(caseById('X03').unresolved.join(' ')).toContain('hypothesis 优先');
    expect(caseById('X03').unresolved.join(' ')).toContain('不是唯一语义答案');
  });

  it('separates a known inference with missing text from genuinely ambiguous adoption', () => {
    expect(states('R14')).toEqual(['U', 'NA', 'U', 'U']);
    expect(caseById('R14').claims[0]!.adoption).toBe('asserted');
    expect(states('R16')).toEqual(['U', 'P', 'P', 'P']);
    expect(caseById('R16').claims[0]!.adoption).toBe('uncertain');
    expect(caseById('R16').evaluations[0]!.expression.emotionOnly).toBe(null);
    expect(caseById('R16').evaluations[0]!.localEvidenceRefs).toEqual([]);
    expect(states('R28')).toEqual(['P', 'P', 'NA', 'P']);
    expect(caseById('R28').evaluations[0]!.targetMessageIds).toEqual([caseById('R28').snapshot.messages[0]!.id]);
    expect(caseById('R28').evaluations[0]!.localEvidenceRefs).toEqual([]);
  });

  it('has discriminating partial, erroneous, unavailable and non-applicable dimension anchors', () => {
    const evaluations = trialCases().filter(item => item.track === 'rating').flatMap(item => item.reference.evaluations);
    for (const dimension of ['R', 'E', 'L', 'B'] as const) {
      const present = new Set(evaluations.map(item => dimensionState(item.dimensions[dimension])));
      for (const grade of ['0', '1', '2', 'U', 'NA', 'P'] as const) expect(present.has(grade), `${dimension}-${grade}`).toBe(true);
    }
    expect(states('R18')[1]).toBe('1');
    expect(caseById('R18').relations[0]!.status).toBe('partial');
    expect(states('R19')[1]).toBe('U');
    expect(caseById('R19').sources[0]!.status).toBe('unreadable');
    expect(caseById('R19').sources[0]!.text).toBe('');
    expect(caseById('R19').evaluations[0]!.contributions).toEqual(['source_lead']);
    expect(states('R20')[2]).toBe('1');
    expect(states('R21')[3]).toBe('1');
  });

  it('records calculation as an action and keeps emotion, reasoning and attack distinct', () => {
    for (const id of ['R12', 'R13']) expect(caseById(id).evaluations[0]!.contributions).toEqual(expect.arrayContaining(['evidence', 'reasoning_check']));
    const mixed = caseById('R22').evaluations[0]!;
    expect(mixed.expression).toMatchObject({ emotion: 'present', attack: 'absent', emotionOnly: false });
    expect(dimensionState(mixed.dimensions.L)).toBe('2'); expect(mixed.contributions).toContain('reasoning_check');
    expect(caseById('R23').claims).toEqual([]);
    expect(states('R23')).toEqual(['NA', 'NA', 'NA', 'NA']);
    expect(caseById('R23').evaluations[0]!.expression).toMatchObject({ emotion: 'present', attack: 'absent', emotionOnly: true });
    expect(states('R24')).toEqual(['0', 'NA', 'NA', 'NA']);
    expect(caseById('R24').evaluations[0]!.expression).toMatchObject({ emotion: 'absent', attack: 'present', emotionOnly: false });
  });

  it('distinguishes system corroboration, reuse and first introduction of the same type of evidence', () => {
    const system = caseById('R25'); const reuse = caseById('R26'); const introduced = caseById('R27');
    expect(system.sources[0]!.introducedBy).toBe('system');
    expect(system.relations[0]!.status).toBe('supports');
    expect(system.evaluations[0]!.sourceIds).toEqual([]);
    expect(system.evaluations[0]!.contributions).toEqual([]); expect(states('R25')[1]).toBe('0');
    expect(reuse.sources[0]!.introducedAtMessageId).toBe(reuse.snapshot.messages[0]!.id);
    expect(reuse.evaluations[0]!.contributions).toEqual(['reuse']); expect(states('R26')[1]).toBe('2');
    expect(introduced.sources[0]!.introducedAtMessageId).toBe(introduced.snapshot.messages[1]!.id);
    expect(introduced.evaluations[0]!.contributions).toEqual(['evidence']); expect(states('R27')[1]).toBe('2');
  });

  it('loads nonempty development exclusions including a reproducible original C20 material hash', async () => {
    const suite = await buildTrialSuite();
    expect(suite.developmentInputHashes.length).toBeGreaterThanOrEqual(25);
    expect(new Set(suite.developmentInputHashes).size).toBe(suite.developmentInputHashes.length);
    expect(suite.developmentInputHashes.every(hash => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    const material = [
      { kind: 'topic', text: '#1分享了自己排队两小时的经历。当前作者以下两句是完整回复，没有引用、事实断言或其他上下文。', links: [], imageCount: 0 },
      { kind: 'reply', text: '气死了，真的气死了！', links: [], imageCount: 0 },
    ];
    expect(suite.developmentInputHashes).toContain(await hashValue(material));
    const caseIds = Array.from({ length: 24 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`);
    for (const dataset of ['reply-calibration-0.1', 'reply-calibration-0.2']) {
      expect(developmentMaterials.entries.filter(entry => entry.dataset === dataset).map(entry => entry.caseId).sort()).toEqual(caseIds);
    }
    expect(developmentMaterials.entries.filter(entry => entry.dataset === 'real-thread-121894').map(entry => entry.representation).sort()).toEqual(['empty-labelled-links', 'text-only', 'url-labelled-links']);
    for (const entry of developmentMaterials.entries) {
      expect(Object.keys(entry).sort()).toEqual(['caseId', 'dataset', 'materialHash', 'representation']);
      expect(suite.developmentInputHashes).toContain(entry.materialHash);
    }
  });
});
