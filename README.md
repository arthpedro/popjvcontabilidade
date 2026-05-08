# Portal de POPs

Portal interno para organizar POPs e arquivos por setor, com painel administrativo
para setores, usuarios e logs de auditoria. O app roda em Node.js puro e pode usar
Supabase para banco/configuracao e Storage.

## Estrutura

```text
.
├── server.js                 # entrypoint local/Vercel
├── src/
│   └── server/
│       ├── app.js            # orquestracao da API e servidor HTTP
│       ├── config/           # ambiente, constantes, headers e rotas estaticas
│       ├── domain/           # normalizacao e helpers de usuarios/setores
│       ├── http/             # helpers de resposta HTTP
│       └── storage/          # cliente/configuracao do Supabase
├── public/
│   ├── index.html            # shell da aplicacao
│   └── assets/
│       ├── css/styles.css
│       ├── js/app.js         # fluxo principal da interface
│       ├── js/ui/            # componentes pequenos compartilhados
│       └── img/logo.jpg
├── dados/                    # dados locais e arquivos dos setores
├── usuarios.json             # usuarios locais
├── package.json
└── vercel.json
```

## Como rodar

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

Sem Supabase, o projeto usa os arquivos locais `usuarios.json`,
`dados/setores.json` e `dados/logs.json`. Para uploads e alteracoes em
producao/serverless, configure `SUPABASE_SERVICE_ROLE_KEY`.

## Validacao

```bash
npm run check
```

Esse comando valida a sintaxe do entrypoint, do servidor e dos arquivos JavaScript publicos.

## Observacoes

- Troque as senhas padrao no primeiro acesso.
- Nao publique `.env`; use `.env.example` como referencia.
- Ative `DEBUG_LOGS=true` apenas quando precisar investigar comportamento do servidor.
