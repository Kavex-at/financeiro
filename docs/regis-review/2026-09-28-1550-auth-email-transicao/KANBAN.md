---
type: regis-review-kanban
run_id: 2026-09-28-1550-auth-email-transicao
total: 19
counts: { p0: 0, p1: 2, p2: 9, p3: 8 }
---

# Kanban — financeiro — 2026-09-28-1550-auth-email-transicao

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado
> Esperado. Ordem: P0 (S → XL), depois P1, P2, P3. Nenhum P0 neste ciclo.
>
> **Cards mesclados**: 4 pares de findings sobrepostos entre QAs foram consolidados em um único card
> cada (ver `REPORT.md` §3, Cross-cutting findings) — `security-1`+`fault-tolerance-1`,
> `security-2`+`fault-tolerance-3`, `testability-1`+`deployability-1`,
> `modifiability-3`+`integrability-1`. O campo **Origem** indica os findings mesclados.
>
> **Nota de escopo**: 2 commits chegaram na branch depois de os agentes gerarem suas seções
> (`6decb8d`, `62310c4`). O card `availability-2` já usa a localização de arquivo pós-refactor
> (`src/frontend/app/login/page.tsx`, não mais `TransicaoEmailBanner.tsx`) — ver `REPORT.md` §7.

---

## P0 — Crítico

Nenhum achado P0 neste ciclo, em nenhuma das 8 QAs.

---

## P1 — Alto

### [security-1] Persistir autor em toda ação administrativa sobre identidade de usuário

**QA**: Security + Fault Tolerance (mesclado)
**Tactic alvo**: Audit Trail / Repair State
**Esforço**: S (≤1d)
**Origem**: F-security-1, F-fault-tolerance-1

**Problema**
> `UserAdminService.setVinculo`, `setAtivo` e `resetPassword` não gravam quem executou a ação nem
> emitem `LogService`, ao contrário de `create` (coluna `created_by`) e `setEmail` (coluna
> `email_updated_by/at` + log), no mesmo arquivo e mesmo commit. `deactivateGuarded`/`setAtivo`
> mudam o controle de acesso da plataforma financeira sem deixar rastro no banco — nem coluna
> `ativo_updated_by/at`, nem chamada a `LogService`. Como `username` é o `sub` usado como
> `executado_por` nos ledgers de Permutas/SISPAG/Recebimentos, sequestrar a senha ou o vínculo
> Conexos de um usuário sequestra a autoria dele no ERP — sem deixar rastro hoje.

**Melhoria Proposta**
> Aplicar o mesmo padrão de `setEmail` às outras três ações (tactic Audit Trail/Repair State):
> (1) migration aditiva com `password_updated_by/at`, `vinculo_updated_by/at`,
> `ativo_updated_by/at` em `app_user` (padrão da migration `0064`); (2) `logService.info` em cada
> método de `UserAdminService.ts` (`setVinculo`, `setAtivo`, `resetPassword`), com `{ id, ator }`;
> (3) gravar as colunas no mesmo `UPDATE` de `deactivateGuarded`/`setAtivo`/`resetPassword`/
> `setVinculo` (um único statement, mesmo padrão do `setEmail`). Adicionar teste espelhando
> `routes/usuarios.test.ts:139-144` para as quatro rotas.

**Resultado Esperado**
> Cobertura de auditoria em `UserAdminService`: 40% (2/5) → 100% (5/5). Toda troca de senha,
> vínculo Conexos ou reativação/desativação de usuário é rastreável a um `ator` e um timestamp.

**Métricas de sucesso**
- % de ações mutantes de `UserAdminService` com trilha persistida: 40% → 100%
- Colunas de trilha em `ativo`/`vinculo`/`senha`: ausentes → presentes
- `LogService.info` em `setAtivo`/`setVinculo`/`resetPassword` (sucesso): ausente → presente

**Risco de não fazer**
> Um incidente de conta comprometida (admin phishado, ou insider malicioso) que reseta senhas ou
> vincula credenciais Conexos a terceiros fica sem trilha forense — a investigação não consegue
> provar quem fez o quê, e a atribuição de baixas no ERP (que depende do `username`) fica sujeita a
> dúvida. Numa revisão de acesso/compliance daqui a 6 meses, "quem desativou o usuário X e quando"
> não tem resposta no banco — só logs efêmeros sem retenção garantida.

