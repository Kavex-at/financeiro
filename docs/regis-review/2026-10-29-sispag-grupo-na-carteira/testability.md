---
qa: Testability
qa_slug: testability
run_id: 2026-10-29-sispag-grupo-na-carteira
agent: qa-testability
generated_at: 2026-10-29T00:00:00Z
scope: all
score: 7
findings_count: 5
cards_count: 5
---

# Testability — Regis-Review (delta `sispag-grupo-na-carteira`)

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev / Analista QA | Mudança nas regras I21v/I21w (sugestão de grupo entra na carteira; nunca confirma 1:1) | `MotorSugestaoBoleto`, `BoletoSuggestionService`, `CenarioGrupoBoleto`, `FormaPagamentoBadge`, `BoletosDoTituloDialog`, `GrupoBoletoPainel`, `sugestaoBoleto` | Dev / CI pré-merge | Teste de unidade determinístico cobre: boleto do grupo sai do pool 1:1; GRUPO_SUGERIDO vs manter desfechos fortes (UNICA_SEGURA, CONFIRMADA, ORFA, EM_GRUPO); reserva seguro-only; exceção de título fora do grupo; 409 no confirmar 1:1; fallback na falha de leitura; única passada do motor por cache; selo + Ver grupo + aviso de drawer + aviso de seleção na FE | ≥ 1 teste por regra, 0 flakes, `jest` verde em < 10 s por suite |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Suites BE do delta verdes | 2/2 (145 tests) | 100 % | ✅ | `npx jest MotorSugestaoBoleto.grupoSugerido BoletoSuggestionService` |
| Suites FE do delta verdes | 4/4 (75 tests) | 100 % | ✅ | `npx jest FormaPagamentoBadge BoletosDoTituloDialog GrupoBoletoPainel sugestaoBoleto` |
| Regras I21v/I21w cobertas por teste de unidade | 7/8 | 8/8 | ⚠️ | ver tabela §3 |
| Branches do catch de `gruposSugeridos` em `BoletoSuggestionService` | 1/2 (só `marcasOuNenhuma`) | 2/2 | ⚠️ | `BoletoSuggestionService.ts:1116-1134` vs `BoletoSuggestionService.test.ts:2046-2051` |
| Situações mantidas (`SITUACOES_QUE_MANTEM`) com teste | 2/4 (`UNICA_SEGURA`, `CONFIRMADA`) | 4/4 (faltam `ORFA`, `EM_GRUPO`) | ⚠️ | `MotorSugestaoBoleto.ts:166-171` vs `MotorSugestaoBoleto.grupoSugerido.test.ts:148-168` |
| Nova leitura `listTitulosEmLotesComprometidos` em `Promise.all` com fallback | ❌ sem try/catch; derruba a carteira | isolada como `marcasOuNenhuma` | ❌ | `BoletoSuggestionService.ts:1155-1172` |
| Teste de integração entre `page.tsx` seleção avulsa e `toast.warning` | ausente | ao menos 1 | ⚠️ | `src/frontend/app/sispag/page.tsx:774-778` sem teste |
| Mapeamento HTTP 409 do `BoletoSuggestionNotAvailableError` | pré-existente, continua válido | mantido | ✅ | `src/backend/domain/errors/BoletoSuggestionErrors.test.ts:49` |

## 3. Tactics — cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `MotorSugestaoBoleto` recebe `EntradaMotorSugestao` puro (sem I/O); testes injetam `GrupoSugeridoChaveado` direto | ✅ | `MotorSugestaoBoleto.grupoSugerido.test.ts:94-99` |
| Specialized Interfaces | `CenarioGrupoBoleto.montar` isolado como função pura; mesmo mock de entrada serve aba e carteira | ✅ | `GrupoBoletoService.test.ts:443-467` |
| Executable Assertions | Teste do motor afirma estado completo do desfecho (`situacao`, `grupoSugerido`, `candidatos.every(!confirmavel)`) | ✅ | `MotorSugestaoBoleto.grupoSugerido.test.ts:120-132` |
| Executable Assertions | Spy em `motorGrupo.sugerir` prova 1 passada por cache | ✅ | `BoletoSuggestionService.test.ts:2033-2043` |
| Recordable Test Cases | Caso real do PRD (RHENUS 5541/5566 → boleto 129818, R$ 26 369,85) virou fixture do motor e do service | ✅ | `MotorSugestaoBoleto.grupoSugerido.test.ts:19-82`; `BoletoSuggestionService.test.ts:1988-2007` |
| Sandbox | `BankingCalendar.withClock(() => HOJE)` fixa o tempo; `relogio` controla TTL do cache | ✅ | `BoletoSuggestionService.test.ts:38-43` |
| Abstract Data Sources | `MotorGrupoBoleto` e os repos (`bloqueioRepo`, `loteRepo`, …) todos mockados em `montar()` do suite BE; nenhum teste do delta toca Postgres | ✅ | `BoletoSuggestionService.test.ts:254-269` |
| Limit Non-Determinism | Motor é puro; teste "não muta a entrada" confere | ✅ | `MotorSugestaoBoleto.grupoSugerido.test.ts:179-184` |
| Limit Non-Determinism | `BoletoSuggestionService.sugerirAgora` acrescentou duas leituras ao `Promise.all` (`listTitulosEmLotesComprometidos`); só uma tem fallback declarado | ⚠️ | `BoletoSuggestionService.ts:1155-1172` |
| Limit Structural Complexity | O caminho de "sugestão vs manter desfecho forte" (`SITUACOES_QUE_MANTEM`) tem 4 ramos; só 2 têm teste direto | ⚠️ | `MotorSugestaoBoleto.ts:166-171` |

