---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-28-2158
agent: qa-fault-tolerance
generated_at: 2026-09-28T22:40:00-03:00
scope: backend, frontend (delta only — feature auth-permissoes-modulo, `4c6b34f..HEAD`)
score: 7.5
findings_count: 3
cards_count: 3
---

# Fault Tolerance — Regis-Review

> Escopo `--quick`: só os diretórios tocados por `auth-permissoes-modulo` (`src/backend/http`,
> `src/backend/domain/{interface,repository,service}/auth`, `src/backend/routes`,
> `src/backend/migrations` 0066 + rollback, `src/backend/jobs/seed-admin`, `src/frontend/lib`,
> `src/frontend/components/{auth,nav,home}`, `src/frontend/app/{usuarios,...}`). Não há SQS, DLQ,
> EventBridge ou escrita a sistema externo (Conexos/Nexxera/GED) nesta feature — as tactics do
> catálogo geral do QA que dependem desses mecanismos são marcadas `N/A` com justificativa (Seção 3).
> O "financial write" mais próximo deste delta é a própria gestão de acesso: papel e permissões
> decidem quem pode disparar permutas/SISPAG/recebimentos, então corrupção de estado aqui é
> P1-adjacente, não P0 — não move dinheiro por si só.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista, na tela `/usuarios`, edita papel e exceções de outro usuário no mesmo diálogo (`EditarAcessoDialog`) | Falha de rede, timeout ou 409 da guarda R9 entre a 1ª chamada (`PATCH /usuarios/:id/papel`) e a 2ª (`PUT /usuarios/:id/permissoes`) | `AccessRepository.setRole` / `AccessRepository.replaceExceptions`, consumidos por `EditarAcessoDialog.handleSubmit` (`src/frontend/app/usuarios/EditarAcessoDialog.tsx:196-207`) | Produção, instância única do Render, uso normal (não é pico de carga) | O sistema deveria completar as duas escritas como uma unidade lógica, reverter a primeira, ou avisar explicitamente que o papel já foi salvo mas as exceções não | 0 estados "papel novo + exceções antigas" sem aviso ao operador; 100% dos saves compostos tratados atomicamente ou com compensação — hoje: 0/1 (ver F-fault-tolerance-1) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas guardadas (R9) envolvidas em transação única com o evento de trilha no mesmo commit | 4/4 (`setRole`, `replaceExceptions`, `deactivateGuarded`, `create`) | 100% | ✅ | `src/backend/domain/repository/auth/AccessRepository.ts:230-315`, `src/backend/domain/repository/auth/UserRepository.ts:164-217,301-323` |
| Caminhos de escrita de acesso com evento persistido em `app_user_access_event` | 4/5 — falta `UserRepository.upsertAdmin` (job `seed-admin`) | 100% | ⚠️ | `src/backend/domain/repository/auth/UserRepository.ts:382-397` (sem `recordEvent`) vs. `:164-217,230-267,274-315,301-323` (com `recordEvent`) |
| Edição composta "papel + exceções" (`EditarAcessoDialog`) coberta por 1 transação/endpoint atômico | 0/1 — 2 chamadas HTTP sequenciais, 2 transações Postgres independentes, sem compensação | 1 operação atômica OU rollback explícito | ❌ | `src/frontend/app/usuarios/EditarAcessoDialog.tsx:196-207`; endpoints `src/backend/routes/usuarios.ts:182-233` |
| Testes que exercitam a falha da 2ª chamada quando a 1ª já comitou (papel+exceções no mesmo submit) | 0/8 casos em `editar-acesso-dialog.test.tsx` | ≥1 | ❌ | `src/frontend/__tests__/editar-acesso-dialog.test.tsx` (casos cobrem só-papel ou só-exceções isoladamente; o caso 409 mockado nem muda o papel) |
| Corridas concorrentes na guarda R9 (dois gestores tentando remover um ao outro) | 10/10 serializadas: 1 sucesso + 1 `LastUserManagerError` | 100% | ✅ | `_shared-metrics.md` (validação ao vivo, Postgres 16 descartável) |
| Guarda de migração 0066 (aborta antes de qualquer DDL se houver `role <> 'admin'`) | Confirmado ao vivo, mensagem em português com os usuários fora do padrão | Presente | ✅ | `src/backend/migrations/0066_auth_permissoes_modulo.sql:29-41`; `_shared-metrics.md` |
| Idempotência da migração 0066 (reaplicação) | Reaplicada sobre banco já migrado: sem erro, sem duplicar | 100% | ✅ | `_shared-metrics.md` ("Migrations do zero (67) + reaplicação da 0066: idempotente") |
| Cobertura de guard único por rota autenticada (self-test) | 85/85 rotas, 1 guard cada, 346 casos comportamentais | 100% | ✅ | `src/backend/http/routePermissions.test.ts`; `_shared-metrics.md` |
| Fail-closed do `AccessService` (erro de repositório não é cacheado, nunca libera por não saber) | Confirmado por leitura de código; erro propaga para o middleware responder 503 | Fail-closed | ✅ | `src/backend/domain/service/auth/AccessService.ts:62-92` (comentário: "Erro do repositório PROPAGA e não é cacheado") |
| Perda de dados no reverse da 0066 (`app_user_access_event`) | Documentada, não automatizada — exige `\copy` manual antes de rodar o rollback | Backup automatizado ou aceitação explícita | ⚠️ | `src/backend/migrations/rollbacks/0066_auth_permissoes_modulo.rollback.sql:7-9` |
| Idempotent replay das escritas guardadas (reenviar o mesmo alvo = no-op, sem duplicar evento) | 3/3 (`setRole`, `replaceExceptions`, `deactivateGuarded` retornam `UNCHANGED`/`DEACTIVATED` sem `UPDATE` nem `recordEvent` extra) | 100% | ✅ | `src/backend/domain/repository/auth/AccessRepository.ts:253-254,289-291`; `UserRepository.ts:311-312` |

