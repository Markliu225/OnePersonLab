import { createSpecialistAgents } from "../agents/specialists.js";
import { DEFAULT_AGENTS } from "../domain/agents.js";
import type {
  IdeaBrief,
  LabArtifact,
  LabRun,
  LabTask,
  MemoryNote,
  PlannerOutput,
  TimelineEvent
} from "../domain/types.js";
import { createId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";
import type { LlmProvider } from "../llm/types.js";
import { fetchSourceEvidence } from "../research/source-fetcher.js";
import { FileStore } from "../storage/file-store.js";
import { createMemoryNotesFromArtifact } from "./memory.js";

function briefToObjective(brief: IdeaBrief): string {
  return brief.title.trim() || `Validate ideas for ${brief.targetUser || "a target market"}`;
}

function briefToContext(brief: IdeaBrief): string {
  return [
    `Problem: ${brief.problem || "Not specified"}`,
    `Target user: ${brief.targetUser || "Not specified"}`,
    `Business goal: ${brief.businessGoal || "Not specified"}`,
    `Validation goal: ${brief.validationGoal || "Not specified"}`
  ].join(" | ");
}

export class LabOrchestrator {
  private readonly specialists;

  constructor(
    private readonly store: FileStore,
    private readonly provider: LlmProvider
  ) {
    this.specialists = createSpecialistAgents(provider);
  }

  listAgents() {
    return DEFAULT_AGENTS;
  }

  async createRun(input: {
    brief: IdeaBrief;
    providerMode?: "mock" | "openai";
  }): Promise<LabRun> {
    const timestamp = nowIso();
    const run: LabRun = {
      id: createId("run"),
      objective: briefToObjective(input.brief),
      context: briefToContext(input.brief),
      brief: input.brief,
      evidence: [],
      providerMode: input.providerMode ?? this.provider.mode,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      successCriteria: [],
      tasks: [],
      artifacts: [],
      timeline: [
        this.createEvent(
          "run.created",
          "Idea validation mission created and queued for execution."
        )
      ]
    };

    await this.store.saveRun(run);
    return run;
  }

  async executeRun(runId: string): Promise<LabRun> {
    const run = await this.requireRun(runId);
    run.status = "running";
    run.updatedAt = nowIso();
    run.timeline.push(
      this.createEvent("run.started", "Idea validation mission started.")
    );
    await this.store.saveRun(run);

    try {
      await this.collectEvidence(run);

      const memory = await this.store.listMemory();
      const globalMemory = memory.filter((note) => note.scope === "global");
      const plan = await this.provider.plan({
        brief: run.brief,
        evidence: run.evidence,
        memory: globalMemory.map((note) => `${note.title}: ${note.content}`)
      });

      this.applyPlan(run, plan);
      await this.store.saveRun(run);

      await this.processTaskGraph(run);

      run.status = "completed";
      run.updatedAt = nowIso();
      run.timeline.push(
        this.createEvent("run.completed", "Idea validation mission completed.")
      );
      await this.store.saveRun(run);
      return run;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown execution failure.";
      run.status = "failed";
      run.error = message;
      run.updatedAt = nowIso();
      run.timeline.push(this.createEvent("run.failed", message));
      await this.store.saveRun(run);
      return run;
    }
  }

  async getRun(runId: string): Promise<LabRun | null> {
    return this.store.getRun(runId);
  }

  async listRuns(): Promise<LabRun[]> {
    return this.store.listRuns();
  }

  private async collectEvidence(run: LabRun): Promise<void> {
    if (run.brief.sourceUrls.length === 0) {
      return;
    }

    const evidence = await fetchSourceEvidence(run.brief.sourceUrls);
    run.evidence = evidence;
    run.updatedAt = nowIso();

    for (const item of evidence) {
      run.timeline.push(
        this.createEvent(
          item.status === "fetched" ? "evidence.fetched" : "evidence.failed",
          item.status === "fetched"
            ? `Fetched evidence from ${item.title}.`
            : `Failed to fetch evidence from ${item.url}.`,
          { evidenceId: item.id, url: item.url }
        )
      );
    }

    await this.store.saveRun(run);
  }

  private async processTaskGraph(run: LabRun): Promise<void> {
    while (run.tasks.some((task) => task.status === "pending")) {
      const readyTasks = run.tasks.filter(
        (task) =>
          task.status === "pending" &&
          task.dependencies.every((dependencyName) =>
            run.tasks.some(
              (candidate) =>
                candidate.name === dependencyName &&
                candidate.status === "completed"
            )
          )
      );

      if (readyTasks.length === 0) {
        throw new Error(
          "No ready tasks found. The task graph may contain unresolved dependencies."
        );
      }

      const results = await Promise.allSettled(
        readyTasks.map(async (task) => this.executeTask(run, task))
      );
      const rejection = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );

      if (rejection) {
        throw rejection.reason;
      }

      await this.store.saveRun(run);
    }
  }

  private async executeTask(run: LabRun, task: LabTask): Promise<void> {
    task.status = "running";
    task.startedAt = nowIso();
    run.updatedAt = nowIso();
    run.timeline.push(
      this.createEvent("task.started", `${task.role} started "${task.name}".`, {
        taskId: task.id,
        role: task.role
      })
    );
    await this.store.saveRun(run);

    try {
      const relatedArtifacts = this.getRelatedArtifacts(run, task);
      const memory = await this.getScopedMemory(run.id);
      const specialist = this.specialists[task.role];
      const output = await specialist.execute({
        run,
        task,
        relatedArtifacts,
        memory
      });

      const artifact: LabArtifact = {
        id: createId("artifact"),
        role: task.role,
        title: output.title,
        kind: output.kind,
        content: output.content,
        summary: output.summary,
        createdAt: nowIso(),
        data: output.data
      };

      run.artifacts.push(artifact);
      task.artifactId = artifact.id;
      task.status = "completed";
      task.completedAt = nowIso();
      run.updatedAt = nowIso();

      if (artifact.kind === "report") {
        run.reportArtifactId = artifact.id;
        run.finalRecommendation = artifact.data?.recommendation;
      }

      run.timeline.push(
        this.createEvent(
          "artifact.created",
          `${task.role} created artifact "${artifact.title}".`,
          { artifactId: artifact.id, taskId: task.id }
        )
      );
      run.timeline.push(
        this.createEvent("task.completed", `${task.role} completed "${task.name}".`, {
          taskId: task.id,
          role: task.role
        })
      );

      const notes = createMemoryNotesFromArtifact({ artifact, runId: run.id });
      await this.store.appendMemory(notes);
      run.timeline.push(
        this.createEvent("memory.saved", `Saved ${notes.length} memory notes.`, {
          artifactId: artifact.id
        })
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown task execution failure.";
      task.status = "failed";
      task.completedAt = nowIso();
      task.error = message;
      run.timeline.push(
        this.createEvent("task.failed", `${task.role} failed "${task.name}".`, {
          taskId: task.id,
          role: task.role
        })
      );
      throw error;
    }
  }

  private applyPlan(run: LabRun, plan: PlannerOutput): void {
    run.northStar = plan.northStar;
    run.successCriteria = plan.successCriteria;
    run.rubric = plan.rubric;
    run.tasks = [
      {
        id: createId("task"),
        name: "Generate founder-fit ideas",
        role: "ideator",
        instructions:
          "Generate multiple distinct business ideas grounded in the founder brief. Each idea should have a clear wedge, monetization path, and founder-fit rationale.",
        acceptanceCriteria: [
          "Produce at least 4 distinct ideas",
          "Tie each idea to a clear target user and pain",
          "Keep the scope narrow enough for early validation"
        ],
        dependencies: [],
        status: "pending"
      },
      {
        id: createId("task"),
        name: "Validate and rank ideas",
        role: "validator",
        instructions:
          "Use the planning rubric plus any source evidence to score each idea, highlight risks, and rank them honestly.",
        acceptanceCriteria: [
          "Score each idea against the rubric",
          "Surface the strongest and weakest assumptions",
          "Rank the ideas and state confidence clearly"
        ],
        dependencies: ["Generate founder-fit ideas"],
        status: "pending"
      },
      {
        id: createId("task"),
        name: "Design validation experiments",
        role: "experimenter",
        instructions:
          "Create the cheapest, fastest experiments that can validate or kill the strongest ideas before heavy building begins.",
        acceptanceCriteria: [
          "Define concrete experiments for the top ideas",
          "Include success and kill signals",
          "Keep tests realistic for a solo operator"
        ],
        dependencies: ["Validate and rank ideas"],
        status: "pending"
      },
      {
        id: createId("task"),
        name: "Write the final decision report",
        role: "reporter",
        instructions:
          "Synthesize the full run into an operator-ready report with a recommendation, rationale, and next moves.",
        acceptanceCriteria: [
          "Name the recommended idea clearly",
          "Explain why it wins and what to test next",
          "Leave the founder with a usable report"
        ],
        dependencies: ["Design validation experiments"],
        status: "pending"
      }
    ];
  }

  private getRelatedArtifacts(run: LabRun, task: LabTask): LabArtifact[] {
    const dependencyNames = new Set(task.dependencies);
    const dependencyArtifactIds = new Set(
      run.tasks
        .filter((candidate) => dependencyNames.has(candidate.name))
        .map((candidate) => candidate.artifactId)
        .filter((value): value is string => Boolean(value))
    );

    return run.artifacts.filter((artifact) => dependencyArtifactIds.has(artifact.id));
  }

  private async getScopedMemory(runId: string): Promise<MemoryNote[]> {
    const notes = await this.store.listMemory();
    return notes.filter(
      (note) => note.scope === "global" || note.runId === runId
    );
  }

  private createEvent(
    type: TimelineEvent["type"],
    message: string,
    metadata?: Record<string, string>
  ): TimelineEvent {
    return {
      id: createId("evt"),
      type,
      message,
      timestamp: nowIso(),
      metadata
    };
  }

  private async requireRun(runId: string): Promise<LabRun> {
    const run = await this.store.getRun(runId);

    if (!run) {
      throw new Error(`Run "${runId}" not found.`);
    }

    return run;
  }
}