**Dependências**: Nenhuma.

---

### [testability-1] Versionar harness de integração para a guarda de concorrência (R11) e a migration 0064

**QA**: Testability + Deployability (mesclado)
**Tactic alvo**: Sandbox / Reproducible builds
**Esforço**: M (2-5d)
**Origem**: F-testability-1, F-deployability-1

**Problema**
> A guarda R11 (`deactivateGuarded`, `FOR UPDATE`) e a unicidade cruzada de e-mail/username
> (`23505` sob corrida), além do `RAISE EXCEPTION` de dado ao vivo da migration `0064`, só foram
> provados contra Postgres real por um gate manual desta rodada (20/20, ver `_shared-metrics.md`),
> sem ficar como teste executável no repositório. Um mock não consegue provar serialização de
> transação, nem o comportamento condicional a dado da migration. O único arquivo
> `*.integration.test.ts` do repo cobre a migration `0060` (`vwMetricasCiclo`, precedente de uma
> revisão anterior) — a `0064` tem exatamente o mesmo perfil de risco, mas não foi coberta.

**Melhoria Proposta**
> Criar um harness de Postgres descartável versionado (reaproveitando o setup já usado
> manualmente nesta rodada: subir Postgres 17/16, aplicar as migrações do zero) com dois testes de
> integração seguindo o padrão `migrations/.*\.integration\.test\.ts` já reconhecido pelo script
> `test:sql`: (1) `UserRepository.integration.test.ts` (ou `describe('integration: UserRepository')`)
> cobrindo a corrida de dois admins se desativando ao mesmo tempo; (2)
> `appUserEmail.integration.test.ts` aplicando as migrações 1→64 e confirmando que a `0064` aborta
> com duplicata de caixa e aplica com os índices `lower()` corretos sem duplicata. Adicionar
> `npm run test:integration` reutilizável por qualquer feature futura com o mesmo perfil de risco.

**Resultado Esperado**
> `describe('integration: ...')` no repo: 0 → ≥2 (cobrindo `UserRepository` e a migration `0064`).
> Cobertura de migrations-com-guarda-de-dado por teste de integração: 0/1 → 1/1 (paridade com
> `vwMetricasCiclo`). A corrida de admins e a guarda da `0064` passam a ser reexecutáveis em
> qualquer máquina/CI, não só num gate manual de uma rodada.

**Métricas de sucesso**
- `describe('integration: ...')` no repo: 0 → ≥2
- Scripts/harness de Postgres descartável versionados: 0 → 1
- Migrations com `RAISE EXCEPTION`/guarda de dado cobertas por teste de integração em CI: 0/1 → 1/1
- Job `backend-sql` continua verde em ≤ tempo atual

**Risco de não fazer**
> A próxima mudança em `deactivateGuarded` ou em `runMigrations.ts`/`MigrationFiles.ts` (esperada
> no passo 2/3 do ADR-0051) pode afrouxar a serialização ou quebrar a guarda da `0064` sem que
> nenhum teste automatizado detecte — o incidente aparece em produção como "todos os admins
> ficaram inativos" ou como um boot falho, consumindo o runbook de rollback.

**Dependências**: Nenhuma.

---

## P2 — Médio

### [availability-1] Self-test de `AUTH_JWT_SECRET` no boot, não só no primeiro login

**QA**: Availability
**Tactic alvo**: Self-Test
**Esforço**: S (≤1d)
**Origem**: F-availability-2

**Problema**
> `AuthService.signToken` só descobre que `AUTH_JWT_SECRET` está ausente quando o primeiro usuário
> tenta logar (`src/backend/domain/service/auth/AuthService.ts:95-102`), retornando 500 sem
> qualquer sinal anterior. Como `AUTH_JWT_SECRET` já é uma env obrigatória rastreada pelo
> `CONFIG_MANIFESTO` (linha 84), a checagem existe — mas não roda no boot da instância que serve
> `/auth`.

**Melhoria Proposta**
> Adicionar uma checagem de `authJwtSecret` no `ConfigDoctor` (ou equivalente) rodando no boot do
> servidor (`index.ts`, nunca em `bootstrapAppContainer` — ver Gotcha do CLAUDE.md sobre os ~58
> jobs), com `console.error`/`LogService` fail-loud caso ausente em produção.

