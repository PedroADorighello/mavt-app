# MAVT Workspace

Aplicativo web interativo para tomada de decisao pelo metodo MAVT, com uma tela unica de trabalho, arvore de criterios, matriz de desempenho, painel de resultados e agente de IA simulado por chat lateral.

## Rodar localmente

```bash
npm install
npm run dev
```

Depois acesse:

```text
http://127.0.0.1:5173
```

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

## Comandos aceitos pelo agente simulado

Exemplos:

```text
adicione alternativa SUV
remova HB20
adicione criterio risco peso 15%
peso do preco para 35%
defina preco de 80000 a 150000 menor melhor
```

O agente atual e uma simulacao local com parser de texto. Para integrar uma IA real, conecte o campo de chat a uma rota backend que chame o modelo desejado e retorne operacoes estruturadas sobre o estado da decisao.
