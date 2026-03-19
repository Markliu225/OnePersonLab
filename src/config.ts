import path from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  providerMode: "mock" | "openai";
  openAiApiKey?: string;
  openAiModel: string;
  openAiBaseUrl: string;
  dataDir: string;
  publicDir: string;
}

export function loadConfig(): AppConfig {
  const cwd = process.cwd();
  const providerMode =
    process.env.LLM_PROVIDER === "openai" ? "openai" : "mock";

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
    providerMode,
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    dataDir: path.resolve(cwd, process.env.LAB_DATA_DIR ?? ".lab-data"),
    publicDir: path.resolve(cwd, "public")
  };
}
