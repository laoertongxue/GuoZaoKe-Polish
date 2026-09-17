/** Portable, credential-free analysis contracts. Character offsets count Unicode code points. */
export const METHOD_VERSION = '0.2.1';
export interface TextSpan { messageId: string; start: number; end: number; quote: string }
export interface ThreadMessage {
  id: string; authorId: string; kind: 'topic' | 'reply'; floor: number | null;
  text: string; publishedAt: string | null; displayedTime: string;
  links: { url: string; label: string }[]; imageCount: number; stableId: boolean;
}
export interface Snapshot {
  id: string; topicId: string; url: string; title: string; capturedAt: string;
  messages: ThreadMessage[];
  pages: { url: string; status: 'read' | 'failed' | 'skipped'; messageIds: string[]; error: string | null }[];
  expectedReplies: number | null; completeness: 'complete' | 'partial' | 'unknown'; gaps: string[];
}
export interface Claim {
  id: string; authorId: string; messageId: string; text: string;
  kind: 'empirical' | 'experience' | 'value' | 'hypothesis' | 'reasoning' | 'question' | 'quotation' | 'uncertain';
  adoption: 'asserted' | 'quoted' | 'questioned' | 'uncertain'; spans: TextSpan[];
  qualifiers: { population: string; time: string; metric: string; unit: string; quantifier: string; conditions: string };
  contextRefs: string[]; uncertainty: string[];
}
export interface AnalysisQuestion {
  id: string; claimIds: string[]; question: string; needed: string[];
  disagreement: 'none_observed' | 'fact' | 'scope' | 'value' | 'mixed' | 'insufficient_context';
  /** null explicitly identifies a reference-only question with no executable search plan. */
  plan: QuestionSearchPlan | null;
}
export type SearchDirection = 'support' | 'counter';
export interface QuestionSearchPlan {
  policyVersion: 'question-search-v1'; frozenAt: string; deadlineAt: string;
  targets: { claimId: string; qualifiers: Claim['qualifiers'] }[];
  evidenceTypes: EvidenceSource['kind'][];
  searches: { direction: SearchDirection; query: string }[];
  maxSearches: number;
  stopConditions: ('directions_completed' | 'deadline_reached' | 'question_budget_exhausted' | 'run_budget_exhausted' | 'source_limit_reached' | 'cancelled')[];
}
export interface QuestionSearchAttempt {
  questionId: string; direction: SearchDirection; requestId: string; startedAt: string;
  status: 'started' | 'completed' | 'failed';
}
export interface SourceDatum {
  label: string; value: number | null; unit: string; population: string; period: string | null; excerpt: string;
}
export interface EvidenceSource {
  id: string; url: string | null; title: string; publisher: string; publishedAt: string | null; retrievedAt: string;
  status: 'read' | 'lead' | 'unreadable'; kind: 'html' | 'pdf' | 'text'; text: string; locator: string;
  rootId: string; introducedBy: 'system' | string; introducedAtMessageId: string | null;
  limitations: string[]; data: SourceDatum[];
}
export interface EvidenceRelation {
  id: string; claimId: string; sourceId: string;
  status: 'supports' | 'partial' | 'contradicts' | 'incomparable' | 'unresolved'; excerpt: string; reason: string;
}
export interface Dimension {
  applicability: 'yes' | 'no' | 'uncertain'; grade: 0 | 1 | 2 | 'U' | null;
  reason: string; ruleIds: string[]; refs: TextSpan[];
}
export type Contribution = 'evidence' | 'reuse' | 'source_lead' | 'clarification' | 'question' | 'reasoning_check' | 'correction' | 'social';
export interface ReplyEvaluation {
  id: string; messageId: string; claimIds: string[]; targetMessageIds: string[]; task: string;
  dimensions: Record<'R' | 'E' | 'L' | 'B', Dimension>;
  expression: { emotion: 'present' | 'absent' | 'uncertain'; attack: 'present' | 'absent' | 'uncertain'; emotionOnly: boolean | null; refs: TextSpan[] };
  contributions: Contribution[]; sourceIds: string[]; localEvidenceRefs: string[]; issues: string[];
}
export interface AnalysisPackage {
  formatVersion: 1; methodVersion: string; id: string; createdAt: string;
  snapshot: Snapshot; claims: Claim[]; questions: AnalysisQuestion[]; sources: EvidenceSource[];
  coverage: { span: TextSpan; claimIds: string[]; disposition: 'claim' | 'non_assertive' | 'uncertain'; reason: string }[];
  relations: EvidenceRelation[]; evaluations: ReplyEvaluation[];
  provenance: {
    mode: 'exploratory' | 'standard'; modelConfigId: string; endpoint: string; model: string; providerModel: string | null; declaredVersion: string;
    parameters: { temperature: number; maxOutputTokens: number };
    stageHashes: Record<string, string>; qualificationId: string | null;
  };
  status: 'partial' | 'completed'; unresolved: string[];
}
export type Stage = 'claims' | 'plan' | 'evidence' | 'relations' | 'replies' | 'report';
export interface AnalysisBudget { maxCalls: number; maxInputCharacters: number; maxSources: number; maxOutputTokens: number; maxSourceBytes?: number }
export interface RunCheckpoint {
  id: string; package: AnalysisPackage; stage: Stage;
  state: 'ready' | 'running' | 'paused' | 'partial' | 'completed' | 'failed' | 'cancelled';
  budget: AnalysisBudget; callsUsed: number; inputCharactersUsed: number;
  inputTokens: number | null; outputTokens: number | null;
  completedStages: Stage[]; errors: { stage: Stage; code: string }[];
  requests: { id: string; stage: Stage; inputHash: string; outputHash: string; providerModel: string | null; sourceIds: string[] }[];
  searchAttempts: QuestionSearchAttempt[];
  updatedAt: string;
}
export interface ValidationIssue { code: string; path: string; message: string }

/** Display-only status resolved against the local background ledger; never imported in a package. */
export interface ReportQualification {
  state: 'qualified_trial' | 'exploratory' | 'unverified' | 'expired';
  qualificationId: string | null; assessedAt: string | null; referenceLabel: string | null; providerModel: string | null;
}
