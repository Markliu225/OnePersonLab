import type { AppConfig } from "../config.js";
import { MockLlmProvider } from "./mock-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import type { LlmProvider } from "./types.js";

export function createProvider(
  config: AppConfig,
  mode: "mock" | "openai" = config.providerMode
): LlmProvider {
  if (mode === "openai") {
    if (!config.openAiApiKey) {
      throw new Error(
        "OPENAI_API_KEY is required when LLM_PROVIDER=openai or providerMode=openai."
      );
    }

    return new OpenAiProvider({
      apiKey: config.openAiApiKey,
      baseUrl: config.openAiBaseUrl,
      model: config.openAiModel
    });
  }

  return new MockLlmProvider();
}