**Resultado Esperado**
> `AUTH_JWT_SECRET` ausente em produção aparece no log de boot da instância, não apenas no primeiro
> 500 de um usuário tentando logar.

**Métricas de sucesso**
- Self-test de `AUTH_JWT_SECRET` no boot: ausente → presente

**Risco de não fazer**
> Um deploy futuro sem a variável (ex.: rotação de segredo mal executada) derruba o login de todos
> os usuários sem qualquer sinal até o primeiro relato manual.

**Dependências**: Nenhuma.

---

### [deployability-2] Registrar a ordem de deploy Render/Vercel no runbook + fechar teste nas 2 rotas não cobertas

**QA**: Deployability
**Tactic alvo**: Deployment observability / Script Deployment Commands
**Esforço**: S (≤1d)
**Origem**: F-deployability-2

**Problema**
> `POST /usuarios` (só `email`) e `PATCH /usuarios/:id/email` não toleram rodar contra o backend
> anterior a esta feature — cenário real sempre que o build do Vercel (mais rápido) terminar antes
> do Render. O único teste existente cobre a direção segura (front antigo × back novo). A
> recomendação de documentar essa garantia (de uma revisão anterior, 2026-09-16) nunca foi
> implementada em `DEPLOY.md`.

**Melhoria Proposta**
> (1) Acrescentar um teste de frontend que simula 404/400 nessas duas chamadas e confirma que a UI
> degrada como já faz para 400/409 (sem crash, erro inline, diálogo aberto). (2) Acrescentar uma
> seção curta em `DEPLOY.md` (ou `docs/runbooks/deploy-ordering.md`): "backend antes do frontend
> quando o PR adicionar rota nova" — hoje essa regra só existe na prosa da ADR-0051 (linha 120-122).

**Resultado Esperado**
> Rotas com contrato alterado cobertas para a direção de risco real: 1/3 → 3/3. `DEPLOY.md` passa a
> ter uma seção "ordem de deploy" citável no checklist do operador.

**Métricas de sucesso**
- Rotas novas com teste explícito para "front novo × back antigo": 1/3 → 3/3
- `DEPLOY.md` contém uma seção de ordem de deploy referenciável: 0 → 1

**Risco de não fazer**
> Cada feature futura que toque `/usuarios` ou `/auth` reintroduz a mesma janela de erro visível
> para o admin, sem que ninguém novo no time saiba que a ordem de deploy importa aqui.

**Dependências**: Nenhuma.

---

### [modifiability-1] Extrair `BCRYPT_ROUNDS` para uma única fonte

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d)
**Origem**: F-modifiability-1

**Problema**
> `BCRYPT_ROUNDS=12` está hardcoded de forma idêntica em `UserAdminService.ts` e `seed-admin.ts`,
> com um comentário que admite a duplicação ("espelha o seed-admin") em vez de eliminá-la. Um
> ajuste de custo do bcrypt em um dos dois sítios sem o outro produz política de hashing divergente
> sem nenhum erro de build ou teste.

**Melhoria Proposta**
> Mover `BCRYPT_ROUNDS` para um módulo compartilhado (ex.: `domain/libs/crypto/PasswordHasher.ts`,
> espelhando o padrão já usado por `SecretCipher` para a cifra do vínculo Conexos) e importar esse
> módulo tanto em `UserAdminService` quanto em `seed-admin.ts`.

**Resultado Esperado**
> 1 fonte de verdade para o custo do bcrypt. Sítios com o valor hardcoded: 2 → 1 (módulo) + 2
> importadores.

**Métricas de sucesso**
- Sítios com `BCRYPT_ROUNDS` hardcoded: 2 → 1

**Risco de não fazer**
> Um endurecimento futuro do custo do bcrypt (plausível dado o histórico de hardening do repo)
> atualiza um sítio e esquece o outro, deixando parte da base (ex.: o admin semeado) com hashing
> mais fraco, sem alerta.

**Dependências**: Nenhuma.

---

### [modifiability-3] Extrair helper único para "quem é o ator" da requisição

**QA**: Modifiability + Integrability (mesclado)
**Tactic alvo**: Encapsulate / Manage Resource Coupling
**Esforço**: S (≤1d)
**Origem**: F-modifiability-3, F-integrability-1

