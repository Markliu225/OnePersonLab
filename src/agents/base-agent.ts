import type {
  AgentExecutionInput,
  AgentExecutionOutput,
  EvaluationRubric,
  IdeaCandidate,
  LabArtifact,
  ValidatedIdea,
  ValidationExperiment
} from "../domain/types.js";
import { summarizeMarkdown } from "../lib/text.js";
import type { LlmProvider } from "../llm/types.js";

export abstract class BaseAgent {
  constructor(protected readonly provider: LlmProvider) {}

  protected requireRubric(input: AgentExecutionInput): EvaluationRubric {
    if (!input.run.rubric) {
      throw new Error("Run rubric is not available.");
    }

    return input.run.rubric;
  }

  protected getIdeasFromRun(input: AgentExecutionInput): IdeaCandidate[] {
    return this.getArtifactsByKind(input.run.artifacts, "ideas")
      .flatMap((artifact) => artifact.data?.ideas ?? []);
  }

  protected getValidationsFromRun(input: AgentExecutionInput): ValidatedIdea[] {
    return this.getArtifactsByKind(input.run.artifacts, "validation")
      .flatMap((artifact) => artifact.data?.validations ?? []);
  }

  protected getExperimentsFromRun(input: AgentExecutionInput): ValidationExperiment[] {
    return this.getArtifactsByKind(input.run.artifacts, "experiments")
      .flatMap((artifact) => artifact.data?.experiments ?? []);
  }

  protected getArtifactsByKind(
    artifacts: LabArtifact[],
    kind: LabArtifact["kind"]
  ): LabArtifact[] {
    return artifacts.filter((artifact) => artifact.kind === kind);
  }

  protected buildOutput(input: {
    title: string;
    kind: LabArtifact["kind"];
    content: string;
    data?: AgentExecutionOutput["data"];
  }): AgentExecutionOutput {
    return {
      title: input.title,
      kind: input.kind,
      content: input.content,
      summary: summarizeMarkdown(input.content),
      data: input.data
    };
  }
}
