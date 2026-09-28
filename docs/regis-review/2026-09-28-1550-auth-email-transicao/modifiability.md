---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-28-1550-auth-email-transicao
agent: qa-modifiability
generated_at: 2026-09-28T15:50:00-03:00
scope: all
score: 8
findings_count: 4
cards_count: 4
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Admin da Columbia / próxima etapa do plano (ADR-0051, passos 2-3) | Pedido de mudança pontual e previsível dentro do plano já documentado (ex.: trocar custo do bcrypt, adicionar papel, ligar/desligar o banner, remover o login por `username`) | Camada `auth` (`UserRepository`, `AuthService`, `UserAdminService`, `SeedAdminConfig`, `routes/auth.ts`, `routes/usuarios.ts`, `domain/errors/*`) | Código em produção (Express/Render hoje), sob os gates do pipeline (typecheck/lint/test/PatternGuardian) | A mudança fica contida na camada `auth` + config, sem tocar as três frentes de negócio (Permutas/SISPAG/Recebimentos) | Nº de arquivos fora de `domain/*/auth`, `domain/errors/`, `routes/{auth,usuarios}.ts`, env/config e frontend `usuarios`/`login` tocados pelo delta = **0/32** arquivos não-teste (medido: `git diff --stat origin/main...HEAD`) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Contenção da mudança (arquivos fora da camada auth/config/frontend-usuarios tocados) | 0 | 0 | ✅ | `git diff --stat origin/main...HEAD` |
| LOC do maior arquivo do delta (`UserRepository.ts`) | 379 | ≤600 (P1 acima disso) | ✅ | `wc -l` |
| LOC `routes/usuarios.ts` / `UserAdminService.ts` / `AuthService.ts` | 226 / 194 / 112 | ≤600 | ✅ | `wc -l` |
| Fan-in de `UserRepository` (blast radius de uma mudança de schema/API) | 5 arquivos (`ConexosSessionResolver`, `UserAdminService`, `AuthService`, `routes/usuarios.ts`, `jobs/seed-admin.ts`) | baixo (<10) | ✅ | `grep -rl "UserRepository" src/backend` |
| Fan-in de `AuthService` / `UserAdminService` | 1 / 1 | baixo | ✅ | `grep -rl` por importador |
| Violações de camada no delta (route → repository/client direto, pulando service) | 0 | 0 | ✅ | leitura manual de `routes/auth.ts` e `routes/usuarios.ts`; único import "profundo" é de `domain/errors/*` (tipos de erro, convenção já usada por ~35 outras classes de erro do domínio) |
| Ciclos de dependência amostrados (`UserRepository` ↔ `AuthService` ↔ `UserAdminService` ↔ `SeedAdminConfig`) | 0 | 0 | ✅ | inspeção manual do grafo de imports (≤3 saltos) |
| Complexidade cognitiva (Biome) nos arquivos do delta | 0 funções >15 | 0 | ✅ | `npm run lint` (74 warnings pré-existentes no repo, 0 em `UserRepository/AuthService/UserAdminService/routes-auth/routes-usuarios/seed-admin/SeedAdminConfig`) |
| Números mágicos duplicados sem fonte única (`BCRYPT_ROUNDS=12`) | 2 sítios idênticos | 1 | ⚠️ | `UserAdminService.ts:13`, `seed-admin.ts:19` |
| Definições independentes do papel `admin` (sem tipo/enum compartilhado) | 2 constantes (`ADMIN_ROLE`, `USER_ROLES`) + ~40 literais `'admin'` inline em `requireRole()` | 1 | ⚠️ | `grep -rn "'admin'" src/backend/routes src/backend/domain/service/auth src/backend/domain/repository/auth` |
| Duplicação do padrão `req.user?.sub ?? req.user?.email` (extração do ator) | 20 ocorrências repo-wide (19 pré-existentes + 1 no delta, `routes/usuarios.ts:32`) | 1 (helper) | ⚠️ | `grep -rn "req.user?.sub ?? req.user?.email" src/backend` |
| Config externalizada via `EnvironmentProvider`/`configManifest.ts` (`AUTH_TRANSICAO_EMAIL_BANNER`) | 1/1 nova var, sem `process.env` cru em service | 100% | ✅ | `EnvironmentProvider.ts`, `configManifest.ts`, `.env.example` |
| Gates da branch (delta) | typecheck ✅, lint ✅ (0 no delta), 158 suites/2371 testes backend, 55/465 frontend | verde | ✅ | `_shared-metrics.md` + reexecução de `typecheck`/`lint` nesta revisão (pós-commit `6decb8d`) |