**Problema**
> A expressão `req.user?.sub ?? req.user?.email` (ou a ordem inversa, `email ?? sub`) está
> duplicada em 20 pontos do backend (`permutas.ts`, `sispag.ts`, `recebimentos.ts`, `operacao.ts`,
> `me.ts` e, agora, `usuarios.ts:32`) — hoje inofensivo porque o token nunca tem `email`, mas o
> próprio ADR-0051 (D2, novo neste delta) já nomeia esse padrão como risco: "quem adicionar o claim
> `email` no passo 3 precisa inverter esses sítios no mesmo PR, ou eles passam a gravar o e-mail na
> trilha em silêncio". 5 sítios de `recebimentos.ts` já divergem entre si na ordem de precedência
> hoje (3 `sub??email`, 2 `email??sub`).

**Melhoria Proposta**
> Extrair um helper único (ex.: `http/actor.ts:actorFromRequest(req)` ou `resolveAtor(req)`) e
> substituir as ~20 ocorrências por chamadas a ele. Não precisa entrar neste ciclo (comportamento
> zero hoje), mas deve ser o primeiro passo do `/feature-new`/`/feature-tweak` que implementar o
> passo 3 do ADR-0051 — antes de adicionar a claim `email`, não depois.

**Resultado Esperado**
> Trocar o provedor de identidade no passo 3 passa a exigir editar 1 função, não fazer grep por
> `req.user?.sub` em rotas de negócio. Ocorrências inline: 20 → 1 (helper) + N chamadas.

**Métricas de sucesso**
- Call-sites de resolução ad-hoc do ator: 20 → 0 (substituídos pelo helper)
- Ordens de precedência divergentes coexistindo: 2 → 1

**Risco de não fazer**
> No passo 3 do ADR-0051, 1 dos ~20 sítios é esquecido na inversão manual, e o `triggeredBy`/`ator`
> de Permutas/SISPAG/Recebimentos passa a gravar e-mail em vez do `username` histórico sem nenhum
> erro — quebra silenciosa de auditoria e do vínculo Conexos por usuário.

**Dependências**: Idealmente concluído antes do `/feature-new` do passo 3 do ADR-0051 (Supabase Auth).

---

### [testability-2] Cobrir os caminhos de saída de `seed-admin.ts`

**QA**: Testability
**Tactic alvo**: Specialized Interfaces
**Esforço**: S (≤1d)
**Origem**: F-testability-2

**Problema**
> `SeedAdminConfig` (validação) e `upsertAdmin` (persistência) têm teste direto; o `main()` de
> `seed-admin.ts` que os conecta — incluindo a ordem "valida ANTES de conectar no banco"
> documentada no arquivo — não tem nenhuma asserção.

**Melhoria Proposta**
> Extrair `main` para uma função exportada e testável (mesmo padrão já aplicado a
> `SeedAdminConfig`), mockando `bootstrapAppContainer`/`container.resolve`/`process.exit`, e
> testar: (a) env inválido nunca chama `bootstrapAppContainer`; (b) sucesso loga a mensagem e sai
> com 0; (c) falha do repositório loga o erro (sem vazar a senha) e sai com 1.

**Resultado Esperado**
> `jobs/` do delta: 1/2 arquivos com teste direto → 2/2.

**Métricas de sucesso**
- Cobertura de arquivo em `jobs/` (delta): 50% → 100%

**Risco de não fazer**
> Baixo — job sob demanda, não em produção contínua; mas um refactor futuro pode inverter "validar
> antes de conectar" sem que nada pegue.

**Dependências**: Nenhuma.

---

### [testability-3] Elevar o piso de `coverageThreshold` do frontend

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d, bump do piso) / M (caminho até 80/70/80)
**Origem**: F-testability-3 (PRÉ-EXISTENTE, `jest.config.js` não tocado por este delta)

**Problema**
> O piso global de `src/frontend/jest.config.js` (33/23/28) é pré-existente e muito abaixo do
> backend (72/54/78) e do alvo defensável (80/70/80) para caminhos críticos. Esta feature elevou a
> cobertura real de login/usuários bem acima disso, mas o piso do CI não trava esse ganho.

**Melhoria Proposta**
> Medir a cobertura real do frontend após esta feature (rodar `npm test -- --coverage` fora do
> `--quick`) e subir `coverageThreshold` para um valor próximo do medido, com um caminho declarado
> para 80/70/80 em `features/` e `shared/components/ui/`.

