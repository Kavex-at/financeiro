---
type: regis-review-kanban
run_id: 2026-08-06-1945
total: 23
counts: { p0: 0, p1: 0, p2: 13, p3: 10 }
---

# Kanban — financeiro — 2026-08-06-1945

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta /
> Resultado Esperado. Ordem: P0 (S → XL), depois P1, P2, P3. Deduplicações estão marcadas com
> prefixo `cq-` (cross-QA). Findings originais estão referenciados na entrada de cada card.

---

## P0 — Crítico

_Nenhum P0 identificado nesta rodada. Gate #8 do pipeline liberado — PR pode seguir para review._

---

## P1 — Alto

_Nenhum P1 identificado nesta rodada. Todos os findings de latência/observabilidade foram
rebaixados para P2 por falta de baseline numérico defensável (`_shared-metrics.md` não tem
métrica de indisponibilidade do ERP; repo não tem `infra/` para instrumentar) — regra da rodada
seguida à risca._

---

## P2 — Médio

### [cq-observabilidade-orfao] Instrumentar observabilidade agregada do best-effort de borderô órfão

**QA**: Availability + Deployability + Fault Tolerance (dedup: availability-2 + deployability-2)
**Tactic alvo**: Monitor + Deployment Observability
**Esforço**: S (código) / M (dashboard/alarme após `infra/`)
**Findings**: F-availability-2, F-deployability-2, F-fault-tolerance-1

**Problema**
> `removerBorderoOrfao` é a defesa de linha 1 contra o casco 18538. Ela loga
> `BUSINESS_INFO`/`BUSINESS_WARN` estruturado, mas não há dashboard/alarme agregando esses eventos
> — o time não sabe (a) quantas vezes por dia a compensação disparou, (b) quantas vezes ela falhou
> e deixou o casco para o consumidor bloquear. Um pico silencioso indicaria regressão em
> `gravarBaixaPermuta`. Se `removerBorderoOrfao` começar a falhar repetidamente em produção, o
> casco continua acumulando no painel e ninguém sabe até um analista reclamar — o incidente
> 2026-08-06 leva 3 meses a acontecer, exatamente o padrão que motivou este tweak.

**Melhoria Proposta**
> Instrumentar dois contadores estruturados no `LogService` com chaves padronizadas para
> extração posterior:
> - `permuta.bordero_orfao.removido` (INFO) — sucesso da compensação;
> - `permuta.bordero_orfao.limpeza_falhou` (WARN) — compensação abortou (ERP relatou item OU
>   `excluirBordero` lançou).
>
> Configurar alerta (CloudWatch/Sentry ou equivalente da plataforma runtime — hoje Render;
> quando `infra/` chegar, converter em métrica CloudWatch): (a) `count(limpeza_falhou) > 0 in
> 24h` → alerta; (b) dashboard com `count(removido)` como métrica de saúde do fluxo.

**Resultado Esperado**
> O time consegue responder "a taxa de nascimento de cascos está subindo?" em minutos, sem varrer
> logs. Cascos que a compensação não conseguiu limpar viram sinal ativo, não passivo. MTTA cai de
> "dias/semanas" para "<1 dia útil".

**Métricas de sucesso**
- Contadores estruturados: 0 → 2
- Alertas configurados para o par INFO/WARN do órfão: 0 → 2
- MTTA regressão silenciosa: dias-semanas → <1 dia útil

**Risco de não fazer**
> Regressão em `gravarBaixaPermuta` pode ficar semanas sem detecção, com cascos aparecendo no
> painel como "sujeira do dia-a-dia". Mesmo padrão que motivou o tweak.

**Dependências**: verificar stack de observabilidade atual (Render logs → provider ainda não
inventariado); dashboard CloudWatch depende de `infra/` (roadmap `AwsInfraArchitect`).

---

### [avail-1] Documentar o trade-off fail-closed do `assertBorderoTemItens` e instrumentar métrica de indisponibilidade

**QA**: Availability
**Tactic alvo**: Monitor + Exception Prevention (formalizar trade-off documentado)
**Esforço**: S
**Findings**: F-availability-1

**Problema**
> O `finalizarBordero` agora depende de um `listBaixas` síncrono ao ERP antes de aprovar. É a
> escolha certa (evita aprovar borderô fantasma como o 18538), mas o comportamento em incidente do
> ERP não está documentado como decisão consciente nem monitorado — o analista só vê "falha ao
> aprovar" no toast, sem distinguir "borderô vazio" de "ERP fora do ar".

**Melhoria Proposta**
> Adicionar comentário JSDoc explícito em `assertBorderoTemItens` marcando o fail-closed como
> política (Bass tactic: **Exception Prevention** > Availability trade-off). No `route` que expõe
> o endpoint, distinguir a exceção do próprio `listBaixas` (ex.: `ConexosError`) da recusa
> semântica ("Borderô ... não possui baixas") — retornar mensagens diferentes para o front, e
> incrementar um contador estruturado no `logService`
> (`permuta.assert_bordero_itens.erp_down`) para observabilidade futura.

**Resultado Esperado**
> Analista distingue os dois cenários no toast (mensagem diferente). Time consegue tracer a
> frequência do fail-closed via log estruturado. Nenhum aumento de custo no caminho feliz.

**Métricas de sucesso**
- Diferenciação de mensagem de erro no route de `finalizarBordero`: 0 → 2 caminhos distintos
- Log estruturado com contador do fail-closed: ausente → 1 novo `LOG_TYPE.BUSINESS_WARN`

