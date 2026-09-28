# Follow-ups — auth-email-transicao (Regis-Review 2026-09-28-1550)

> Relatório: `docs/regis-review/2026-09-28-1550-auth-email-transicao/REPORT.md` e `KANBAN.md`.
> **Nenhum P0** nas 8 QAs (score geral 7,9). Nada aqui foi implementado neste ciclo; são candidatos
> a `/feature-tweak`. Os passos 2 e 3 da ADR-0051 passam pela mesma área, então vários destes ficam
> mais baratos se entrarem junto com eles.

## P1

- **security-1 — Trilha de autor em toda ação administrativa sobre usuário.** `setAtivo`,
  `resetPassword` e `setVinculo` não gravam quem fez nem quando (só `create` e `setEmail` gravam).
  Como o `username` é o `executado_por` dos ledgers, trocar a senha ou o vínculo Conexos de alguém
  é assumir a identidade de escrita no ERP dessa pessoa, hoje sem rastro. Mesclado com
  fault-tolerance-1. Esforço S.
- **testability-1 — Harness de integração versionado para a guarda R11 e a migration 0064.** A
  corrida de dois admins se desativando e a guarda de caixa da 0064 foram provadas ao vivo neste
  ciclo (Postgres descartável, 20/20), mas não ficaram como teste. O repo já tem o padrão:
  `*.integration.test.ts` + `npm run test:sql` + job `backend-sql` do CI. Mesclado com
  deployability-1. Esforço M.

## P2

- **security-2 — Revogar sessões ao desativar.** O middleware não relê `ativo`; um token já emitido
  vale até 12h depois da desativação. PRÉ-EXISTENTE; candidato natural ao passo 2 (permissões lidas
  do banco por requisição). Mesclado com fault-tolerance-3.
- **deployability-2 — Ordem de deploy no `DEPLOY.md`.** "Backend antes do frontend" está só na
  ADR-0051 e na nota do PR. Levar para o runbook do operador.
- **availability-1 — Self-test do `AUTH_JWT_SECRET` no boot** (hoje só falha no primeiro login).
  Lembrar do gotcha: vai em `index.ts`, não em `bootstrapAppContainer`.
- **modifiability-1 — `BCRYPT_ROUNDS` numa fonte só** (`UserAdminService.ts` e `seed-admin.ts`).
- **modifiability-3 — Helper único para "quem é o ator"** (`req.user.sub ?? req.user.email` em ~20
  sítios, com precedência divergente em `routes/recebimentos.ts`). Pré-requisito do passo 3.
  Mesclado com integrability-1.
- **testability-2 — Cobrir as saídas de `jobs/seed-admin.ts`** (só o `SeedAdminConfig` tem teste).
- **testability-3 — Subir o `coverageThreshold` do frontend** (PRÉ-EXISTENTE).
- **fault-tolerance-2 — Padrão de `Idempotency-Key`** antes de chegar às frentes financeiras.
- **PatternGuardian P1 (não remediado) — `jobs/seed-admin.ts` resolve `UserRepository` direto**,
  sem service. Mesmo desenho da `main` (o job já fazia isso); decidir se "job pode resolver
  repositório" é convenção aceita e registrar no CLAUDE.md, ou criar `UserAdminService.upsertAdmin`.
- **PatternGuardian P2 — `NOT_FOUND:` como string** em `UserAdminService` e `startsWith` em
  `routes/usuarios.ts`. Padrão PRÉ-EXISTENTE do arquivo; trocar por `UserNotFoundError` tipado.
- **PatternGuardian P2 — regra de negócio (R11) dentro do repositório** (`deactivateGuarded`).
  Mantida lá de propósito: a checagem precisa das linhas travadas na mesma transação. Registrar a
  exceção ou expor a transação ao service.
- **DesignSystemReviewer P2 — diálogos de `/usuarios` com `useState` manual** em vez de
  react-hook-form + Zod, e botão que troca ícone por spinner. Padrão herdado dos diálogos irmãos;
  migrar os três juntos.

## P3

- **availability-2** — logar (`console.warn`) a falha do banner de transição, hoje silenciosa por
  desenho (fail closed).
- **availability-3** — timeout client-side em `lib/http.ts` (PRÉ-EXISTENTE).
- **integrability-2** — `ADMIN_EMAIL`/`ADMIN_PASSWORD` no `CONFIG_MANIFESTO`.
- **modifiability-4** — mapeamento erro de domínio → HTTP compartilhado entre rotas.
- **performance-1** — paginação defensiva em `GET /usuarios` (15 usuários hoje).
- **performance-2** — `durationMs` nos logs do login.
- **security-3** — igualar o tempo de resposta do login (identificador inexistente/inativo responde
  sem `bcrypt.compare`): enumeração por tempo. Comportamento PRÉ-EXISTENTE.
- **testability-4** — testes por propriedade (`fast-check`) na normalização e colisão de e-mail.
- **DesignSystemReviewer** — `role="status"` num banner persistente: o DS só documenta o papel para
  loading/toast. Confirmar com quem mantém o DS.
- **Task 7, critério do `grep ADMIN_USERNAME`** — ainda aparece em 3 relatórios históricos de
  `docs/regis-review/` (2026-06-24, 2026-08-12, 2026-08-28). Não foram editados porque são registros
  datados; se o critério for literal, a decisão é do Yuri.

## Cards do quadro (uma linha por card)

- [P1] security-1: trilha de autor em setAtivo, resetPassword e setVinculo
- [P1] testability-1: teste de integração versionado para a guarda R11 e a migration 0064
- [P2] security-2: revogar sessões ao desativar usuário (token vale até 12h)
- [P2] deployability-2: ordem de deploy backend antes do frontend no DEPLOY.md
- [P2] availability-1: self-test do AUTH_JWT_SECRET no boot (index.ts)
- [P2] modifiability-1: BCRYPT_ROUNDS numa fonte só
- [P2] modifiability-3: helper único para o ator da requisição (sub ?? email)
- [P2] testability-2: cobrir as saídas do jobs/seed-admin.ts
- [P2] testability-3: subir o coverageThreshold do frontend
- [P2] fault-tolerance-2: padrão de Idempotency-Key para rotas de escrita
- [P2] pattern-guardian: seed-admin resolve UserRepository direto (decidir convenção de jobs)
- [P2] pattern-guardian: trocar NOT_FOUND string por UserNotFoundError tipado
- [P2] pattern-guardian: regra R11 dentro do UserRepository.deactivateGuarded
- [P2] design-system: diálogos de /usuarios em react-hook-form + Zod e spinner sem trocar ícone
- [P3] availability-2: logar a falha do banner de transição
- [P3] availability-3: timeout client-side em lib/http.ts
- [P3] integrability-2: ADMIN_EMAIL e ADMIN_PASSWORD no CONFIG_MANIFESTO
- [P3] modifiability-4: mapeamento erro de domínio para HTTP compartilhado
- [P3] performance-1: paginação defensiva em GET /usuarios
- [P3] performance-2: durationMs nos logs do login
- [P3] security-3: igualar o tempo de resposta do login (enumeração por tempo)
- [P3] testability-4: testes por propriedade na normalização de e-mail
- [P3] design-system: confirmar role="status" em banner persistente
