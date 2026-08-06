---
qa: Testability
qa_slug: testability
run_id: 2026-08-06-1945
agent: qa-testability
generated_at: 2026-08-06T19:45:00-03:00
scope: backend+frontend (restrito ao delta do tweak `bordero-vazio-orfao`)
score: 7.5
findings_count: 5
cards_count: 4
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

Bass: testability é o **multiplicador de custo** de qualquer futura mudança. O delta cria um caminho
de higiene (I-Write-7 — remover casco vazio) e um caminho de guarda (recusar aprovar borderô sem
item) em cima da escrita real no `fin010`. A pergunta operacional é: *quando amanhã alguém mudar o
loop `for (const aloc of alocacoes)` ou o modo como o `borCod` é reciclado entre pares, os testes
existentes vão pegar a regressão do borderô 18538?*

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista/dev fazendo `/feature-tweak` sobre o loop de reconciliação | mudança na ordem de POSTs, no gate `borderoCriadoAqui` ou na contagem de itens | `ReconciliacaoPermutaService.reconciliar` + `BorderoGestaoService.finalizarBordero` + `BorderosPanel.tsx` | dev (jest) e prod (Express legado sobre fin010) | testes exercitam I-Write-7 nos 4 caminhos (todas-falham / misto / ERP-tem-item / limpeza-falha) e a guarda da UI recusa antes do POST | 6 testes novos, 100% verdes; cobertura dos 2 arquivos backend ≥ 93,5% stmts; UI guard sem teste automatizado |

## 2. Métricas observadas

### Métrica observável #1 — Cobertura por arquivo do delta (backend)

Cobertura coletada **apenas nos 2 arquivos do delta** (o `--quick` bloqueou a cobertura full, mas
a per-file cabe em 6s):

| Arquivo | % Stmts | % Branch | % Funcs | % Lines | Linhas descobertas | Status |
|---|---|---|---|---|---|---|
| `BorderoGestaoService.ts` | 96,75 | 79,27 | 100 | 97,57 | 106, 130, 278, 516 | ✅ |
| `ReconciliacaoPermutaService.ts` | 93,50 | 79,00 | 95,45 | 96,34 | 105, 129, 239-240, 370, 537, 755, 820 | ✅ |
| **Delta agregado** | **94,95** | **79,10** | **98,07** | **96,87** | — | ✅ |

Alvo Bass (service layer): ≥ 80% lines / 70% branches / 80% funcs. **Delta bate os três com folga**
(branches em 79% vs alvo 70%). Fonte: `npx jest --testPathPatterns='(ReconciliacaoPermutaService|BorderoGestaoService)\.test\.ts$' --coverage --collectCoverageFrom='domain/service/permutas/(ReconciliacaoPermutaService|BorderoGestaoService).ts'` (rodado em 6,3s no worktree).

