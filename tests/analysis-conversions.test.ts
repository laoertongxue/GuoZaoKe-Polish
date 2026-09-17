import { describe, expect, it } from 'vitest';
import { conversionsFor } from '../src/analysis/conversions';
import { examplePackage } from './fixtures/analysis/package';
import { exportPackage, importPackage, hashValue } from '../src/analysis/contracts';

describe('auditable deterministic unit conversions', () => {
  it('retains original values and scope, records an exact rule and never changes currencies or wage periods', () => {
    const pkg = examplePackage(); const source=pkg.sources[0]!;
    source.data=[{...source.data[0]!,value:1.25,unit:'万元',excerpt:'本次费用1.25万元。'}, {...source.data[0]!,value:5,unit:'美元'}, {...source.data[0]!,value:3,unit:'元/月'}, {...source.data[0]!,value:null,unit:'万元'}];
    const rows=conversionsFor(pkg.sources).items;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({sourceId:source.id,dataIndex:0,originalValue:1.25,originalUnit:'万元',value:12500,unit:'元',multiplier:10000,divisor:1});
    expect(rows[1]?.value).toBeNull(); expect(source.data[0]?.value).toBe(1.25);
  });
  it('exports conversions with the package and rejects a recalculated envelope carrying a false conversion', async () => {
    const pkg=examplePackage();pkg.sources[0]!.text='本次费用1.25万元。';pkg.sources[0]!.data=[{...pkg.sources[0]!.data[0]!,value:1.25,unit:'万元',excerpt:'本次费用1.25万元。'}];pkg.relations=[];
    const envelope=JSON.parse(await exportPackage(pkg));
    expect(envelope.conversions.items[0].value).toBe(12500);
    expect(await importPackage(JSON.stringify(envelope))).toEqual(pkg);
    envelope.conversions.items[0].value=99999;
    envelope.sha256=await hashValue({package:envelope.package,conversions:envelope.conversions});
    await expect(importPackage(JSON.stringify(envelope))).rejects.toThrow('conversion_integrity');
  });
  it('does not pair a population count with a different amount unit in the same excerpt', () => {
    const pkg=examplePackage();pkg.sources[0]!.text='样本2人，总成本5万元。';
    pkg.sources[0]!.data=[{...pkg.sources[0]!.data[0]!,value:2,unit:'万元',excerpt:pkg.sources[0]!.text}];
    expect(conversionsFor(pkg.sources).items).toHaveLength(0);
    pkg.sources[0]!.data[0]!.value=5;
    expect(conversionsFor(pkg.sources).items[0]?.value).toBe(50000);
  });
  it.each(['费用5万元 / 人','费用5万元\n／人','费用5万元 每年'])('does not discard a separated denominator: %s',text=>{
    const pkg=examplePackage();pkg.sources[0]!.data=[{...pkg.sources[0]!.data[0]!,value:5,unit:'万元',excerpt:text}];
    expect(conversionsFor(pkg.sources).items).toEqual([]);
  });
});