**Risco de não fazer**
> Se o ERP começar a intermitir, o time culpará o guard novo por regressões que na verdade são
> do ERP. Sinal ruído-x-real fica embaralhado.

**Dependências**: Nenhuma.

---

### [ft-1] Cobrir o cenário "ERP apagou, cache falhou" no `removerBorderoOrfao`

**QA**: Fault Tolerance
**Tactic alvo**: Rollback (por passo) + Condition Monitoring
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-1

**Problema**
> `removerBorderoOrfao` faz `excluirBordero` (ERP) → `deleteBorderoCache` (local) → log dentro
> do MESMO `try`. Se o ERP sucede e o cache falha, o catch loga `BUSINESS_WARN` "remover pelo
> painel" — mensagem enganosa (o borderô já não existe no ERP) e cache fica temporariamente
> inconsistente até o próximo `refreshCache`.

**Melhoria Proposta**
> Separar as duas operações: envelopar `deleteBorderoCache` em try/catch próprio; se o ERP
> sucedeu mas o cache falhou, logar `BUSINESS_INFO` "borderô removido do ERP; cache limpará no
> próximo refresh" (não um warn). Adicionar teste que simula `deleteBorderoCache` rejeitando e
> verifica o log final.

**Resultado Esperado**
> A mensagem de log casa com o estado real do sistema; o warn não confunde o analista para apagar
> algo que já não existe. Cobertura de teste do cenário sobe de 0 para 1.

**Métricas de sucesso**
- Testes cobrindo "ERP sucesso + cache falha": 0 → 1
- Log correto no cenário: 0/1 → 1/1

**Risco de não fazer**
> Confusão operacional pontual quando o DB do backend oscila logo depois de uma escrita no ERP.
> Sem risco financeiro direto.

**Dependências**: Nenhuma.

---

### [ft-2] Sinalizar payload malformado do `listBaixas` (rows filtradas silenciosamente)

**QA**: Fault Tolerance
**Tactic alvo**: Sanity Checking + Condition Monitoring
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-2 (reescrita pelo consolidador — variante REAL)

**Problema**
> `ConexosBaixaClient.listBaixas` (`src/backend/domain/client/ConexosBaixaClient.ts:169-187`)
> normaliza com `page.rows ?? []` e depois filtra `Number.isFinite(b.docCod) &&
> Number.isFinite(b.bxaCodSeq)`. O filtro é correto (protege o DELETE por índice de identidade),
> mas é **silencioso** — uma resposta HTTP 200 com payload malformado (rows sem `bxaCodSeq`
> finito) pode render `[]` para um borderô que TEM baixas. O guard
> `listBaixas.length === 0` de `removerBorderoOrfao` interpretaria isso como "casco vazio" e
> chamaria `excluirBordero` em um borderô com baixa real.

**Melhoria Proposta**
> No `ConexosBaixaClient.listBaixas`, após o `.map().filter()`, comparar
> `rawRows.length !== filteredRows.length` e logar `BUSINESS_WARN` do tipo
> `conexos.listBaixas.rows_filtradas` com `{ borCod, filCod, rawCount, filteredCount }`. Também
> logar quando `rows.length === pageSize` (indício de truncamento — cobre parcialmente
> integ-1). Nenhuma mudança de comportamento; apenas visibilidade da defesa silenciosa.

**Resultado Esperado**
> Payload malformado do ERP vira sinal ativo (alerta) antes de virar exclusão errônea. Bug futuro
> do ERP passa a ser detectado por log-grep antes de qualquer divergência ERP↔contábil.

**Métricas de sucesso**
- Log `conexos.listBaixas.rows_filtradas` emitido em cenário de payload malformado: ausente →
  emitido a cada ocorrência
- Log `conexos.listBaixas.pagina_cheia` em `rows.length === pageSize`: ausente → emitido

**Risco de não fazer**
> ALTO em severidade (baixa real deletada = divergência ERP↔contábil no `fin010`), BAIXO em
> probabilidade (requer bug de payload do ERP). Sem o log, uma mudança contratual do ERP que
> quebre `bxaCodSeq` fica invisível até a primeira exclusão errônea.

**Dependências**: Nenhuma.

---

### [ft-3] Reforçar defense-in-depth da limpeza: teste do 2º nível (`excluirBordero` rejeita quando há baixa vinculada)

**QA**: Fault Tolerance
**Tactic alvo**: Voting / Redundancy + Condition Monitoring
**Esforço**: S (≤1d)
**Findings**: F-fault-tolerance-3

**Problema**
> A guarda `listBaixas>0 → não apaga` é a defesa primária contra apagar borderô com baixa real.
> O 2º nível (ERP recusar `excluirBordero` de borderô com item) NÃO é validado por teste. Se um
> dia o comportamento do ERP mudar (cascade delete) ou se `listBaixas` retornar `[]` por causa
> não-de-ausência (ver ft-2), não temos um trip-wire.

**Melhoria Proposta**
> Adicionar teste que simula: `listBaixas` retorna `[]` (contrário à realidade), `excluirBordero`
> rejeita com "borderô tem baixas vinculadas"; verificar que o outer catch loga `BUSINESS_WARN`
> sem propagar. Documentar em `fin010-write-contract.md` (I-Write-7) que a 2ª linha de defesa
> depende do comportamento do endpoint `moduleBordero.delete` — se o ERP algum dia passar a
> cascatear, este teste falhará e sinalizará.

**Resultado Esperado**
> Cobertura de teste do 2º nível de defesa passa a existir; qualquer mudança contratual do ERP
> (`excluirBordero` cascatear) é detectada por teste.