## 4. Findings

### F-testability-1: ramo de catch de `gruposSugeridos` nunca é exercitado pelo teste do service

- **Severidade**: P1
- **Tactic violada**: Executable Assertions / Limit Non-Determinism
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1116-1134`; teste em `BoletoSuggestionService.test.ts:2046-2051`
- **Evidência**:
  O caso "falha no motor de grupos não derruba a listagem" injeta `h.bloqueioRepo.listAtivos.mockRejectedValue(...)`. Isso cai em `marcasOuNenhuma` (returns `undefined`) e faz a service pular `this.gruposSugeridos(...)` por completo (`const gruposSugeridos = marcas ? await this.gruposSugeridos(...) : []`). O `try/catch` dentro de `gruposSugeridos` (envolvendo `motorGrupo.sugerir` + `CenarioGrupoBoleto.montar/paraMotor1a1`) **nunca executa** no suite. O nome do teste ("falha no motor de grupos") sugere que exercita esse ramo, mas não exercita.
- **Impacto técnico**: Se `motorGrupo.sugerir` lançar (ex.: `TypeError` por payload malformado, ou mudança futura em `CenarioGrupoBoleto`), a carteira cai sem que o teste perceba. Dead code de defesa.
- **Impacto de negócio**: Carteira do SISPAG indisponível na janela de fechamento, com o incidente escondido do CI.
- **Métrica de baseline**: 1/2 ramos de fallback cobertos.

### F-testability-2: `listTitulosEmLotesComprometidos` entra na carteira sem isolamento no `Promise.all`

- **Severidade**: P1
- **Tactic violada**: Limit Non-Determinism / Sandbox
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1155-1172`
- **Evidência**:
  A nova chamada `this.loteRepo.listTitulosEmLotesComprometidos()` foi adicionada ao `Promise.all` principal. Diferente de `marcasOuNenhuma`, ela **não** tem wrapper com `try/catch`. Se a query falhar, o `listarSugestoes` inteiro rejeita (regressão no caminho quente da carteira que antes nem tocava essa tabela).
  Nenhum teste do delta exercita `listTitulosEmLotesComprometidos.mockRejectedValue(...)`.
- **Impacto técnico**: SQL lento ou lock em `com298` derruba a carteira inteira; comportamento era "sugestão de grupo apaga, 1:1 segue". Hoje é "500 na página".
- **Impacto de negócio**: Durante corte do dia, a tela do SISPAG some; analista precisa recarregar sem saber o motivo.
- **Métrica de baseline**: 0 testes cobrindo rejeição de `listTitulosEmLotesComprometidos` em `sugerirAgora`.

