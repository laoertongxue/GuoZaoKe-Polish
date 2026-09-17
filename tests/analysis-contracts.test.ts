import { describe, expect, it } from 'vitest';
import { exportPackage, importPackage, validatePackage, comparableInputs, hashValue } from '../src/analysis/contracts';
import { examplePackage } from './fixtures/analysis/package';

describe('auditable analysis contract', () => {
  it('preserves Unicode code-point spans, missing dates, null and separate author/system evidence', async () => {
    const pkg = examplePackage();
    expect(validatePackage(pkg)).toEqual([]);
    const read = await importPackage(await exportPackage(pkg));
    expect(read).toEqual(pkg);
    expect(read.snapshot.messages[0]?.publishedAt).toBeNull();
    expect(read.evaluations[0]?.dimensions.E.grade).toBe(0);
  });
  it('rejects invented ownership, positions, references and unread supporting sources', () => {
    const pkg = examplePackage();
    pkg.claims[0]!.authorId = 'P01';
    pkg.claims[0]!.spans[0]!.start = 2;
    pkg.relations[0]!.sourceId = 'missing';
    expect(validatePackage(pkg).map(x => x.code)).toEqual(expect.arrayContaining(['ownership', 'span', 'reference']));
    const unread = examplePackage(); unread.sources[0]!.status = 'lead';
    expect(validatePackage(unread).map(x => x.code)).toContain('unread_evidence');
  });
  it('rejects laundering system evidence into participant credit', () => {
    const pkg = examplePackage(); pkg.evaluations[0]!.sourceIds = ['S01'];
    pkg.evaluations[0]!.dimensions.E.grade = 2;
    expect(validatePackage(pkg).map(x => x.code)).toContain('source_attribution');
  });
  it('keeps NA, pending applicability and missing evidence distinct', () => {
    const pkg = examplePackage(); pkg.evaluations[0]!.dimensions.L.grade = 0;
    expect(validatePackage(pkg).map(x => x.code)).toContain('dimension');
    pkg.evaluations[0]!.dimensions.L = { applicability: 'uncertain', grade: 'U', reason: '不清楚是否提出推导', ruleIds: ['L-P'], refs: [] };
    expect(validatePackage(pkg).map(x => x.code)).toContain('dimension');
  });
  it('rejects fabricated quotations, numeric values without excerpt and null turned into a score', () => {
    const pkg = examplePackage(); pkg.sources[0]!.data[0]!.excerpt = '没有出现在原文的数字';
    pkg.relations[0]!.excerpt = '并不存在的支持';
    expect(validatePackage(pkg).filter(x => x.code === 'excerpt')).toHaveLength(2);
  });
  it('rejects unknown fields including API keys, personality scores and prototype payloads', async () => {
    for (const extra of [{ apiKey: 'never-export-this' }, { participantRanking: [{ score: 0 }] }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
      await expect(exportPackage({ ...examplePackage(), ...extra })).rejects.toThrow('unknown_field');
    }
    const pkg: any = examplePackage(); pkg.provenance.authorization = 'secret';
    await expect(exportPackage(pkg)).rejects.toThrow('unknown_field');
    expect(({} as any).polluted).toBeUndefined();
  });
  it('detects changed imports and forbids comparing distinct frozen evidence, claims or rules', async () => {
    const pkg = examplePackage(); const envelope = JSON.parse(await exportPackage(pkg));
    envelope.package.claims[0].text = 'changed';
    await expect(importPackage(JSON.stringify(envelope))).rejects.toThrow('integrity');
    expect(await comparableInputs(pkg, structuredClone(pkg))).toEqual({ comparable: true, differences: [] });
    const changed = examplePackage(); changed.sources[0]!.text += ' 新增资料';
    changed.methodVersion = '0.2.2';
    expect((await comparableInputs(pkg, changed)).differences).toEqual(['method', 'evidence']);
  });
  it('hashes canonical data independently of property order while preserving null', async () => {
    expect(await hashValue({ b: null, a: 1 })).toBe(await hashValue({ a: 1, b: null }));
    expect(await hashValue({ b: null })).not.toBe(await hashValue({ b: 0 }));
  });
  it('rejects changed numeric values even when their excerpt is genuine', () => {
    const pkg = examplePackage(); pkg.sources[0]!.data[0]!.value = 999;
    expect(validatePackage(pkg).map(x => x.code)).toContain('numeric_provenance');
    pkg.sources[0]!.text = '原值为 1,200.50 元，比例 12%。';
    pkg.sources[0]!.data = [{ label: '原值', value: 1200.5, unit: '元', population: '原统计对象', period: null, excerpt: pkg.sources[0]!.text }];
    pkg.relations = [];
    expect(validatePackage(pkg)).toEqual([]);
    pkg.sources[0]!.data[0]!.value = 0.12;
    expect(validatePackage(pkg).map(x => x.code)).toContain('numeric_provenance');
  });
  it('requires evidence spans for determinate dimensions and prevents unrelated-message attribution', () => {
    const pkg = examplePackage(); pkg.evaluations[0]!.dimensions.E.refs = [];
    expect(validatePackage(pkg).map(x => x.code)).toContain('dimension');
  });
  it('rejects an invented unit even when the numeric token exists in the source', () => {
    const pkg=examplePackage();pkg.sources[0]!.data[0]!.unit='万元';
    expect(validatePackage(pkg).map(x=>x.code)).toContain('unit_provenance');
    pkg.sources[0]!.data[0]!.unit='';
    expect(validatePackage(pkg)).toEqual([]);
  });
  it('rejects cyclic source roots and credential-bearing source links', () => {
    const pkg=examplePackage();pkg.sources.push({...structuredClone(pkg.sources[0]!),id:'S02',rootId:'S01'});pkg.sources[0]!.rootId='S02';
    expect(validatePackage(pkg).map(x=>x.code)).toContain('source_root');
    pkg.sources[0]!.rootId='S01';pkg.sources[0]!.url='https://name:secret@example.org/report';
    expect(validatePackage(pkg).map(x=>x.code)).toContain('source_url');
  });
  it('does not credit another participant’s source without a located reuse reference', () => {
    const pkg=examplePackage(),source=pkg.sources[0]!,topic=pkg.snapshot.messages[0]!;
    source.introducedBy=topic.authorId;source.introducedAtMessageId=topic.id;topic.links=[{url:source.url!,label:'原始资料'}];
    const evaluation=pkg.evaluations[0]!;evaluation.sourceIds=[source.id];evaluation.contributions=['reuse'];evaluation.dimensions.E.grade=2;evaluation.localEvidenceRefs=[];
    expect(validatePackage(pkg).map(x=>x.code)).toContain('source_attribution');
  });
  it('cannot attribute another message’s attack or emotion to the evaluated reply', () => {
    const pkg=examplePackage(),topic=pkg.snapshot.messages[0]!;topic.text='你就是个蠢货';
    pkg.evaluations[0]!.expression={attack:'present',emotion:'present',emotionOnly:false,refs:[{messageId:topic.id,start:0,end:[...topic.text].length,quote:topic.text}]};
    expect(validatePackage(pkg).map(x=>x.code)).toContain('ownership');
  });
});