**Métricas de sucesso**
- Testes cobrindo o 2º nível de defesa: 0 → 1
- Documentação da contra-invariante no ERP (I-Write-7 §2ª linha): ausente → presente

**Risco de não fazer**
> Baixo hoje; ALTO se o ERP mudar. Sem trip-wire, a mudança passaria silenciosa e o próximo casco
> varreria uma baixa real.

**Dependências**: Nenhuma.

---

### [deploy-1] Documentar ordem de deploy segura FE↔BE para o par de guardas de Permutas

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S
**Findings**: F-deployability-1

**Problema**
> O ADR-0030 cria duas guardas complementares (backend `assertBorderoTemItens` + frontend
> `vazio`), mas Render (BE) e Vercel (FE) são deploys independentes. A janela intermediária é
> **segura nos dois sentidos** (F-deployability-1), mas isso não está escrito em lugar nenhum —
> o próximo tweak em Permutas que criar uma guarda cruzada FE/BE pode não ter a mesma sorte.

**Melhoria Proposta**
> Adicionar seção "Ordem de deploy" no ADR-0030 documentando: (a) lockstep de versão via
> `scripts/bump-version.ps1` como mecanismo de correlação; (b) checklist de "degradação segura
> FE-primeiro / BE-primeiro" que agentes futuros devem preencher em ADRs que introduzem guardas
> duplicadas.

**Resultado Esperado**
> Toda mudança FE↔BE com guarda dupla tem análise "ordem A vs. ordem B" registrada no ADR.
> Estado do sistema: 0 tweaks recentes com guarda dupla sem essa análise → 100%.

**Métricas de sucesso**
- ADRs com guarda dupla FE↔BE contendo seção "ordem de deploy": 0 → 100% (deste tweak em diante)

**Risco de não fazer**
> Próxima guarda dupla FE↔BE pode escolher uma direção onde a ordem intermediária é regressiva
> (não meramente estagnada), sem que o revisor perceba.

**Dependências**: Nenhuma.

---

### [deploy-3] Avaliar kill-switch granular para auto-limpeza de borderô órfão

**QA**: Deployability
**Tactic alvo**: Logical Grouping
**Esforço**: S
**Findings**: F-deployability-3

**Problema**
> A auto-limpeza está transitivamente coberta pelo gate `CONEXOS_WRITE_ENABLED` (verificado:
> `borderoCriadoAqui` só vira true dentro do ramo não-dry-run), mas não tem interruptor próprio.
> Se o comportamento se mostrar defeituoso em produção, a única forma de desligar é
> `CONEXOS_WRITE_ENABLED=false`, que também para as baixas legítimas. Assimetria com o pattern
> existente de flag de escrita.

**Melhoria Proposta**
> Adicionar env var opcional `CONEXOS_AUTO_CLEANUP_ORFAO_ENABLED` (default `true` para preservar
> comportamento atual) via `EnvironmentProvider`, checada no início de `removerBorderoOrfao`.
> Documentar em `business-rules/fin010-write-contract.md` como override de emergência.

**Resultado Esperado**
> Incidente hipotético na auto-limpeza mitigado por toggle em segundos, sem revert de código.
> Time-to-mitigate: minutos → segundos.

**Métricas de sucesso**
- Kill-switches granulares para caminhos irreversíveis no ERP: 0 → 1
- Time-to-mitigate estimado de bug isolado em `removerBorderoOrfao`: ~15 min (revert+redeploy)
  → <1 min (toggle)

**Risco de não fazer**
> Um bug futuro em `removerBorderoOrfao` (mesmo raro) exigirá revert de release para conter —
> impacto amplificado em janela de incidente.

**Dependências**: Nenhuma.

---

### [cq-shortcircuit-assert] Curto-circuitar `assertBorderoTemItens` quando a trilha já garante ≥ 1 baixa `settled`

**QA**: Performance + Integrability (dedup: performance-1 + integrability-4)
**Tactic alvo**: Reduce Overhead + Manage Resources
**Esforço**: S (≤1d)
**Findings**: F-performance-1, F-integrability-4

**Problema**
> Toda aprovação passa a fazer +1 chamada ao Conexos (`listBaixas`) antes do `finalizarBordero`,
> mesmo quando a trilha local (`permuta_alocacao_execucao`) já mostra ≥ 1 linha `status='settled'`
> para aquele borderô — cenário do caminho feliz da esmagadora maioria das aprovações. O motivo
> da consulta ao ERP (regra I-Write-7) é evitar contar linhas `error` com `bor_cod` como "item";
> mas `error` NUNCA é `settled`, então basta contar `settled` na trilha.

**Melhoria Proposta**
> No `assertBorderoTemItens`, ler primeiro a trilha via
> `execucaoRepository.hasSettledForBorCod(borCod)` e curto-circuitar quando `true` — aí NÃO
> chama o ERP. Só cai no `listBaixas` quando a trilha não tem `settled` (o cenário exato de
> I-Write-7). Mantém a mesma correção (linha `error` não é contada), pega o caminho feliz.
> Arquivo único a tocar: `src/backend/domain/service/permutas/BorderoGestaoService.ts`.
> O front (`BorderosPanel.tsx`) já usa a mesma heurística de `settled`, então a semântica
> UI/API bate.

**Resultado Esperado**
> Chamadas ao Conexos por aprovação no caminho feliz: **2 → 1**. Caminho de casco vazio:
> comportamento inalterado (recusa antes do POST com mensagem acionável). Adicionar teste "trilha
> tem `settled` → não chama `listBaixas`".