### F-testability-3: `SITUACOES_QUE_MANTEM` para `ORFA` e `EM_GRUPO` não têm teste

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts:166-171` e `marcarGrupoSugerido` (linhas ~400-418 do arquivo pós-diff)
- **Evidência**: `SITUACOES_QUE_MANTEM` lista 4 valores (`UNICA_SEGURA`, `CONFIRMADA`, `ORFA`, `EM_GRUPO`). O suite novo cobre só `UNICA_SEGURA` (`MotorSugestaoBoleto.grupoSugerido.test.ts:148-168`) e `CONFIRMADA` (`:170-179`). Nenhum caso prova que um título **órfão** ou **em grupo confirmado** sobrepõe o selo de GRUPO_SUGERIDO — e esse é exatamente o cenário onde o selo contraditório mais dói (uma órfã silenciosamente virando GRUPO_SUGERIDO desarmaria a UI que pede "anular para liberar").
- **Impacto técnico**: Regressão trivial (um `delete SITUACOES_QUE_MANTEM.ORFA`) passaria no CI atual.
- **Impacto de negócio**: Analista veria um título órfão com rótulo "em grupo sugerido" e perderia a instrução de "anule o grupo confirmado antes".
- **Métrica de baseline**: 2/4 ramos de `SITUACOES_QUE_MANTEM` cobertos.

### F-testability-4: aviso de seleção no `page.tsx` não tem teste de integração

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/frontend/app/sispag/page.tsx:774-778` (toast.warning dentro de `toggleSelecao`)
- **Evidência**: `avisoSelecaoGrupoSugerido` tem testes unitários (`sugestaoBoleto.test.ts:159-168`), mas não existe teste do `SispagPanel` que prove que o `toast.warning` dispara ao selecionar um título com `grupoSugerido`, nem que `não` dispara ao selecionar o mesmo título já selecionado (o guard `!selecionados.has(keyOf(t))`). O comportamento Q8 fica dependente de inspeção visual.
- **Impacto técnico**: Qualquer refactor em `toggleSelecao` pode remover o toast sem alarme.
- **Impacto de negócio**: Analista seleciona avulso o 5541 (R$ 434,38 do RHENUS), gera remessa, e o grupo nunca se fecha — exatamente o defeito que a feature deveria evitar.
- **Métrica de baseline**: 0 testes de componente/página cobrindo `toggleSelecao` + grupo sugerido.

