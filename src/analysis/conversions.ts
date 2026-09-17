import type { EvidenceSource, SourceDatum } from './types';

/** Textual pairing only, not a semantic check of metric, population or period. */
export function datumUnitBinding(datum:SourceDatum):'explicit_pair'|'not_verified'|'unknown' {
  if(datum.value===null || !datum.unit.trim())return 'unknown';
  const text=datum.excerpt.normalize('NFKC').replace(/−/g,'-');
  const unit=datum.unit.normalize('NFKC').trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`(?<![\\d.,])([-+]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)\\s*${unit}(?!\\s*[/／每])`,'g');
  return [...text.matchAll(pattern)].some(match=>Number(match[1]!.replaceAll(',',''))===datum.value)?'explicit_pair':'not_verified';
}

/** Only fixed unit scales. No exchange rates, annualisation, population extrapolation or inferred missing values. */
const RULES = [
  { id:'cny-wan-to-yuan', from:'万元', to:'元', multiplier:10000, divisor:1 },
  { id:'cny-yi-to-yuan', from:'亿元', to:'元', multiplier:100000000, divisor:1 },
  { id:'people-wan-to-person', from:'万人', to:'人', multiplier:10000, divisor:1 },
  { id:'devices-wan-to-unit', from:'万台', to:'台', multiplier:10000, divisor:1 },
  { id:'mass-tonne-to-kg', from:'吨', to:'千克', multiplier:1000, divisor:1 },
  { id:'length-km-to-m', from:'千米', to:'米', multiplier:1000, divisor:1 },
  { id:'time-minute-to-second', from:'分钟', to:'秒', multiplier:60, divisor:1 },
  { id:'time-hour-to-second', from:'小时', to:'秒', multiplier:3600, divisor:1 },
] as const;
export interface UnitConversion {
  sourceId:string; dataIndex:number; label:string;
  originalValue:number|null; originalUnit:string; value:number|null; unit:string;
  population:string; period:string|null; ruleId:string; multiplier:number; divisor:number;
  formula:string; rounding:string;
}
export function conversionsFor(sources: EvidenceSource[]): { version:'unit-scales-1'; items:UnitConversion[] } {
  const items:UnitConversion[]=[];
  for(const source of sources) for(const [dataIndex,datum] of source.data.entries()) {
    const rule=RULES.find(rule=>rule.from===datum.unit.trim());if(!rule || source.status!=='read')continue;
    if(datum.value!==null && datumUnitBinding(datum)!=='explicit_pair')continue;
    const raw=datum.value===null ? null : datum.value*rule.multiplier/rule.divisor;
    // A finite result is necessary but is not a claim of measurement precision.
    if(raw!==null && !Number.isFinite(raw))continue;
    const value=raw===null ? null : Number(raw.toPrecision(15));
    items.push({sourceId:source.id,dataIndex,label:datum.label,originalValue:datum.value,originalUnit:datum.unit,value,unit:rule.to,population:datum.population,period:datum.period,ruleId:rule.id,multiplier:rule.multiplier,divisor:rule.divisor,formula:datum.value===null?'原值未知，结果保留未知':`${datum.value} × ${rule.multiplier} ÷ ${rule.divisor} = ${value}`,rounding:'十进制最多15位有效数字；不增加原始观测精度'});
  }
  return {version:'unit-scales-1',items};
}
