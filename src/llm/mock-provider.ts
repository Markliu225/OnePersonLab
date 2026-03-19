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

function clampScore(score: number): number {
  return Math.max(1, Math.min(10, Math.round(score)));
}

function briefOrFallback(value: string, fallback: string): string {
  return value.trim() || fallback;
}

function createDefaultRubric(brief: IdeaBrief): EvaluationRubric {
  return {
    criteria: [
      {
        name: "Founder fit",
        description: `How well the idea matches the founder's strengths: ${briefOrFallback(brief.strengths, "not specified")}.`,
        weight: 25
      },
      {
        name: "Pain intensity",
        description: `How acute the target user's pain is around ${briefOrFallback(brief.problem, "the stated problem")}.`,
        weight: 20
      },
      {
        name: "Speed to validation",
        description: `How quickly the idea can be tested given the current constraints: ${briefOrFallback(brief.constraints, "not specified")}.`,
        weight: 20
      },
      {
        name: "Monetization clarity",
        description: "How directly the product can turn into paid revenue.",
        weight: 15
      },
      {
        name: "Distribution reach",
        description: "How plausible it is to reach early users with the founder's current assets.",
        weight: 10
      },
      {
        name: "Evidence strength",
        description: "How much direct support exists from the brief and optional source evidence.",
        weight: 10
      }
    ]
  };
}

function generateMockIdeas(brief: IdeaBrief): IdeaCandidate[] {
  const targetUser = briefOrFallback(brief.targetUser, "operators in a niche market");
  const problem = briefOrFallback(brief.problem, "a messy, expensive workflow");
  const strengths = briefOrFallback(brief.strengths, "general product and execution ability");

  return [
    {
      id: createId("idea"),
      name: `${targetUser} Concierge Copilot`,
      oneLiner: `A high-touch AI-assisted service for ${targetUser} that solves ${problem} before it becomes software.`,
      targetUser,
      pain: problem,
      solution:
        "Offer a done-for-you or done-with-you workflow where the founder uses AI internally to deliver a premium result fast.",
      whyNow:
        "Teams want outcomes immediately and are increasingly comfortable with AI-augmented services as long as the ROI is obvious.",
      whyYou: `This idea leans on the founder's current strengths: ${strengths}.`,
      monetization: "Monthly retainer plus setup fee.",
      acquisition:
        "Founder-led outbound, warm intros, niche communities, and problem-specific content.",
      buildScope:
        "Landing page, intake flow, manual service playbook, and internal AI prompts.",
      strengths: [
        "Fast path to first revenue",
        "High learning density from direct customer contact",
        "Can validate pain before building product"
      ],
      risks: [
        "Operationally heavy if positioning is too broad",
        "May cap out without a productization path"
      ]
    },
    {
      id: createId("idea"),
      name: `${targetUser} Workflow OS`,
      oneLiner: `A vertical workflow product that helps ${targetUser} handle ${problem} with repeatable automation and shared visibility.`,
      targetUser,
      pain: problem,
      solution:
        "Package the highest-value workflow into software with templates, automation, and analytics.",
      whyNow:
        "Niche operators are willing to buy focused tools that eliminate admin overhead without enterprise complexity.",
      whyYou: `Your strengths in ${strengths} can shape a narrow, opinionated product instead of a generic platform.`,
      monetization: "Subscription with team tier upgrades.",
      acquisition:
        "Niche partner channels, founder audience, and workflow-specific case studies.",
      buildScope:
        "Single-player MVP, one killer workflow, light collaboration, and reporting.",
      strengths: [
        "Better long-term leverage than pure service",
        "Easier to scale once the wedge is proven",
        "Can compound with data and templates"
      ],
      risks: [
        "Longer path to a convincing MVP",
        "Needs careful scoping to avoid building too much too early"
      ]
    },
    {
      id: createId("idea"),
      name: `${targetUser} Insight Engine`,
      oneLiner: `A recurring insight product that monitors ${problem} for ${targetUser} and converts noise into decisions.`,
      targetUser,
      pain: problem,
      solution:
        "Blend monitoring, summaries, and recommended actions into a subscription report or dashboard.",
      whyNow:
        "Information overload keeps rising, and buyers increasingly value distilled decisions more than raw data access.",
      whyYou: `This format works especially well if the founder already has strengths in ${strengths}.`,
      monetization: "Subscription, premium advisory add-on, and paid research packs.",
      acquisition:
        "LinkedIn or X content, newsletter distribution, community sponsorships, and referrals.",
      buildScope:
        "Content pipeline, curated data sources, simple client portal, and reporting templates.",
      strengths: [
        "Low engineering burden",
        "Useful bridge between content and product",
        "Can validate appetite quickly with a waitlist or pilot"
      ],
      risks: [
        "Value may feel soft if decisions are not concrete",
        "Harder to defend if source material is easy to copy"
      ]
    },
    {
      id: createId("idea"),
      name: `${targetUser} Playbook Studio`,
      oneLiner: `A toolkit plus guided program that helps ${targetUser} install a repeatable playbook for dealing with ${problem}.`,
      targetUser,
      pain: problem,
      solution:
        "Combine templates, AI workflows, checklists, and a light coaching layer into a productized system.",
      whyNow:
        "Buyers often want a faster, cheaper alternative to full-service consulting but still need implementation support.",
      whyYou: `This idea lets the founder package their strengths in ${strengths} into a productized offer.`,
      monetization: "One-time program fee with optional ongoing support.",
      acquisition:
        "Workshops, webinars, partner communities, and direct outreach to warm operators.",
      buildScope:
        "Template bundle, onboarding guide, AI prompt library, and optional office hours.",
      strengths: [
        "Balanced speed and leverage",
        "Easy to launch with existing assets",
        "Naturally leads to testimonials and case studies"
      ],
      risks: [
        "May be perceived as less urgent than a painkiller product",
        "Needs a concrete transformation promise"
      ]
    }
  ];
}

