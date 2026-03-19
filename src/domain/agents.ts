import type { LabAgent } from "./types.js";

export const DEFAULT_AGENTS: LabAgent[] = [
  {
    role: "planner",
    name: "Decision Planner",
    specialty: "Turn an idea brief into a clear evaluation rubric and mission path.",
    responsibilities: [
      "Define the decision north-star",
      "Set success criteria and evaluation weights",
      "Frame the downstream workflow"
    ]
  },
  {
    role: "ideator",
    name: "Idea Generator",
    specialty: "Generate founder-fit, market-aware business ideas.",
    responsibilities: [
      "Produce candidate ideas with different strategic shapes",
      "Tie each idea to a clear user pain and wedge",
      "Keep ideas grounded in the founder brief"
    ]
  },
  {
    role: "validator",
    name: "Idea Validator",
    specialty: "Stress-test ideas with evidence, scoring, and risk analysis.",
    responsibilities: [
      "Score ideas against the evaluation rubric",
      "Call out weak assumptions and evidence gaps",
      "Recommend which ideas deserve validation effort"
    ]
  },
  {
    role: "experimenter",
    name: "Experiment Designer",
    specialty: "Design minimum-cost tests to validate demand fast.",
    responsibilities: [
      "Create low-cost validation actions",
      "Define success and kill signals",
      "Sequence experiments by leverage"
    ]
  },
  {
    role: "reporter",
    name: "Report Writer",
    specialty: "Synthesize the full decision package into a usable report.",
    responsibilities: [
      "Summarize the opportunity landscape",
      "Recommend the best next move",
      "Produce an operator-ready report"
    ]
  }
];
