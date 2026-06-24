import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { mavtAgentPlugin } from "./server/mavtAgentPlugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    plugins: [
      react(),
      mavtAgentPlugin({
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL,
        model: env.MAVT_OPENAI_MODEL || env.OPENAI_MODEL,
      }),
    ],
  };
});