function scoreIdea(
  idea: IdeaCandidate,
  ideaIndex: number,
  rubric: EvaluationRubric,
  evidenceCount: number,
  brief: IdeaBrief
): ValidatedIdea {
  const baseProfiles = [
    [9, 8, 9, 9, 7, 5],
    [8, 8, 6, 8, 7, 6],
    [7, 7, 8, 6, 8, 5],
    [8, 7, 7, 7, 8, 5]
  ];
  const base = baseProfiles[ideaIndex] ?? baseProfiles[baseProfiles.length - 1];
  const constraints = brief.constraints.toLowerCase();
  const assets = `${brief.assets} ${brief.strengths}`.toLowerCase();
  const evidenceBonus = evidenceCount >= 3 ? 2 : evidenceCount >= 1 ? 1 : 0;

  const breakdown = rubric.criteria.map((criterion, index) => {
    let score = base[index] ?? 6;

    if (criterion.name.toLowerCase().includes("speed")) {
      if (constraints.includes("part-time") || constraints.includes("small budget")) {
        score += ideaIndex === 0 ? 1 : ideaIndex === 1 ? -1 : 0;
      }
    }

    if (criterion.name.toLowerCase().includes("distribution")) {
      if (
        assets.includes("audience") ||
        assets.includes("community") ||
        assets.includes("network")
      ) {
        score += 1;
      }
    }

    if (criterion.name.toLowerCase().includes("evidence")) {
      score += evidenceBonus;
    }

    const safeScore = clampScore(score);
    return {
      criterion: criterion.name,
      weight: criterion.weight,
      score: safeScore,
      rationale: `${idea.name} scores ${safeScore}/10 on ${criterion.name.toLowerCase()} based on the founder brief, its business model, and available evidence.`
    };
  });

  const weighted = breakdown.reduce(
    (total, item) => total + item.score * item.weight,
    0
  );
  const totalScore = Math.round(weighted / 10);
  const confidence = Math.min(95, 50 + evidenceBonus * 12 + brief.problem.length / 20);
  const evidenceStrength =
    evidenceCount >= 3 ? "strong" : evidenceCount >= 1 ? "medium" : "weak";
  const verdict =
    totalScore >= 80
      ? "strong-bet"
      : totalScore >= 70
        ? "promising"
        : totalScore >= 60
          ? "watchlist"
          : "reject";

  return {
    ideaId: idea.id,
    ideaName: idea.name,
    totalScore,
    verdict,
    confidence: Math.round(confidence),
    evidenceStrength,
    summary: `${idea.name} looks ${verdict} because it balances founder fit, speed, and monetization with acceptable risk.`,
    breakdown,
    keyRisks: idea.risks,
    validationQuestions: [
      `Will ${idea.targetUser} pay quickly enough for the promise in ${idea.oneLiner}?`,
      `Is the acquisition channel "${idea.acquisition}" repeatable within the founder's constraints?`,
      `Can the first version stay within this build scope: ${idea.buildScope}?`
    ]
  };
}

