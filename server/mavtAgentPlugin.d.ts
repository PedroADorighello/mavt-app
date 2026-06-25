import type { Plugin } from "vite";
type MavtAgentPluginOptions = {
    apiKey?: string;
    apiKeys?: string[];
    baseUrl?: string;
    model?: string;
    models?: string[];
    maxOutputTokens?: number;
    timeoutMs?: number;
};
export declare function mavtAgentPlugin(options?: MavtAgentPluginOptions): Plugin;
export {};