**Resultado Esperado**
> `coverageThreshold` do frontend: 33/23/28 → valor medido pós-feature, com plano explícito até
> 80/70/80 nos diretórios críticos.

**Métricas de sucesso**
- `coverageThreshold.global.lines` (frontend): 33 → medido pós-feature (esperado > 40, a confirmar)

**Risco de não fazer**
> O ganho de testabilidade desta feature erode silenciosamente em ciclos futuros sob pressão de
> prazo — nenhum gate impede.

**Dependências**: Uma rodada de `regis-review` sem `--quick` (ou execução manual de
`npm test -- --coverage --silent` no frontend) para medir o valor real antes de fixar o novo piso.

---

### [fault-tolerance-2] Definir o padrão de `Idempotency-Key` antes que ele chegue às frentes financeiras

**QA**: Fault Tolerance
**Tactic alvo**: Idempotent Replay
**Esforço**: M (2-5d)
**Origem**: F-fault-tolerance-2

**Problema**
> Nenhuma das 5 rotas de mutação deste delta honra `Idempotency-Key` — hoje são seguras por
> acidente (chave natural de e-mail, operações já idempotentes), mas este é o primeiro conjunto de
> rotas nascido sob a política DDD/Lambda-ready do CLAUDE.md, e ele não estabelece o padrão que
> "executar permuta"/"finalizar lote"/"baixar conciliação" vão precisar — ações sem chave natural
> tão conveniente quanto e-mail único.

**Melhoria Proposta**
> Desenhar (não necessariamente implementar aqui) um middleware/`asyncHandler` reutilizável que
> aceite `Idempotency-Key`, persista `(key, resultado)` por uma janela curta, e devolva o resultado
> gravado em reenvio — documentado como o padrão a seguir no primeiro `/feature-new` de
> Permutas/SISPAG que executar uma escrita financeira sem chave natural.

**Resultado Esperado**
> Padrão de idempotência documentado (ADR ou nota em `CLAUDE.md`/`ontology/`) antes do primeiro
> endpoint de execução financeira ser modelado.

**Métricas de sucesso**
- Padrão de `Idempotency-Key` documentado: ausente → presente
- Endpoints financeiros futuros que o citam desde a primeira interview: 0 → 100% (medido nos
  próximos ciclos)

**Risco de não fazer**
> Quando a execução de permuta/remessa SISPAG (sem chave natural conveniente) chegar sem esse
> padrão definido, um double-click ou retry de proxy vira execução dupla de um write financeiro —
> exatamente o cenário P0 que esta QA existe para prevenir.

**Dependências**: Idealmente resolvido antes do `/feature-new` que modelar execução de permuta ou
remessa SISPAG.

---

### [security-2] Revogar sessões ativas ao desativar um usuário

**QA**: Security + Fault Tolerance (mesclado)
**Tactic alvo**: Revoke Access / Rollback-Recovery
**Esforço**: M (2-5d) — toca middleware compartilhado por todas as rotas
**Origem**: F-security-3, F-fault-tolerance-3

**Problema**
> `deactivateGuarded`/`setAtivo` mudam `app_user.ativo`, mas o middleware de auth (pré-existente,
> `http/auth.ts`) só valida assinatura e expiração do JWT — nunca `ativo`. Um token de até 12h
> continua autenticando em rotas que não dependem do vínculo Conexos, mesmo após a desativação
> administrativa. Este delta acabou de reforçar a guarda de QUEM pode desativar (R11) — é o momento
> natural de fechar a lacuna adjacente.

**Melhoria Proposta**
> Caminho tático (antes do passo 2 completo do ADR-0051): adicionar uma checagem leve de `ativo`,
> cacheada com TTL curto (ex.: 60s), nas rotas `requireRole('admin')` — sem pagar o custo de uma
> query por request em toda rota autenticada. Caminho alternativo/fallback mais simples: reduzir
> `TOKEN_EXPIRATION` (hoje `12h`). O passo 2 do ADR-0051 (permissões lidas do banco por requisição)
> continua sendo a solução definitiva.

**Resultado Esperado**
> Janela de exposição pós-desativação nas rotas administrativas: até 12h → ≤60s (ou o TTL de cache
> escolhido), sem esperar o SSO completo (passo 3).