> ⚠️ **Não medível localmente**: cobertura de linha/branch e `npm audit` — omitidos por `--quick` (ver `_shared-metrics.md`). Terraform/infra — não existe `infra/` neste repo.

### Apêndice — Top 10 maiores arquivos do backend (repo inteiro, contexto; nenhum do delta aparece aqui)

| # | Arquivo | LOC |
|---|---|---|
| 1 | `domain/service/recebimentos/RecebimentoNumerarioService.ts` | 2415 |
| 2 | `domain/client/ConexosGerDocProcessoClient.ts` | 1300 |
| 3 | `domain/service/permutas/EleicaoPermutasService.ts` | 1143 |
| 4 | `domain/service/permutas/ReconciliacaoPermutaService.ts` | 1140 |
| 5 | `domain/service/sispag/RemessaService.ts` | 1111 |
| 6 | `domain/client/ConexosSispagWriteClient.ts` | 1090 |
| 7 | `routes/recebimentos.ts` | 984 |
| 8 | `routes/permutas.ts` | 933 |
| 9 | `jobs/validate-permutas-saldo-ordem-centavos-v1.ts` | 736 |
| 10 | `domain/repository/permutas/PermutaExecucaoRepository.ts` | 732 |

O maior arquivo do delta (`UserRepository.ts`, 379 LOC) ficaria em 15º lugar — a feature não move a agulha da distribuição de tamanho do repositório.

### Apêndice — Top 10 maiores arquivos do frontend (repo inteiro, contexto)

| # | Arquivo | LOC |
|---|---|---|
| 1 | `app/sispag/page.tsx` | 1252 |
| 2 | `app/permutas/page.tsx` | 1083 |
| 3 | `lib/recebimentos.ts` | 1065 |
| 4 | `app/recebimentos/components/AlocarProcessosDialog.tsx` | 928 |
| 5 | `lib/sispag.ts` | 887 |
| 6 | `app/permutas/BorderosPanel.tsx` | 758 |
| 7 | `app/recebimentos/page.tsx` | 727 |
| 8 | `lib/api.ts` | 639 |
| 9 | `lib/arquitetura/tecnica.ts` | 623 |
| 10 | `app/sispag/components/LoteCard.tsx` | 582 |

`app/usuarios/page.tsx` (220 LOC) e os diálogos novos (`EditarEmailDialog.tsx` 112, `NovoUsuarioDialog.tsx` 196) ficam bem abaixo desta lista.

### Apêndice — Top 10 services por fan-in (repo inteiro, `domain/service/`, contexto)

| # | Service | Fan-in |
|---|---|---|
| 1 | `LogService` | 37 |
| 2 | `ErpErrorInterpreter` | 4 |
| 3 | `EleicaoPermutasService` | 4 |
| 4 | `VariacaoCambialPermutaService` | 3 |
| 5 | `SaldoAlocacaoAdiantamentoService` | 3 |
| 6 | `ReconciliacaoPermutaService` | 3 |
| 7 | `NotificacaoService` | 3 |
| 8 | `JobRunReadModel` | 3 |
| 9 | `IngestaoTransacoesService` | 3 |
| 10 | `GestaoPermutasService` | 3 |

