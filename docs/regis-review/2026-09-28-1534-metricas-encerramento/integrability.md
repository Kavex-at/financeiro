---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-28-1534-metricas-encerramento
agent: qa-integrability
generated_at: 2026-09-28T15:34:00-03:00
scope: backend
score: 8
findings_count: 2
cards_count: 2
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| `kavex-report-ciclo` (skill externa) e a tela Métricas | `GET /metricas/ciclo` lido depois do deploy da 0065 (ADR-0052) | `metricas.metricas_ciclo()` (função lida pelo repository) + `permuta_alocacao_execucao`/`solicitacao_numerario_execucao` (ledgers de escrita) | Produção, pós-migration, sem mudança de forma do contrato | O consumidor recebe as MESMAS 9 colunas + `parcial`/`apurado_ate`, na mesma ordem — só o VALOR de semanas já publicadas pode mudar, por design (D4) | 0 desvio de forma/ordem/tipo; retroatividade de valor limitada às linhas com `criado_em` ≠ `encerrado_em` (baseline: 2/190 linhas, R$ 503.066,69, medido 18/09) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Colunas do contrato (`RETURNS TABLE`) alteradas neste delta | 0 — função redefinida com as mesmas 9 colunas + `parcial`/`apurado_ate` | 0 | ✅ | `src/backend/migrations/0065_metricas_ciclo_data_pelo_encerramento.sql:57-68`; guarda estática (pré-existente) continua validando `0058` inalterada |
| `routes/metricas.ts` / `MetricasCicloRepository.ts` / `MetricaCiclo.ts` tocados neste delta | 0 arquivos | 0 (mudança é só na fonte de dado, não no boundary HTTP) | ✅ | `git diff --stat origin/main..HEAD` (ver `_shared-metrics.md`) — nenhum dos três aparece no diff |
| Sites de escrita que carimbam `encerrado_em` com a MESMA expressão SQL literal (`CASE WHEN status IN (...) THEN COALESCE(encerrado_em, now()) ELSE now() END`) | 3 (Permuta: `markSettled`, `markParcial`, `markError`) + 2 (SN: `markSettled`, `markError`) = 5 sites, 2 arquivos, 0 abstração compartilhada | ≤1 fonte de verdade por regra de negócio (trigger, coluna computada ou helper) | ⚠️ | `PermutaExecucaoRepository.ts:454-455,509-510,540`; `SolicitacaoNumerarioExecucaoRepository.ts:323-324,353` |
| Testes que fixam a expressão `encerrado_em` literal, por repositório | 2/2 repositórios (`PermutaExecucaoRepository.test.ts:277-300`, `SolicitacaoNumerarioExecucaoRepository.test.ts:224-238`) | 2/2 | ✅ | grep acima |
| Testes de contrato cross-repo (Permuta × SN) validando que a MESMA regra do ADR-0052 vale nos dois ledgers | 0 (cada repo testado isoladamente; nada compara os dois) | ≥1 teste "as duas frentes seguem a mesma doutrina" | ⚠️ | busca por teste combinando os dois arquivos: nenhum resultado |
| Cobertura de fixture/integration test para os cenários de reexecução (o próprio motivo do ADR-0052) | 5 novos testes de integração (retentativa permuta, retentativa SN, re-clique, backfill, contrato) rodando contra Postgres real | ≥1 por cenário de reexecução | ✅ | `_shared-metrics.md` — `vwMetricasCiclo.integration.test.ts` 24/24 |
| Validação do antes/depois contra produção real (antes de publicar o próximo report) | Pendente — consulta read-only pronta, não executada nesta sessão (acesso negado) | Executada antes do merge ou logo após o deploy | ⚠️ não medível localmente | `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md` |
| Sinal no contrato de wire (`MetricaCiclo`) distinguindo linha estável de linha recalculada | Ausente (nenhum campo tipo `revisado_em`/`recalculado`) | N/A para este delta (decisão deliberada, ADR-0052 D4) — mas é precedente para a próxima correção retroativa | ⚠️ aceito como trade-off, não como lacuna nova | `src/backend/domain/interface/metricas/MetricaCiclo.ts:1-25` (sem campo de revisão); ADR-0052 "Consequências" |