**Métricas de sucesso**
- Janela de acesso residual após desativação: 12h (TTL do token) → alvo definido pelo time (ex.:
  ≤5min nas rotas admin)

**Risco de não fazer**
> Desligamento de funcionário ou vazamento de credencial deixa até 12h de acesso de leitura (e
> escrita não-Conexos) ativo mesmo após a ação administrativa de desativar — relevante para resposta
> a incidente num sistema que autentica escritas financeiras.

**Dependências**: Passo 2 do ADR-0051 é a solução definitiva; este card é mitigação tática isolada,
independente de `security-1`.

---

## P3 — Baixo

### [availability-2] Registrar (mesmo que só `console.warn`) a falha do banner de transição

**QA**: Availability
**Tactic alvo**: Exception Detection
**Esforço**: S (≤1d)
**Origem**: F-availability-1

**Problema**
> A busca do estado do banner de transição engole qualquer erro de rede/parse sem nenhum rastro
> (`.catch(() => undefined)`). O design de "fail closed" está correto; a ausência total de log não
> está. **Nota de localização (pós-consolidação)**: o finding original apontava
> `TransicaoEmailBanner.tsx:20-24`; o commit `62310c4` (chegou após a geração da seção de
> Availability) tornou o banner presentacional e içou o `fetch` para a página de login — o mesmo
> `.catch(() => undefined)` hoje vive em `src/frontend/app/login/page.tsx:38-48` (`LoginForm`), com
> comportamento idêntico. `src/frontend/lib/auth/transicao.ts:22-24` (`fetchTransicaoEmail`)
> também engole `catch { return false }` sem log, e não foi tocado pelo refactor.

**Melhoria Proposta**
> Trocar `.catch(() => undefined)` em `LoginForm` (`src/frontend/app/login/page.tsx`) por um
> `console.warn` (ou telemetria de frontend, se existir) que não afete `setTransicaoAtiva(false)`.

**Resultado Esperado**
> Uma falha sustentada de `/auth/transicao` (ex.: CORS quebrado) deixa rastro no console do
> navegador, detectável em suporte, sem mudar o comportamento visual (banner continua ausente).

**Métricas de sucesso**
- Catches silenciosos em código novo deste delta: 1 → 0

**Risco de não fazer**
> Baixo — o pior cenário é um problema de rede mais amplo (que afetaria `/auth/login`, já
> instrumentado) passar despercebido um pouco mais na sua manifestação mais branda (banner
> ausente).

**Dependências**: Nenhuma.

---

### [availability-3] Padronizar timeout client-side em `lib/http.ts` (follow-up de ciclo futuro)

**QA**: Availability
**Tactic alvo**: Ignore Faulty Behavior
**Esforço**: S (≤1d) — muda 1 arquivo central, mas é trabalho pré-existente, não deste ciclo
**Origem**: F-availability-4 (PRÉ-EXISTENTE)

**Problema**
> `apiFetch`/`fetch` (pré-existentes, `src/frontend/lib/http.ts`) não têm `AbortController`/
> timeout. A nova `definirEmail` reproduz esse padrão, junto com todas as outras ~6 funções de
> `lib/usuarios.ts` que já existiam. Um backend hung deixa qualquer diálogo de mutação
> (`EditarEmailDialog` incluso) girando sem saída.

**Melhoria Proposta**
> Adicionar timeout (ex.: 15-20s) com `AbortController` em `apiFetch`, um ponto central que
> beneficia toda a tela `/usuarios` e `/login` de uma vez — não arquivo a arquivo.

**Resultado Esperado**
> Qualquer chamada via `apiFetch` que não responda em N segundos falha com um erro tratável pelo
> `catch` já existente em cada tela, em vez de girar indefinidamente.

**Métricas de sucesso**
- Funções de `lib/usuarios.ts`/`lib/auth/transicao.ts` com timeout: 0/8 → 8/8

**Risco de não fazer**
> Baixo hoje (Render raramente trava sem responder); cresce se o backend passar a fazer chamadas
> síncronas mais longas em rotas que a tela `/usuarios` invoca.

**Dependências**: Nenhuma. Não é debt introduzido por este delta — registrado como follow-up em
`ontology/_inbox/auth-email-transicao-regis-followups.md`, não bloqueia o merge.