**Métricas de sucesso**
- Nº de `listBaixas` disparados por aprovação (caminho feliz): 1 → 0
- Nº total de RTTs ao Conexos por aprovação (caminho feliz): 2 → 1
- `assertBorderoTemItens` p50 no caminho feliz: 1× RTT Conexos → ~1 ms (query local)

**Risco de não fazer**
> Cada nova UX que atravesse este método herda o RTT extra; sem instrumentação (perf-2), o
> overhead fica invisível até virar reclamação de "aprovar ficou lento".

**Dependências**: idealmente após (ou junto com) `perf-2`, senão não dá para medir o ganho.

---

### [perf-2] Instrumentar latência das chamadas ao Conexos (`ConexosBaseClient`)

**QA**: Performance
**Tactic alvo**: (meta) Measure Performance — pré-condição para Manage Resources / Control Resource Demand
**Esforço**: S (≤1d)
**Findings**: F-performance-1, F-performance-2

**Problema**
> Nenhuma chamada ao ERP é medida hoje (`grep` por `duration/elapsed/Date.now/performance.now/latency`
> no `ConexosBaseClient.ts` → 0 hits). Este delta introduziu +1 RTT por aprovação (F-performance-1),
> mas o repo não tem baseline — impossível classificar o impacto real (P1 vs P3) e impossível
> provar o ganho do card `cq-shortcircuit-assert`. Vale para as três frentes (Permutas, SISPAG,
> Recebimentos).

**Melhoria Proposta**
> No wrapper de chamadas em `ConexosBaseClient` (onde já vive `runWithRetry`), envelopar cada
> request num timer (`performance.now()` antes/depois) e logar
> `{ endpoint, method, duration_ms, status, attempts }` via `LogService`. Como o backend hoje é
> Express (sem CloudWatch), começar por log estruturado — depois virar histograma quando a
> rodada de infra chegar. Endpoints-alvo prioritários: `fin010/baixas/list`,
> `fin010/finalizar/{borCod}`, `fin010/{filCod}/{borCod}` (`getBordero`), `fin010/list`
> (`listBorderos`).

**Resultado Esperado**
> p50/p95 por endpoint disponível em log em ≤ 1 semana de uso em produção. Baseline conhecido
> para `listBaixas` (usado pelo delta) e `finalizarBordero`. Regressões futuras (~+50% de p95)
> viram alertáveis. Card `cq-shortcircuit-assert` fica falseável (medir ganho real do
> curto-circuito).

**Métricas de sucesso**
- Cobertura de instrumentação por endpoint Conexos: 0% → 100% (nos endpoints do painel de borderô)
- Baseline de p95 `listBaixas` documentado: ausente → registrado em `ontology/_inbox/` ou dashboard

**Risco de não fazer**
> Todo card futuro de performance no eixo Conexos fica com severidade rebaixada por falta de
> baseline. Regressões só são pegas por analista reclamando.

**Dependências**: Nenhuma.

---

### [integ-3] Consolidar orquestração fin010 em um façade "Fin010BorderoFacade" (ACL)

**QA**: Integrability + Modifiability
**Tactic alvo**: Use an Intermediary + Manage Resource Coupling
**Esforço**: M (2–5d)
**Findings**: F-integrability-3

**Problema**
> `ReconciliacaoPermutaService` já depende de 8 operações do `ConexosBaixaClient` + 1 do
> `ConexosTitulosClient`; `BorderoGestaoService` sobrepõe 3 dessas operações + 3 novas. Não há
> intermediário entre os serviços de permuta e o SDK do Conexos. Trocar o provedor ou migrar
> para Conexos v2 (roadmap sem data firme) exigirá mexer nos 2 serviços simultaneamente.

**Melhoria Proposta**
> Extrair um `Fin010BorderoFacade` (ou `ConexosBorderoWriteGateway`) responsável pelo ciclo
> completo do borderô: `abrir`, `baixar`, `contarItens`, `apagar`, `finalizar`, `cancelar`,
> `estornar`. Os serviços de permuta passam a depender do façade — o `ConexosBaixaClient` vira
> detalhe de implementação do gateway.

**Resultado Esperado**
> Um único ponto de anti-corrupção contra o `fin010`. Migração para o Conexos v2 troca a
> implementação do façade sem impacto nos serviços.

**Métricas de sucesso**
- Chamadas diretas a `ConexosBaixaClient` fora do gateway: 11 → 0
- Nº de serviços impactados pela troca de v1→v2 do fin010: 2 → 1

**Risco de não fazer**
> Cada novo caso de escrita fin010 (ex.: reabrir cancelamento, estorno programático — hoje TODO)
> grava mais uma aresta serviço→SDK. Débito monotonicamente crescendo.

**Dependências**: integ-2 (para saber quem consome o quê).

---

### [mod-2] Extrair o loop de baixa de `reconciliar` para um método próprio (`baixarAlocacoesDoBordero`)

**QA**: Modifiability + Testability
**Tactic alvo**: Split Module / Refactor
**Esforço**: M (2–5d)
**Findings**: F-modifiability-2

**Problema**
> `ReconciliacaoPermutaService.reconciliar` está com 204 linhas (era 191, +13 pelo delta) e
> concentra: (a) resolução de adto/saldo, (b) auto-alocação lazy, (c) resolve de dry-run/write,
> (d) loop com 4 sub-branches de idempotência, (e) tratamento de erro por par, (f) cleanup do
> órfão. Já era o hot spot de mudança; cada tweak novo (I-Write-6, I-Write-7…) empurra-o mais
> longe da compreensibilidade. Biome não sinaliza (loop é linear), então não há gate automático.

