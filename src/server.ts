import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { loadConfig } from "./config.js";
import type { IdeaBrief } from "./domain/types.js";
import { createProvider } from "./llm/create-provider.js";
import { LabOrchestrator } from "./orchestrator/lab-orchestrator.js";
import { FileStore } from "./storage/file-store.js";

const config = loadConfig();
const store = new FileStore(config.dataDir);

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(
  response: http.ServerResponse,
  statusCode: number,
  contentType: string,
  payload: string
): void {
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(payload);
}

async function parseJsonBody<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");

  if (!body) {
    return {} as T;
  }

  return JSON.parse(body) as T;
}

async function serveStatic(
  response: http.ServerResponse,
  filePath: string
): Promise<void> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const ext = path.extname(filePath);
    const contentType =
      ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : "text/html; charset=utf-8";
    sendText(response, 200, contentType, content);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

function getOrchestrator(providerMode?: "mock" | "openai") {
  const provider = createProvider(config, providerMode);
  return new LabOrchestrator(store, provider);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSourceUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function buildIdeaBrief(body: Record<string, unknown>): IdeaBrief {
  const problem = normalizeString(body.problem) || normalizeString(body.objective);
  const targetUser = normalizeString(body.targetUser);
  const title =
    normalizeString(body.title) ||
    [problem, targetUser].filter(Boolean).join(" for ") ||
    "Idea Validation Run";

  return {
    title,
    problem,
    targetUser,
    marketContext:
      normalizeString(body.marketContext) || normalizeString(body.context),
    strengths: normalizeString(body.strengths),
    assets: normalizeString(body.assets),
    constraints: normalizeString(body.constraints),
    businessGoal: normalizeString(body.businessGoal),
    validationGoal: normalizeString(body.validationGoal),
    notes: normalizeString(body.notes),
    sourceUrls: normalizeSourceUrls(body.sourceUrls)
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const method = request.method ?? "GET";

  try {
    if (method === "GET" && url.pathname === "/") {
      await serveStatic(response, path.join(config.publicDir, "index.html"));
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/assets/")) {
      const fileName = path.basename(url.pathname.replace("/assets/", ""));
      await serveStatic(response, path.join(config.publicDir, fileName));
      return;
    }

    if (method === "GET" && url.pathname === "/api/meta") {
      const availableProviders = config.openAiApiKey
        ? ["mock", "openai"]
        : ["mock"];
      sendJson(response, 200, {
        host: config.host,
        port: config.port,
        defaultProvider: config.providerMode,
        availableProviders,
        workflow: "idea-lab"
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/agents") {
      const orchestrator = getOrchestrator();
      sendJson(response, 200, { agents: orchestrator.listAgents() });
      return;
    }

    if (method === "GET" && url.pathname === "/api/runs") {
      const orchestrator = getOrchestrator();
      const runs = await orchestrator.listRuns();
      sendJson(response, 200, { runs });
      return;
    }

    if (
      method === "GET" &&
      /^\/api\/runs\/[^/]+\/report\.md$/.test(url.pathname)
    ) {
      const runId = url.pathname.replace(/^\/api\/runs\/([^/]+)\/report\.md$/, "$1");
      const orchestrator = getOrchestrator();
      const run = await orchestrator.getRun(runId);

      if (!run) {
        sendJson(response, 404, { error: "Run not found" });
        return;
      }

      const reportArtifact = run.artifacts.find(
        (artifact) => artifact.id === run.reportArtifactId || artifact.kind === "report"
      );

      if (!reportArtifact) {
        sendJson(response, 404, { error: "Report not found" });
        return;
      }

      sendText(response, 200, "text/markdown; charset=utf-8", reportArtifact.content);
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/api/runs/")) {
      const runId = url.pathname.replace("/api/runs/", "");
      const orchestrator = getOrchestrator();
      const run = await orchestrator.getRun(runId);

      if (!run) {
        sendJson(response, 404, { error: "Run not found" });
        return;
      }

      sendJson(response, 200, { run });
      return;
    }

    if (method === "POST" && url.pathname === "/api/runs") {
      const body = await parseJsonBody<Record<string, unknown>>(request);
      const brief = buildIdeaBrief(body);
      const providerMode =
        body.providerMode === "openai" ? "openai" : ("mock" as const);

      if (!brief.problem || !brief.targetUser) {
        sendJson(response, 400, {
          error: "problem and targetUser are required"
        });
        return;
      }

      const orchestrator = getOrchestrator(providerMode);
      const run = await orchestrator.createRun({
        brief,
        providerMode
      });

      void orchestrator.executeRun(run.id);

      sendJson(response, 202, {
        runId: run.id,
        status: run.status,
        message: "Idea validation mission accepted and execution started."
      });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error.";
    sendJson(response, 500, { error: message });
  }
});

async function bootstrap(): Promise<void> {
  await store.init();

  server.listen(config.port, config.host, () => {
    console.log(
      `One Person Lab listening on http://${config.host}:${config.port}`
    );
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