---

### [integrability-2] Registrar `ADMIN_EMAIL`/`ADMIN_PASSWORD` no `CONFIG_MANIFESTO` (ou documentar por que ficam de fora)

**QA**: Integrability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d)
**Origem**: F-integrability-2

**Problema**
> Este delta adicionou `AUTH_TRANSICAO_EMAIL_BANNER` ao `CONFIG_MANIFESTO`/`ConfigDoctor` (o
> registro central de config do repo), mas renomeou `ADMIN_USERNAME`→`ADMIN_EMAIL` e tornou
> `ADMIN_EMAIL`/`ADMIN_PASSWORD` obrigatórias sem as registrar no mesmo manifesto — aplicando o
> padrão de forma parcial dentro do mesmo PR.

**Melhoria Proposta**
> Ou registrar as duas vars no `CONFIG_MANIFESTO` com `criticidade: OPCIONAL` (já que só importam
> no `seed:admin` pontual, não no processo vivo), ou adicionar um comentário no manifesto
> explicando por que vars de job one-shot ficam fora dele.

**Resultado Esperado**
> Critério de "o que entra no `CONFIG_MANIFESTO`" documentado uma vez, aplicável de forma
> consistente a toda var nova daqui pra frente.

**Métricas de sucesso**
- Critério de inclusão no manifesto documentado: ausente → 1 comentário explícito no topo de
  `configManifest.ts`

**Risco de não fazer**
> Nenhum risco operacional; próximo PR volta a ter a mesma dúvida sem resposta escrita.

**Dependências**: Nenhuma.

---

### [modifiability-4] Unificar o mapeamento erro-de-domínio → HTTP entre rotas

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: M (2-5d, migração de 3 arquivos com cobertura de teste a preservar)
**Origem**: F-modifiability-4

**Problema**
> `routes/usuarios.ts` define seu próprio `respondError()` para traduzir erros de domínio tipados
> em respostas HTTP; `routes/permutas.ts` e `routes/recebimentos.ts` fazem o equivalente com suas
> próprias cadeias de `instanceof`, sem abstração compartilhada entre as três.

**Melhoria Proposta**
> Extrair um mapeador comum (ex.: `http/domainErrorResponder.ts`) que aceite uma tabela
> `{ ErrorClass -> {status, mensagem} }` e seja reusado pelas rotas; `usuarios.ts`, por ser o mais
> recente e mais limpo dos três, é um bom ponto de partida para a extração.

**Resultado Esperado**
> 1 mapeador compartilhado; 3 implementações locais → 1, com respostas HTTP consistentes por erro
> de domínio para qualquer rota nova.

**Métricas de sucesso**
- Implementações locais de mapeamento erro→HTTP: 3 → 1 compartilhada

**Risco de não fazer**
> Cada rota nova (uma a cada `/feature-new`) reinventa a mesma lógica; a resposta HTTP de um mesmo
> tipo de erro diverge em wording/formato entre frentes ao longo do tempo.

**Dependências**: Nenhuma.

---

### [performance-1] Adicionar paginação defensiva a `GET /usuarios`

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: S (≤1d)
**Origem**: F-performance-1 (PRÉ-EXISTENTE — delta só ampliou o `SELECT` em 3 colunas)

**Problema**
> `UserRepository.listAll` roda `SELECT ... FROM app_user ORDER BY created_at DESC, id DESC` sem
> `LIMIT`/`OFFSET` (pré-existente). Hoje inofensivo (15 linhas), mas contraria o `Dynamic WHERE
> Pattern` do CLAUDE.md e vira dívida silenciosa se `app_user` crescer com a federação do passo 3
> do ADR-0051 (SSO corporativo).

**Melhoria Proposta**
> Adicionar `LIMIT $limit OFFSET $offset` a `UserRepository.listAll`, com um teto default (ex.:
> 200) mesmo sem paginação de UI — protege contra crescimento inesperado sem exigir redesenho da
> tela agora.

**Resultado Esperado**
> `GET /usuarios` nunca devolve mais que o teto configurado, mesmo que `app_user` cresça 100x.

**Métricas de sucesso**
- Presença de `LIMIT` no `SELECT` de `listAll`: ausente → presente
- Teto de linhas por chamada: ilimitado → 200 (configurável)

