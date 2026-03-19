export type AgentRole =
  | "planner"
  | "ideator"
  | "validator"
  | "experimenter"
  | "reporter";

export type SpecialistRole = Exclude<AgentRole, "planner">;

export type RunStatus = "queued" | "running" | "completed" | "failed";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type MemoryType = "fact" | "decision" | "risk";

export type ArtifactKind =
  | "plan"
  | "ideas"
  | "validation"
  | "experiments"
  | "report";

export type EvidenceStatus = "fetched" | "failed";

export type ValidationVerdict =
  | "strong-bet"
  | "promising"
  | "watchlist"
  | "reject";

export type EvidenceStrength = "weak" | "medium" | "strong";

export type RecommendationDecision = "pursue" | "test-first" | "hold";

export type ExperimentPriority = "high" | "medium" | "low";

export interface IdeaBrief {
  title: string;
  problem: string;
  targetUser: string;
  marketContext: string;
  strengths: string;
  assets: string;
  constraints: string;
  businessGoal: string;
  validationGoal: string;
  notes: string;
  sourceUrls: string[];
}

export interface SourceEvidence {
  id: string;
  url: string;
  title: string;
  summary: string;
  excerpt: string;
  status: EvidenceStatus;
  fetchedAt: string;
  error?: string;
}

export interface RubricCriterion {
  name: string;
  description: string;
  weight: number;
}

export interface EvaluationRubric {
  criteria: RubricCriterion[];
}

export interface IdeaCandidate {
  id: string;
  name: string;
  oneLiner: string;
  targetUser: string;
  pain: string;
  solution: string;
  whyNow: string;
  whyYou: string;
  monetization: string;
  acquisition: string;
  buildScope: string;
  strengths: string[];
  risks: string[];
}

export interface IdeaScoreBreakdown {
  criterion: string;
  weight: number;
  score: number;
  rationale: string;
}

export interface ValidatedIdea {
  ideaId: string;
  ideaName: string;
  totalScore: number;
  verdict: ValidationVerdict;
  confidence: number;
  evidenceStrength: EvidenceStrength;
  summary: string;
  breakdown: IdeaScoreBreakdown[];
  keyRisks: string[];
  validationQuestions: string[];
}

export interface ValidationExperiment {
  ideaId: string;
  ideaName: string;
  experiment: string;
  hypothesis: string;
  action: string;
  successSignal: string;
  killSignal: string;
  cost: string;
  time: string;
  priority: ExperimentPriority;
}

export interface FinalRecommendation {
  recommendedIdeaId?: string;
  recommendedIdeaName?: string;
  decision: RecommendationDecision;
  rationale: string;
  whatToDoNow: string[];
  killSignals: string[];
}

export interface ArtifactData {
  rubric?: EvaluationRubric;
  ideas?: IdeaCandidate[];
  validations?: ValidatedIdea[];
  experiments?: ValidationExperiment[];
  recommendation?: FinalRecommendation;
}

export interface LabAgent {
  role: AgentRole;
  name: string;
  specialty: string;
  responsibilities: string[];
}

export interface LabTask {
  id: string;
  name: string;
  role: SpecialistRole;
  instructions: string;
  acceptanceCriteria: string[];
  dependencies: string[];
  status: TaskStatus;
  startedAt?: string;
  completedAt?: string;
  artifactId?: string;
  error?: string;
}

export interface LabArtifact {
  id: string;
  role: SpecialistRole;
  title: string;
  kind: ArtifactKind;
  content: string;
  summary: string;
  createdAt: string;
  data?: ArtifactData;
}

export interface TimelineEvent {
  id: string;
  type:
    | "run.created"
    | "run.started"
    | "run.completed"
    | "run.failed"
    | "task.started"
    | "task.completed"
    | "task.failed"
    | "artifact.created"
    | "memory.saved"
    | "evidence.fetched"
    | "evidence.failed";
  message: string;
  timestamp: string;
  metadata?: Record<string, string>;
}

export interface MemoryNote {
  id: string;
  scope: "global" | "run";
  runId?: string;
  type: MemoryType;
  title: string;
  content: string;
  tags: string[];
  sourceArtifactId?: string;
  createdAt: string;
}

export interface LabRun {
  id: string;
  objective: string;
  context: string;
  brief: IdeaBrief;
  evidence: SourceEvidence[];
  providerMode: "mock" | "openai";
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  northStar?: string;
  successCriteria: string[];
  rubric?: EvaluationRubric;
  finalRecommendation?: FinalRecommendation;
  reportArtifactId?: string;
  tasks: LabTask[];
  artifacts: LabArtifact[];
  timeline: TimelineEvent[];
  error?: string;
}

export interface PlannerOutput {
  northStar: string;
  successCriteria: string[];
  rubric: EvaluationRubric;
}

export interface AgentExecutionInput {
  run: LabRun;
  task: LabTask;
  relatedArtifacts: LabArtifact[];
  memory: MemoryNote[];
}

export interface AgentExecutionOutput {
  title: string;
  kind: ArtifactKind;
  content: string;
  summary: string;
  data?: ArtifactData;
}