**Melhoria Proposta**
> **Split Module** dentro da classe: extrair o corpo do `for (const aloc of alocacoes)` para um
> método privado `baixarAlocacoesDoBordero(params: { alocacoes; adto; filCod; dryRun; ... }):
> Promise<{ resultados; borCod?; borderoCriadoAqui }>`. `reconciliar` fica reduzido a:
> resolve → loop delegado → cleanup → return. O `borderoCriadoAqui` sai do escopo léxico e vira
> retorno explícito. Testes existentes continuam válidos (interface pública não muda).
> Considerar também extrair o bloco de "idempotência viva do settled" em
> `verificarIdempotenciaViva`.

**Resultado Esperado**
> `reconciliar` cai para ≤ 80 linhas; o loop vive isolado com escopo próprio.

**Métricas de sucesso**
- `reconciliar` LOC: 204 → ≤ 80
- Complexity cognitiva do novo método: ≤ 15 (mantém sem warning)
- Suite `ReconciliacaoPermutaService.test.ts`: 47/47 verde sem modificação

**Risco de não fazer**
> O próximo tweak que tocar essa janela (ex.: retry por par, política de auto-alocação
> condicional, log estruturado por par) empurra o método para > 250 linhas e nesse ponto qualquer
> PR passa a ser difícil de revisar. Ancoragem no gate: já é o método mais complexo do domínio
> permutas hoje.

**Dependências**: nenhuma (mas coordenar com test-4 — se aquele card refatorar a suite antes,
prefere-se um alvo já refatorado).

---

### [test-1] Cobrir a guarda `vazio` do BorderosPanel com teste automatizado

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d)
**Findings**: F-testability-1

**Problema**
> A UI hoje desabilita o botão "Aprovar" quando `!b.baixas.some(x => x.status === 'settled')`, que
> é a *primeira* barreira contra o casco 18538. Não há teste; um refactor pode inverter a
> condição sem CI reclamar. O harness FE (`__tests__/permutas-components.test.tsx` com
> `@testing-library/react`) já existe e serve de precedente.

**Melhoria Proposta**
> Criar `src/frontend/__tests__/borderos-panel.test.tsx`. Mockar `@/lib/api` (funções
> `fetchBorderos`, `fetchBaixasErp`) e renderizar o painel com **duas fixtures**: (i) borderô
> EM_CADASTRO com uma baixa `settled` → botão "Aprovar" **habilitado**; (ii) borderô EM_CADASTRO
> com uma única baixa `error` (o casco 18538) → botão "Aprovar" **desabilitado** e `title`
> contém "sem baixa".

**Resultado Esperado**
> Testes cobrindo a guarda `vazio`: 0 → 2. Regressão do 18538 no lado UX defendida por CI.

**Métricas de sucesso**
- Testes cobrindo a guarda `vazio` do BorderosPanel: **0 → 2**
- Arquivos `.test.tsx` no frontend cobrindo componentes de `app/permutas/`: **1 → 2**

**Risco de não fazer**
> Em 6 meses, alguém troca `status === 'settled'` por `status !== 'error'` (parece semanticamente
> igual, não é — `skipped`/`dry-run` também não são settled) e o casco volta a aparecer aprovável
> até alguém tentar.

**Dependências**: Nenhuma.

---

### [test-2] Adicionar asserções de log nos 3 caminhos de `removerBorderoOrfao`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤1d — 3 linhas por teste)
**Findings**: F-testability-2

**Problema**
> `removerBorderoOrfao` é best-effort com observabilidade **exclusivamente por log**
> (`BUSINESS_INFO` no sucesso, `BUSINESS_WARN` no ERP-tem-item e no `catch`). Os 4 testes
> I-Write-7 asseveram sobre os efeitos (excluirBordero/deleteBorderoCache/erro do retorno), mas
> nunca sobre `logService.warn`/`info` — se alguém rebaixar o log para `debug` ou mudar a
> `message`, dashboards e alertas mentem e CI aprova.

**Melhoria Proposta**
> Em cada um dos 3 testes existentes de I-Write-7 (todas-falham, ERP-tem-item, limpeza-falha),
> adicionar um `expect(logService.warn|info).toHaveBeenCalledWith(expect.objectContaining({ type:
> LOG_TYPE.BUSINESS_*, data: expect.objectContaining({ borCod: 1999 }) }))`.

**Resultado Esperado**
> Asserções sobre eventos observáveis do best-effort: **0 → 3** (uma por caminho).

**Métricas de sucesso**
- Testes I-Write-7 com asserção de log: **0 → 3**

**Risco de não fazer**
> Perda silenciosa da trilha operacional do único caminho automático que *manipula* o fin010 fora
> do handshake principal.

**Dependências**: cross-QA — a mesma asserção reforça `cq-observabilidade-orfao` (é pré-requisito
para que os contadores estruturados sejam confiáveis).

---

## P3 — Baixo

### [cq-predicado-vazio] Consolidar a definição semântica de "borderô vazio" e expor `podeAprovar` no serviço

**QA**: Modifiability + Availability + Integrability (dedup: modifiability-1 + availability-3)
**Tactic alvo**: Abstract Common Services + Removal from Service (fonte única do predicado)
**Esforço**: S
**Findings**: F-modifiability-1, F-availability-3, F-integrability-2

**Problema**
> O predicado "borderô vazio" aparece em três lugares (produtor
> `!resultados.some(isBaixaConfirmada)`, consumidor `listBaixas().length === 0`, front
> `!b.baixas.some(x => x.status === 'settled')`). As fontes de dados são intencionalmente
> diferentes (documentado no ADR-0030), mas os três compartilham o mesmo conceito de "status
> confirmado = `settled`". Se essa definição mudar, três pontos precisam mudar em sincronia. Além
> disso, o front recalcula o predicado em vez de consumir um flag do serviço, criando
> possibilidade de divergência em trilha stale.

