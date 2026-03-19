import type {
  EvaluationRubric,
  FinalRecommendation,
  IdeaBrief,
  IdeaCandidate,
  SourceEvidence,
  ValidatedIdea,
  ValidationExperiment
} from "../domain/types.js";

function maybe(value: string): string {
  return value.trim() || "Not specified.";
}

export function renderIdeasMarkdown(input: {
  brief: IdeaBrief;
  ideas: IdeaCandidate[];
}): string {
  const sections = input.ideas.map(
    (idea, index) => `## ${index + 1}. ${idea.name}

**One-liner**: ${idea.oneLiner}

**Target user**: ${idea.targetUser}

**Pain**: ${idea.pain}

**Solution**: ${idea.solution}

**Why now**: ${idea.whyNow}

**Why you**: ${idea.whyYou}

**Monetization**: ${idea.monetization}

**Acquisition**: ${idea.acquisition}

**Build scope**: ${idea.buildScope}

**Strengths**
${idea.strengths.map((item) => `- ${item}`).join("\n")}

**Risks**
${idea.risks.map((item) => `- ${item}`).join("\n")}`
  );

  return `# Idea Candidates

## Brief Snapshot
- Problem: ${maybe(input.brief.problem)}
- Target user: ${maybe(input.brief.targetUser)}
- Business goal: ${maybe(input.brief.businessGoal)}
- Founder strengths: ${maybe(input.brief.strengths)}

${sections.join("\n\n")}`;
}

export function renderValidationMarkdown(input: {
  rubric: EvaluationRubric;
  evidence: SourceEvidence[];
  validations: ValidatedIdea[];
}): string {
  const rubric = input.rubric.criteria
    .map(
      (criterion) =>
        `- ${criterion.name} (${criterion.weight}%): ${criterion.description}`
    )
    .join("\n");

  const evidenceSummary = input.evidence.length
    ? input.evidence
        .map(
          (item) =>
            `- ${item.title || item.url}: ${item.status === "fetched" ? item.summary : `Fetch failed (${item.error ?? "Unknown error"})`}`
        )
        .join("\n")
    : "- No external evidence URLs were provided.";

  const blocks = input.validations.map(
    (item, index) => `## ${index + 1}. ${item.ideaName}

**Total score**: ${item.totalScore}/100

**Verdict**: ${item.verdict}

**Confidence**: ${item.confidence}/100

**Evidence strength**: ${item.evidenceStrength}

**Summary**: ${item.summary}

**Score breakdown**
${item.breakdown
  .map(
    (score) =>
      `- ${score.criterion}: ${score.score}/10 at ${score.weight}% weight. ${score.rationale}`
  )
  .join("\n")}

**Key risks**
${item.keyRisks.map((risk) => `- ${risk}`).join("\n")}

**Validation questions**
${item.validationQuestions.map((question) => `- ${question}`).join("\n")}`
  );

  return `# Validation Review

## Evaluation Rubric
${rubric}

## Evidence Used
${evidenceSummary}

${blocks.join("\n\n")}`;
}

export function renderExperimentsMarkdown(input: {
  experiments: ValidationExperiment[];
}): string {
  const grouped = input.experiments.map(
    (experiment, index) => `## ${index + 1}. ${experiment.ideaName}: ${experiment.experiment}

**Priority**: ${experiment.priority}

**Hypothesis**: ${experiment.hypothesis}

**Action**: ${experiment.action}

**Success signal**: ${experiment.successSignal}

**Kill signal**: ${experiment.killSignal}

**Cost**: ${experiment.cost}

**Time**: ${experiment.time}`
  );

  return `# Validation Experiments

${grouped.join("\n\n")}`;
}

export function renderReportMarkdown(input: {
  brief: IdeaBrief;
  ideas: IdeaCandidate[];
  validations: ValidatedIdea[];
  experiments: ValidationExperiment[];
  recommendation: FinalRecommendation;
  evidence: SourceEvidence[];
}): string {
  const topIdeas = [...input.validations]
    .sort((left, right) => right.totalScore - left.totalScore)
    .slice(0, 3)
    .map(
      (item) =>
        `- ${item.ideaName}: ${item.totalScore}/100, ${item.verdict}, confidence ${item.confidence}/100`
    )
    .join("\n");

  const chosenIdea = input.ideas.find(
    (idea) => idea.id === input.recommendation.recommendedIdeaId
  );

  const experimentList = input.experiments
    .filter((experiment) =>
      input.recommendation.recommendedIdeaId
        ? experiment.ideaId === input.recommendation.recommendedIdeaId
        : true
    )
    .slice(0, 3)
    .map((experiment) => `- ${experiment.experiment}: ${experiment.action}`)
    .join("\n");

  const evidenceList = input.evidence.length
    ? input.evidence
        .map((item) => `- ${item.title || item.url}: ${item.summary}`)
        .join("\n")
    : "- The report relied on the founder brief and internal scoring only.";

  return `# Idea Validation Report

## Executive Summary
- Decision: ${input.recommendation.decision}
- Recommended idea: ${input.recommendation.recommendedIdeaName || "None selected"}
- Business goal: ${maybe(input.brief.businessGoal)}
- Validation goal: ${maybe(input.brief.validationGoal)}

## Recommendation
${input.recommendation.rationale}

## Why This Idea
${chosenIdea ? chosenIdea.oneLiner : "No idea was selected as the lead recommendation."}

## Ranked Ideas
${topIdeas || "- No validated ideas yet."}

## Evidence Highlights
${evidenceList}

## Next Moves
${input.recommendation.whatToDoNow.map((item) => `- ${item}`).join("\n")}

## Fast Experiments
${experimentList || "- No experiments proposed."}

## Kill Signals
${input.recommendation.killSignals.map((item) => `- ${item}`).join("\n")}`;
}