### Demais métricas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes das 2 suites do delta (backend) | 47/47 pass | 100% pass | ✅ | `npx jest --testPathPatterns='(ReconciliacaoPermutaService\|BorderoGestaoService)\.test\.ts$'` — 3,9s |
| Testes NOVOS adicionados pelo delta | 6 (4 no service de reconciliação + 2 no de gestão) | ≥1 por caminho crítico de I-Write-7 | ✅ | `git diff main` nos dois `.test.ts` |
| Caminhos de I-Write-7 cobertos por teste no backend | 4 de 4 documentados: `todas-falham`, `misto (falha→sucesso, borderô fica)`, `ERP-tem-item (fail-safe)`, `limpeza-falha (erro real sobrevive)` + 2 do consumidor (`sem item no ERP` / `trilha error não conta`) | 100% dos caminhos ontológicos | ✅ | `ReconciliacaoPermutaService.test.ts:497-580` + `BorderoGestaoService.test.ts:374-403` |
| Teste da guarda `vazio` no `BorderosPanel.tsx` | 0 | ≥1 (asserção do `disabled` do botão "Aprovar" com uma baixa `error`) | ❌ | `find src/frontend -name "BorderosPanel*.test*"` retorna vazio; grep `BorderosPanel` em `__tests__/` = vazio |
| Harness FE p/ componentes de `app/permutas/` já existe? | Sim — `src/frontend/__tests__/permutas-components.test.tsx` usa `render/screen` do `@testing-library/react` sobre `PermutaPendenteTable`, `AbaHistorico`, etc. | — | ✅ (precedente ativo) | `head permutas-components.test.tsx` |
| Assertivas sobre log emitido pelo caminho best-effort (`removerBorderoOrfao`) | 0 asserções em `logService.warn`/`info` nos 4 testes de I-Write-7 do reconciliador | ≥1 assert `warn`/`info` (Executable Assertions sobre observabilidade) | ⚠️ | `ReconciliacaoPermutaService.test.ts` — grep `logService.warn` no bloco I-Write-7 = 0 hits |
| Teste do caminho `assertBorderoTemItens` quando `listBaixas` **falha** (`throw`) | 0 | ≥1 (comportamento hoje: erro do `listBaixas` propaga → analista trava; potencial fail-open/close a documentar) | ⚠️ | `BorderoGestaoService.test.ts:374-403` — só cobre `listBaixas = []` e trilha-error, não a exceção |
| Determinismo dos 6 testes novos (mocks, ordem, `mockRejectedValueOnce`) | ✅ mocks isolados por teste via `buildDeps()`, sem `beforeAll` global; `mockRejectedValueOnce().mockResolvedValue()` é sequencial por chamada (não por tempo) → determinístico | Sem `Date.now()`/`setTimeout` reais nos novos testes | ✅ | Leitura dos testes `:501-575` (reconciliador) e `:374-403` (gestão) |
| Cobertura backend full | ⚠️ Não coletado | 80/70/80 no `domain/service` | — | `--quick` — cobertura full pulada por escopo |
| Cobertura frontend full | ⚠️ Não coletado | 60% lines em `app/permutas/` | — | `--quick` — idem |
| Suite frontend total | 141/141 pass (23 suites, 209 arquivos de teste) | 100% pass | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente (por escolha do `--quick`):** cobertura full backend/frontend. Se a run
> for repetida sem `--quick`, coletar por diretório (`domain/service`, `domain/repository`,
> `app/permutas`).

## 3. Tactics — Cobertura no delta

Mapa Bass & Clements aplicado ao delta.

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| **Control & Observe: Specialized Interfaces** | Injeção construtora com `as never` (dependências mockadas) no `buildDeps()` das duas suites — nenhum teste chama `container.resolve`. Segue exatamente o padrão prescrito no CLAUDE.md ("Test the service layer, not the handler directly"). | ✅ | `ReconciliacaoPermutaService.test.ts:85-95`; `BorderoGestaoService.test.ts:52-60` |
| **Control & Observe: Recordable Test Cases** | Mocks derivados de HARs reais (borderô 18538 explicitamente citado nos testes I-Write-7, borderô 15593 no I-Write-6 legado). O dado do ERP não é sintético. | ✅ | comentários `// Regressão do borderô 18538 (2026-08-06)` `ReconciliacaoPermutaService.test.ts:498-500` e `BorderoGestaoService.test.ts:374-376` |
| **Control & Observe: Sandbox** | `EnvironmentProvider` mockado com toggles `conexosWriteEnabled` / `conexosDryRun`; guard-rail defensivo (`dry-run` sempre vence). Nenhum teste toca rede real. | ✅ | `envFlags` `ReconciliacaoPermutaService.test.ts:6-9` |
| **Control & Observe: Executable Assertions** | Assertivas sobre `mock.calls`, resultado da chamada pública (`out.resultados[0].status`), payload do POST final e chamadas do repositório. **Gap:** os 4 testes I-Write-7 não asseveram sobre as chamadas de `logService.warn`/`info` que o `removerBorderoOrfao` faz — o best-effort perdeu sua asserção de observabilidade. | ⚠️ parcial | vide finding F-testability-2 |
| **Control & Observe: Abstract Data Sources** | Repositórios mockados por interface completa (`beginExecution`, `markSettled`, `markError`, `deleteBorderoCache` etc.). O `deleteBorderoCache` foi adicionado ao mock do reconciliador especificamente para o delta, sem contaminar os testes antigos. | ✅ | `buildDeps()` `ReconciliacaoPermutaService.test.ts:55-68` |
| **Limit Complexity: Limit Structural Complexity** | Método órfão (`removerBorderoOrfao`) é `private`, mas testado **apenas** pelo comportamento observável do público `reconciliar` — sem `as any` para pinçar o privado. Boa prática. As duas suites ficaram grandes (`ReconciliacaoPermutaService.test.ts` cresceu para 736 LOC no delta), mas o cabeçalho continua legível pelas descrições. | ✅ | ver F-testability-4 (limite superior de LOC) |
| **Limit Complexity: Limit Non-Determinism** | Nenhum `Date.now()` novo, nenhum `setTimeout`, nenhum `Math.random`. `mockRejectedValueOnce().mockResolvedValue(...)` é ordenado por chamada — não por tempo — logo determinístico. O caso misto (falha→sucesso) usa 2 alocações no MESMO borderô: a ordem do `for` é do array retornado por `listAtivas`, também determinística. | ✅ | `ReconciliacaoPermutaService.test.ts:525-548` |
| **Frontend: Property-based testing** | `fast-check` é dep. Não usado no delta (nem seria natural aqui: o guard é booleano puro). Nota de referência, sem impacto. | N/A | — |

