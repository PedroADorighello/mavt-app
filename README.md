# MAVT Workspace

Aplicativo web interativo para tomada de decisão pelo método MAVT, com uma tela única de trabalho, árvore de critérios, matriz de desempenho, painel de resultados e agente de IA por chat lateral.

## Rodar localmente

```bash
npm install
npm run dev
```

Depois acesse:

```text
http://127.0.0.1:5173
```

## Ativar IA real no chat

O app inclui um endpoint local `/api/agent` que chama a OpenAI pelo servidor Vite. A chave não fica no frontend.

1. Crie um arquivo `.env` na raiz do projeto.
2. Preencha:

```text
OPENAI_API_KEY=sua_chave_aqui
MAVT_OPENAI_MODEL=gpt-5.5
MAVT_AGENT_MAX_OUTPUT_TOKENS=160
MAVT_AGENT_TIMEOUT_MS=25000
```

3. Reinicie o `npm run dev`.

Sem `OPENAI_API_KEY`, o chat continua funcionando com o agente local por regras.

Fallbacks opcionais:

```text
OPENAI_API_KEYS=chave_principal,chave_reserva
MAVT_OPENAI_MODELS=gpt-5.5,gpt-5.4-mini,gpt-4.1-mini
```

Chaves de fallback ajudam em casos de limite, quota, indisponibilidade temporaria ou acesso diferente entre projetos. Elas nao corrigem erro de prompt, JSON invalido ou uma configuracao errada que afete todas as chaves.

Com chaves gratuitas, mantenha `MAVT_AGENT_MAX_OUTPUT_TOKENS` baixo. Para provedores compativeis/OpenRouter, o app limita a chamada a 160 tokens para evitar erro de creditos insuficientes.

## Gerar build de producao

```bash
npm run build
```

Os arquivos finais ficam em `dist/`.

## Deploy na Vercel

1. Crie um repositorio no GitHub e envie esta pasta para ele.
2. Acesse [vercel.com/new](https://vercel.com/new).
3. Importe o repositorio.
4. Use as configuracoes padrao da Vercel para Vite:
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. Clique em `Deploy`.

Depois do deploy, a Vercel gera uma URL no formato:

```text
https://nome-do-projeto.vercel.app
```

## Comandos aceitos pelo agente

Exemplos:

```text
adicione alternativa SUV
remova HB20
adicione critério risco peso 15%
peso do preco para 35%
defina preco de 80000 a 150000 menor melhor
```

Com a chave configurada, a IA interpreta pedidos mais livres e retorna operacoes estruturadas. Se a chamada falhar, o app usa automaticamente o parser local como fallback.