## 3. Tactics — Cobertura no nf-projects (delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Regra de negócio ("quando uma execução conta como encerrada") fica só no repositório de escrita, nunca no service/rota; a leitura (`MetricasCicloRepository`) não sabe COMO `encerrado_em` foi carimbado, só o lê via `COALESCE` | ✅ presente | `0065...sql:59-68` (função só lê); `PermutaExecucaoRepository.ts:454` (só escreve) |
| Use an Intermediary | N/A — delta não adiciona client/integração externa nova, só ajusta ledgers internos | N/A | — |
| Restrict Communication Paths | Única via de escrita de `encerrado_em`: os 3 métodos terminais do repositório (`markSettled`/`markParcial`/`markError`); nenhuma outra query do domínio grava a coluna | ✅ presente | teste explícito "re-clique e demais escritas não mexem em `encerrado_em`" — `PermutaExecucaoRepository.test.ts:302-322`, `SolicitacaoNumerarioExecucaoRepository.test.ts:238-247` |
| Adhere to Standards | Segue o contrato pré-existente da view/função (9 colunas) sem alterar forma; nomenclatura da coluna documentada via `COMMENT ON COLUMN` | ✅ presente | `0065...sql:52-56` |
| Abstract Common Services | A regra "quem carimba `encerrado_em` e quando" é reimplementada por SQL literal 5 vezes em 2 arquivos, sem função/trigger/helper compartilhado — ver F-integrability-1 | ⚠️ parcial | `PermutaExecucaoRepository.ts:454-455,509-510,540`; `SolicitacaoNumerarioExecucaoRepository.ts:323-324,353` |
| Discover Service | N/A — sem SSM/client novo neste delta | N/A | — |
| Tailor Interface | N/A para este delta — não introduz opt-in de consumidor (isso foi a 0060/ADR-0048, fora de escopo) | N/A | — |
| Configure Behavior | N/A — nenhum parâmetro novo configurável; janelas/pisos inalterados | N/A | — |
| Manage Resources | Migration corre em transação por arquivo + advisory lock (padrão do runner, não tocado neste delta); backfill sem `LIMIT`/batch, mas ~190 linhas, abaixo do limiar de 1.000 que exige script de reverse | ✅ presente (dentro do padrão existente) | `_shared-metrics.md` "Rows touched by 0065 backfill" |
| Orchestrate | N/A — sem orquestração de múltiplos collaborators neste delta (é escrita local + leitura de função SQL) | N/A | — |
| Manage Resource Coupling | N/A — não há recurso compartilhado novo | N/A | — |
| Contract testing (moderno) | Forte para o cenário deste delta: 5 testes de integração contra Postgres real cobrindo retentativa/re-clique/backfill/contrato, mais guardas estáticas por repositório fixando a expressão SQL — mas nenhum teste cruza os dois ledgers para provar que a MESMA doutrina (ADR-0052) vale nos dois | ⚠️ parcial | ver métricas acima |
| Versioning strategy (moderno) | Consciente e documentada: ADR-0052 descarta chave de `metrica` nova, escolhe recalcular a série no lugar — decisão explícita, não omissão | ✅ presente (decisão, não lacuna) | ADR-0052 "Descartado: chave de `metrica` nova" |
| Backward-compatibility shims (moderno) | Não aplicável como shim — o delta assume, por decisão, que romper retroativamente o VALOR de uma semana já publicada é aceitável e documenta o porquê; não finge compatibilidade que não existe | ✅ presente, decisão honesta (ver F-integrability-2 para o gap residual: nenhum sinal de "isto foi recalculado" no payload) | ADR-0052 "Consequências" |
| Observability of integration failures (moderno) | N/A neste delta — não altera o endpoint HTTP nem adiciona log; a observabilidade do endpoint já era tema do ciclo anterior (`metricas-historico`, F-integrability-3) | N/A para o delta | `ontology/_inbox/metricas-ciclo-regis-followups.md:20` (INTEG-3, já em aberto) |

## 4. Findings (achados)