**Risco de não fazer**
> Baixo em 6 meses (a tabela cresce por cadastro manual de admin) — mas se o passo 3 do ADR-0051
> popular `app_user` a partir de um diretório SSO, o risco sobe de P3 para P1 sem aviso.

**Dependências**: Nenhuma.

---

### [performance-2] Instrumentar duração de `AuthService.login` no `LogService`

**QA**: Performance
**Tactic alvo**: Reduce Overhead (observabilidade de latência)
**Esforço**: S (≤1d)
**Origem**: F-performance-3

**Problema**
> Não há nenhuma métrica de latência para `POST /auth/login` — nem localmente nem em produção (sem
> APM). Se o `bcryptjs` ou a nova query `findByLoginIdentifier` degradarem sob carga, o primeiro
> sinal será uma reclamação de usuário, não um alarme.

**Melhoria Proposta**
> Envolver `AuthService.login` com uma medição simples (`Date.now()` no início/fim, campo
> `durationMs` no `LogService.info`/`error` já emitido para o caso de múltiplos candidatos).

**Resultado Esperado**
> `LogService` passa a registrar `durationMs` em todo login (sucesso ou falha).

**Métricas de sucesso**
- Cobertura de `durationMs` em logs de login: 0% → 100%

**Risco de não fazer**
> Baixo agora; sobe quando o volume de usuários crescer o suficiente para o custo do `bcryptjs`
> (150–300ms/chamada) começar a competir por CPU do processo Express.

**Dependências**: Nenhuma.

---

### [security-3] Igualar o tempo de resposta do login entre identificador inexistente/inativo e senha errada

**QA**: Security
**Tactic alvo**: Authenticate Actors
**Esforço**: S (≤1d)
**Origem**: F-security-2

**Problema**
> `AuthService.login` retorna imediatamente (sem `bcrypt.compare`) quando o identificador não
> existe ou a conta está inativa, e só depois de um `bcrypt.compare` (custo 12) quando a senha está
> errada. A intenção declarada no código ("os três com a mesma resposta") vale para o corpo HTTP,
> mas não para o tempo de resposta.

**Melhoria Proposta**
> Executar um `bcrypt.compare` contra um hash fixo/dummy nos caminhos de "não existe"/"inativo"
> antes de retornar `null`, para igualar o tempo dos três caminhos — padrão comum contra oráculo de
> tempo em login.

**Resultado Esperado**
> Diferença de latência entre os três caminhos de falha deixa de ser estruturalmente distinguível.

**Métricas de sucesso**
- Presença de `bcrypt.compare` (real ou dummy) em 100% dos caminhos de retorno de `login`: 1/3 → 3/3

**Risco de não fazer**
> Enumeração de contas ativas/inativas por terceiros — risco baixo isolado, mas insumo para
> phishing direcionado.

**Dependências**: Nenhuma.

---

### [testability-4] Testes baseados em propriedade para normalização/colisão de e-mail

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Origem**: F-testability-4

**Problema**
> `createUserSchema`, `setEmailSchema` e `findByLoginIdentifier` implementam invariantes de
> normalização (dois valores diferentes só depois de normalizar nunca devem casar a mesma linha;
> todo e-mail persistido é sempre `trim().toLowerCase()`) testadas hoje só por exemplos pontuais
> (4-6 casos por função), embora `fast-check` já seja dependência do repo e esteja subutilizado.

**Melhoria Proposta**
> Adicionar `fc.assert` sobre `createUserSchema`/`setEmailSchema`: para qualquer string `s` com um
> `@` válido, `parse({ email: s })` sempre devolve `s.trim().toLowerCase()`; e para qualquer par de
> strings que normalizam para o mesmo valor, o schema as trata como equivalentes.

**Resultado Esperado**
> Usos de `fast-check` nos testes de auth/usuários: 0 → ≥2 (um em `UserAdminService.test.ts`, um em
> `UserRepository.test.ts` para `findByLoginIdentifier`).

**Métricas de sucesso**
- Arquivos de teste do delta usando `fast-check`: 0 → ≥2

**Risco de não fazer**
> Baixo — os exemplos hoje já cobrem os casos de negócio conhecidos; o risco é um caractere/
> Unicode-edge-case não previsto escapando.

**Dependências**: Nenhuma.
