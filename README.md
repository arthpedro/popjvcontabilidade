# Portal de POPs

Portal interno para organizar POPs e arquivos por setor, com painel administrativo para setores e usuários. O app roda em Node.js puro e pode usar Supabase para banco/configuração e Storage.

## Requisitos

- Node.js compatível com o campo `engines` do `package.json`
- Conta/projeto Supabase, se quiser persistência em nuvem

## Como Rodar

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Ambiente

Crie um `.env` com base no `.env.example`:

```bash
PORT=3000
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DEBUG_LOGS=false
```

Sem Supabase, o projeto usa os arquivos locais `usuarios.json` e `dados/setores.json`. Para uploads e alterações em produção/serverless, configure `SUPABASE_SERVICE_ROLE_KEY`.

## Validação

```bash
npm run check
```

Esse comando valida a sintaxe de `server.js` e `script.js`.

## Observações

- Troque as senhas padrão no primeiro acesso.
- Não publique `.env`; use `.env.example` como referência.
- Ative `DEBUG_LOGS=true` apenas quando precisar investigar comportamento do servidor.