`AuthService` e `UserAdminService` (fan-in = 1 cada) não entram nesta lista — confirma que o delta opera numa área de baixo raio de propagação do grafo de dependências, o que é o resultado esperado para uma mudança isolada na camada de acesso.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | `SeedAdminConfig` extraída de `seed-admin.ts` especificamente para ser testável sem rodar o job; `domain/errors/` mantém 1 classe por arquivo (`EmailAlreadyInUseError.ts`, `SelfDeactivationError.ts`, `LastActiveAdminError.ts`, movidas para lá no meio do delta); todos os arquivos tocados ficam ≤379 LOC | ✅ presente | `jobs/SeedAdminConfig.ts:36`, `domain/errors/*.ts`, commit `6decb8d` |
| Increase Semantic Coherence | Separação clara por responsabilidade (`UserRepository`=persistência, `AuthService`=login, `UserAdminService`=gestão admin, `SeedAdminConfig`=validação de env); mas o vocabulário de papéis está espalhado (ver F-modifiability-2) | ⚠️ parcial | `UserRepository.ts:58` (`ADMIN_ROLE`) vs `UserAdminService.ts:16` (`USER_ROLES`) |
| Encapsulate | Erros de domínio tipados (`EmailAlreadyInUseError`, `SelfDeactivationError`, `LastActiveAdminError`) escondem o SQLSTATE `23505` do Postgres atrás de `rethrowUniqueViolation`; resultados de `setEmail`/`deactivateGuarded` são enums (`SET_EMAIL_RESULT`, `DEACTIVATE_RESULT`), não booleans/strings soltos. Mas a extração "quem é o ator" (`req.user?.sub ?? req.user?.email`) não está encapsulada (ver F-modifiability-3) | ⚠️ parcial | `UserRepository.ts:368-378`, `SET_EMAIL_RESULT`/`DEACTIVATE_RESULT` (linhas 43-55) |
| Use an Intermediary | `EnvironmentProvider` intermedia 100% do acesso a env (`AUTH_TRANSICAO_EMAIL_BANNER`, nunca `process.env` cru nos services); `PostgreeDatabaseClient.withTransaction` intermedia a transação com `FOR UPDATE` da guarda de desativação | ✅ presente | `EnvironmentProvider.ts:213`, `UserRepository.ts:255-287` |
| Restrict Dependencies | Cadeia Route→Service→Repository→Client intacta nos 7 arquivos de produção do delta; único import "abaixo" do service em uma rota é de `domain/errors/*` (tipos de erro, convenção já usada por ~35 classes de erro do domínio, não é o repositório) | ✅ presente | `routes/usuarios.ts:8-10`, `routes/auth.ts` |
| Refactor | O próprio delta se auto-corrigiu durante a revisão: commit `6decb8d` moveu as 3 classes de erro de dentro de `UserRepository.ts` para `domain/errors/`, alinhando com a convenção já estabelecida no repositório, sem regressão (typecheck limpo, lint 0 no delta após a mudança) | ✅ presente | `git log --oneline -- src/backend/domain/errors/` |
| Abstract Common Services | `BCRYPT_ROUNDS=12` duplicado literalmente em 2 arquivos (F-modifiability-1); mapeamento erro-de-domínio→HTTP (`respondError`) reinventado localmente em `usuarios.ts`, `permutas.ts` e `recebimentos.ts` sem abstração compartilhada (F-modifiability-4) | ⚠️ parcial | `UserAdminService.ts:13`, `seed-admin.ts:19`; `routes/usuarios.ts:42-67` |
| Defer Binding | `AUTH_TRANSICAO_EMAIL_BANNER` é um feature flag real: chave manual, fail-closed, efeito sem redeploy do frontend (só restart do backend), documentado em `configManifest.ts`. ADR-0051 defere explicitamente a claim `email` no token e a migração para Supabase Auth para os passos 2/3, com o seam já pronto (`LoginResult.email` opcional, `sub` congelado) — sequenciamento deliberado de decisões de binding em vez de big-bang | ✅ presente | `routes/auth.ts:57-64`, `configManifest.ts` (+10), `ontology/decisions/0051-*.md` §D1/D2 |

Não há tactic de "Defer Binding" via polimorfismo/plugin neste delta — não aplicável: a camada auth não tem múltiplas implementações intercambiáveis de uma interface (consistente com o padrão de todo o repositório, que usa `tsyringe` só para injeção de classe única, sem tokens nomeados — ver `grep -rn "container.register\|TOKEN"` = 0 ocorrências).

## 4. Findings (achados)

