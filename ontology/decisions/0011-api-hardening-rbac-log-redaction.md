# ADR-0011 — API hardening: RBAC server-side + redação de log (Lote A dos P0 do Regis 2026-06-22-1658)

> **Emendada pela ADR-0053 (2026-09-28).** A seção 1 (RBAC por `requireRole`) não vale mais: ver a Emenda ao fim.

- **Status:** aceito
- **Data:** 2026-06-22
- **Contexto:** remediação dos P0 de Security do Regis-Review `2026-06-22-1658` (cards security-1, security-3). READ-ONLY no Conexos; backend Express (legado).

## Decisão

### 1. RBAC server-side nas mutações (security-1)
Middleware `requireRole(...allowed)` em `src/backend/http/auth.ts` gateia as **rotas de mutação** de permutas em `requireRole('admin')`: `POST /eleicao`, `POST /ingestao`, `POST/DELETE /cliente-filtro`, `POST/DELETE /alocacoes`, `POST /processar`. As **rotas de leitura** (`/painel`, `/gestao`, `/runs`, `/importadores`, `/invoices/buscar`) seguem abertas a qualquer usuário **autenticado**.

- **Fonte do role:** o `role` já vem no JWT. Hoje o frontend autentica via `POST /auth/login` (HS256 próprio, tabela `app_user`, `role` default `'admin'`), então os usuários atuais são todos `admin` — o gate não quebra ninguém e prepara roles futuros (ex.: `analyst` read-only). Tokens Supabase (ES256, `role='authenticated'`) — caminho de bootstrap, não usado pelo FE — ficam corretamente barrados nas mutações.
- **Respostas:** sem `req.user` → 401; role fora da lista → 403 (`Forbidden: insufficient role`).
- **Bass tactic:** Authorize Actors.

### 2. Redação de campos sensíveis no logger (security-3)
`redactBody(value, keys?)` em `src/backend/http/redact.ts` mascara (`[REDACTED]`, recursivo, case-insensitive) chaves sensíveis (`password`, `senha`, `token`, `authorization`, `secret`, `api_key`, …) antes do `JSON.stringify` no request/response logger (`index.ts`). Para o vazamento da senha do `POST /auth/login` no stdout/log drains do Render.
- **Bass tactic:** Limit Access.

## Não incluído (decisões correlatas)
- **performance-2 (timeout Conexos):** descartado como P0 — o axios do Conexos **já tem** `timeout: 40000` (`services/conexos.ts:81`); o finding mediu o wrapper DDD (`ConexosClient.ts`), não o transporte. Eventual ajuste (parametrizar/reduzir) fica como follow-up não-bloqueante.
- **security-2 (rotação de segredos / secret manager):** ação de ops (Render/Supabase) — fora do escopo de código.
- Demais P0 (auto-ingest coalescing, sandbox de teste, coverage FE, isolamento Supabase, rollback) → Lotes B/C e ops.

## Consequências
- Toda nova rota de **mutação** deve usar `requireRole('admin')` explicitamente (não há gate global por verbo). Documentar ao adicionar rotas.
- Quando surgir um segundo role (ex.: `analyst`), revisar a lista `allowed` por rota.

## Emenda (2026-09-28, ADR-0053)

`requireRole` deixou de existir no código, e o `role` do token não é mais fonte de autorização. A
regra "toda nova rota de mutação usa `requireRole('admin')`; leituras ficam abertas a qualquer
autenticado" é substituída por: **toda rota autenticada tem exatamente um guard explícito**,
`exigirPermissao(p)` (permissão por módulo lida do banco a cada requisição) ou `somenteAutenticado()`,
conferido por um teste de cobertura por introspecção (`http/routePermissions.test.ts`). Sem a
permissão, 403 `{ error: 'Você não tem permissão para esta ação.', permissao }` em português, no lugar
de `Forbidden: insufficient role`. A seção 2 (redação de log) permanece válida e inalterada.
