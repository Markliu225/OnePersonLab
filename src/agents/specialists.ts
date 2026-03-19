import { BaseAgent } from "./base-agent.js";
import type { AgentExecutionInput, SpecialistRole } from "../domain/types.js";
import type { LlmProvider } from "../llm/types.js";

class IdeatorAgent extends BaseAgent {
  readonly role = "ideator" as const;

  async execute(input: AgentExecutionInput) {
    const result = await this.provider.generateIdeas({
      brief: input.run.brief,
      evidence: input.run.evidence,
      rubric: this.requireRubric(input),
      memory: input.memory.map((note) => `${note.title}: ${note.content}`)
    });

    return this.buildOutput({
      title: "Idea Candidates",
      kind: "ideas",
      content: result.markdown,
      data: { ideas: result.ideas }
    });
  }
}

class ValidatorAgent extends BaseAgent {
  readonly role = "validator" as const;

  async execute(input: AgentExecutionInput) {
    const ideas = this.getIdeasFromRun(input);

    if (ideas.length === 0) {
      throw new Error("Validator requires idea candidates but none were found.");
    }

    const result = await this.provider.validateIdeas({
      brief: input.run.brief,
      evidence: input.run.evidence,
      rubric: this.requireRubric(input),
      ideas,
      memory: input.memory.map((note) => `${note.title}: ${note.content}`)
    });

    return this.buildOutput({
      title: "Idea Validation",
      kind: "validation",
      content: result.markdown,
      data: { validations: result.validations }
    });
  }
}

class ExperimenterAgent extends BaseAgent {
  readonly role = "experimenter" as const;

  async execute(input: AgentExecutionInput) {
    const ideas = this.getIdeasFromRun(input);
    const validations = this.getValidationsFromRun(input);

    if (ideas.length === 0 || validations.length === 0) {
      throw new Error(
        "Experimenter requires idea and validation data but the prerequisites are missing."
      );
    }

    const result = await this.provider.designExperiments({
      brief: input.run.brief,
      evidence: input.run.evidence,
      rubric: this.requireRubric(input),
      ideas,
      validations,
      memory: input.memory.map((note) => `${note.title}: ${note.content}`)
    });

    return this.buildOutput({
      title: "Validation Experiments",
      kind: "experiments",
      content: result.markdown,
      data: { experiments: result.experiments }
    });
  }
}

class ReporterAgent extends BaseAgent {
  readonly role = "reporter" as const;

  async execute(input: AgentExecutionInput) {
    const ideas = this.getIdeasFromRun(input);
    const validations = this.getValidationsFromRun(input);
    const experiments = this.getExperimentsFromRun(input);

    if (ideas.length === 0 || validations.length === 0) {
      throw new Error(
        "Reporter requires idea and validation artifacts before writing the report."
      );
    }

    const result = await this.provider.writeReport({
      brief: input.run.brief,
      evidence: input.run.evidence,
      rubric: this.requireRubric(input),
      ideas,
      validations,
      experiments,
      memory: input.memory.map((note) => `${note.title}: ${note.content}`)
    });

    return this.buildOutput({
      title: "Decision Report",
      kind: "report",
      content: result.report,
      data: { recommendation: result.recommendation }
    });
  }
}

export function createSpecialistAgents(provider: LlmProvider) {
  return {
    ideator: new IdeatorAgent(provider),
    validator: new ValidatorAgent(provider),
    experimenter: new ExperimenterAgent(provider),
    reporter: new ReporterAgent(provider)
  };
}

export type SpecialistAgents = ReturnType<typeof createSpecialistAgents>;

export type SpecialistAgent = SpecialistAgents[SpecialistRole];