## 4. Findings

### F-testability-1: Guarda `vazio` do BorderosPanel.tsx não tem teste automatizado

- **Severidade**: P2 (débito técnico defensável — regressão do 18538 pode voltar sem teste unitário na UI)
- **Tactic violada**: Executable Assertions (frontend)
- **Localização**: `src/frontend/app/permutas/BorderosPanel.tsx:468-486`
- **Evidência (objetiva)**:
  ```tsx
  const vazio = !b.baixas.some((x) => x.status === 'settled')
  // ...
  disabled={!noso || b.situacao !== 'EM_CADASTRO' || vazio}
  ```
  Nenhum arquivo em `src/frontend/**` renderiza `BorderosPanel` num teste (`grep -l BorderosPanel src/frontend/__tests__` = vazio; nem colocado, nem sob `__tests__/`). Ao mesmo tempo, o harness para componentes de `app/permutas/` já existe: `src/frontend/__tests__/permutas-components.test.tsx` usa `@testing-library/react` e renderiza `PermutaPendenteTable` + `AbaHistorico`.
- **Impacto técnico**: um refactor futuro pode inverter a condição (`some` → `every`), trocar `settled` por outro status ou mover a lógica para um selector, e nada quebra em CI. O caminho servidor (`assertBorderoTemItens`) protege contra o POST, mas a UI **é** a primeira barreira (mostra o `title` explicativo e desabilita o clique) — sem ela, o analista descobre que o borderô é casco só ao tentar aprovar.
- **Impacto de negócio**: retorno da regressão do borderô 18538 no lado UX (o backend protege, mas o analista tenta e leva erro em vez de ver "Excluir"). Custo silencioso, mas mensurável em suporte.
- **Métrica de baseline**: 0 testes cobrindo `BorderosPanel.vazio` sobre 141 testes FE totais; harness existe (10 arquivos `.test.tsx`).

### F-testability-2: 4 testes de I-Write-7 do reconciliador não asseveram sobre logs

