import type { AnalysisQuestion, Claim, QuestionSearchPlan, SearchDirection } from './types';

/** These limits are application policy, never model-supplied parameters. */
export const QUESTION_SEARCH_POLICY = {
  version: 'question-search-v1' as const,
  durationMs: 10 * 60 * 1000,
  maxSearches: 2,
  evidenceTypes: ['html', 'pdf', 'text'] as const,
  stopConditions: ['directions_completed', 'deadline_reached', 'question_budget_exhausted', 'run_budget_exhausted', 'source_limit_reached', 'cancelled'] as const,
};

export function createQuestionPlan(question: Omit<AnalysisQuestion, 'plan'>, claims: Claim[], frozenAt: string): QuestionSearchPlan {
  return {
    policyVersion: QUESTION_SEARCH_POLICY.version, frozenAt,
    deadlineAt: new Date(Date.parse(frozenAt) + QUESTION_SEARCH_POLICY.durationMs).toISOString(),
    targets: question.claimIds.map(claimId => {
      const claim = claims.find(c => c.id === claimId);
      if (!claim) throw new Error('reference: 核查计划引用了不存在的主张');
      return {claimId, qualifiers: structuredClone(claim.qualifiers)};
    }),
    evidenceTypes: [...QUESTION_SEARCH_POLICY.evidenceTypes],
    searches: [{direction:'support',query:question.question}, {direction:'counter',query:`${question.question} 反例 限制 统计口径`}],
    maxSearches: QUESTION_SEARCH_POLICY.maxSearches,
    stopConditions: [...QUESTION_SEARCH_POLICY.stopConditions],
  };
}

export class QuestionSearchStop extends Error {
  constructor(readonly code: 'deadline_reached' | 'question_budget_exhausted') { super(code); }
}
export const directionLabel = (direction: SearchDirection) => direction === 'support' ? '正向' : '反向';
