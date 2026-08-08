# Elloot API

API do marketplace [Elloot](https://github.com/faite-push/elloot-api) — Express 5, Prisma 6, PostgreSQL, Redis opcional.

Frontend irmão: [`elloot-app`](https://github.com/faite-push/elloot-app).

## Requisitos

- Node.js 20+
- PostgreSQL 15+
- Redis (opcional)

## Setup

```bash
git clone https://github.com/faite-push/elloot-api.git
cd elloot-api
npm install
cp .env.example .env.local
# Ajuste DATABASE_URL, JWT_SECRET, PORT, FRONTEND_URL, CORS_ORIGIN

npx prisma generate
npx prisma db push
npx prisma db seed           # categorias (+ seções)
npm run db:secure            # RLS
npm run dev                  # http://localhost:5000 (ou PORT do .env)
```

Health: `GET /api/health`

Com Docker local (Postgres):

```bash
docker compose up -d
```

## Scripts

| Comando | Uso |
|---------|-----|
| `npm run dev` | API com nodemon |
| `npm run typecheck` | TypeScript |
| `npm run test:e2e` | Fluxo E2E (API no ar) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:secure` | Aplica policies RLS |

## Estrutura

```
src/
  config/          # env, SSL
  databases/       # Prisma, Redis, RLS
  lib/             # errors, async-handler, sanitize
  middleware/      # auth, errors, rls
  modules/         # domínio (um por pasta)
  routes/index.ts  # monta /api/*
prisma/
  schema.prisma
  seed.ts
  data/            # categorias GGMAX + seções
  sql/             # RLS
scripts/           # e2e-flow.ts
```

## Módulos

| Módulo | Prefixo |
|--------|---------|
| health | `/api/health` |
| auth | `/api/auth` |
| catalog | `/api/catalog` |
| listings | `/api/listings` |
| media | `/api/media` |
| orders | `/api/orders` |
| payments | `/api/payments` |
| wallet | `/api/wallet` |
| conversations | `/api/conversations` |
| disputes | `/api/disputes` |
| jobs | `/api/jobs` |

Detalhes de env: [`.env.example`](./.env.example).

## Segurança

- Não commitar `.env`, certificados TLS nem arquivos em `storage/`.
- JWT e secrets só via variáveis de ambiente.

## Licença

Privado / uso do time Elloot.