- **Severidade**: P2
- **Tactic violada**: Executable Assertions sobre saída de observabilidade
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts:501-580` (`I-Write-7: todas as baixas falham...`, `ERP relata item...`, `falha ao excluir o órfão...`, `falha seguida de sucesso...`)
- **Evidência (objetiva)**:
  O `removerBorderoOrfao` é **best-effort com observabilidade por log** — três `logService.warn`/`info` distintos (removeu OK, ERP tinha item, exclusão falhou). Grep no bloco `I-Write-7` dos testes:
  ```
  logService.warn : 0 hits
  logService.info : 0 hits
  ```
  Só há asserção sobre `excluirBordero`/`deleteBorderoCache` (efeitos) e `resultados[0].status` (retorno). Os três eventos observáveis do best-effort nunca são verificados.
- **Impacto técnico**: alguém pode remover ou trocar o log (ex.: rebaixar `warn` para `debug`, mudar a chave `message`) sem quebrar nada em CI. Perdemos a única trilha operacional do caminho de higiene — o dashboard/alertas que dependerem do texto do log passam a mentir silenciosamente.
- **Impacto de negócio**: perda de detectabilidade do próprio mecanismo que existe *para* dar visibilidade quando algo dá errado no fim da baixa. Menor que F-testability-1, mas concreto.
- **Métrica de baseline**: 0 asserções em `logService.*` nos 4 testes I-Write-7; alvo mínimo: 1 assert por caminho best-effort (3 caminhos → 3 asserts).

### F-testability-3: `assertBorderoTemItens` não testa a falha do `listBaixas`

- **Severidade**: P3 (baixo — comportamento hoje é fail-closed, mas a política deveria ser declarada em teste)
- **Tactic violada**: Executable Assertions (defesa contra estado indeterminado)
- **Localização**: `src/backend/domain/service/permutas/BorderoGestaoService.ts:257-268`; teste `BorderoGestaoService.test.ts:374-403`
- **Evidência (objetiva)**:
  ```typescript
  private assertBorderoTemItens = async (filCod: number, borCod: number): Promise<void> => {
      const baixas = await this.conexosBaixaClient.listBaixas({ filCod, borCod });
      if (baixas.length === 0) { throw ... }
  };
  ```
  Se `listBaixas` lançar (ERP fora do ar), a exceção **propaga** — o analista NÃO consegue aprovar um borderô legítimo enquanto o ERP não responder. Isso pode ser desejável (fail-closed), mas não há teste que documente a decisão. Nenhum dos 2 testes novos cobre esse ramo.
- **Impacto técnico**: alguém pode trocar o `listBaixas` por um cliente com retry mais permissivo ou envolver a chamada num `try/catch => permitir`, invertendo silenciosamente a política. Sem teste, a mudança passa.
- **Impacto de negócio**: baixo hoje (ERP raramente indisponível na hora exata da aprovação), mas o *comportamento sob falha do ERP* de uma escrita em fin010 é justamente o tipo de decisão que precisa de teste com fórceps.
- **Métrica de baseline**: 0 testes cobrindo `listBaixas throws → finalizarBordero throws`; alvo: 1 teste declarando fail-closed explicitamente.

### F-testability-4: `ReconciliacaoPermutaService.test.ts` já em 736 LOC (crescendo)

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts`
- **Evidência (objetiva)**: o delta adicionou 86 linhas ao teste, subindo de 654 → 736 LOC. Ainda saudável (as descrições estão organizadas por invariante), mas Bass alerta em >500 LOC. É um sintoma de que o serviço orquestra muitos invariantes (I-Write-1 a I-Write-7 + idempotência viva + âncora + multi-título).
- **Impacto técnico**: cada novo I-Write empurra a suite pra +80 LOC. Em 2 tweaks a suite passa dos 900 e a leitura por invariante começa a doer.
- **Impacto de negócio**: cost-multiplier de futuros tweaks no fluxo de baixa cresce; hoje é gerenciável.
- **Métrica de baseline**: 736 LOC (delta) vs alvo de conforto Bass ≤ 500 LOC.

### F-testability-5: Cobertura das duas suites do delta acima do alvo Bass

- **Severidade**: — (finding **positiva**, sem card; contexto para o score)
- **Tactic**: Executable Assertions + Specialized Interfaces
- **Localização**: `src/backend/domain/service/permutas/` (2 arquivos)
- **Evidência**: 94,95% stmts / 79,10% branch / 98,07% funcs / 96,87% lines no delta agregado; alvo Bass service layer = 80/70/80. As poucas linhas descobertas (`ReconciliacaoPermutaService.ts:105, 129, 239-240, 370, 537, 755, 820`) são fallbacks defensivos (branches `undefined` de campos opcionais e o `catch` do fetch de títulos com fallback silencioso).
- **Impacto**: baseline forte. O delta *não* piora nada; ao contrário, adiciona 6 asserções sobre um caminho até então descoberto.