function buildExperiments(validations: ValidatedIdea[]): ValidationExperiment[] {
  const topIdeas = [...validations]
    .sort((left, right) => right.totalScore - left.totalScore)
    .slice(0, 2);

  return topIdeas.flatMap((idea, index) => [
    {
      ideaId: idea.ideaId,
      ideaName: idea.ideaName,
      experiment: "Customer discovery sprint",
      hypothesis: `${idea.ideaName} solves a painful, frequent problem for its target users.`,
      action:
        "Run 8 to 10 founder-led interviews with a tight script and a concrete problem narrative.",
      successSignal:
        "At least 5 interviews confirm the pain is urgent, expensive, and currently solved poorly.",
      killSignal:
        "Interviewees treat the issue as a nice-to-have or cannot describe a budget owner.",
      cost: "Low",
      time: "3 days",
      priority: "high"
    },
    {
      ideaId: idea.ideaId,
      ideaName: idea.ideaName,
      experiment: index === 0 ? "Offer test landing page" : "Manual pilot sale",
      hypothesis:
        index === 0
          ? `A focused promise for ${idea.ideaName} can convert cold or warm interest into calls or signups.`
          : `${idea.ideaName} can be delivered manually before product build and still generate willingness to pay.`,
      action:
        index === 0
          ? "Publish a one-page landing page with a clear promise, CTA, and short intake form. Drive targeted traffic from founder-led channels."
          : "Sell one manual pilot with a defined scope, then fulfill it with a lightweight internal workflow.",
      successSignal:
        index === 0
          ? "Landing page converts at or above 10% from qualified visitors into calls or waitlist signups."
          : "One pilot closes within two weeks and the delivery path uncovers repeatable patterns.",
      killSignal:
        index === 0
          ? "Traffic arrives but qualified visitors do not book or sign up."
          : "Interested users refuse to pay even for a manually delivered outcome.",
      cost: index === 0 ? "Low" : "Medium",
      time: index === 0 ? "5 days" : "7 days",
      priority: index === 0 ? "high" : "medium"
    }
  ]);
}

function buildRecommendation(
  ideas: IdeaCandidate[],
  validations: ValidatedIdea[]
): FinalRecommendation {
  const sorted = [...validations].sort((left, right) => right.totalScore - left.totalScore);
  const winner = sorted[0];
  const decision =
    !winner || winner.verdict === "reject"
      ? "hold"
      : winner.verdict === "strong-bet"
        ? "pursue"
        : "test-first";

  const idea = ideas.find((item) => item.id === winner?.ideaId);

  return {
    recommendedIdeaId: winner?.ideaId,
    recommendedIdeaName: winner?.ideaName,
    decision,
    rationale: winner
      ? `${winner.ideaName} ranks highest because it offers the best combined score on founder fit, monetization, and validation speed. ${winner.summary}`
      : "No idea is strong enough to recommend yet.",
    whatToDoNow: winner
      ? [
          `Run customer discovery focused on ${winner.ideaName}.`,
          "Launch a narrow offer test before building software.",
          `Document what users actually pay for in the first week and refine the wedge around "${idea?.pain ?? "the key pain"}".`
        ]
      : [
          "Clarify the target user and pain more narrowly.",
          "Collect more evidence before committing to a build path.",
          "Re-run ideation with tighter constraints."
        ],
    killSignals: winner
      ? [
          "Users do not describe the pain as urgent.",
          "No one is willing to pre-commit time or money.",
          "The founder cannot acquire early users through current channels."
        ]
      : [
          "The problem remains vague after additional interviews.",
          "Ideas stay low-confidence even after more evidence is gathered."
        ]
  };
}

export class MockLlmProvider implements LlmProvider {
  readonly mode = "mock" as const;

  async plan(input: {
    brief: IdeaBrief;
    evidence: SourceEvidence[];
    memory: string[];
  }): Promise<PlannerOutput> {
    return {
      northStar:
        "Recommend the best founder-fit idea, prove what should be tested first, and leave behind an operator-ready decision report.",
      successCriteria: [
        "Generate multiple strategically distinct ideas from the founder brief",
        "Score each idea against an explicit rubric instead of intuition alone",
        "Use optional source evidence when available",
        "Finish with concrete experiments and a written recommendation"
      ],
      rubric: createDefaultRubric(input.brief)
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
    const ideas = generateMockIdeas(input.brief);
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
    const validations = input.ideas.map((idea, index) =>
      scoreIdea(idea, index, input.rubric, input.evidence.length, input.brief)
    );

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
    const experiments = buildExperiments(input.validations);
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
    const recommendation = buildRecommendation(input.ideas, input.validations);
    return {
      report: renderReportMarkdown({
        brief: input.brief,
        ideas: input.ideas,
        validations: input.validations,
        experiments: input.experiments,
        recommendation,
        evidence: input.evidence
      }),
      recommendation
    };
  }
}
