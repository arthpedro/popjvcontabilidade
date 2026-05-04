# Portal POPS

Portal interno para escritorio de contabilidade, com frontend em HTML, CSS e JavaScript puro e persistencia em nuvem pelas rotas `/api/cloud/*`.

## Stack atual

- HTML estatico
- CSS puro
- JavaScript puro com modulos nativos
- Vercel Serverless Functions (`/api/cloud/*`)
- Upstash Redis
- Vercel Blob

## Estrutura principal

```txt
index.html
src/
  index.css
  main.js
  cloud.js
  blob-upload.js
vendor/
  mammoth.browser.min.js
api/
  _lib/
    cloud-store.js
  cloud/
    sectors.js
    staff-users.js
    documents.js
    blob-upload.js
    blob-delete.js
```

## Rotas

- `/` -> redireciona para o primeiro setor criado ou mostra estado vazio
- `/setores/:sectorId` -> setores criados no painel Staff
- `/staff`, `/staff/setores`, `/staff/usuarios` -> autenticacao e gestao administrativa

## Persistencia em nuvem

Os dados continuam centralizados na nuvem. A aplicacao nao usa `localStorage` como persistencia final.

- setores
- usuarios administrativos
- metadados de documentos por setor
- arquivos enviados para os setores

Endpoints usados pelo frontend:

- `GET/PUT /api/cloud/sectors`
- `GET/PUT /api/cloud/staff-users`
- `GET/PUT /api/cloud/documents`
- `POST /api/cloud/blob-upload`
- `POST /api/cloud/blob-delete`

## Setup na Vercel

1. Adicione **Upstash Redis** ao projeto.
2. Adicione **Vercel Blob** ao projeto.
3. Confirme as variaveis:
   - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
   - ou `KV_REST_API_URL` + `KV_REST_API_TOKEN`
   - `BLOB_READ_WRITE_TOKEN`
4. Faca novo deploy.

## Usuario inicial

- usuario: `admin`
- senha: `123456`

## Verificacao local

```bash
npm install
npm run check
```

Para testar a aplicacao completa com `/api/*`, Redis e Blob, use `vercel dev` com as variaveis carregadas.
