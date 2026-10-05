# Tasks: sispag-excecao-destino

**Spec source:** ontology/_inbox/sispag-excecao-destino-diff-proposal.md (+ ontology/_inbox/sispag-excecao-gap.md, ADR-0061)
**Ontology diff:** yes — `ontology/decisions/0061-excecao-de-destino-sispag-cadastro-primeiro.md`, `ontology/entities/excecao-destino.md`, `ontology/state-machines/excecao-destino.md`, `ontology/business-rules/excecao-destino-sispag.md` (I12a-i), `ontology/actions/sispag/*excecao*.md` (6), `ontology/business-rules/destino-pagamento-sispag.md`, `ontology/entities/lote-pagamento.md`, `ontology/entities/usuario.md`, `ontology/state-machines/lote-pagamento.md`
**Estimated scope:** L (1 migration, 1 regra, 1 repository, 1 service, resolver/finalizar/envio ajustados, rotas, frontend com tela nova; carga em planilha bloqueada)

> **Regras transversais (valem para toda task):**
> - Nada escreve no `cmn025`. O envio do destino do item ao `fin015` continua como está (I10f, destino congelado).
> - Flag `SISPAG_EXCECAO_DESTINO_ENABLED` (alias `SISPAG_DESTINO_MANUAL_ENABLED` por um ciclo), default `false`, lida só via `EnvironmentProvider`. Desligada: comportamento idêntico ao `main` sem destino manual.
> - Conta/chave nunca em claro em log, `LogService.data`, mensagem de erro ou payload de remessa; só mascarada (`MaskDestino`).
> - Identificadores em inglês; logs e mensagens ao operador em português. Classes exportadas, métodos arrow, modificadores explícitos, Zod nas bordas, SQL parametrizado, `@injectable()`/`@singleton()`.
> - Migration: próximo número livre é **0075** (worktree e `origin/main`, último = `0074`). Reconfirmar antes do commit; conferir que o `.sql` aparece em `dist/` no `npm run build`.
> - Sem bump de versão aqui (é no Ship).
> - As Tasks 2-6 de `sispag-ted-pix-tasks.md` (destinoManual por item e aprovação por item) ficam superadas por este arquivo.

## Task list

### Task 1: Q4 — contagem read-only de `destino_manual` e da trilha em produção
**Files to change:**
- `src/backend/jobs/probe-destino-manual-uso.ts` (novo, somente leitura)

**Acceptance criteria:**
- [ ] Script usa o `.env` local do financeiro (não o MCP Supabase), só `SELECT`, e imprime contagens: itens com `destino_manual` não nulo, linhas de `lote_pagamento_item_destino_audit`, lotes RASCUNHO abertos com destino manual
- [ ] Nenhum valor de conta/chave é impresso (só contagens e ids de lote)
- [ ] Resultado registrado em `ontology/_inbox/sispag-excecao-gap.md` (Q4) e decide o ramo da Task 2 (0 = coluna inerte; >0 = conversão em `PENDENTE`, nunca `APROVADA`, deduplicada por favorecido+tipo)

**Dependencies:** none

---

### Task 2: Migration 0075 — `excecao_destino`, trilha só-inclusão, permissão `sispag:excecao`
**Files to change:**
- `src/backend/migrations/0075_sispag_excecao_destino.sql`
- `src/backend/migrations/0075_sispag_excecao_destino.test.ts`
- `src/backend/migrations/0075_sispag_excecao_destino.integration.test.ts`
- `src/backend/migrations/MigrationFiles.ts` (somente se o manifesto exigir)

**Tests to write first (TDD):**
- `.test.ts` (estático, padrão 0068): contém `CREATE TABLE excecao_destino`, índice único parcial `(pes_cod, tipo) WHERE estado = 'APROVADA'`, `CHECK` de estado nos 5 valores, `CHECK` de tipo (`CONTA` | `CHAVE_PIX`), trigger bloqueando `UPDATE`/`DELETE` na trilha, `CHECK` de permissão com `sispag:excecao` e sem `sispag:aprovar_destino`
- `.integration.test.ts`: `UPDATE`/`DELETE` em `excecao_destino_audit` falha; segunda `APROVADA` para o mesmo (pes_cod, tipo) falha; concessão existente de `sispag:aprovar_destino` em `app_role_permission` e `user_permission` vira `sispag:excecao` (idempotente, rodar duas vezes não duplica); `aprovado_por <> cadastrado_por` também como `CHECK` de defesa em profundidade quando `estado = 'APROVADA'`

