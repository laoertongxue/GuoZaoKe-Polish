import { freezeCalibrationSuite, DEFAULT_CALIBRATION_THRESHOLDS, type CalibrationCase, type FrozenCalibrationSuite } from './comparison';
import { hashValue } from './contracts';
import { splitSpans } from './snapshot';
import developmentMaterials from './development-material-hashes.json';
import { METHOD_VERSION, type AnalysisPackage, type Claim, type Dimension, type EvidenceSource, type ReplyEvaluation } from './types';

// Assistant-adjudicated candidate rule trials, not independent expert labels or formal holdout certification.
// Every artifact content/threshold change requires a new version and actual seal event.
const FROZEN_AT = '2026-09-15T08:25:22.000Z';
const stamp = '2026-09-15T00:00:00.000Z';
function base(id: string, title: string, topic: string, reply: string, partial = false): AnalysisPackage {
  const topicId = `99000000000${id.replace(/\D/g,'')}`;
  const url = `https://www.guozaoke.com/t/${topicId}`;
  return {formatVersion:1,methodVersion:METHOD_VERSION,id:`reference-${id}`,createdAt:stamp,
    snapshot:{id:`calibration-${id}`,topicId,url,title:`合成候选样例 ${id} · ${title}`,capturedAt:stamp,messages:[
      {id:`topic-${topicId}`,authorId:'P01',kind:'topic',floor:null,text:topic,publishedAt:null,displayedTime:'合成语境，非真实帖子',links:[],imageCount:0,stableId:false},
      {id:`reply-${topicId}`,authorId:'P02',kind:'reply',floor:1,text:reply,publishedAt:null,displayedTime:'合成语境，非真实帖子',links:[],imageCount:0,stableId:false},
    ],pages:[{url,status:'read',messageIds:[`topic-${topicId}`,`reply-${topicId}`],error:null}],expectedReplies:partial?null:1,completeness:partial?'partial':'complete',gaps:partial?['样例故意缺少 #9 被引用原文。']:[]},
    claims:[],coverage:[],questions:[],sources:[],relations:[],evaluations:[],provenance:{mode:'exploratory',modelConfigId:'reference',endpoint:'https://example.org/v1',model:'reference-only',providerModel:null,declaredVersion:'assistant-adjudicated-0.2.1-candidate-v2',parameters:{temperature:0,maxOutputTokens:4096},stageHashes:{},qualificationId:null},status:'completed',unresolved:['全部人物、数据与网址标识均为合成测试材料，不得当作真实论坛事实。','本包为新编合成候选规则试跑集，非正式留出认证；结构字段匹配不等于语义正确率，重复运行不增加独立样例数。']};
}
function claim(pkg:AnalysisPackage,id:string,quote:string,kind:Claim['kind'],qualifiers:Partial<Claim['qualifiers']>,adoption:Claim['adoption']='asserted',messageIndex=1) {
  const m=pkg.snapshot.messages[messageIndex]!;const index=m.text.indexOf(quote);if(index<0)throw new Error('fixture_quote');
  const start=Array.from(m.text.slice(0,index)).length;
  pkg.claims.push({id,authorId:m.authorId,messageId:m.id,text:quote,kind,adoption,spans:[{messageId:m.id,start,end:start+Array.from(quote).length,quote}],qualifiers:{population:'not_stated',time:'not_stated',metric:'not_applicable',unit:'not_applicable',quantifier:'not_stated',conditions:'not_stated',...qualifiers},contextRefs:[],uncertainty:[]});
}
function cover(pkg:AnalysisPackage) {
  pkg.coverage=pkg.snapshot.messages.flatMap(m=>splitSpans(m).map(span=>{
    const ids=pkg.claims.filter(c=>c.spans.some(s=>s.messageId===span.messageId && s.start<span.end && s.end>span.start)).map(c=>c.id);
    return {span,claimIds:ids,disposition:ids.length?'claim' as const:'non_assertive' as const,reason:ids.length?'记录该原句中的命题或提问':'任务指令、限定、资料引入动作或表达语境，未增加本轮选定的独立命题'};
  }));return pkg;
}
function source(pkg:AnalysisPackage,text:string,options:{introducedBy?:'reply'|'topic'|'system';readable?:boolean}={}): EvidenceSource {
  const m=options.introducedBy==='system'?null:pkg.snapshot.messages[options.introducedBy==='topic'?0:1]!;
  const readable=options.readable!==false;
  const source:EvidenceSource={id:'S01',url:null,title:readable?'给定合成原始记录 S01':'仅有资料名及段号的合成线索 S01',publisher:'合成测试材料',publishedAt:null,retrievedAt:stamp,status:readable?'read':'unreadable',kind:'text',text:readable?text:'',locator:readable?'内置样例 S01，第1段':'作者声称 S01 第2段；未取得原文',rootId:'S01',introducedBy:m?.authorId??'system',introducedAtMessageId:m?.id??null,limitations:readable?['为测试规则专门编写的虚构记录。']:['原文不可读；不能从资料名或作者转述推定支持关系。'],data:[]};pkg.sources.push(source);return source;
}
function relate(pkg:AnalysisPackage,status:AnalysisPackage['relations'][number]['status'],reason:string) {
  pkg.relations.push({id:`E-${pkg.claims[0]!.id}`,claimId:pkg.claims[0]!.id,sourceId:'S01',status,excerpt:pkg.sources[0]!.text,reason});
}
type TrialState=Exclude<Dimension['grade'],null>|'NA'|'P';
type EvaluationOptions={missingTarget?:boolean;contributions?:ReplyEvaluation['contributions'];sourceIds?:string[];expression?:Pick<ReplyEvaluation['expression'],'emotion'|'attack'|'emotionOnly'>};
function evaluate(pkg:AnalysisPackage,states:[TrialState,TrialState,TrialState,TrialState],reasons:[string,string,string,string],task:string,options:EvaluationOptions={}) {
  const m=pkg.snapshot.messages[1]!;const refs=[{messageId:m.id,start:0,end:Array.from(m.text).length,quote:m.text}];
  const dimensions=Object.fromEntries((['R','E','L','B'] as const).map((key,index)=>{const state=states[index]!;return [key,{applicability:state==='NA'?'no':state==='P'?'uncertain':'yes',grade:state==='NA'||state==='P'?null:state,reason:reasons[index]!,ruleIds:[`${key}${typeof state==='number'?state:`-${state}`}`],refs}];})) as Record<'R'|'E'|'L'|'B',Dimension>;
  const missing=options.missingTarget??false;
  const expression=options.expression??{emotion:'absent',attack:'absent',emotionOnly:false};
  const claims=pkg.claims.filter(c=>c.messageId===m.id);
  pkg.evaluations.push({id:`V-${claims[0]?.id||m.id}`,messageId:m.id,claimIds:claims.map(c=>c.id),targetMessageIds:missing?[]:[pkg.snapshot.messages[0]!.id],task,dimensions,expression:{...expression,refs:expression.emotion==='present'||expression.attack==='present'?refs:[]},contributions:options.contributions??(pkg.sources.some(s=>s.status==='read'&&s.introducedAtMessageId===m.id)?['evidence']:[]),sourceIds:options.sourceIds??pkg.sources.filter(s=>s.introducedBy!=='system').map(s=>s.id),localEvidenceRefs:missing?[]:[pkg.snapshot.messages[0]!.id],issues:missing?['缺少#9原文，不能补造被回应的内容。']:[]});
  return cover(pkg);
}
export function trialCases(): CalibrationCase[] {
  const x1=base('X01','引用归属','请区分个人偏好、转述与提问。','我更喜欢纸质书。有人说“电子书一定伤眼”，我没有采纳这个说法，想知道其证据。');
  claim(x1,'C-X01-1','我更喜欢纸质书。','value',{population:'我',metric:'阅读媒介偏好'});
  claim(x1,'C-X01-2','电子书一定伤眼','quotation',{population:'电子书',quantifier:'一定'},'quoted');
  claim(x1,'C-X01-3','想知道其证据','question',{population:'电子书一定伤眼'},'questioned');
  x1.unresolved.push('本轮将偏好、未采纳的被引命题和提问分别登记；其他拆分/合并需看原文，不是文案不同就判语义错误。');
  const x2=base('X02','否定与有限经历','本地压缩测试的结果是什么？','仅在这次十次本地测试里，压缩后平均体积没有下降。我没有说所有文件都如此。');
  claim(x2,'C-X02-0','本地压缩测试的结果是什么？','question',{population:'本地压缩测试',metric:'结果'},'questioned',0);
  claim(x2,'C-X02-1','仅在这次十次本地测试里，压缩后平均体积没有下降。','experience',{population:'这次十次本地测试',time:'这次',metric:'压缩后平均体积',unit:'not_stated',quantifier:'仅',conditions:'本地测试'});
  x2.unresolved.push('否定与有限范围必须保留；将后一句限定也纳入同一主张可有合理依据，精确span差异不直接代表语义错误。');
  const x3=base('X03','假设不能变成观测','计算假设与实测结果请分开。','如果每组有6个球，5组就是30个。这只是计算假设，不是现场清点结果。');
  claim(x3,'C-X03-1','如果每组有6个球，5组就是30个。','hypothesis',{population:'5组球',time:'not_applicable',metric:'球的总数',unit:'个',quantifier:'5组',conditions:'如果每组有6个球'});
  x3.unresolved.push('本轮结构分类采用 hypothesis 优先于 reasoning，焦点为显式假设而非现实观测；这不是唯一语义答案。保留条件的reasoning分类应展示为规则约定差异，不能宣传成事实错误。');
  const r1=base('R11','样本外推','甲厂3台显示器的合成记录，能说明所有品牌都会省电吗？请解释。','附记录 S01：甲厂3台都省电。测了甲厂3台，所以所有品牌都会省电。');
  claim(r1,'C-R11','测了甲厂3台，所以所有品牌都会省电。','reasoning',{population:'所有品牌',metric:'省电',quantifier:'所有',conditions:'测了甲厂3台'});
  source(r1,'S01 合成记录：本次只测甲厂3台显示器；这3台耗电均低于各自测试基线。没有其他品牌的测试。');
  r1.relations=[{id:'E-R11',claimId:'C-R11',sourceId:'S01',status:'incomparable',excerpt:r1.sources[0]!.text,reason:'甲厂3台样本不能与所有品牌的总体断言视为同一口径。'}];
  evaluate(r1,[2,0,0,0],['直接回答是否能说明并给出了理由；理由有效性另评。','记录仅涉及甲厂3台，不能支持所有品牌的结论。','从甲厂3台推广到所有品牌缺少有效推导。','依据范围为甲厂3台，结论明确扩成所有品牌。'],'判断该样本是否足以推广到所有品牌并说明理由');
  const r2=base('R12','同口径资料与有效计算','按合成记录 S01，本次8个订单的均摊运费是多少？请给出计算。','我附上本次记录 S01：这8单总运费24元，24÷8=3元/单，因此仅本次8单的均摊运费为3元/单。');
  claim(r2,'C-R12','这8单总运费24元，24÷8=3元/单，因此仅本次8单的均摊运费为3元/单。','empirical',{population:'本次8单',time:'本次',metric:'均摊运费',unit:'元/单',quantifier:'仅',conditions:'这8单总运费24元'});
  source(r2,'S01 合成订单记录：本次订单数8单，总运费24元，均摊运费3元/单。范围仅限这8单。');
  r2.relations=[{id:'E-R12',claimId:'C-R12',sourceId:'S01',status:'supports',excerpt:r2.sources[0]!.text,reason:'对象、统计期间、总额、订单数和均摊口径与该有限主张一致。'}];
  evaluate(r2,[2,2,2,2],['给出了所问数值和计算。','随回复引入可读、可定位且同口径的记录。','24÷8=3，展示的计算成立。','结论明确限于本次8单。'],'回答本次8单均摊运费并列计算');
  r2.evaluations[0]!.contributions.push('reasoning_check');
  const r3=base('R13','数值误引与条件算术分开','仅按合成记录 S01，A组8人的完成率是多少？请列计算。','附记录 S01。仅这次A组8人中有4人完成，4÷8=50%，所以这次A组完成率50%。');
  claim(r3,'C-R13','仅这次A组8人中有4人完成，4÷8=50%，所以这次A组完成率50%。','empirical',{population:'这次A组8人',time:'这次',metric:'完成率',unit:'%',quantifier:'仅',conditions:'有4人完成'});
  source(r3,'S01 合成记录：这次A组8人参加，其中2人完成，完成率25%。');
  r3.relations=[{id:'E-R13',claimId:'C-R13',sourceId:'S01',status:'contradicts',excerpt:r3.sources[0]!.text,reason:'原始记录是2人和25%，回复误引为4人和50%。'}];
  evaluate(r3,[2,0,2,2],['直接回答完成率并列出计算，数字正确性由E处理。','所附记录的2人被误引为4人。','如果前提为4/8，等于50%的算术有效；前提误引另评。','仍限于同次A组，单纯数字误引不重复算范围扩张。'],'仅针对A组这8人的完成率列计算');
  r3.evaluations[0]!.contributions.push('reasoning_check');
  const r4=base('R14','目标缺失必须弃判','上文部分消息不可见。','#9 你说的那个就算成立，也说明不了这个。',true);
  claim(r4,'C-R14','#9 你说的那个就算成立，也说明不了这个。','reasoning',{population:'ambiguous',conditions:'ambiguous'});
  evaluate(r4,['U','NA','U','U'],['明确回应#9，目标原文缺失，不能核对覆盖。','只质疑条件推导，未另行采纳经验事实。','能确定作者在检验推导，但缺少前提与结论原文，不能验证。','能确定作者提出自己的推导检验，无法对照目标范围；不是采纳与否不明。'],'回应缺失的#9并检验其前提是否足以推出结论',{missingTarget:true,contributions:['reasoning_check']});
  const r5=base('R15','有限偏好无须外证','你本人更喜欢哪种便笺？','我自己偏爱没有横线的便笺，仅代表我的使用偏好。');
  claim(r5,'C-R15','我自己偏爱没有横线的便笺，仅代表我的使用偏好。','value',{population:'我自己',metric:'便笺偏好',quantifier:'仅',conditions:'我的使用偏好'});
  evaluate(r5,[2,'NA','NA',2],['回答了本人偏好。','个人价值偏好不承担外部事实举证任务。','没有展示前提到结论推导。','明确只陈述个人偏好。'],'回答个人便笺偏好');
  const r16 = base('R16', '采纳与反讽归属不明', '缺少#9及能确定所指方案的其他上下文。', '#9 “这下又都变好了”，呵呵。', true);
  claim(r16, 'C-R16', r16.snapshot.messages[1]!.text, 'uncertain', { population: 'ambiguous', metric: 'ambiguous', conditions: 'ambiguous' }, 'uncertain');
  evaluate(r16, ['U', 'P', 'P', 'P'], ['明确指向#9，但无法读取回应目标。', '不能确定引号内文字是采纳、转述还是反讽，举证任务待定。', '不能确定是在检验某个推导，还是仅转述或确认。', '无法确定作者自己采纳的范围与强度。'], '判断对缺失#9的回应，不恢复未知语境', { missingTarget: true, expression: { emotion: 'uncertain', attack: 'uncertain', emotionOnly: null } });

  const r17 = base('R17', '仅完成部分明确请求', '请报告本次订单均摊运费，并同时列出订单数和计算式。', '附记录 S01，本次均摊运费为3元/单。');
  claim(r17, 'C-R17', '本次均摊运费为3元/单。', 'empirical', { population: '本次订单', time: '本次', metric: '均摊运费', unit: '元/单' });
  r17.claims[0]!.contextRefs.push(r17.snapshot.messages[0]!.id);
  source(r17, 'S01 合成记录：本次8个订单，总运费24元，均摊3元/单。'); relate(r17, 'supports', '记录支持其报告的本次均摊数值；请求中未回答的部分由R另评。');
  evaluate(r17, [1, 2, 'NA', 2], ['只给均摊数，未列明确要求的订单数与计算式。', '所附记录可核对并支持报告的均摊数值。', '回复本身未展示计算，不因来源有数字自动判L2。', '结论仍限于本次订单，没有扩大所引记录。'], '报告本次均摊运费，同时列出订单数及计算式');

  const r18 = base('R18', '同口径可识别的部分支持', '这次试验预定三批样品的合格率是否都为90%？请给记录。', '附记录 S01，这次试验的第1、2、3批合格率都为90%。');
  claim(r18, 'C-R18', '这次试验的第1、2、3批合格率都为90%。', 'empirical', { population: '这次试验的第1、2、3批', time: '这次试验', metric: '合格率', unit: '%', quantifier: '都' });
  source(r18, 'S01 合成记录：本次预定三批采用同一检测口径。第1批100件中90件合格；第2批100件中90件合格。第3批尚无检测记录，不能判断其合格率。');
  relate(r18, 'partial', '同一有限主张中，第1、2批的90%可由同口径记录确认，第3批缺失；不是只支持一个无关前提。');
  evaluate(r18, [2, 1, 'NA', 0], ['回答三批是否均为90%并提供记录。', '同口径记录直接支持列举范围中的第1、2批，未支持第3批。', '仅报告并列结论，没有展示由记录到结论的推导过程。', '已有检测只覆盖前两批，却把第3批也写成已确认。'], '核查所选的三批均为90%的整体主张，分别指出已支持和缺失部分');

  const r19 = base('R19', '有线索但资料不可读', '你所说这次同组观察的平均步数减少了多少？请给出处。', '据 S01 第2段，这次同一组的平均步数减少120步。');
  claim(r19, 'C-R19', '这次同一组的平均步数减少120步。', 'empirical', { population: '这次同一组', time: '这次', metric: '平均步数减少', unit: '步' });
  source(r19, '', { readable: false }); relate(r19, 'unresolved', '给出资料名和段号，但原文未读取，不能核验数值或范围。');
  evaluate(r19, [2, 'U', 'NA', 'U'], ['给出数值和所要求的资料名、段号。', '确有来源线索但无法读取，不按未举证E0处理。', '只转述一个数值，没有展示推导。', '来源不可读，无法对照同组及平均口径是否被保留。'], '报告减少步数及出处', { contributions: ['source_lead'] });

  const r20 = base('R20', '有效部分与尚缺桥梁', '在给定假设下，比较录入加校验的总耗时并提出选择。录入每步1分钟，A有3步、B有5步；两者校验耗时未知。', '录入阶段A是3分钟、B是5分钟，A少2分钟，因此我倾向选A；但还需要比较校验耗时，才能补全总流程选择的依据。');
  claim(r20, 'C-R20', r20.snapshot.messages[1]!.text, 'reasoning', { population: 'A与B的总流程选择', time: 'not_applicable', metric: '总耗时', unit: '分钟', conditions: '录入每步1分钟；校验耗时未知' });
  r20.claims[0]!.contextRefs.push(r20.snapshot.messages[0]!.id);
  evaluate(r20, [1, 'NA', 1, 2], ['完成录入比较，但明确缺少请求中的校验及总耗时比较。', '在给定假设内做算术和选择建议，不新增经验事实。', '录入少2分钟的有效部分已展示；总体选择依据仍缺校验比较，作者也明确承认尚未补全。', '明确保留阶段边界及未知条件，未断言A总耗时已更短。'], '评价从已展示录入计算到总流程选型建议的完整论证，不能只选已完成的算术子任务', { contributions: ['reasoning_check'] });
  r20.unresolved.push('L1针对所选的完整选型论证。若另立仅计算录入差值的单元，该子任务可以L2；两者不是同一个冻结任务。');

  const r21 = base('R21', '部分落实测量边界', '概括 S01 的本次样本均值，并交代测量起止边界。', '附记录 S01，本次20件的平均处理时间是4分钟。');
  claim(r21, 'C-R21', '本次20件的平均处理时间是4分钟。', 'empirical', { population: '本次20件', time: '本次', metric: '平均处理时间', unit: '分钟', conditions: 'not_stated' });
  source(r21, 'S01 合成记录：本次20件。处理时间从扫描入工位开始，到工位复核结束，不含入工位前排队时间；该口径平均4分钟。');
  relate(r21, 'supports', '记录支持本次20件的均值4分钟；回复对计时起止的限定缺漏由B另记，未明说包括排队时间。');
  evaluate(r21, [1, 2, 'NA', 1], ['报告了均值和样本，但未交代明确要求的测量起止。', '所附记录可读，支持其报告的样本范围和均值字段。', '没有展示推导。', '保留本次20件，却未落实来源的计时起止；没有把排队明确计入，不能直接判已扩张B0。'], '概括本次均值并交代计时起止边界');

  const r22 = base('R22', '情绪与有效推导并存', '给定5只盒子、每盒2颗球，有人算作20颗；这个算式成立吗？', '太离谱了！5×2=10，不是20。');
  claim(r22, 'C-R22', '5×2=10，不是20。', 'reasoning', { population: '5只盒子中的球', time: 'not_applicable', metric: '球的总数', unit: '颗', conditions: '每盒2颗' });
  r22.claims[0]!.contextRefs.push(r22.snapshot.messages[0]!.id);
  evaluate(r22, [2, 'NA', 2, 2], ['直接检查所问算式并给出结果。', '仅检查给定条件内的算术，无外部事实举证任务。', '5×2=10，指出20的计算错误。', '计算限定在给定5盒、每盒2颗，未扩大为观测事实。'], '检查给定条件内5×2的计算', { contributions: ['reasoning_check'], expression: { emotion: 'present', attack: 'absent', emotionOnly: false } });

  const r23 = base('R23', '纯情绪', '这里仅记录一次令人不快的等待，没有向回帖者提出论证任务。', '烦死了！真让人心烦！');
  evaluate(r23, ['NA', 'NA', 'NA', 'NA'], ['纯情绪表达，未承担实质回应任务。', '没有经验断言或举证任务。', '没有推导。', '没有需要检查依据边界的主张。'], '识别完整回复的表达功能', { expression: { emotion: 'present', attack: 'absent', emotionOnly: true } });

  const r24 = base('R24', '攻击替代回答', '请回答这次样本包括哪些城市。', '你这蠢货，没资格讨论。');
  evaluate(r24, [0, 'NA', 'NA', 'NA'], ['以人身贬损替代所要求的城市范围回答。', '独立侮辱不强行转换成经验事实断言。', '未展示推导。', '侮辱措辞本身不形成依据范围检验。'], '回答本次样本的城市范围', { expression: { emotion: 'absent', attack: 'present', emotionOnly: false } });

  const r25 = base('R25', '系统补证不归作者', '本次合成登记有多少名报名者？这是作者的完整回复，此前没有提供资料。', '本次登记共有18名报名者。');
  claim(r25, 'C-R25', r25.snapshot.messages[1]!.text, 'empirical', { population: '本次登记的报名者', time: '本次', metric: '报名人数', unit: '名' });
  source(r25, 'S01 合成登记：本次登记共有18名报名者。此记录由系统事后补入，作者没有引用。', { introducedBy: 'system' });
  relate(r25, 'supports', '系统补入的记录支持事实内容，但不构成作者的原始举证。');
  evaluate(r25, [2, 0, 'NA', 'U'], ['回答了所问报名人数。', '完整回复未提供或援用资料；系统找到记录不把E升级。', '仅报告人数，没有推导。', '作者未说明所据材料，无法检查其依据到结论的范围迁移；系统不补写作者的依据链。'], '报告本次登记人数并区分作者举证与系统补查', { sourceIds: [] });

  const r26 = base('R26', '前文资料的正确复用', '我已首先提供 S01：本次登记有18名报名者。请据该记录确认人数。', '按你上文提供的 S01，本次登记共有18名报名者。');
  claim(r26, 'C-R26', '本次登记共有18名报名者。', 'empirical', { population: '本次登记的报名者', time: '本次', metric: '报名人数', unit: '名' });
  source(r26, 'S01 合成登记：本次登记共有18名报名者。', { introducedBy: 'topic' }); relate(r26, 'supports', '正确援用原帖作者已经提供的同口径记录。');
  evaluate(r26, [2, 2, 'NA', 2], ['按请求确认人数。', '正确援用前文可读且可定位的记录。', '直接援用人数，不自动形成推导。', '保留本次登记对象及人数口径。'], '确认前文记录的人数，保留最初资料提供者', { contributions: ['reuse'] });

  const r27 = base('R27', '作者首次引入资料', '本次合成登记有多少名报名者？请给出记录，此前尚无人提供。', '我附上原始记录 S01：本次登记共有18名报名者。');
  claim(r27, 'C-R27', '本次登记共有18名报名者。', 'empirical', { population: '本次登记的报名者', time: '本次', metric: '报名人数', unit: '名' });
  source(r27, 'S01 合成登记：本次登记共有18名报名者。'); relate(r27, 'supports', '作者在已知完整历史中首次引入同口径的可读记录。');
  evaluate(r27, [2, 2, 'NA', 2], ['回答人数并提供记录。', '作者提供可定位且同口径的记录。', '直接报告人数，没有推导。', '保留本次登记范围。'], '报告本次人数并提供记录');

  const r28 = base('R28', '无法确定是否承担回应任务', '讨论顺序及所指观点未保存，无法确定下句是在确认某个判断还是例行应答。', '是的。', true);
  r28.snapshot.gaps = ['所指观点和交谈顺序缺失；回复没有可识别的楼层或对象。'];
  claim(r28, 'C-R28', '是的。', 'uncertain', { population: 'ambiguous', metric: 'ambiguous', conditions: 'ambiguous' }, 'uncertain');
  evaluate(r28, ['P', 'P', 'NA', 'P'], ['无法确定是承担实质答题任务，还是例行社交应答；不同于已知正在回答某条缺失原文的R-U。', '没有可恢复的被采纳命题，不能判断是否承担事实举证任务。', '完整可见回复没有展示前提到结论或推导检验，不能仅因语境不足就制造L任务。', '未确定作者所采纳的主张，依据范围检验是否适用待定。'], '判断该短回复是否承担实质回应任务，不补造所指观点');
  r28.evaluations[0]!.localEvidenceRefs = [];
  r28.evaluations[0]!.issues = ['冻结任务把可见背景消息作为判读语境；该消息只记录缺口，不是已找回的回应目标。无法识别回应对象，也无法确定是否承担实质回应任务。'];

  const extraction: CalibrationCase[] = [x1, x2, x3].map(reference => ({ id: reference.id, track: 'extraction', stratum: '主张归属与范围', reference: cover(reference) }));
  const rating: [AnalysisPackage, string][] = [
    [r1, '推导与范围错误'], [r2, '完整任务与有效计算'], [r3, '数字误引'], [r4, '任务已知材料缺失'], [r5, '有限偏好'], [r16, '归属待定'],
    [r17, '回应部分覆盖'], [r18, '证据部分支持'], [r19, '来源不可读'], [r20, '论证桥梁未完成'], [r21, '依据限定部分落实'],
    [r22, '情绪与推理并存'], [r23, '纯情绪'], [r24, '攻击替代回答'], [r25, '系统补证'], [r26, '前文复用'], [r27, '首次引入'], [r28, '回应任务适用性待定'],
  ];
  return extraction.concat(rating.map(([reference, stratum]) => ({ id: reference.id, track: 'rating', stratum, reference })));
}
export async function buildTrialSuite(): Promise<FrozenCalibrationSuite> {
  const suite=await freezeCalibrationSuite({id:'gzk-candidate-rules-20260915-v2',methodVersion:METHOD_VERSION,referenceLabel:'Codex 依据0.2.1规则裁定的新编合成候选规则试跑集；尚无独立人工专家标注；非正式留出认证，仅检验冻结任务的字段执行与差异',developmentInputHashes:[...new Set(developmentMaterials.entries.map(entry=>entry.materialHash))],thresholds:{...DEFAULT_CALIBRATION_THRESHOLDS},cases:trialCases()});
  // Use the source artifact's actual seal event, not a new timestamp whenever the UI opens it.
  const {hash:_discard,...payload}=suite;payload.frozenAt=FROZEN_AT;return {...payload,hash:await hashValue(payload)};
}