**Melhoria Proposta**
> Duas mudanças complementares:
> 1. Extrair `BAIXA_STATUS_CONFIRMADO = 'settled' as const` em `src/shared/types/permuta.ts`,
>    importada pelos três pontos. Frontend e backend do monorepo já compartilham types via
>    `@/lib/types`.
> 2. Expor `podeAprovar: boolean` no `BorderoGestaoService.listarBorderos` calculado a partir do
>    mesmo predicado usado pelo `assertBorderoTemItens` (cache `vlrTotalLiquido>0` OU baixa
>    `settled` na trilha). Frontend consome esse flag em vez de recalcular.

**Resultado Esperado**
> 1 fonte de verdade para o valor "confirmado" + 1 ponto de decisão para "aprovável". Testes
> existentes continuam válidos; um teste adicional garante que o literal `'settled'` aparece só
> na constante e nos testes.

**Métricas de sucesso**
- Ocorrências literais de `'settled'` fora da constante/tipo: 3 → 0
- Duplicação de predicado front vs. back: 2 → 1
- Divergência do botão em teste de trilha stale: alcançável → impossível

**Risco de não fazer**
> Um refactor futuro (ex.: introduzir `reconciling-partial`) esquece um dos três pontos e
> reintroduz a bug-classe do borderô 18538 — aprovações vazias ou aprovações bloqueadas
> indevidamente.

**Dependências**: Nenhuma.

---

### [cq-timeout-limpeza] Circuit-breaker leve / teto de tempo na compensação em cenário de ERP degradado

**QA**: Availability + Fault Tolerance (dedup: availability-4 + fault-tolerance-4)
**Tactic alvo**: Degradation + Retry (com teto de custo) + Timeout explícito
**Esforço**: S
**Findings**: F-availability-4, F-fault-tolerance-4

**Problema**
> Quando o ERP está completamente indisponível, o `reconciliar` no caminho de falha total
> primeiro exaure retries em cada `gravarBaixaPermuta` e depois entra em `removerBorderoOrfao`,
> que faz um `listBaixas` também retentado (2 retries × 500 ms + jitter, timeout HTTP 40 s) e um
> `excluirBordero`. No pior caso, o request do analista fica pendurado por dezenas de segundos.
> Além disso, `removerBorderoOrfao` não tem timeout definido no site da chamada — herda do axios.