## 5. Cards Kanban

### [testability-1] Cobrir a guarda `vazio` do BorderosPanel com teste automatizado

- **Problema**
  > A UI hoje desabilita o botão "Aprovar" quando `!b.baixas.some(x => x.status === 'settled')`, que é a *primeira* barreira contra o casco 18538. Não há teste; um refactor pode inverter a condição sem CI reclamar. O harness FE (`__tests__/permutas-components.test.tsx` com `@testing-library/react`) já existe e serve de precedente.

- **Melhoria Proposta**
  > Criar `src/frontend/__tests__/borderos-panel.test.tsx` (ou colocar em `app/permutas/BorderosPanel.test.tsx` seguindo o padrão colocated do CLAUDE.md, se houver decisão local). Mockar `@/lib/api` (as funções `fetchBorderos`, `fetchBaixasErp`) e renderizar o painel com **duas fixtures**: (i) borderô EM_CADASTRO com uma baixa `settled` → botão "Aprovar" **habilitado**; (ii) borderô EM_CADASTRO com uma única baixa `error` (o casco 18538) → botão "Aprovar" **desabilitado** e `title` contém "sem baixa". Tactic: Executable Assertions no frontend.

- **Resultado Esperado**
  > Testes cobrindo a guarda `vazio`: 0 → 2. Regressão do 18538 no lado UX defendida por CI.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Testes cobrindo a guarda `vazio` do BorderosPanel: **0 → 2**
  - Arquivos `.test.tsx` no frontend cobrindo componentes de `app/permutas/`: **1 → 2**
- **Risco de não fazer**: em 6 meses, alguém troca `status === 'settled'` por `status !== 'error'` (parece semanticamente igual, não é — `skipped`/`dry-run` também não são settled) e o casco volta a aparecer aprovável até alguém tentar.
- **Dependências**: nenhuma.

### [testability-2] Adicionar asserções de log nos 3 caminhos de `removerBorderoOrfao`

- **Problema**
  > `removerBorderoOrfao` é best-effort com observabilidade **exclusivamente por log** (`BUSINESS_INFO` no sucesso, `BUSINESS_WARN` no ERP-tem-item e no `catch`). Os 4 testes I-Write-7 asseveram sobre os efeitos (excluirBordero/deleteBorderoCache/erro do retorno), mas nunca sobre `logService.warn`/`info` — se alguém rebaixar o log para `debug` ou mudar a `message`, dashboards e alertas mentem e CI aprova.

- **Melhoria Proposta**
  > Em cada um dos 3 testes existentes de I-Write-7 (todas-falham, ERP-tem-item, limpeza-falha), adicionar um `expect(logService.warn|info).toHaveBeenCalledWith(expect.objectContaining({ type: LOG_TYPE.BUSINESS_*, data: expect.objectContaining({ borCod: 1999 }) }))`. Tactic: Executable Assertions sobre observabilidade.

- **Resultado Esperado**
  > Asserções sobre eventos observáveis do best-effort: **0 → 3** (uma por caminho).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — 3 linhas por teste)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Testes I-Write-7 com asserção de log: **0 → 3**
- **Risco de não fazer**: perda silenciosa da trilha operacional do único caminho automático que *manipula* o fin010 fora do handshake principal.
- **Dependências**: cross-QA — a mesma asserção reforça o card `fault-tolerance-*` de observabilidade do best-effort (ver seção 6).

### [testability-3] Declarar em teste a política do `assertBorderoTemItens` sob falha do `listBaixas`

- **Problema**
  > O guard `assertBorderoTemItens` só é testado nos ramos "ERP retorna vazio" e "trilha tem `error`". Se `listBaixas` lançar (ERP indisponível), a exceção propaga e o analista trava — decisão fail-closed razoável, mas **não documentada em teste**. Um refactor futuro pode envolver num `try/catch => allow` e inverter a política sem alarme.

