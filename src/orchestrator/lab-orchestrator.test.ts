import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MockLlmProvider } from "../llm/mock-provider.js";
import { FileStore } from "../storage/file-store.js";
import { LabOrchestrator } from "./lab-orchestrator.js";

async function createTempStore(): Promise<{
  store: FileStore;
  cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "one-person-lab-"));
  const store = new FileStore(dir);
  await store.init();

  return {
    store,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}

test("orchestrator executes a full idea-lab mission and persists the report", async () => {
  const { store, cleanup } = await createTempStore();

  try {
    const orchestrator = new LabOrchestrator(store, new MockLlmProvider());
    const run = await orchestrator.createRun({
      brief: {
        title: "AI workflow ideas for boutique agencies",
        problem: "Boutique agencies lose margin to repetitive client operations",
        targetUser: "Boutique agency owners",
        marketContext: "Small teams with high service intensity and weak internal tooling",
        strengths: "Product thinking, AI prototyping, and founder-led sales",
        assets: "Existing network in service businesses",
        constraints: "Part-time founder and small budget",
        businessGoal: "Find a path to first revenue within 30 days",
        validationGoal: "Identify the best idea to test without building a full SaaS",
        notes: "Prefer B2B offers over consumer ideas",
        sourceUrls: []
      }
    });

    const completed = await orchestrator.executeRun(run.id);

    assert.equal(completed.status, "completed");
    assert.equal(completed.tasks.length, 4);
    assert.equal(completed.artifacts.length, 4);
    assert.ok(completed.rubric);
    assert.ok(completed.finalRecommendation);
    assert.ok(completed.reportArtifactId);
    assert.equal(completed.artifacts.at(-1)?.kind, "report");

    const ideasArtifact = completed.artifacts.find((artifact) => artifact.kind === "ideas");
    const validationArtifact = completed.artifacts.find(
      (artifact) => artifact.kind === "validation"
    );

    assert.ok(ideasArtifact?.data?.ideas);
    assert.equal(ideasArtifact?.data?.ideas?.length, 4);
    assert.ok(validationArtifact?.data?.validations);
    assert.equal(validationArtifact?.data?.validations?.length, 4);

    const persisted = await store.getRun(run.id);
    assert.ok(persisted);
    assert.equal(persisted?.artifacts.length, 4);
    assert.ok(
      persisted?.timeline.some((event) => event.type === "run.completed")
    );

    const memory = await store.listMemory();
    assert.equal(memory.length, 8);
  } finally {
    await cleanup();
  }
});

test("orchestrator exposes the idea-lab agent roster", async () => {
  const { store, cleanup } = await createTempStore();

  try {
    const orchestrator = new LabOrchestrator(store, new MockLlmProvider());
    const agents = orchestrator.listAgents();
    assert.equal(agents.length, 5);
    assert.equal(agents[0]?.role, "planner");
    assert.equal(agents[1]?.role, "ideator");
    assert.equal(agents.at(-1)?.role, "reporter");
  } finally {
    await cleanup();
  }
});