**Melhoria Proposta**
> Uma de duas alternativas: (a) passar `signal: AbortController` com timeout agregado de 5 s
> para o par `listBaixas + excluirBordero` — o que passar disso, ignora (log "compensação adiada
> — ERP indisponível"); (b) confirmar por HAR/config que o timeout do `ConexosBaixaClient` está
> ≤10s e documentar essa dependência em I-Write-7. Preferência: (a), pela objetividade. O casco
> fica no ERP e será limpo no próximo run com ERP saudável ou manualmente pelo painel.

**Resultado Esperado**
> Em incidente de ERP, o request do analista devolve o erro real da baixa em ≤ 60 s (não em
> ≤ 120 s + margem). O casco fica no ERP e será limpo no próximo run com ERP saudável; a UI
> espelha corretamente (guard consumidor + botão desabilitado).

**Métricas de sucesso**
- Tempo pior caso do `reconciliar` em cenário "ERP down": ~120 s + margem → ≤ 60 s
- Cascos criados no incidente: mesmos que hoje (compensação adiada, não removida)

**Risco de não fazer**
> Baixo — o cenário é raro (ERP totalmente fora do ar por >40 s durante uma reconciliação) e o
> casco fica coberto pelo consumidor. Card é polimento.

**Dependências**: Nenhuma.

---

### [deploy-4] Executar bump de versão v0.20.2 + entrada no CHANGELOG antes do merge

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-4

**Status**: ✅ **JÁ APLICADO** neste worktree — FE+BE em `0.20.2` (lockstep) + entrada
`v0.20.2 (2026-08-06)` no `CHANGELOG.md` citando ADR-0030 e o borderô 18538. O bump foi feito
manualmente (equivalente ao `scripts/bump-version.ps1 -Execute`) porque o runner é Linux e não
tem PowerShell instalado.

**Problema**
> `src/backend/package.json` e `src/frontend/package.json` seguiam em `0.20.1` — versão da release
> anterior. Green Criterion #10 (CLAUDE.md) exige bump para deltas com `fix`, e o job `tag-release`
> do CI é idempotente por tag, então sem bump o deploy do delta vai a produção sem GitHub Release
> nova. Delta é `fix(permutas)` motivado por borderô 18538.

**Melhoria Proposta**
> Bump semver PATCH (0.20.1 → 0.20.2) em lockstep FE+BE. Atualizar `CHANGELOG.md` com entrada
> citando ADR-0030 e o borderô 18538. Commit `chore(release): v0.20.2`.

**Resultado Esperado**
> Tag `v0.20.2` publicada pelo job `tag-release` no push para main; GitHub Release criada com
> CHANGELOG.md como referência. Rastreabilidade de rollback preservada.

**Métricas de sucesso**
- `src/{backend,frontend}/package.json.version`: 0.20.1 → 0.20.2 (lockstep) ✅
- Entrada v0.20.2 em `CHANGELOG.md`: ausente → presente ✅

**Risco de não fazer**
> Bloqueia Green Criterion #10 (o próprio pipeline recusa o PR); em produção o incidente
> 2026-08-06 fica sem tag rastreável.

**Dependências**: Precede o PR (obrigatório para gate).

---

### [integ-1] Documentar o teto de paginação de `listBaixas` e ancorar I-Write-7 nele

**QA**: Integrability
**Tactic alvo**: Adhere to Standards (documentação de boundary)
**Esforço**: S (≤1d)
**Findings**: F-integrability-1 (rebaixada de P2 para P3 pelo consolidador — ver §7 do REPORT)

**Problema**
> `ConexosBaixaClient.listBaixas` só lê `pageSize:200` da página 1. O guard I-Write-7 decide
> "borderô vazio" a partir de `.length === 0` — para uma checagem de vazio o teto não gera
> falso-positivo (se há qualquer baixa, ela está na página 1), mas o boundary não está
> documentado. Se a mesma fixture for reutilizada em contexto que precise contar TODAS as baixas
> (ex.: SISPAG), a suposição vira armadilha silenciosa.

**Melhoria Proposta**
> Adicionar em `ontology/business-rules/fin010-write-contract.md` (seção I-Write-7) o teto de
> 200 como boundary conhecido. No `ConexosBaixaClient.listBaixas`, tornar explícito no JSDoc que
> a chamada é single-page. Coletar P95 de `baixas.length` do cache `permuta_bordero` (query
> analítica única) para calibrar o teto. Cross-referenciar com ft-2 (log de truncamento em
> `rows.length === pageSize`).

**Resultado Esperado**
> Contrato de escrita cita paginação; consumidor detecta e alerta em caso de truncamento futuro.

**Métricas de sucesso**
- Doc I-Write-7 cita teto de paginação: ausente → presente
- P95 de `baixas.length` medido: ausente → registrado no doc

**Risco de não fazer**
> Baixo — cenário exigiria >200 baixas em um borderô de permuta, atualmente inexistente. Vira
> armadilha só se o teto for reusado em contexto de maior volume.

**Dependências**: parcialmente coberto por ft-2 (log de truncamento).

---

### [integ-2] Cross-referenciar I-Write-7 em `ontology/integrations/conexos.md`

**QA**: Integrability
**Tactic alvo**: Encapsulate (documentação)
**Esforço**: S (≤1d)
**Findings**: F-integrability-2

**Problema**
> A tabela de endpoints em `conexos.md:60` documenta `listBaixas` como "detalhe de borderôs
> lançados direto no Conexos (ADR-0014)" — não menciona o novo consumo pelo guard I-Write-7.
> Refactor futuro do client pode quebrar a semântica "array vazio = borderô vazio" sem que o
> revisor perceba que essa semântica virou carga arquitetural.

**Melhoria Proposta**
> Atualizar `ontology/integrations/conexos.md` (linhas 59-60) para citar, na coluna "propósito",
> ADR-0030 + I-Write-7 como consumidor da mesma operação. Adicionar bloco "Consumidores" no fim
> da seção fin010 mapeando `endpoint → serviço:método` de todo consumo interno.

**Resultado Esperado**
> Toda operação `fin010` documentada com seus consumidores nomeados. Cross-reference bidirecional
> entre business-rules e integrations.

**Métricas de sucesso**
- `conexos.md` cita I-Write-7 e ADR-0030: ausente → presente
- Ratio "operação fin010 documentada com consumidor": 0/11 → 11/11

**Risco de não fazer**
> Regressão silenciosa no refactor do `listGenericPaginated` — casco vazio volta ao produção.

**Dependências**: Nenhuma.

---

### [mod-3] Documentar `assertBorderoTemItens.throw` como contrato de UX

**QA**: Modifiability
**Tactic alvo**: Increase Semantic Coherence
**Esforço**: S (literalmente 5min)
**Findings**: F-modifiability-3

**Problema**
> A mensagem lançada por `assertBorderoTemItens` (`"Borderô N não possui baixas — não há o que
> aprovar. Ele ficou vazio porque a baixa falhou depois de criá-lo; use 'Excluir' para
> removê-lo."`) é lida palavra-por-palavra pelo `toast.error` do `BorderosPanel.confirmarAcao`. É
> a instrução acionável ao analista. TypeScript não avisa se um refactor "melhora" o texto e
> derruba o "use Excluir".

**Melhoria Proposta**
> Adicionar comentário no método marcando a mensagem como parte do contrato UX (`@ux-contract`),
> e um teste que garanta a presença do fragmento "use \"Excluir\"" — evita erosão.

**Resultado Esperado**
> A mensagem é vista como interface e não como log de debug.

**Métricas de sucesso**
- Presença de `@ux-contract` (ou equivalente) no JSDoc do método: ausente → presente
- Teste que assert o fragmento chave: ausente → presente

**Risco de não fazer**
> Baixo, mas real — um refactor de "internacionalização" ou "logs mais concisos" reescreve a
> mensagem e o analista perde a instrução; volta o mesmo problema que o delta corrigiu.

**Dependências**: Nenhuma.

---

### [sec-1] Extrair helper `safeErpErrMessage(err)` para uniformizar a serialização de erros do ERP em log

**QA**: Security
**Tactic alvo**: Encrypt Data
**Esforço**: S (≤1d)
**Findings**: F-security-3

**Problema**
> O delta adiciona mais um catch que faz `err instanceof Error ? err.message : String(err)`. É o
> padrão correto — evita que o `cause: AxiosError` com `config.headers.Cookie` (sid do Conexos)
> escape para o log — mas é reproduzido à mão em pelo menos três lugares
> (`routes/permutas.ts`, `BorderoGestaoService.excluirBaixa`, agora
> `ReconciliacaoPermutaService.removerBorderoOrfao`). Cada nova cópia é uma chance de alguém
> trocar por `String(err)`, `JSON.stringify(err)` ou `err.stack` sem perceber.

**Melhoria Proposta**
> Criar `src/backend/domain/libs/log/safeErpErrMessage.ts` com uma única função que devolve
> string sanitizada (`.message` de Error, `String(err)` de non-Error, `undefined`-guard).
> Refatorar os três sites atuais para usá-la. Adicionar regra do `PatternGuardian`/lint proibindo
> passar `err` cru para `logService` fora dessa função.

**Resultado Esperado**
> 1 único ponto de serialização de erro de ERP para log; a próxima cópy-paste do padrão vira
> compile-error/lint-error em vez de exposição silenciosa.

**Métricas de sucesso**
- Sites com serialização ad-hoc de `err` para log: 3 → 0
- Ocorrências de `err.cause` / `err.response` / `err.stack` em `logService.*({ data })`: 0 → 0
  (garantido por lint)

**Risco de não fazer**
> Probabilidade pequena mas cumulativa — em 6 meses, mais uma feature adiciona catch e alguém
> troca por `JSON.stringify(err)`, expondo Cookie/sid do Conexos no log storage.

**Dependências**: Nenhuma.

---

### [sec-2] Rodar `npm audit` (backend + frontend) em pipeline non-`--quick`

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S (≤1d)
**Findings**: (cobre lacuna declarada em `_shared-metrics.md`)

**Problema**
> O `_shared-metrics.md` explicita que `npm audit` não foi coletado neste run (modo `--quick`).
> O delta não introduz dependências novas, mas o baseline de CVEs não foi verificado — se uma
> `axios`/`zod`/`next` tiver crítico conhecido, o gate não pega.

**Melhoria Proposta**
> No próximo `/regis-review` non-quick, executar `npm audit --json` em `src/backend` e
> `src/frontend`; registrar contagens crit/high/moderate no `_shared-metrics.md` e falhar o gate
> em `critical>0` ou `high>0`.

**Resultado Esperado**
> Contagem de CVEs auditada por run: `⚠️ não coletado` → `crit=0, high=0, mod≤5`; gate falha em
> quebra do alvo antes de merge.

**Métricas de sucesso**
- `npm audit` executado por run non-quick: 0/N → N/N
- CVEs critical/high: desconhecido → 0/0

**Risco de não fazer**
> CVE crítico em runtime (Node) ou lib de auth entra em produção sem sinal; MTTR alto quando a
> divulgação vira exploit ativo.

**Dependências**: Nenhuma — configuração de CI.

---

### [test-3] Declarar em teste a política do `assertBorderoTemItens` sob falha do `listBaixas`

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤0,5d)
**Findings**: F-testability-3