**Acceptance criteria:**
- [ ] Tabela `excecao_destino`: favorecido (`pes_cod`), `tipo`, destino (colunas de conta ou chave CPF/CNPJ), `estado`, `origem` (`MANUAL` | `PLANILHA`), `carga_id` nulo, `cadastrado_por`, `aprovado_por` nulo, timestamps, motivo de rejeição/revogação
- [ ] `excecao_destino_audit` só-inclusão, com trigger (mesmo padrão de `lote_pagamento_item_destino_audit`); eventos: cadastro, aprovação, rejeição, revogação, substituição, `DIVERGENCIA_CADASTRO`, uso
- [ ] Permissões: `app_role_permission` e `user_permission` com `CHECK` atualizado; concessões antigas convertidas; papel Administrador recebe `sispag:excecao`; Analista continua sem ela
- [ ] Ramo Q4: se contagem > 0, converte `destino_manual` em `PENDENTE` (dedup favorecido+tipo); se 0, apenas cria. Coluna `destino_manual` fica inerte (sem DROP nesta migration)
- [ ] Idempotente (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`); sem reverse destrutivo documentado
- [ ] `cd src/backend && npm run typecheck` passa

**Dependencies:** Task 1

---

### Task 3: Permissão `sispag:excecao` nos catálogos (backend e frontend)
**Files to change:**
- `src/backend/domain/interface/auth/Permission.ts`
- `src/backend/domain/service/auth/EffectivePermissionCalculator.test.ts`
- `src/frontend/lib/permissoes.ts`
- `src/frontend/__tests__/permissoes-api.test.ts`
- `src/frontend/app/perfil/alvo.test.ts`

**Tests to write first (TDD):**
- Catálogo expõe `SISPAG_EXCECAO = 'sispag:excecao'` e não expõe mais `SISPAG_APROVAR_DESTINO`
- Cálculo efetivo: Administrador tem; Analista não tem; exceção por usuário `conceder` funciona

**Acceptance criteria:**
- [ ] Nenhuma referência restante a `aprovar_destino` em `src/` (grep vazio, exceto migrations antigas)
- [ ] `typecheck` backend e frontend passam

**Dependencies:** Task 2

---

### Task 4: Regra de domínio `ExcecaoDestinoRule` (aprovador diferente do cadastrante, falha fechada)
**Files to change:**
- `src/backend/domain/libs/sispag/ExcecaoDestinoRule.ts` (novo)
- `src/backend/domain/libs/sispag/ExcecaoDestinoRule.test.ts` (novo)
- `src/backend/domain/errors/` (erros: `ExcecaoAprovacaoProprioCadastranteError`, `ExcecaoSemPermissaoError`, `ExcecaoTitularidadeError`, `ExcecaoEstadoInvalidoError`)
- `src/backend/domain/interface/sispag/SispagInterface.ts` (tipos `ExcecaoDestino`, estados, tipos)

**Tests to write first (TDD):**
- `aprovadoPor === cadastradoPor` lança `ExcecaoAprovacaoProprioCadastranteError`; ids ausentes/vazios/indefinidos também lançam (falha fechada, nunca presume diferente)
- Máquina de estados: só `PENDENTE → APROVADA | REJEITADA`; `APROVADA → REVOGADA | SUBSTITUIDA`; qualquer outra transição lança; terminais não saem
- Cadastrante pode rejeitar a própria `PENDENTE`; qualquer titular de `sispag:excecao` pode revogar `APROVADA`, inclusive o cadastrante
- PIX: só chave do tipo CPF/CNPJ igual ao `pdcDocFederal` (só dígitos); qualquer outro tipo de chave rejeitado; TED e PIX ambos exigem aprovação (sem isenção do PIX, diferente de ADR-0054 D11)
- Comparação de titularidade usa documento normalizado (só dígitos), nunca loga o valor

**Acceptance criteria:**
- [ ] Classe `@injectable()`, métodos arrow, sem I/O (pura)
- [ ] `DestinoManualValidator` reaproveitado para formato; `DestinoAprovacaoRule` marcada para remoção na Task 6
- [ ] `npm test -- ExcecaoDestinoRule` passa

**Dependencies:** Task 3

---

### Task 5: Repository `ExcecaoDestinoRepository` (SQL parametrizado + trilha)
**Files to change:**
- `src/backend/domain/repository/sispag/ExcecaoDestinoRepository.ts` (novo)
- `src/backend/domain/repository/sispag/ExcecaoDestinoRepository.test.ts` (novo)
- `src/backend/domain/repository/sispag/ExcecaoDestinoRepository.integration.test.ts` (novo)

**Tests to write first (TDD):**
- `insert`, `transition` (com `WHERE estado = $esperado`, retorno 0 linhas = `ExcecaoEstadoInvalidoError`), `findAprovada(pesCod, tipo)`, `list` com filtro por estado/favorecido, `appendAudit`
- Aprovar move a `APROVADA` anterior do mesmo (favorecido, tipo) a `SUBSTITUIDA` na mesma transação, com trilha dos dois eventos
- Valor completo só no banco; `list` devolve já mascarado

**Acceptance criteria:**
- [ ] Todo SQL com `$1..$n`; nenhuma interpolação (PatternGuardian)
- [ ] Transição + trilha na mesma transação (atomicidade testada com falha forçada na trilha)

**Dependencies:** Task 4

---

### Task 6: Resolver, finalizar-lote e envio — cadastro primeiro, depois exceção `APROVADA`
**Files to change:**
- `src/backend/domain/service/sispag/DestinoPagamentoResolver.ts` (+ `.test.ts`)
- `src/backend/domain/service/sispag/LotePagamentoService.ts` (+ `.test.ts`)
- `src/backend/domain/service/sispag/RemessaService.ts` (+ `.test.ts`)
- `src/backend/domain/libs/sispag/DestinoAprovacaoRule.ts` e `.test.ts` (remover)
- `src/backend/domain/libs/environment/model/EnvironmentVars.ts`, `EnvironmentProvider.ts` e `.test.ts` (flag nova com alias)

**Tests to write first (TDD):**
- Ordem: cadastro `cmn025` ativo vence; sem cadastro válido usa exceção `APROVADA`; `PENDENTE`/`REJEITADA`/`REVOGADA`/`SUBSTITUIDA` nunca resolvem
- Cadastro válido + exceção `APROVADA` → exceção vira `SUBSTITUIDA` automaticamente, nunca usada; valor diferente grava `DIVERGENCIA_CADASTRO` (mascarado) e emite `Alerta`; igual grava só a substituição
- `finalizarLote` barra item TED/PIX sem destino resolvível (falha fechada, erro em português com a chave do item, sem valor do destino)
- `RemessaService` reconfere ao vivo antes do `criarLote` (cadastro primeiro, depois exceção + titularidade I10i); item que deixou de resolver (revogada entre finalizar e envio) bloqueia o envio daquele item
- Flag desligada: sem leitura de exceção; paridade com `main`
- `destinoManual` por item não é mais lido nem gravado; `aprovarDestinoManualItem` removido

**Acceptance criteria:**
- [ ] Uso da exceção grava evento `USO` na trilha sem valor em claro
- [ ] Destino congelado no item ao importar no `fin015` (I10f) preservado; revogar depois não reescreve (I12g)
- [ ] Definição de "cadastro válido" = conta/chave ATIVA ao vivo (mesma função da I10), conforme proposta de Q3 (confirmar com o Yuri; ver riscos)
- [ ] `npm test` do backend passa

**Dependencies:** Task 5

---

### Task 7: Service `ExcecaoDestinoService` e job de aposentadoria
**Files to change:**
- `src/backend/domain/service/sispag/ExcecaoDestinoService.ts` (+ `.test.ts`) — `registrar`, `aprovar`, `rejeitar`, `revogar`, `listar`, `aposentarSubstituidas`
- `src/backend/jobs/aposentar-excecoes-substituidas.ts` (novo, manual/GH Actions, sem scheduler próprio)
- `src/backend/domain/service/sispag/ExcecaoDestinoService.integration.test.ts`

**Tests to write first (TDD):**
- `registrar` valida formato (Zod + `DestinoManualValidator`), lê titularidade ao vivo (I10i), cria `PENDENTE`, nunca `APROVADA`
- `aprovar` com o mesmo usuário do cadastrante é negado no service, independente da UI; reconfere I10i
- `rejeitar`/`revogar` exigem motivo
- `aposentarSubstituidas` é idempotente e usa a mesma função de cadastro válido da Task 6

**Acceptance criteria:**
- [ ] Todo método gera `LogService` em português com id da exceção, favorecido e ator; nunca conta/chave
- [ ] Job lê env estreito (padrão do `detect-staleness`), não depende de `bootstrapAppContainer` ampliado (Gotcha do CLAUDE.md)
- [ ] ObservabilityAdvisor: o job novo é considerado (ver Task 11)

**Dependencies:** Task 6

---

### Task 8: Rotas Express de exceções
**Files to change:**
- `src/backend/routes/sispag.ts` (remover rotas `.../destino` e `.../destino/aprovar` por item; adicionar `/sispag/excecoes`)
- `src/backend/routes/sispag.test.ts`
- `src/backend/http/` (schemas Zod de body, se for o padrão local)

**Tests to write first (TDD):**
- `GET /sispag/excecoes` (filtros), `POST /sispag/excecoes`, `POST /sispag/excecoes/:id/aprovar`, `.../rejeitar`, `.../revogar`; todos com `exigirPermissao(PERMISSION.SISPAG_EXCECAO)` (`sispag:ver` para o GET, escolhido conforme a regra de visibilidade da Task 9)
- 400 para body inválido sem eco do valor; 403 sem permissão ou flag; 409 estado inválido; 403 específico para aprovar a própria
- Resposta sempre mascarada; `GET /sispag/recursos` expõe a flag nova como booleano

**Acceptance criteria:**
- [ ] Nenhum endpoint devolve conta/chave em claro
- [ ] `ator(req)` usa o id do usuário autenticado (não o body)
- [ ] `typecheck`, `lint` e testes das rotas passam

**Dependencies:** Task 7

---

### Task 9: Frontend — substituir `InformarDestinoDialog`, tela de exceções e aprovação
**Files to change:**
- `src/frontend/app/sispag/components/InformarDestinoDialog.tsx` e `.test.tsx` (removidos ou reduzidos a "cadastrar exceção para este favorecido")
- `src/frontend/app/sispag/components/LoteCard.tsx` e `.test.tsx` (selo "sem destino: aguardando exceção" no lugar do selo de aprovação por item; link para a tela de exceções)
- `src/frontend/app/sispag/excecoes/page.tsx` (novo) + `components/ExcecoesTable.tsx`, `CadastrarExcecaoDialog.tsx`, `AprovarExcecaoDialog.tsx`, `RevogarExcecaoDialog.tsx` (+ testes)
- `src/frontend/lib/sispag.ts`

**Tests to write first (TDD):**
- Lista por estado; ação "Aprovar" desabilitada com tooltip quando o usuário é o cadastrante (a regra real é do backend; a UI só evita o clique inútil)
- Rejeitar/revogar exigem motivo; conta/chave sempre mascaradas; acessibilidade por teclado nos diálogos
- Sem permissão `sispag:excecao`, a tela e as ações não aparecem; flag desligada, nada aparece

**Acceptance criteria:**
- [ ] `DesignSystemReviewer` gate aprovado (frontend tocado: SIM)
- [ ] `cd src/frontend && npm run lint && npm run typecheck && npm test` passam (o gate de formato é `npm run lint`, não Prettier)

**Dependencies:** Task 8

---

### Task 10: Carga em planilha — **BLOQUEADA POR Q1 (layout não visto)**
**Files to change:**
- `src/backend/domain/service/sispag/ExcecaoDestinoCargaService.ts` (+ `.test.ts`)
- `src/backend/routes/sispag.ts` (`POST /sispag/excecoes/carga`) e `.test.ts`
- `src/frontend/app/sispag/excecoes/components/CarregarPlanilhaDialog.tsx` (+ teste)

**Acceptance criteria:**
- [ ] Só inicia após resposta de Q1 em `sispag-excecao-gap.md` (colunas, aba, chave do favorecido, distinção TED x PIX) e amostra mascarada em fixture
- [ ] Cria apenas `PENDENTE` (`origem = PLANILHA`, `cargaId`); nenhum caminho cria `APROVADA` (I12d)
- [ ] Recarga conforme Q10 (proposta: idêntica ignorada; diferente = nova `PENDENTE`, a aprovada segue valendo)
- [ ] Relatório da carga lista linhas rejeitadas por validação/titularidade, sem valores em claro
- [ ] Se Q1 não for respondida até o Ship, esta task sai do PR e vira follow-up; as Tasks 1-9 e 11-12 não dependem dela

**Dependencies:** Tasks 7, 8, 9 + resposta de Q1

---

### Task 11: Observabilidade (ObservabilityAdvisor)
**Files to change:**
- `src/backend/domain/service/sispag/ExcecaoDestinoService.ts` (campos de log)
- `src/backend/domain/service/sispag/SispagPainelService.ts` (contadores) e `.test.ts`

**Acceptance criteria:**
- [ ] ObservabilityAdvisor revisou o job `aposentar-excecoes-substituidas` e o `Alerta` `DIVERGENCIA_CADASTRO`
- [ ] Painel: contagem de exceções por estado e de exceções `PENDENTE` há mais de N dias (N definido no review), sem valores de destino
- [ ] Alerta de `DIVERGENCIA_CADASTRO` visível a quem tem `sispag:excecao` (proposta Q8; "resolver" = marcar como visto)

**Dependencies:** Task 7

---

### Task 12: Docs e ontologia
**Files to change:**
- `ontology/_index.json`, `ontology/_coverage.json` (arquivos de implementação reais), `ontology/CHANGELOG.md`
- `DEPLOY.md` (flag nova e alias; passo operacional: conceder `sispag:excecao` a uma 2a pessoa)
- `ontology/_inbox/migration-debt.md` (retirada do destino manual por item)

**Acceptance criteria:**
- [ ] `ExcecaoDestino` com `implementation_status` atualizado e `related_files` preenchido
- [ ] Nota operacional: com um único titular de `sispag:excecao`, nada é aprovado (aprovador diferente do cadastrante)

**Dependencies:** Tasks 6-9

---

## Definition of Done

All tasks complete (Task 10 pode sair como follow-up se Q1 seguir aberta) AND:
- [ ] `npm run typecheck` (backend e frontend)
- [ ] `npm run lint` (backend e frontend)
- [ ] `npm test` (backend e frontend)
- [ ] PatternGuardian gate
- [ ] entity_changed: diff em `ontology/` presente (ADR-0061 e demais)
- [ ] frontend tocado: DesignSystemReviewer gate
- [ ] novo job (`aposentar-excecoes-substituidas`): ObservabilityAdvisor review
- [ ] Ground-Truth gate: N/A (sem lógica monetária; nenhum valor, saldo ou baixa é calculado). Registrar a dispensa no relatório do loop
- [ ] AwsInfraArchitect: N/A (não existe `infra/`)
- [ ] delta com feat/fix/perf em `src/`: versão FE+BE em lockstep no Ship (sem pwsh nesta máquina: aplicar semver à mão nos dois `package.json`; conferir a versão real de `origin/main` antes) e `CHANGELOG.md` atualizado
