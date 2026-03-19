import type {
  EvaluationRubric,
  FinalRecommendation,
  IdeaBrief,
  IdeaCandidate,
  PlannerOutput,
  SourceEvidence,
  ValidatedIdea,
  ValidationExperiment
} from "../domain/types.js";

export interface LlmProvider {
  readonly mode: "mock" | "openai";
  plan(input: {
    brief: IdeaBrief;
    evidence: SourceEvidence[];
    memory: string[];
  }): Promise<PlannerOutput>;
  generateIdeas(input: {
    brief: IdeaBrief;
    evidence: SourceEvidence[];
    rubric: EvaluationRubric;
    memory: string[];
  }): Promise<{
    ideas: IdeaCandidate[];
    markdown: string;
  }>;
  validateIdeas(input: {
    brief: IdeaBrief;
    evidence: SourceEvidence[];
    rubric: EvaluationRubric;
    ideas: IdeaCandidate[];
    memory: string[];
  }): Promise<{
    validations: ValidatedIdea[];
    markdown: string;
  }>;
  designExperiments(input: {
    brief: IdeaBrief;
    evidence: SourceEvidence[];
    rubric: EvaluationRubric;
    ideas: IdeaCandidate[];
    validations: ValidatedIdea[];
    memory: string[];
  }): Promise<{
    experiments: ValidationExperiment[];
    markdown: string;
  }>;
  writeReport(input: {
    brief: IdeaBrief;
    evidence: SourceEvidence[];
    rubric: EvaluationRubric;
    ideas: IdeaCandidate[];
    validations: ValidatedIdea[];
    experiments: ValidationExperiment[];
    memory: string[];
  }): Promise<{
    report: string;
    recommendation: FinalRecommendation;
  }>;
}