**Problema**
> O guard `assertBorderoTemItens` só é testado nos ramos "ERP retorna vazio" e "trilha tem
> `error`". Se `listBaixas` lançar `ConexosError` (ERP indisponível), a exceção propaga e o
> analista trava — decisão fail-closed razoável, mas **não documentada em teste**. Um refactor
> futuro pode envolver num `try/catch => allow` e inverter a política sem alarme.

**Melhoria Proposta**
> Adicionar 1 teste em `BorderoGestaoService.test.ts` sob `describe('finalizarBordero — casco
> vazio (I-Write-7)')`: `it('bloqueia quando listBaixas falha — fail-closed anti-aprovação-de-casco')`,
> com `conexosClient.listBaixas.mockRejectedValue(new Error('ERP timeout'))` e
> `expect(...).rejects.toThrow(/ERP timeout/)` + `expect(finalizarBordero mock).not.toHaveBeenCalled()`.

**Resultado Esperado**
> Caminhos de `assertBorderoTemItens` cobertos: **2 → 3**. Política fail-closed do guard virada
> em invariante testável.

**Métricas de sucesso**
- Ramos de `assertBorderoTemItens` cobertos por teste: **2 → 3**

**Risco de não fazer**
> Baixo hoje; potencial inversão silenciosa de política em tweak futuro.

**Dependências**: Nenhuma.

---

### [test-4] Extrair helpers para segmentar `ReconciliacaoPermutaService.test.ts` (>500 LOC)

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: M (2–3d — inclui refatorar o `buildDeps` compartilhado)
**Findings**: F-testability-4

**Problema**
> A suite chegou a 736 LOC ao acomodar 6 blocos de invariantes (I-Write-1 a 7 + idempotência
> viva + âncora + multi-título). Cada `/feature-tweak` sobre o fluxo de baixa empurra +50 a +100
> LOC. Bass alerta em >500. Ainda legível hoje, mas o slope está apontado.

**Melhoria Proposta**
> Sem mudar cobertura, extrair um arquivo `ReconciliacaoPermutaService.i-write-7.test.ts`
> (colocated) para o bloco I-Write-7 e um builder `buildDepsForOrphan(...)` compartilhado por
> composição — se o custo de extrair `buildDeps` for alto, adiar.

**Resultado Esperado**
> Maior arquivo de teste do delta: **736 LOC → ≤ 500 LOC por arquivo**; suíte segmentada por
> invariante (I-Write-N por arquivo).

**Métricas de sucesso**
- LOC do maior arquivo de teste em `permutas/`: **736 → ≤ 500**

**Risco de não fazer**
> Em ~2 tweaks a suite passa de 900 LOC e a leitura por invariante começa a doer.

**Dependências**: idealmente após test-2 estabilizar as asserções de log (evita mover teste e
depois voltar pra editá-lo).