### F-integrability-1: Regra de carimbo de `encerrado_em` duplicada 5x em SQL literal, sem abstração compartilhada

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:454-455,509-510,540`; `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts:323-324,353`
- **Evidência (objetiva)**:
  ```
  -- PermutaExecucaoRepository.ts:454 (markSettled) e :509 (markParcial), idênticas:
  encerrado_em = CASE WHEN status IN ('settled', 'parcial')
                      THEN COALESCE(encerrado_em, now()) ELSE now() END,

  -- SolicitacaoNumerarioExecucaoRepository.ts:323 (markSettled), variante de 1 status:
  encerrado_em = CASE WHEN status = 'settled'
                      THEN COALESCE(encerrado_em, now()) ELSE now() END,

  -- markError nos dois arquivos (linhas 540 e 353): `encerrado_em = now(),` repetido
  ```
- **Impacto técnico**: a doutrina do ADR-0052 ("1º encerramento imóvel; falha sobrescrevível") existe só como texto idêntico repetido em 5 pontos de 2 arquivos, sem função/trigger/coluna computada central. Um novo terminal de status (ex.: `cancelado`) adicionado a uma frente e esquecido na lista `IN (...)` da outra não quebra nenhum teste hoje — cada repositório só valida a própria string — e produz uma semana subfaturada em silêncio, o mesmo tipo de bug que motivou esta ADR.
- **Impacto de negócio**: cada nova integração de escrita no roadmap (Conexos `fin010` write-side de Permutas/SISPAG, e futuramente Nexxera) que precisar contar para as mesmas métricas terá que replicar esta expressão à mão, com o mesmo risco de drift — custo marginal de integração que crescerá a cada ledger novo.
- **Métrica de baseline**: 5 sites de escrita / 2 arquivos com a mesma regra em SQL literal; 0 função ou trigger compartilhada; 0 teste cruzando os dois repositórios para provar consistência da doutrina.

### F-integrability-2: Contrato de wire não sinaliza quando um valor de semana já publicada foi recalculado

- **Severidade**: P2
- **Tactic violada**: Backward-compatibility shims / Versioning strategy
- **Localização**: `src/backend/domain/interface/metricas/MetricaCiclo.ts:1-25` (payload sem campo de revisão); decisão em `ontology/decisions/0052-...md` ("Consequências")
- **Evidência (objetiva)**:
  ```
  // MetricaCiclo não tem `revisado_em`/`recalculado`: a mesma chave (`frente`+`metrica`+`janela_inicio`)
  // pode devolver valor diferente do que o report leu no ciclo 6, sem nenhum campo distinguindo isso.
  ```
- **Impacto técnico**: este delta é, por decisão (ADR-0052 D4), a primeira vez que o contrato quebra a suposição implícita "o valor de uma semana fechada não muda depois de publicado". A decisão está bem documentada no ADR, mas nada no PAYLOAD deixa essa quebra visível para um consumidor automatizado — só para quem lê a ontologia.
- **Impacto de negócio**: se um consumidor futuro (Nexxera/GED, ou uma segunda skill) cachear ou arquivar a resposta assumindo imutabilidade — suposição razoável para uma métrica "semana fechada" — uma correção retroativa como esta (R$ 503.066,69 movendo de semana) se propaga sem aviso.
- **Métrica de baseline**: magnitude conhecida da retroatividade deste delta: 2 linhas em 190, R$ 503.066,69 (medido 18/09, `_shared-metrics.md`); 0 campo no contrato sinalizando revisão.

## 5. Cards Kanban

### [integrability-1] Extrair a doutrina de `encerrado_em` para um único ponto por ledger

- **Problema**
  > A regra do ADR-0052 (1º encerramento imóvel, falha sobrescrevível) está copiada como SQL literal em 5 pontos de 2 repositórios, sem fonte única de verdade (F-integrability-1). Cada integração de escrita futura (Conexos `fin010`, Nexxera) que precisar alimentar as mesmas métricas terá que replicar a expressão corretamente à mão.

- **Melhoria Proposta**
  > Tactic: Abstract Common Services. Extrair a expressão para uma constante/template SQL compartilhado por repositório (ex.: método privado `stampEncerradoEm(statusTerminal: string[])` que monta o fragmento), ou avaliar mover o carimbo para um trigger de banco parametrizado por lista de status terminais por tabela — decisão a validar com o Yuri dado o princípio "sem GRANT/trigger paralelo à aplicação" já registrado no ADR-0045 D5. Adicionar 1 teste cruzando os dois repositórios que prove que a doutrina é a mesma nos dois ledgers.

- **Resultado Esperado**
  > Um novo status terminal ou um novo ledger de execução herda a regra sem copiar SQL à mão. Métrica: sites de escrita com a expressão duplicada — 5 → 1 fonte compartilhada (ou 0 se migrada para trigger); testes cross-repo de consistência — 0 → ≥1.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Sites de escrita com a expressão SQL duplicada: 5 → 1 (ou 0, se via trigger)
  - Teste de consistência cross-repo (Permuta × SN): 0 → ≥1
- **Risco de não fazer**: a próxima frente de escrita (Conexos `fin010`, Nexxera) replica a regra errado, e o mesmo tipo de subfaturamento silencioso que motivou o ADR-0052 se repete em um ledger novo — sem teste que pegue o desvio, porque cada repositório só valida a própria cópia.
- **Dependências**: nenhuma; pode ser feito como follow-up isolado.

### [integrability-2] Sinalizar no payload quando uma janela já apurada foi recalculada desde a última leitura

- **Problema**
  > Este delta muda, por decisão deliberada, o valor de semanas já publicadas ao cliente (R$ 503.066,69 em 2/190 linhas na última medição). O contrato de wire (`MetricaCiclo`) não tem nenhum campo que sinalize essa quebra para um consumidor automatizado (F-integrability-2) — hoje só o `kavex-report-ciclo` é o consumidor, e ele não faz cache entre ciclos, mas o roadmap já prevê mais integrações lendo dados do financeiro.

- **Melhoria Proposta**
  > Tactic: Backward-compatibility shims / Versioning strategy. Não é obrigatório para este delta (nenhum consumidor atual depende de imutabilidade), mas registrar em `ontology/_inbox/metricas-ciclo-regis-followups.md` a decisão de adicionar, na próxima mudança de contrato, um campo leve (ex.: hash/checksum da leitura, ou `series_version`) que permita a um consumidor detectar retroatividade sem comparar valor a valor.

- **Resultado Esperado**
  > Próxima correção retroativa (haverá outra, dado que o ledger é upsert por natureza) é detectável programaticamente por quem consome a API, não só por quem lê o ADR. Métrica: mecanismo de sinalização de revisão — ausente → definido em ADR/contrato.

- **Tactic alvo**: Versioning strategy
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para o registro da decisão; M (2-5d) se implementado
- **Findings relacionados**: F-integrability-2
- **Risco de não fazer**: um futuro consumidor que arquive/cacheie leituras semanais (razoável para "semana fechada") herda dados obsoletos sem meio de saber que deveria reler.
- **Dependências**: nenhuma; pode entrar como follow-up de baixa prioridade.

## 6. Notas do agente

Escopo: só o delta (migration 0065 + 2 repositórios de escrita + testes; ADR-0052). Contrato HTTP
(`routes/metricas.ts`, `MetricasCicloRepository.ts`, `MetricaCiclo.ts`) não foi tocado neste delta — os
3 findings de integrabilidade do ciclo anterior (contract test cross-repo com `metrics.py`, versionamento,
observabilidade por origem) permanecem em aberto em `ontology/_inbox/metricas-ciclo-regis-followups.md`
(`INTEG-2/3/4/5`, `CROSS-CONTRACT`) e não são reabertos aqui para evitar duplicata — apenas referenciados.
Cross-QA: F-integrability-1 se sobrepõe a Modifiability (mesma duplicação de código é custo de mudança,
não só de integração) — sinalizar ao consolidator para não duplicar card. F-integrability-2 também toca
Testability/Fault-Tolerance (a validação produção do antes/depois, `ontology/_inbox/metricas-ciclo-data-
encerramento-validacao.md`, ainda não rodou — não é achado de Integrability em si, mas é pré-requisito
para fechar com segurança o mesmo delta que gera F-integrability-2).
