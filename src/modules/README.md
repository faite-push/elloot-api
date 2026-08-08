# Módulos da API

Cada pasta = um domínio de negócio. O router em `src/routes/index.ts` monta tudo sob `/api`.

## Ao criar um módulo novo

1. Pasta `src/modules/<nome>/`
2. `<nome>.routes.ts` (obrigatório) + schemas/service se precisar
3. Registrar em `src/routes/index.ts`
4. Documentar uma linha no `elloot-api/README.md`
5. Se houver UI, criar `elloot-app/src/features/<nome>/` com o mesmo nome

## Convenção de arquivos

| Arquivo | Responsabilidade |
|---------|------------------|
| `*.routes.ts` | HTTP: parse, auth, status codes |
| `*.schemas.ts` | Zod (validação de body/query) |
| `*.service.ts` | Regras + Prisma |
| `*.shared.ts` | Helpers usados por routes e service |

Módulos pequenos podem ficar só com `routes.ts` até crescerem (ex.: `health`, `wallet`).

## Mapa atual

- **catalog** — categorias hierárquicas + listings públicos
- **listings** — CRUD autenticado do vendedor
- **orders** — escrow (vários arquivos por lifecycle)
- **payments** — sandbox PIX
- **media** — upload e storage
- **auth** — sessão e OAuth
- **wallet** — leitura de ledger
- **conversations** / **disputes** — chat e disputas (API pronta; UI app ainda planejada)
- **jobs** — tarefas internas (expire, auto-release)