### F-testability-5: nome do teste de fallback desalinhado da realidade (ruído semântico)

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (clareza)
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.test.ts:2046-2051`
- **Evidência**: O título do teste é "falha no motor de grupos não derruba a listagem", mas o setup falha `bloqueioRepo.listAtivos` — leitura de **marcas**, não o motor. O leitor do suite vai acreditar que o motor é protegido quando não é.
- **Impacto técnico**: Falso senso de cobertura; relacionado a F-testability-1.
- **Impacto de negócio**: Nenhum direto; multiplicador para bugs futuros.
- **Métrica de baseline**: 1 teste mal rotulado.

## 5. Cards Kanban

### [testability-1] Cobrir o fallback real do motor de grupos no `BoletoSuggestionService`

- **Problema**
  > O catch de `gruposSugeridos` (que protege `motorGrupo.sugerir` + `CenarioGrupoBoleto.montar/paraMotor1a1`) nunca é exercitado pelo suite. O único teste que diz cobri-lo falha na leitura de marcas, não no motor.

- **Melhoria Proposta**
  > Acrescentar dois casos a `BoletoSuggestionService.test.ts` (seção "sugestão de grupo na carteira"): (1) `jest.spyOn(motorGrupo, 'sugerir').mockImplementation(() => { throw new Error('boom') })` → listagem volta ao 1:1, `logService.warn` chamado; (2) `jest.spyOn(CenarioGrupoBoleto, 'paraMotor1a1').mockImplementation(() => { throw ... })` → mesmo comportamento. Renomear o teste atual para "falha ao ler marcas não derruba a listagem" (ver testability-5).

- **Resultado Esperado**
  > Branches de fallback de `gruposSugeridos` cobertos 1/2 → 2/2. Garantia de que a carteira não cai mesmo com crash no motor de grupos.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1, F-testability-5
- **Métricas de sucesso**:
  - Ramos de catch cobertos: 1/2 → 2/2
  - Testes com nome fiel ao setup: n−1 → n
- **Risco de não fazer**: Um `TypeError` em `CenarioGrupoBoleto.paraMotor1a1` (p.ex. após uma mudança em `GrupoSugeridoRef`) derruba a carteira inteira em produção sem o CI gritar.
- **Dependências**: —

### [testability-2] Isolar `listTitulosEmLotesComprometidos` como `comprometidosOuNenhum` + teste de rejeição

- **Problema**
  > A nova dependência `loteRepo.listTitulosEmLotesComprometidos` entra no `Promise.all` principal sem wrapper tolerante. Qualquer falha (lock, SQL lenta, erro transitório) rejeita toda a listagem, regredindo o comportamento histórico da carteira.

- **Melhoria Proposta**
  > Espelhar `marcasOuNenhuma`: criar `comprometidosOuNenhum()` que loga `warn` e retorna `[]`, e tratar `[]` como "sem comprometidos" (grupo sugerido pode ser desligado nesta execução). Adicionar teste `h.loteRepo.listTitulosEmLotesComprometidos.mockRejectedValue(...)` que afirma que (a) listagem segue com 1:1, (b) `logService.warn` chamado, (c) `grupoSugerido` ausente nos títulos.

- **Resultado Esperado**
  > Falha de 1 das 2 leituras novas do grupo deixa de ser falha global: cobertura de 1/2 → 2/2 "soft-degrade reads" na `sugerirAgora`.

- **Tactic alvo**: Limit Non-Determinism / Sandbox
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Testes BE do delta: 10 → 11
  - Falhas em `listTitulosEmLotesComprometidos` que derrubam a carteira: hoje = total; alvo = 0
- **Risco de não fazer**: Uma SQL "mais pesada" em `com298` leva a página do SISPAG a 500 no horário de corte, sem recuperação automática.
- **Dependências**: —

### [testability-3] Fechar cobertura de `SITUACOES_QUE_MANTEM` (`ORFA`, `EM_GRUPO`)

- **Problema**
  > A tabela `SITUACOES_QUE_MANTEM` tem 4 valores. Só `UNICA_SEGURA` e `CONFIRMADA` são provados; `ORFA` e `EM_GRUPO` são regressões ao alcance de um `delete`.

- **Melhoria Proposta**
  > Em `MotorSugestaoBoleto.grupoSugerido.test.ts`, acrescentar: (1) um título com decisão `CONFIRMADA` **órfã** (sem boleto no pool) dentro de uma sugestão de grupo → `situacao === 'ORFA'`, `grupoSugerido` presente; (2) um título com `grupoBoletoId` (`EM_GRUPO`) dentro de uma sugestão → `situacao === 'EM_GRUPO'`, `grupoSugerido` presente. Pode reusar as fixtures existentes.

- **Resultado Esperado**
  > Ramos cobertos de `SITUACOES_QUE_MANTEM`: 2/4 → 4/4.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Testes do motor "preserva situação forte": 2 → 4
- **Risco de não fazer**: Regressão silenciosa em órfã transforma o rótulo "anule o grupo" em "em grupo sugerido", confundindo a analista.
- **Dependências**: —

### [testability-4] Teste de integração do aviso de seleção no `SispagPanel`

- **Problema**
  > `avisoSelecaoGrupoSugerido` tem teste unitário, mas a ligação com `toast.warning` em `page.tsx:774-778` não tem teste — o Q8 depende de inspeção visual.

- **Melhoria Proposta**
  > Novo arquivo `src/frontend/app/sispag/page.selecao-grupo.test.tsx` (ou acréscimo ao suite existente de `SispagPanel`): mockar `apiFetch` para devolver desfecho `GRUPO_SUGERIDO` para 5541 e disparar `userEvent.click` na checkbox do título. Afirmar `toast.warning` chamado uma vez com descrição do grupo e, ao desmarcar e remarcar, segue chamando (ou não — formalizar a semântica atual: só chama quando não estava selecionado).

- **Resultado Esperado**
  > Cobertura de componente para o aviso Q8: 0 → 1 caso feliz + 1 caso de guard (`!selecionados.has(...)`).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S/M
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Testes de página sobre `toggleSelecao` + grupo sugerido: 0 → 2
- **Risco de não fazer**: Refactor silencioso de `toggleSelecao` apaga o Q8; o incidente que motivou a emenda ADR-0077 de 2026-10-29 volta.
- **Dependências**: —

### [testability-5] Renomear teste de fallback para refletir o ramo exercitado

- **Problema**
  > O caso "falha no motor de grupos não derruba a listagem" (`BoletoSuggestionService.test.ts:2046`) na verdade falha a leitura de marcas, não o motor. Falso-positivo semântico.

- **Melhoria Proposta**
  > Renomear para "falha ao ler marcas de duplicidade não derruba a listagem (sugestão de grupo desligada)" e deixar o teste do motor para o card testability-1.

- **Resultado Esperado**
  > 0 testes com nome enganoso no suite do delta.

- **Tactic alvo**: Executable Assertions (clareza)
- **Severidade**: P3
- **Esforço estimado**: S (≤ 15 min)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Testes com rótulo fiel: n−1 → n
- **Risco de não fazer**: Multiplicador cognitivo para bugs futuros.
- **Dependências**: Combina com testability-1.

## 6. Notas do agente

- Rodei `jest` só nas suites tocadas pelo delta (BE: 2 arquivos, 145 ok; FE: 4 arquivos, 75 ok); sem flakes.
- A cobertura das 8 regras pedidas é 7/8: a única verdadeiramente ausente é o par `ORFA`/`EM_GRUPO` dentro de `SITUACOES_QUE_MANTEM` (F-3). As outras 7 têm teste direto, incluindo o 409 (via contrato `BoletoSuggestionNotAvailableError → 409` já coberto em `BoletoSuggestionErrors.test.ts:49`).
- Nenhum P0 declarável: o único candidato (F-2, nova leitura sem fallback) ainda não é defeito funcional comprovado — é um regress-risk ao caminho quente. Fica P1 com baseline numérica.
- Cross-QA: F-testability-2 cruza Fault Tolerance (nova dependência obrigatória na carteira), F-testability-1 cruza Modifiability (dead branch oculta refactor), e F-testability-4 cruza Usability/UX (Q8 desaparecer sem alarme).
