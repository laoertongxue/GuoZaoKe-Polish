import type { AnalysisPackage, Dimension } from '../../../src/analysis/types';

/** Model planning output deliberately excludes application-owned executable policy. */
export const questionDrafts = () => examplePackage().questions.map(({plan:_plan,...question})=>question);

export function examplePackage(): AnalysisPackage {
  const na: Dimension = { applicability: 'no', grade: null, reason: '没有展示推导。', ruleIds: ['L-NA'], refs: [] };
  return {
    formatVersion: 1, methodVersion: '0.2.1', id: 'run-1', createdAt: '2026-09-15T06:00:00Z',
    snapshot: {
      id: 'snap-1', topicId: '121894', url: 'https://www.guozaoke.com/t/121894', title: '测试讨论', capturedAt: '2026-09-15T06:00:00Z',
      messages: [
        { id: 'topic-121894', authorId: 'P01', kind: 'topic', floor: null, text: '平均费用是多少？', publishedAt: null, displayedTime: '昨天', links: [], imageCount: 0, stableId: true },
        { id: 'reply-123', authorId: 'P02', kind: 'reply', floor: 1, text: '😃平均每单是10元。', publishedAt: null, displayedTime: '1 分钟前', links: [], imageCount: 0, stableId: true },
      ],
      pages: [{ url: 'https://www.guozaoke.com/t/121894', status: 'read', messageIds: ['topic-121894', 'reply-123'], error: null }],
      expectedReplies: 1, completeness: 'complete', gaps: [],
    },
    claims: [{ id: 'C01', authorId: 'P02', messageId: 'reply-123', text: '平均每单是10元。', kind: 'empirical', adoption: 'asserted', spans: [{ messageId: 'reply-123', start: 1, end: 10, quote: '平均每单是10元。' }], qualifiers: { population: 'not_stated', time: 'not_stated', metric: '每单平均费用', unit: '元', quantifier: '平均', conditions: 'not_stated' }, contextRefs: [], uncertainty: [] }],
    coverage: [],
    questions: [{ id: 'Q01', claimIds: ['C01'], question: '平均每单费用是多少？', needed: ['费用口径', '时期'], disagreement: 'insufficient_context', plan: null }],
    sources: [{ id: 'S01', url: 'https://example.org/report', title: '费用表', publisher: '示例机构', publishedAt: null, retrievedAt: '2026-09-15T06:00:00Z', status: 'read', kind: 'html', text: '样本平均每单费用为10元。', locator: '正文', rootId: 'S01', introducedBy: 'system', introducedAtMessageId: null, limitations: ['仅样本数据'], data: [{ label: '每单费用', value: 10, unit: '元', population: '样本', period: null, excerpt: '样本平均每单费用为10元。' }] }],
    relations: [{ id: 'E01', claimId: 'C01', sourceId: 'S01', status: 'partial', excerpt: '样本平均每单费用为10元。', reason: '支持样本范围，不能确认总体及时期。' }],
    evaluations: [{ id: 'V-C01', messageId: 'reply-123', claimIds: ['C01'], targetMessageIds: ['topic-121894'], task: '回答每单费用', dimensions: { R: { applicability: 'yes', grade: 2, reason: '给出了数值。', ruleIds: ['R2'], refs: [{ messageId: 'reply-123', start: 1, end: 10, quote: '平均每单是10元。' }] }, E: { applicability: 'yes', grade: 0, reason: '原回复没有给出材料。', ruleIds: ['E0'], refs: [{ messageId: 'reply-123', start: 1, end: 10, quote: '平均每单是10元。' }] }, L: na, B: { applicability: 'yes', grade: 'U', reason: '没有作者依据可比较。', ruleIds: ['B-U'], refs: [] } }, expression: { emotion: 'uncertain', attack: 'absent', emotionOnly: false, refs: [] }, contributions: [], sourceIds: [], localEvidenceRefs: [], issues: [] }],
    provenance: { mode: 'exploratory', modelConfigId: 'local', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat', providerModel: null, declaredVersion: '', parameters: { temperature: 0, maxOutputTokens: 4096 }, stageHashes: {}, qualificationId: null },
    status: 'completed', unresolved: ['来源口径需进一步确认'],
  };
}