> ⚠️ **Não medível localmente**: latência real / comportamento sob múltiplas instâncias Render
> (`numInstances > 1`) do cache de 30s do `AccessService` — requer produção com mais de uma
> instância; hoje é 1 (`render.yaml`, `plan: starter`). A própria ADR-0053 já registra a ressalva.
> ⚠️ **Fora de escopo desta feature**: filas SQS, DLQ, EventBridge, reconciliação contra Conexos —
> nenhum desses mecanismos existe nos diretórios tocados por `auth-permissoes-modulo`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution / Replacement | N/A — feature síncrona HTTP, sem componente redundante a substituir | N/A | justificativa: sem infra redundante no escopo |
| Predictive Model | N/A — sem previsão de carga/falha nesta feature | N/A | — |
| Increase Competence Set | Zod na borda (`accessRowSchema`, `roleRowSchema`) recusa linha torta do banco em vez de mapear às cegas | ✅ presente | `src/backend/domain/repository/auth/AccessRepository.ts:123-138` |
| Sanity Checking | `EffectivePermissionCalculator` descarta valores fora do catálogo (`ignoradas`) sem lançar, e loga aviso — nunca derruba a resolução de acesso por um valor legado no banco | ✅ presente | `src/backend/domain/service/auth/EffectivePermissionCalculator.ts:36-53`; `AccessService.ts:74-81` |
| Comparison | Teste de introspecção compara o conjunto de rotas montadas com a tabela esperada (rota nova sem guard falha nomeando a rota) | ✅ presente | `src/backend/http/routePermissions.test.ts` |
| Timestamp | `app_user_access_event.em` (`DEFAULT now()`) ordena a trilha | ✅ presente | `src/backend/migrations/0066_auth_permissoes_modulo.sql:80-91` |
| Timeout | `lock_timeout`/`statement_timeout` na migração; sem timeout explícito dentro do fluxo HTTP síncrono desta feature (não há chamada a serviço externo neste delta) | ⚠️ parcial | `src/backend/migrations/runMigrations.ts:32,50` (pré-existente, não tocado por este delta) |
| Condition Monitoring | Guarda R9 recalcula o estado efetivo ANTES de aceitar a escrita (simula o depois e confere `usuarios:gerenciar`) | ✅ presente | `src/backend/domain/repository/auth/AccessRepository.ts:332-372` |
| Self-Test | `seed-admin` falha alto e nomeado se o papel `Administrador` não existir (0066 não aplicada) | ✅ presente | `src/backend/jobs/SeedAdminConfig.ts:51-61`, `seed-admin.ts` |
| Voting | N/A — decisão de acesso é de uma única fonte de verdade (o banco), não há quórum | N/A | por desenho (I1 da ADR-0053) |
| Redundancy | N/A — instância única (Render `plan: starter`), sem réplica a coordenar | N/A | `_shared-metrics.md` |
| Recovery (forward) | 409 tipado devolvido inline, diálogo continua aberto, usuário pode corrigir e reenviar | ✅ presente | `src/frontend/app/usuarios/EditarAcessoDialog.tsx:184-208`; testes de 409 inline |
| Recovery (backward / rollback) | `withTransaction` faz `ROLLBACK` em qualquer exceção dentro de UMA escrita guardada; **não existe rollback entre as DUAS chamadas** do diálogo composto | ⚠️ parcial | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:175-196` (ok) vs. F-fault-tolerance-1 (gap) |
| Reintroduction (Shadow/Resync/Escalating Restart) | N/A — não há processo a reintroduzir nesta feature (sem worker/job de longa duração) | N/A | — |
| Rollback (schema) | Script de reverse dedicado, documentado, com ordem de aplicação e o que se perde | ✅ presente (com ressalva P3) | `src/backend/migrations/rollbacks/0066_auth_permissoes_modulo.rollback.sql` |
| Repair State | `EffectivePermissionCalculator` tolera lixo no pacote/exceções sem quebrar o cálculo (loga e ignora) | ✅ presente | `EffectivePermissionCalculator.ts:36-53` |
| Idempotent Replay | Reenviar a mesma escrita (mesmo papel, mesmo conjunto de exceções, desativar já desativado) é no-op: sem `UPDATE`, sem evento duplicado | ✅ presente | `AccessRepository.ts:253-254,289-291`; `UserRepository.ts:311-312` |
| Compensating Transaction | Não existe entre `atribuirPapel` e `definirExcecoes`; a mitigação de fato é a idempotência de cada chamada isolada (retry seguro), não uma compensação da 1ª pela falha da 2ª | ❌ ausente | F-fault-tolerance-1 |
| Reconcile | N/A — não há sistema externo (Conexos/Nexxera) escrito por esta feature para reconciliar | N/A | escopo é só `app_user`/`app_role`/trilha local |
| Quarantine | N/A — sem fila/DLQ nesta feature | N/A | — |

## 4. Findings (achados)

### F-fault-tolerance-1: Edição composta "papel + exceções" não é atômica nem tem compensação

- **Severidade**: P1
- **Tactic violada**: Compensating Transaction / Recovery (backward)
- **Localização**: `src/frontend/app/usuarios/EditarAcessoDialog.tsx:196-207`; `src/backend/routes/usuarios.ts:182-233`; `src/backend/domain/repository/auth/AccessRepository.ts:230-268` (setRole), `:274-315` (replaceExceptions)
- **Evidência (objetiva)**:
  ```ts
  // EditarAcessoDialog.tsx:196-207
  setSaving(true)
  setErro(null)
  try {
      if (papelMudou && papelId !== undefined) await atribuirPapel(alvo.id, papelId)
      if (excecoesMudaram) await definirExcecoes(alvo.id, novas)
      toast.success(`Acesso de ${alvo.username} atualizado.`)
      onClose()
      onSaved()
  } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao salvar o acesso.')
  } finally {
      setSaving(false)
  }
  ```
  `atribuirPapel` e `definirExcecoes` chamam dois endpoints (`PATCH /usuarios/:id/papel`,
  `PUT /usuarios/:id/permissoes`), cada um sua própria `withTransaction`. Não há um terceiro
  endpoint combinado nem uma chamada que desfaça a primeira se a segunda falhar. Em
  `src/frontend/__tests__/editar-acesso-dialog.test.tsx`, os 8 testes do arquivo cobrem "só papel
  muda" (linha 150-157) e "só exceções mudam" (linha 124-140) **isoladamente**; o único teste de 409
  (linha 167-181) mantém `alvo.papel = { id: 1, ... }` igual ao papel escolhido, então
  `papelMudou` é `false` e `atribuirPapel` nunca é chamado nesse teste — **0 dos 8 casos** exercitam
  "papel muda E exceções mudam no mesmo submit" ou "a 1ª chamada comita e a 2ª falha".
- **Impacto técnico**: se `atribuirPapel` retorna 200 e a rede cai (ou `definirExcecoes` recebe um
  409 da guarda R9, que é reavaliada do zero sobre o estado JÁ COMMITADO do novo papel, sem
  conhecer a exceção pendente que compensaria a perda de `usuarios:gerenciar`), o usuário-alvo fica
  com o papel novo persistido e as exceções antigas — um estado que o analista nunca pediu, sem
  toast de sucesso e sem indicação de que a 1ª escrita já valeu. Como a ordem é sempre papel→exceções
  (nunca o inverso), uma edição legítima que reatribui papel E adiciona uma exceção
  `usuarios:gerenciar: conceder` para compensar pode ser recusada por 409 no passo 1 mesmo sendo
  segura no estado final combinado.
- **Impacto de negócio**: a tela de usuários é o único ponto de controle de quem executa Permutas/
  SISPAG/Recebimentos; um estado intermediário não sinalizado pode deixar um usuário
  temporariamente com mais ou menos acesso do que o analista pretendia, descoberto só na próxima
  auditoria da trilha. Baixo volume (≈15 usuários, ação rara), mas sem rede de segurança automática.
- **Métrica de baseline**: 0/1 edição composta coberta por transação única; 0/8 testes do diálogo
  cobrem o cenário combinado ou a falha intercalada.

### F-fault-tolerance-2: `upsertAdmin` (job `seed-admin`) muda papel/ativo sem gravar na trilha de acesso

- **Severidade**: P1
- **Tactic violada**: Condition Monitoring / auditabilidade do estado (invariante D7 da ADR-0053)
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts:382-397`
- **Evidência (objetiva)**:
  ```ts
  public upsertAdmin = async (email: string, passwordHash: string): Promise<void> => {
      const role = await this.accessRepository
          .findRoleByName(ADMIN_ROLE_NAME)
          .catch((error: unknown) => this.rethrowMissingRoleTable(error));
      if (!role) throw new AdminRoleMissingError();

      await this.databaseClient.insert(
          `INSERT INTO app_user (username, email, password_hash, role_id, ativo)
           VALUES ($email, $email, $passwordHash, $roleId, true)
           ON CONFLICT (username) DO UPDATE SET
              password_hash = EXCLUDED.password_hash,
              role_id = EXCLUDED.role_id,
              email = EXCLUDED.email,
              ativo = true`,
          { email, passwordHash, roleId: role.id },
      );
  };
  ```
  Nenhuma chamada a `this.accessRepository.recordEvent(...)`. Comparar com os 4 outros
  caminhos de escrita de acesso desta mesma classe/arquivo (`create` em `UserRepository.ts:164-217`,
  `setRole`/`replaceExceptions` em `AccessRepository.ts:230-315`, `deactivateGuarded` em
  `UserRepository.ts:301-323`), todos com `recordEvent` na mesma transação. O teste
  `AccessRepository.test.ts:406-413` só confere que a trilha não recebe `UPDATE`/`DELETE`; não
  confere que todo caminho de escrita grava um `INSERT` nela, então esta lacuna passa despercebida
  pelos gates verdes.
