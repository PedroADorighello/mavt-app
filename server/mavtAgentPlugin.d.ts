import type { Plugin } from "vite";
type MavtAgentPluginOptions = {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
};
export declare function mavtAgentPlugin(options?: MavtAgentPluginOptions): Plugin;
export {};
