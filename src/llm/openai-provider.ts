import {
  renderExperimentsMarkdown,
  renderIdeasMarkdown,
  renderReportMarkdown,
  renderValidationMarkdown
} from "../lib/idea-lab-markdown.js";
import { createId } from "../lib/id.js";
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
import type { LlmProvider } from "./types.js";

interface OpenAiProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function briefToPrompt(brief: IdeaBrief): string {
  return `Title: ${brief.title}
Problem: ${brief.problem}
Target user: ${brief.targetUser}
Market context: ${brief.marketContext || "Not provided"}
Founder strengths: ${brief.strengths || "Not provided"}
Assets: ${brief.assets || "Not provided"}
Constraints: ${brief.constraints || "Not provided"}
Business goal: ${brief.businessGoal || "Not provided"}
Validation goal: ${brief.validationGoal || "Not provided"}
Notes: ${brief.notes || "Not provided"}`;
}

function evidenceToPrompt(evidence: SourceEvidence[]): string {
  if (evidence.length === 0) {
    return "No external evidence URLs were provided.";
  }

  return evidence
    .map((item) => {
      if (item.status === "failed") {
        return `- ${item.url}: fetch failed (${item.error ?? "unknown error"})`;
      }

      return `- ${item.title}: ${item.summary}`;
    })
    .join("\n");
}