- **Impacto técnico**: rodar `npm run seed-admin` reatribui `role_id` e reativa (`ativo = true`) a
  conta do admin de bootstrap sem deixar rastro em `app_user_access_event` — reativar uma conta
  desativada é exatamente o tipo de evento que a ADR-0053 (D7) diz que deve ser trilhado ("uma
  linha por escrita efetiva"). Esta é a única escrita de acesso do delta que não passa pela
  `AccessRepository`.
- **Impacto de negócio**: a trilha de acesso é o artefato de auditoria de quem mudou o quê e quando
  (requisito cruzado com Security); um re-seed em produção que reativa/reatribui papel do admin
  fica invisível para quem lê só a trilha, quebrando a garantia "toda mudança de acesso é
  trilhada" justamente na conta mais privilegiada.
- **Métrica de baseline**: 4/5 caminhos de escrita de acesso gravam evento; 1/5 (`upsertAdmin`) não.

### F-fault-tolerance-3: Perda da trilha de acesso no reverse da 0066 depende de passo manual não testado

- **Severidade**: P3
- **Tactic violada**: Recovery (backward) / Repair State
- **Localização**: `src/backend/migrations/rollbacks/0066_auth_permissoes_modulo.rollback.sql:7-9`
- **Evidência (objetiva)**:
  ```sql
  -- O QUE SE PERDE: a trilha de acesso (`app_user_access_event`) gravada desde o deploy é perdida,
  -- junto com as exceções por usuário e os papéis. Se a trilha importar, exporte-a antes:
  --   \copy app_user_access_event TO 'trilha-acesso.csv' CSV HEADER
  ```
  O `\copy` está documentado em comentário, não executado automaticamente pelo script nem coberto
  por teste (o `rollbacks.test.ts` desta branch só cresce 3 linhas, sem cobrir o export).
- **Impacto técnico**: um operador sob pressão (rollback é sempre reativo a um incidente) pode pular
  o `\copy` e perder a trilha de auditoria de todo o período em que a 0066 esteve no ar.
- **Impacto de negócio**: gap de auditoria retroativo, relevante para Security/compliance, não para
  disponibilidade — é decisão consciente e documentada (forward-recovery explícito), não descoberta
  aqui pela primeira vez.
- **Métrica de baseline**: 1 passo manual (`\copy`) não automatizado, 0 testes cobrindo sua execução.

## 5. Cards Kanban

### [fault-tolerance-1] Tornar atômica (ou compensada) a edição composta de acesso

- **Problema**
  > `EditarAcessoDialog` salva papel e exceções como duas chamadas HTTP sequenciais e
  > independentes (`atribuirPapel` então `definirExcecoes`), cada uma com sua própria transação.
  > Falha na 2ª depois da 1ª já ter comitado deixa o usuário-alvo com papel novo e exceções antigas,
  > sem aviso de sucesso parcial; nenhum dos 8 testes do diálogo cobre esse caminho.

- **Melhoria Proposta**
  > Tactic alvo: Compensating Transaction. Opção A (preferida): endpoint único
  > `PUT /usuarios/:id/acesso { papelId?, excecoes? }` que chama `setRole` e `replaceExceptions`
  > dentro da MESMA `withTransaction` (reaproveitando `lockAndCheck` uma única vez, simulando o
  > estado final combinado antes de decidir o 409 — resolve também o falso-positivo de sequência).
  > Opção B (mínima): se o combinado não for viável neste ciclo, o diálogo deve, ao falhar a 2ª
  > chamada após a 1ª ter sucesso, reverter explicitamente a 1ª (`atribuirPapel(alvo.id, alvo.papel.id)`)
  > antes de mostrar o erro — e o teste correspondente precisa existir.

- **Resultado Esperado**
  > Edição composta 0/1 atômica → 1/1 atômica (ou com compensação testada); testes do diálogo
  > cobrindo o cenário combinado e a falha intercalada: 0/8 → ≥2/9.

- **Tactic alvo**: Compensating Transaction
- **Severidade**: P1
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Edições compostas cobertas por transação única ou compensação testada: 0/1 → 1/1
  - Testes do diálogo cobrindo papel+exceções no mesmo submit: 0/8 → ≥1
- **Risco de não fazer**: em 6 meses, com mais papéis reais na Columbia (a ADR já prevê recorte por
  frente), edições compostas ficam mais comuns; o estado intermediário some na rotina até um
  incidente de acesso indevido forçar a investigação da trilha.
- **Dependências**: nenhuma — pode ser feito como `/feature-tweak` isolado sobre `usuarios.ts` e
  `AccessRepository`.

### [fault-tolerance-2] Trilhar a reativação/reatribuição de papel feita pelo `seed-admin`

- **Problema**
  > `UserRepository.upsertAdmin` (usado pelo job `seed-admin`) muda `role_id` e `ativo` via `INSERT
  > ... ON CONFLICT` cru, sem chamar `AccessRepository.recordEvent`. É o único, dos 5 caminhos de
  > escrita de acesso do delta, que não grava na trilha `app_user_access_event`.

- **Melhoria Proposta**
  > Tactic alvo: Condition Monitoring (fechar a lacuna do invariante D7 da ADR-0053). Envolver o
  > `INSERT ... ON CONFLICT` em `withTransaction`, comparar o estado antes/depois (papel e `ativo`)
  > e chamar `this.accessRepository.recordEvent(tx, { actor: 'seed-admin', ... })` quando algo
  > mudar — mesmo padrão de `create`/`setRole`. Ator fixo `'seed-admin'` (não há usuário logado
  > nesse contexto de CLI).

- **Resultado Esperado**
  > Caminhos de escrita de acesso com evento persistido: 4/5 → 5/5. Reset/reativação do admin de
  > bootstrap em produção passa a aparecer na trilha como qualquer outra mudança de acesso.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Caminhos de escrita de acesso com `recordEvent`: 4/5 → 5/5
- **Risco de não fazer**: um re-seed em produção (troca de senha/reativação do admin) continua
  invisível na trilha de auditoria, justamente na conta mais privilegiada do sistema.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Automatizar (ou testar) o export da trilha antes do rollback da 0066

- **Problema**
  > O reverse da 0066 derruba `app_user_access_event` sem confirmação; o `\copy` que preserva a
  > trilha é só um comentário no script, não executado nem testado.

- **Melhoria Proposta**
  > Tactic alvo: Recovery (backward) documentada e assistida. Adicionar ao próprio
  > `.rollback.sql` um passo que falha alto se a tabela tiver linhas e nenhuma flag de
  > "já exportei" for passada (ex.: variável de sessão), ou mover o `\copy` para um script wrapper
  > (`npm run migrate:rollback -- 0066`) que sempre exporta antes de aplicar.

- **Resultado Esperado**
  > Passo de export deixa de depender de o operador lembrar do comentário: 0 automatizado → 1
  > automatizado ou obrigatório.

- **Tactic alvo**: Recovery (backward)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Export da trilha antes do rollback: manual/comentado → automatizado ou bloqueante
- **Risco de não fazer**: perda silenciosa da trilha de auditoria num rollback feito sob pressão de
  incidente — baixo, porque é cenário raro (só entre o deploy do backend novo e a decisão de
  reverter), mas o custo de corrigir agora é de horas.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito à feature (`--quick`): tactics de fila/SQS/DLQ/reconciliação contra Conexos
  marcadas `N/A` — não existem nos diretórios tocados por `auth-permissoes-modulo`. Não avaliei o
  pipeline financeiro geral (fora de escopo deste run).
- F-fault-tolerance-1 e F-fault-tolerance-2 cruzam com Security (auditabilidade do trilho D7) e com
  Testability (cobertura de cenário combinado/falha intercalada no `EditarAcessoDialog` — sinalizar
  ao `qa-testability`).
- Não medi latência do cache de 30s do `AccessService` sob múltiplas instâncias (hoje 1 instância);
  a própria ADR-0053 já registra a ressalva — cross-ref `qa-availability`/`qa-performance`.
- Validação ao vivo de concorrência (10/10 corridas) e da guarda de migração vieram de
  `_shared-metrics.md` (Postgres descartável), não reexecutei localmente neste run `--quick`.
