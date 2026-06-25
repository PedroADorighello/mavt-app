const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_COMPATIBLE_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5.5";
export function mavtAgentPlugin(options = {}) {
    return {
        name: "mavt-agent-api",
        configureServer(server) {
            server.middlewares.use("/api/agent", (request, response, next) => {
                handleAgentRequest(request, response, options).catch(next);
            });
        },
        configurePreviewServer(server) {
            server.middlewares.use("/api/agent", (request, response, next) => {
                handleAgentRequest(request, response, options).catch(next);
            });
        },
    };
}
async function handleAgentRequest(request, response, options) {
    if (request.method !== "POST") {
        sendJson(response, 405, { error: "Método não permitido." });
        return;
    }
    const apiKey = options.apiKey;
    if (!apiKey) {
        sendJson(response, 401, {
            error: "OPENAI_API_KEY não configurada. Defina a chave em .env ou no ambiente antes de iniciar o app.",
        });
        return;
    }
    const body = await readJsonBody(request).catch(() => undefined);
    if (!body) {
        sendJson(response, 400, { error: "JSON invalido." });
        return;
    }
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) {
        sendJson(response, 400, { error: "Mensagem vazia." });
        return;
    }
    const payload = {
        message,
        model: compactDecisionModel(body?.model),
    };
    const usesCompatibleChat = Boolean(options.baseUrl) || apiKey.startsWith("sk-or-");
    const aiResponse = usesCompatibleChat
        ? await callCompatibleChat(apiKey, options, payload)
        : await callOpenAIResponses(apiKey, options, payload);
    if (!aiResponse.ok) {
        sendJson(response, aiResponse.status, {
            error: aiResponse.error ?? "Falha ao chamar a IA.",
        });
        return;
    }
    const outputText = aiResponse.text;
    const parsed = parseJsonObject(outputText);
    if (!parsed) {
        sendJson(response, 502, {
            error: "A IA não retornou um JSON válido.",
            preview: outputText.slice(0, 500),
        });
        return;
    }
    sendJson(response, 200, sanitizeAgentResult(parsed));
}
async function callOpenAIResponses(apiKey, options, payload) {
    const response = await fetch(resolveUrl(options.baseUrl, OPENAI_RESPONSES_URL), {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: options.model || DEFAULT_MODEL,
            max_output_tokens: 220,
            input: [
                {
                    role: "developer",
                    content: buildSystemPrompt(),
                },
                {
                    role: "user",
                    content: JSON.stringify(payload),
                },
            ],
        }),
    });
    const data = await response.json().catch(() => undefined);
    return {
        ok: response.ok,
        status: response.status,
        text: extractResponsesText(data),
        error: data?.error?.message,
    };
}
async function callCompatibleChat(apiKey, options, payload) {
    const response = await fetch(resolveUrl(options.baseUrl, OPENAI_COMPATIBLE_CHAT_URL), {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://127.0.0.1:5173",
            "X-Title": "MAVT Workspace",
        },
        body: JSON.stringify({
            model: options.model || "openai/gpt-4o-mini",
            max_tokens: 220,
            messages: [
                {
                    role: "system",
                    content: buildSystemPrompt(),
                },
                {
                    role: "user",
                    content: JSON.stringify(payload),
                },
            ],
            response_format: { type: "json_object" },
        }),
    });
    const data = await response.json().catch(() => undefined);
    return {
        ok: response.ok,
        status: response.status,
        text: data?.choices?.[0]?.message?.content ?? "",
        error: data?.error?.message,
    };
}
function buildSystemPrompt() {
    return [
        "Você é um agente especialista em MAVT para um app de decisão multicritério.",
        "Sua tarefa e interpretar a mensagem do usuario e retornar somente JSON valido, sem markdown.",
        "Não invente dados numéricos de desempenho. Se o usuário não der valores, deixe o app criar campos vazios.",
        "Use nomes em portugues quando o usuario escrever em portugues.",
        "Retorne no formato:",
        '{"reply":"texto curto em portugues","operations":[]}',
        "Operações aceitas:",
        '{"type":"setRootName","rootName":"Escolher carro"}',
        '{"type":"replaceAlternatives","alternatives":["A","B"]}',
        '{"type":"addAlternatives","alternatives":["A"]}',
        '{"type":"removeAlternatives","alternatives":["A"]}',
        '{"type":"replaceCriteria","criteria":[{"name":"Custo","weight":40,"subcriteria":["Preço","Manutenção"]}]}',
        '{"type":"addCriteria","criteria":[{"name":"Custo","weight":40,"subcriteria":["Preço","Manutenção"]}]}',
        '{"type":"removeCriteria","criteria":["Custo"]}',
        '{"type":"setCriterionWeight","criterion":"Custo","weight":40}',
        '{"type":"addSubcriteria","criterion":"Custo","subcriteria":["Preço","Manutenção"]}',
        '{"type":"configureScale","criterion":"Preço","min":0,"max":100,"direction":"cost"}',
        '{"type":"setPerformance","criterion":"Preço","alternative":"Alfa","value":120}',
        "direction deve ser benefit para maior melhor, ou cost para menor melhor.",
        "Use setPerformance quando o usuário informar valores de alternativas na matriz de desempenho.",
        "Use replaceCriteria, não addCriteria, quando o usuário disser que os critérios são, serão, ou descrever o problema inteiro.",
        "Use replaceAlternatives quando o usuário disser que as alternativas são ou descrever o problema inteiro.",
        "Se o pedido for ambíguo, retorne operations vazia e explique a dúvida no reply.",
    ].join("\n");
}
function compactDecisionModel(model) {
    if (!model || typeof model !== "object")
        return undefined;
    return {
        rootName: model.rootName,
        alternatives: Array.isArray(model.alternatives)
            ? model.alternatives.map((item) => ({ name: item?.name })).filter((item) => item.name)
            : [],
        criteria: compactCriteria(model.criteria),
    };
}
function compactCriteria(criteria) {
    if (!Array.isArray(criteria))
        return [];
    return criteria
        .map((criterion) => ({
        name: criterion?.name,
        weight: criterion?.weight,
        children: compactCriteria(criterion?.children),
        scale: criterion?.scale
            ? {
                min: criterion.scale.min,
                max: criterion.scale.max,
                direction: criterion.scale.direction,
                mode: criterion.scale.mode,
            }
            : undefined,
    }))
        .filter((criterion) => criterion.name);
}
function sanitizeAgentResult(value) {
    const reply = typeof value?.reply === "string" && value.reply.trim() ? value.reply.trim() : "Entendi.";
    const operations = Array.isArray(value?.operations) ? value.operations.filter((operation) => operation?.type) : [];
    return { reply, operations };
}
function resolveUrl(baseUrl, fallback) {
    if (!baseUrl)
        return fallback;
    if (baseUrl.endsWith("/chat/completions") || baseUrl.endsWith("/responses"))
        return baseUrl;
    return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}
function extractResponsesText(response) {
    if (typeof response?.output_text === "string")
        return response.output_text;
    const parts = [];
    for (const output of response?.output ?? []) {
        for (const content of output?.content ?? []) {
            if (typeof content?.text === "string")
                parts.push(content.text);
        }
    }
    return parts.join("\n");
}
function parseJsonObject(text) {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    try {
        return JSON.parse(trimmed);
    }
    catch {
        const match = trimmed.match(/\{[\s\S]*\}/);
        if (!match)
            return undefined;
        try {
            return JSON.parse(match[0]);
        }
        catch {
            return undefined;
        }
    }
}
async function readJsonBody(request) {
    const decoder = new TextDecoder();
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
    }
    chunks.push(decoder.decode());
    const raw = chunks.join("");
    return raw ? JSON.parse(raw) : {};
}
function sendJson(response, statusCode, value) {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(value));
}