function stripJsonFences(content: string): string {
  return content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeIdea(idea: Partial<IdeaCandidate>): IdeaCandidate {
  return {
    id: idea.id || createId("idea"),
    name: idea.name?.trim() || "Untitled Idea",
    oneLiner: idea.oneLiner?.trim() || "",
    targetUser: idea.targetUser?.trim() || "",
    pain: idea.pain?.trim() || "",
    solution: idea.solution?.trim() || "",
    whyNow: idea.whyNow?.trim() || "",
    whyYou: idea.whyYou?.trim() || "",
    monetization: idea.monetization?.trim() || "",
    acquisition: idea.acquisition?.trim() || "",
    buildScope: idea.buildScope?.trim() || "",
    strengths: idea.strengths?.filter(Boolean) ?? [],
    risks: idea.risks?.filter(Boolean) ?? []
  };
}

function normalizeRubric(rubric: EvaluationRubric): EvaluationRubric {
  const fallback = [
    {
      name: "Founder fit",
      description: "How well the idea fits the founder.",
      weight: 25
    },
    {
      name: "Pain intensity",
      description: "How urgent the problem is.",
      weight: 20
    },
    {
      name: "Speed to validation",
      description: "How quickly the idea can be tested.",
      weight: 20
    },
    {
      name: "Monetization clarity",
      description: "How clearly revenue can appear.",
      weight: 15
    },
    {
      name: "Distribution reach",
      description: "How plausible first-user acquisition is.",
      weight: 10
    },
    {
      name: "Evidence strength",
      description: "How strong the supporting evidence is.",
      weight: 10
    }
  ];

  if (!rubric.criteria?.length) {
    return { criteria: fallback };
  }

  const total = rubric.criteria.reduce(
    (sum, criterion) => sum + Math.max(0, criterion.weight || 0),
    0
  );

  if (total === 100) {
    return rubric;
  }

  return {
    criteria: rubric.criteria.map((criterion) => ({
      ...criterion,
      weight: Math.max(1, Math.round((criterion.weight / total) * 100))
    }))
  };
}

export class OpenAiProvider implements LlmProvider {
  readonly mode = "openai" as const;

  constructor(private readonly options: OpenAiProviderOptions) {}

  async plan(input: {
    brief: IdeaBrief;
    evidence: SourceEvidence[];
    memory: string[];
  }): Promise<PlannerOutput> {
    const parsed = await this.completeJson<PlannerOutput>([
      {
        role: "system",
        content:
          "You are the planner in an idea lab. Return valid JSON only. Be concrete, founder-aware, and evaluation-first."
      },
      {
        role: "user",
        content: `Create a decision plan for this founder brief.

Founder brief:
${briefToPrompt(input.brief)}

Evidence:
${evidenceToPrompt(input.evidence)}

Memory:
${input.memory.join("\n") || "None"}

Return JSON with this exact shape:
{
  "northStar": "string",
  "successCriteria": ["string"],
  "rubric": {
    "criteria": [
      {
        "name": "string",
        "description": "string",
        "weight": 0
      }
    ]
  }
}

Constraints:
- Use 5 to 6 criteria.
- Weights must sum to 100.
- Optimize for founder-fit, validation speed, and revenue clarity.
- Keep successCriteria short and operator-friendly.`
      }
    ]);

    return {
      northStar: parsed.northStar,
      successCriteria: parsed.successCriteria,
      rubric: normalizeRubric(parsed.rubric)
    };
  }

  async generateIdeas(input: {
    brief: IdeaBrief;
    evidence: SourceEvidence[];
    rubric: EvaluationRubric;
    memory: string[];
  }): Promise<{
    ideas: IdeaCandidate[];
    markdown: string;
  }> {
    const parsed = await this.completeJson<{ ideas: Partial<IdeaCandidate>[] }>([
      {
        role: "system",
        content:
          "You are the ideator in an idea lab. Return valid JSON only. Generate ideas that are specific, commercially plausible, and distinct in strategy."
      },
      {
        role: "user",
        content: `Generate 4 startup or productized-service ideas from this founder brief.

Founder brief:
${briefToPrompt(input.brief)}

Evidence:
${evidenceToPrompt(input.evidence)}

Rubric:
${input.rubric.criteria
  .map((criterion) => `- ${criterion.name} (${criterion.weight}%): ${criterion.description}`)
  .join("\n")}

Memory:
${input.memory.join("\n") || "None"}

Return JSON only with this exact shape:
{
  "ideas": [
    {
      "id": "optional-string",
      "name": "string",
      "oneLiner": "string",
      "targetUser": "string",
      "pain": "string",
      "solution": "string",
      "whyNow": "string",
      "whyYou": "string",
      "monetization": "string",
      "acquisition": "string",
      "buildScope": "string",
      "strengths": ["string"],
      "risks": ["string"]
    }
  ]
}

Constraints:
- Make each idea strategically different.
- Avoid generic AI wrapper ideas.
- Tie every idea tightly to the founder brief.
- Keep buildScope narrow enough for a small first version.`
      }
    ]);

    const ideas = (parsed.ideas ?? []).map(normalizeIdea);
    return {
      ideas,
      markdown: renderIdeasMarkdown({
        brief: input.brief,
        ideas
      })
    };
  }

  async validateIdeas(input: {
    brief: IdeaBrief;
    evidence: SourceEvidence[];
    rubric: EvaluationRubric;
    ideas: IdeaCandidate[];
    memory: string[];
  }): Promise<{
    validations: ValidatedIdea[];
    markdown: string;
  }> {
    const parsed = await this.completeJson<{ validations: ValidatedIdea[] }>([
      {
        role: "system",
        content:
          "You are the validator in an idea lab. Return valid JSON only. Score rigorously, not politely."
      },
      {
        role: "user",
        content: `Validate these ideas against the rubric and evidence.

Founder brief:
${briefToPrompt(input.brief)}

Evidence:
${evidenceToPrompt(input.evidence)}

Rubric:
${input.rubric.criteria
  .map((criterion) => `- ${criterion.name} (${criterion.weight}%): ${criterion.description}`)
  .join("\n")}

Ideas:
${JSON.stringify(input.ideas, null, 2)}

Memory:
${input.memory.join("\n") || "None"}

Return JSON only with this exact shape:
{
  "validations": [
    {
      "ideaId": "string",
      "ideaName": "string",
      "totalScore": 0,
      "verdict": "strong-bet | promising | watchlist | reject",
      "confidence": 0,
      "evidenceStrength": "weak | medium | strong",
      "summary": "string",
      "breakdown": [
        {
          "criterion": "string",
          "weight": 0,
          "score": 0,
          "rationale": "string"
        }
      ],
      "keyRisks": ["string"],
      "validationQuestions": ["string"]
    }
  ]
}

Constraints:
- Use scores from 1 to 10 inside breakdown.
- totalScore must be 0 to 100.
- confidence must be 0 to 100.
- Be willing to reject weak ideas.
- Make the breakdown align with the rubric criteria.`
      }
    ]);

    const validations = parsed.validations ?? [];
    return {
      validations,
      markdown: renderValidationMarkdown({
        rubric: input.rubric,
        evidence: input.evidence,
        validations
      })
    };
  }

  async designExperiments(input: {
    brief: IdeaBrief;
    evidence: SourceEvidence[];
    rubric: EvaluationRubric;
    ideas: IdeaCandidate[];
    validations: ValidatedIdea[];
    memory: string[];
  }): Promise<{
    experiments: ValidationExperiment[];
    markdown: string;
  }> {
    const parsed = await this.completeJson<{ experiments: ValidationExperiment[] }>([
      {
        role: "system",
        content:
          "You are the experiment designer in an idea lab. Return valid JSON only. Favor low-cost, high-learning tests."
      },
      {
        role: "user",
        content: `Design validation experiments for the strongest ideas.

Founder brief:
${briefToPrompt(input.brief)}

Validated ideas:
${JSON.stringify(input.validations, null, 2)}

Ideas:
${JSON.stringify(input.ideas, null, 2)}

Evidence:
${evidenceToPrompt(input.evidence)}

Return JSON only with this exact shape:
{
  "experiments": [
    {
      "ideaId": "string",
      "ideaName": "string",
      "experiment": "string",
      "hypothesis": "string",
      "action": "string",
      "successSignal": "string",
      "killSignal": "string",
      "cost": "string",
      "time": "string",
      "priority": "high | medium | low"
    }
  ]
}

Constraints:
- Focus on the top 1 to 2 ideas.
- Prioritize tests that avoid heavy product build.
- Include clear success and kill signals.`
      }
    ]);

    const experiments = parsed.experiments ?? [];
    return {
      experiments,
      markdown: renderExperimentsMarkdown({ experiments })
    };
  }

  async writeReport(input: {
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
  }> {
    const parsed = await this.completeJson<{
      recommendation: FinalRecommendation;
    }>([
      {
        role: "system",
        content:
          "You are the report writer in an idea lab. Return valid JSON only. Make a decision and explain it clearly."
      },
      {
        role: "user",
        content: `Create the final recommendation for this idea validation run.

Founder brief:
${briefToPrompt(input.brief)}

Evidence:
${evidenceToPrompt(input.evidence)}

Ideas:
${JSON.stringify(input.ideas, null, 2)}

Validated ideas:
${JSON.stringify(input.validations, null, 2)}

Experiments:
${JSON.stringify(input.experiments, null, 2)}

Return JSON only with this exact shape:
{
  "recommendation": {
    "recommendedIdeaId": "string",
    "recommendedIdeaName": "string",
    "decision": "pursue | test-first | hold",
    "rationale": "string",
    "whatToDoNow": ["string"],
    "killSignals": ["string"]
  }
}

Constraints:
- If no idea is strong enough, use decision "hold".
- whatToDoNow should be concrete and near-term.
- killSignals should be objective and falsifiable.`
      }
    ]);

    const recommendation = parsed.recommendation;

    return {
      recommendation,
      report: renderReportMarkdown({
        brief: input.brief,
        ideas: input.ideas,
        validations: input.validations,
        experiments: input.experiments,
        recommendation,
        evidence: input.evidence
      })
    };
  }

  private async complete(messages: ChatMessage[]): Promise<string> {
    const baseUrl = this.options.baseUrl.replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify({
        model: this.options.model,
        messages,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI request failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error("OpenAI response did not include message content.");
    }

    return content;
  }

  private async completeJson<T>(messages: ChatMessage[]): Promise<T> {
    const content = await this.complete(messages);
    return JSON.parse(stripJsonFences(content)) as T;
  }
}
