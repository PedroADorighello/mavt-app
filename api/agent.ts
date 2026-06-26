import { handleAgentRequest } from "../server/mavtAgentPlugin.js";

declare const process: {
  env: Record<string, string | undefined>;
};

function parseCsvEnv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function handler(request: any, response: any) {
  await handleAgentRequest(request, response, {
    apiKey: process.env.OPENAI_API_KEY,
    apiKeys: parseCsvEnv(process.env.OPENAI_API_KEYS),
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.MAVT_OPENAI_MODEL || process.env.OPENAI_MODEL,
    models: parseCsvEnv(process.env.MAVT_OPENAI_MODELS || process.env.OPENAI_MODELS),
    maxOutputTokens: parsePositiveNumber(process.env.MAVT_AGENT_MAX_OUTPUT_TOKENS),
    timeoutMs: parsePositiveNumber(process.env.MAVT_AGENT_TIMEOUT_MS),
  });
}