### F-modifiability-1: `BCRYPT_ROUNDS` duplicado sem fonte única

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/domain/service/auth/UserAdminService.ts:13`, `src/backend/jobs/seed-admin.ts:19`
- **Evidência (objetiva)**:
  ```ts
  // UserAdminService.ts:12-13
  /** Custo do bcrypt — espelha o `seed-admin` (BCRYPT_ROUNDS = 12). */
  const BCRYPT_ROUNDS = 12;

  // seed-admin.ts:19
  const BCRYPT_ROUNDS = 12;
  ```
- **Impacto técnico**: se um dos dois sítios for atualizado (ex.: endurecer o custo do bcrypt) sem o outro, usuários criados pela UI e o admin semeado passam a ter políticas de hashing diferentes — nenhum teste ou erro de compilação detecta a divergência, porque ambos são valores válidos.
- **Impacto de negócio**: parâmetro relevante para segurança (custo do bcrypt) vira uma política implícita de dois sítios; um hardening futuro precisa de diligência manual (grep) em vez de uma única edição, e um sítio esquecido deixa parte da base com hashing mais fraco sem alerta.
- **Métrica de baseline**: 2 sítios, valor idêntico (12), 0 constante/módulo compartilhado.

### F-modifiability-2: Vocabulário do papel `admin` sem fonte única

- **Severidade**: P2
- **Tactic violada**: Increase Semantic Coherence
- **Localização**: `UserRepository.ts:58` (`ADMIN_ROLE`), `UserAdminService.ts:16` (`USER_ROLES`), ~40 sítios de `requireRole('admin')` em `routes/{permutas,sispag,recebimentos,operacao,usuarios}.ts`
- **Evidência (objetiva)**:
  ```
  UserRepository.ts:58:      const ADMIN_ROLE = 'admin';
  UserAdminService.ts:16:    export const USER_ROLES = ['admin', 'operador'] as const;
  routes/usuarios.ts:30:     router.use(requireRole('admin'));
  + ~39 outros requireRole('admin') em permutas.ts/sispag.ts/recebimentos.ts/operacao.ts
  ```
- **Impacto técnico**: adicionar/renomear um papel (mudança já anunciada pela ADR-0051 passo 2, "Permissões por página/feature") exige tocar 3 definições independentes mais dezenas de literais de string, sem nenhum vínculo garantido pelo compilador entre eles; um typo em `requireRole('adimn')` falha silenciosamente para 403 em vez de erro de tipo.
- **Impacto de negócio**: um rollout malfeito de papel/permissão arrisca bloquear (ou liberar demais) usuários de forma invisível até QA manual pegar — risco concreto porque o próprio ADR-0051 já planeja essa mudança como o próximo passo.
- **Métrica de baseline**: 2 declarações independentes de papel + ~40 literais crus, 0 enum/tipo compartilhado.

### F-modifiability-3: Extração do "ator" (`sub ?? email`) duplicada 20x

- **Severidade**: P3
- **Tactic violada**: Encapsulate
- **Localização**: `routes/usuarios.ts:32`; padrão idêntico em `permutas.ts`, `sispag.ts`, `recebimentos.ts`, `operacao.ts`, `me.ts` (20 ocorrências repo-wide)
- **Evidência (objetiva)**:
  ```ts
  // routes/usuarios.ts:32
  const ator = (req: Request): string | undefined => req.user?.sub ?? req.user?.email;
  ```
  ```
  $ grep -rn "req.user?.sub ?? req.user?.email" src/backend --include="*.ts" | grep -v test | wc -l
  20
  ```
- **Impacto técnico**: a própria ADR-0051 (D2) já nomeia este padrão como risco futuro — "quem adicionar a claim `email` no passo 3 precisa inverter esses três [sítios] para `sub ?? email` no mesmo PR, ou eles passam a gravar o e-mail na trilha em silêncio" — e o delta soma mais uma instância inline em vez de um helper único que o passo 3 poderia atualizar em um lugar só.
- **Impacto de negócio**: o próprio ADR descreve o risco de negócio — drift silencioso do identificador gravado em `executado_por`/`criado_por`/`triggeredBy` nos ledgers de Permutas, SISPAG e Recebimentos, se algum dos ~20 sítios for esquecido na inversão do passo 3.
- **Métrica de baseline**: 20 ocorrências repo-wide (19 pré-existentes + 1 no delta), 0 helper compartilhado.

### F-modifiability-4: Mapeamento erro-de-domínio → HTTP duplicado por arquivo de rota

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `routes/usuarios.ts:42-67` (`respondError`); mapeamento equivalente, mas com estrutura própria, em `routes/permutas.ts` (~linha 80-99) e `routes/recebimentos.ts` (9 checagens `FilialForbiddenError`)
- **Evidência (objetiva)**:
  ```ts
  // routes/usuarios.ts:42
  const respondError = (res: Response, err: unknown): boolean => {
      if (err instanceof EmailAlreadyInUseError) { res.status(409)... return true; }
      if (err instanceof SelfDeactivationError) { ... }
      ...
  };
  ```
- **Impacto técnico**: cada arquivo de rota reinventa sua própria cadeia `instanceof`/função local para traduzir um erro de domínio tipado em status/mensagem HTTP; não há middleware ou mapeador compartilhado, então toda rota nova (e o pipeline gera uma a cada `/feature-new`) volta a copiar o padrão.
- **Impacto de negócio**: risco crescente de inconsistência na resposta HTTP (wording do 409, presença de `requestId`, etc.) entre frentes conforme mais rotas nascem, e custo de manutenção por arquivo que cresce a cada nova classe de erro.
- **Métrica de baseline**: 3 arquivos de rota com mapeamento local independente, 0 abstração compartilhada.

## 5. Cards Kanban

### [modifiability-1] Extrair `BCRYPT_ROUNDS` para uma única fonte

- **Problema**
  > `BCRYPT_ROUNDS=12` está hardcoded de forma idêntica em `UserAdminService.ts` e `seed-admin.ts`, com um comentário que admite a duplicação ("espelha o seed-admin") em vez de eliminá-la. Um ajuste de custo do bcrypt em um dos dois sítios sem o outro produz política de hashing divergente sem nenhum erro de build ou teste.

- **Melhoria Proposta**
  > Mover `BCRYPT_ROUNDS` para um módulo compartilhado (ex.: `domain/libs/crypto/PasswordHasher.ts`, espelhando o padrão já usado por `SecretCipher` para a cifra do vínculo Conexos) e importar esse módulo tanto em `UserAdminService` quanto em `seed-admin.ts`. Tactic: Abstract Common Services.

- **Resultado Esperado**
  > 1 fonte de verdade para o custo do bcrypt. Sítios com o valor hardcoded: 2 → 1 (módulo) + 2 importadores.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Sítios com `BCRYPT_ROUNDS` hardcoded: 2 → 1
- **Risco de não fazer**: um endurecimento futuro do custo do bcrypt (plausível dado o histórico de hardening do repo) atualiza um sítio e esquece o outro, deixando parte da base (ex.: o admin semeado) com hashing mais fraco, sem alerta.
- **Dependências**: nenhuma.

### [modifiability-2] Centralizar o vocabulário de papéis (`admin`/`operador`)

- **Problema**
  > O papel `admin` é definido de forma independente em 3+ lugares — `ADMIN_ROLE` privado em `UserRepository.ts`, `USER_ROLES` exportado em `UserAdminService.ts`, e ~40 literais `'admin'` inline em `requireRole('admin')` espalhados por `permutas.ts`, `sispag.ts`, `recebimentos.ts`, `operacao.ts` e `usuarios.ts` — sem nenhum tipo/enum compartilhado que os amarre.

- **Melhoria Proposta**
  > Promover `USER_ROLES` (já `as const` em `UserAdminService.ts`) a um módulo compartilhado (ex.: `domain/core/roles.ts`), importado por `UserRepository`, por `requireRole()` em `http/auth.ts` e por todos os call-sites hoje com o literal solto. Tactic: Increase Semantic Coherence.

- **Resultado Esperado**
  > 1 definição de papéis. Renomear/adicionar um papel passa a ser 1 edição com erro de compilação nos sítios desatualizados, em vez de uma varredura manual por ~40 strings.

- **Tactic alvo**: Increase Semantic Coherence
- **Severidade**: P2
- **Esforço estimado**: M (2-5d, dado o número de call-sites a migrar com segurança)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Definições independentes de papel: 2 + ~40 literais → 1 módulo compartilhado
- **Risco de não fazer**: ADR-0051 já anuncia o passo 2 do plano ("Permissões por página/feature, lidas do banco") como a próxima mudança nesta mesma área — chegar lá com o vocabulário de papéis ainda espalhado multiplica o custo exatamente da mudança já planejada.
- **Dependências**: idealmente concluído antes do `/feature-new` do passo 2 da ADR-0051.

### [modifiability-3] Extrair helper para "quem é o ator" da requisição

- **Problema**
  > A expressão `req.user?.sub ?? req.user?.email` está duplicada em 20 pontos do backend (`permutas.ts`, `sispag.ts`, `recebimentos.ts`, `operacao.ts`, `me.ts` e, agora, `usuarios.ts:32`); a própria ADR-0051 (D2) já nomeia esse padrão como risco para quando o passo 3 adicionar a claim `email` ao token.

- **Melhoria Proposta**
  > Extrair um helper único (ex.: `http/actor.ts:actorFromRequest(req)`) e substituir as 20 ocorrências por chamadas a ele. Tactic: Encapsulate.

- **Resultado Esperado**
  > 1 ponto de mudança para a inversão de precedência que a própria ADR já prevê ser necessária no passo 3, em vez de 20 sítios a caçar manualmente. Ocorrências inline: 20 → 1 (helper) + N chamadas.

- **Tactic alvo**: Encapsulate
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Ocorrências do padrão inline: 20 → 1
- **Risco de não fazer**: quando o passo 3 da ADR-0051 adicionar a claim `email` ao token, a inversão de precedência pode deixar 1+ dos 20 sítios desatualizados, gravando o e-mail em vez do `username` canônico nos ledgers de Permutas/SISPAG/Recebimentos — o cenário que a própria ADR descreve como perigoso.
- **Dependências**: idealmente antes do `/feature-new` do passo 3 da ADR-0051 (Supabase Auth).

### [modifiability-4] Unificar o mapeamento erro-de-domínio → HTTP entre rotas

- **Problema**
  > `routes/usuarios.ts` define seu próprio `respondError()` para traduzir erros de domínio tipados em respostas HTTP; `routes/permutas.ts` e `routes/recebimentos.ts` fazem o equivalente com suas próprias cadeias de `instanceof`, sem abstração compartilhada entre as três.

- **Melhoria Proposta**
  > Extrair um mapeador comum (ex.: `http/domainErrorResponder.ts`) que aceite uma tabela `{ ErrorClass -> {status, mensagem} }` e seja reusado pelas rotas; `usuarios.ts`, por ser o mais recente e mais limpo dos três, é um bom ponto de partida para a extração. Tactic: Abstract Common Services.

- **Resultado Esperado**
  > 1 mapeador compartilhado; 3 implementações locais → 1, com respostas HTTP consistentes por erro de domínio para qualquer rota nova.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: M (2-5d, migração de 3 arquivos com cobertura de teste a preservar)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Implementações locais de mapeamento erro→HTTP: 3 → 1 compartilhada
- **Risco de não fazer**: cada rota nova (uma a cada `/feature-new`) reinventa a mesma lógica; a resposta HTTP de um mesmo tipo de erro diverge em wording/formato entre frentes ao longo do tempo.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: delta vs `origin/main` (32 arquivos não-teste + testes). O commit `6decb8d` ("move user error classes to domain/errors") chegou no worktree compartilhado *durante* esta revisão; os achados acima já refletem o estado pós-refactor, reverificado (`npm run typecheck` limpo, `npm run lint` = 74 warnings/0 no delta).
- Cross-QA → Integrability: o próprio `Refactor`/`Encapsulate` de mover as classes de erro para `domain/errors/` também é achado relevante de Integrability (contrato de erro na borda HTTP); conferir sobreposição.
- Cross-QA → Testability: 0 ciclos detectados e todos os arquivos do delta ≤379 LOC correlacionam com a suíte ao vivo (20/20 cenários de `UserRepository` contra Postgres descartável, ver `_shared-metrics.md`) — sinal positivo de "fácil de testar = fácil de mudar" a registrar no lado de Testability.
- Cross-QA → Deployability: F-modifiability-1 (`BCRYPT_ROUNDS`) é número mágico **não** externalizado, ao contrário de `AUTH_TRANSICAO_EMAIL_BANNER` (bem feito, via `EnvironmentProvider`); vale Deployability avaliar se o custo do bcrypt devia ser tunável por env sem redeploy.
- Ontologia: `entity_changed=false` (ADR-0051 — `app_user` é infraestrutura de plataforma, não entidade das 3 frentes financeiras); `_index.json`/`_coverage.json` corretamente intocados por este delta, sem drift a reportar para esta feature.
