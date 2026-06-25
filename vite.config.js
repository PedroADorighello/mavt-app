import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { mavtAgentPlugin } from "./server/mavtAgentPlugin";
function parseCsvEnv(value) {
    return (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}
function parsePositiveNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, ".", "");
    return {
        plugins: [
            react(),
            mavtAgentPlugin({
                apiKey: env.OPENAI_API_KEY,
                apiKeys: parseCsvEnv(env.OPENAI_API_KEYS),
                baseUrl: env.OPENAI_BASE_URL,
                model: env.MAVT_OPENAI_MODEL || env.OPENAI_MODEL,
                models: parseCsvEnv(env.MAVT_OPENAI_MODELS || env.OPENAI_MODELS),
                maxOutputTokens: parsePositiveNumber(env.MAVT_AGENT_MAX_OUTPUT_TOKENS),
                timeoutMs: parsePositiveNumber(env.MAVT_AGENT_TIMEOUT_MS),
            }),
        ],
    };
});
