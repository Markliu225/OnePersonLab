import type {
  AgentRole,
  LabArtifact,
  MemoryNote,
  MemoryType
} from "../domain/types.js";
import { createId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

const roleToType: Record<AgentRole, MemoryType> = {
  planner: "decision",
  ideator: "decision",
  validator: "fact",
  experimenter: "decision",
  reporter: "risk"
};

export function createMemoryNotesFromArtifact(input: {
  artifact: LabArtifact;
  runId: string;
}): MemoryNote[] {
  return [
    {
      id: createId("memory"),
      scope: "run",
      runId: input.runId,
      type: roleToType[input.artifact.role],
      title: `${input.artifact.title} Summary`,
      content: input.artifact.summary,
      tags: [input.artifact.role, input.artifact.kind],
      sourceArtifactId: input.artifact.id,
      createdAt: nowIso()
    },
    {
      id: createId("memory"),
      scope: "global",
      type: roleToType[input.artifact.role],
      title: `${input.artifact.role} pattern`,
      content: input.artifact.summary,
      tags: [input.artifact.role, "global"],
      sourceArtifactId: input.artifact.id,
      createdAt: nowIso()
    }
  ];
}