- **Melhoria Proposta**
  > Adicionar 1 teste em `BorderoGestaoService.test.ts` sob `describe('finalizarBordero — casco vazio (I-Write-7)')`: `it('bloqueia quando listBaixas falha — fail-closed anti-aprovação-de-casco')`, com `conexosClient.listBaixas.mockRejectedValue(new Error('ERP timeout'))` e `expect(...).rejects.toThrow(/ERP timeout/)` + `expect(finalizarBordero mock).not.toHaveBeenCalled()`. Tactic: Executable Assertions.

- **Resultado Esperado**
  > Caminhos de `assertBorderoTemItens` cobertos: **2 → 3**. Política fail-closed do guard virada em invariante testável.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤0,5d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Ramos de `assertBorderoTemItens` cobertos por teste: **2 → 3**
- **Risco de não fazer**: baixo hoje; potencial inversão silenciosa de política em tweak futuro.
- **Dependências**: nenhuma.

### [testability-4] Extrair helpers para segmentar `ReconciliacaoPermutaService.test.ts` (>500 LOC)

- **Problema**
  > A suite chegou a 736 LOC ao acomodar 6 blocos de invariantes (I-Write-1 a 7 + idempotência viva + âncora + multi-título). Cada `/feature-tweak` sobre o fluxo de baixa empurra +50 a +100 LOC. Bass alerta em >500. Ainda legível hoje, mas o slope está apontado.

- **Melhoria Proposta**
  > Sem mudar cobertura, extrair um arquivo `ReconciliacaoPermutaService.i-write-7.test.ts` (colocated) para o bloco I-Write-7 e um builder `buildDepsForOrphan(...)` compartilhado por composição — se o custo de extrair `buildDeps` for alto, adiar. Tactic: Limit Structural Complexity nos testes.

- **Resultado Esperado**
  > Maior arquivo de teste do delta: **736 LOC → ≤ 500 LOC por arquivo**; suíte segmentada por invariante (I-Write-N por arquivo).

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: M (2–3d — inclui refatorar o `buildDeps` compartilhado)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - LOC do maior arquivo de teste em `permutas/`: **736 → ≤ 500**
- **Risco de não fazer**: em ~2 tweaks a suite passa de 900 LOC e a leitura por invariante começa a doer.
- **Dependências**: idealmente após F-testability-2 estabilizar as asserções de log (evita mover teste e depois voltar pra editá-lo).

## 6. Notas do agente

- Escopo **restrito ao delta**: não avaliei cobertura full nem outras suites do repo (`--quick` explícito).
  Rodei cobertura per-file dos 2 arquivos alterados (6,3s no worktree) porque cabia no tempo e é o
  número que Bass mais pede.
- Determinismo dos 6 testes novos verificado por leitura direta: mocks isolados em `buildDeps()` sem
  `beforeAll`, sem tempo real, sem randomness. `mockRejectedValueOnce().mockResolvedValue()` é
  ordenado por chamada — não por tempo — e o loop `for (const aloc of alocacoes)` itera na ordem do
  array de `listAtivas` (determinística). Sem risco de flake.
- **Cross-QA detectado** para o consolidador:
  1. F-testability-2 (log assertions no best-effort) **reforça** achados de `fault-tolerance` sobre a
     observabilidade do `removerBorderoOrfao` — o log é a única saída visível quando o ERP mente
     sobre ter itens; se qa-fault-tolerance abrir card sobre alertar em cima do WARN, este teste é
     pré-requisito.
  2. F-testability-1 (guarda de UI) **reforça** modifiability — a lógica `!some(x.status === 'settled')`
     é frágil a refactor de statuses; qa-modifiability pode querer extrair um selector puro
     testável isoladamente.
  3. F-testability-3 tangencia `integrability` — comportamento sob falha do `listBaixas` é contrato
     de fronteira com o `ConexosBaixaClient`; se aquele QA abrir card de contract test, este teste é
     o mínimo local.
