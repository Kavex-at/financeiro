---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-28-1534-metricas-encerramento
agent: qa-modifiability
generated_at: 2026-09-28T18:40:00-03:00
scope: backend
score: 7.5
findings_count: 2
cards_count: 2
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista/Yuri, via ADR-0052 (`/feature-tweak`) | Corrigir a data usada para atribuir uma baixa à semana do ciclo (encerramento, não criação) | `PermutaExecucaoRepository.ts`, `SolicitacaoNumerarioExecucaoRepository.ts`, `metricas.metricas_ciclo` (migration 0065) | Backend raw-SQL/sem ORM, DDD com repositórios `@injectable`, números já publicados semanalmente ao cliente (`kavex-report-ciclo`) | Desenvolvedor precisa tocar 3 sítios de SQL bruto que codificam a mesma regra de "quais status são terminais" e reescrever por inteiro a função de 144 linhas em uma nova migration (Postgres exige `CREATE OR REPLACE` do corpo inteiro) | Delta de 12 arquivos / +706 −5 para uma mudança conceitual de 1 coluna de data; da função de 144 linhas redefinida, apenas ~5 (~3,5%) de fato mudam — o resto é cópia literal da 0058 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos / linhas tocados por uma mudança de 1 regra de data | 12 arquivos, +706/−5 (código: 6 arquivos, +226 líquido; resto é ADR/inbox/release) | Mudança de 1 regra de leitura concentrada em ≤2 camadas | ⚠️ | `git diff --stat origin/main..HEAD` |
| % do corpo de `metricas.metricas_ciclo` reescrito de fato vs. copiado literalmente da 0058 | ~5 de 144 linhas mudam (~3,5%); as outras 139 são restatement byte-a-byte | Mudança de regra deveria tocar um fragmento pequeno e isolado, não o corpo inteiro | ⚠️ | `diff` entre corpo da função em `0058_vw_metricas_ciclo.sql` e `0065_...sql` |
| Duplicação do invariante "quais status congelam `encerrado_em`" | 3 ocorrências de `CASE WHEN status IN (...)` (2× `PermutaExecucaoRepository.ts`, 1× `SolicitacaoNumerarioExecucaoRepository.ts`), nenhuma derivada do tipo TS já existente (`ExecucaoStatus`, `RecebimentoExecucaoStatus`) | 1 fonte única do invariante por ledger | ⚠️ | `grep -n encerrado_em src/backend/domain/repository/{permutas,recebimentos}/*.ts`; `PermutaExecucaoRepository.ts:16` |
| LOC do arquivo tocado `PermutaExecucaoRepository.ts` | 742 (9º maior arquivo do backend); delta soma +10 | p95 ≤ 400, max ≤ 600 (heurística Split Module) | ❌ | `wc -l` |
| LOC do arquivo tocado `SolicitacaoNumerarioExecucaoRepository.ts` | 390; delta soma +6 | ≤ 400 | ✅ | `wc -l` |
| Fan-in de `PermutaExecucaoRepository` (contexto — arquivo mais tocado do delta) | 10 arquivos (6 services, 1 repository, 1 interface, 1 route, 1 job) | Referência: mudança aqui ecoa largo | ℹ️ contexto | `grep -rl PermutaExecucaoRepository src/backend --include='*.ts'` |
| Fan-in de `SolicitacaoNumerarioExecucaoRepository` | 6 arquivos | Referência | ℹ️ contexto | idem |
| Contrato da função SQL (9 colunas + `parcial`/`apurado_ate`) | Idêntico ao da 0058; `MetricasCicloRepository.ts` e `routes/metricas.ts` (consumidores) não precisaram de alteração | Mudança de regra não deveria quebrar consumidores | ✅ | `diff` de assinatura 0058 vs 0065 |
| Cobertura de teste da mudança | +5 casos de integração SQL (retentativa permuta, retentativa SN, re-clique, backfill, contrato), +5 guards estáticos, +2 suites de repositório (unit) | Mudança de regra de negócio coberta por teste de contrato | ✅ | `_shared-metrics.md` |
| Linhas afetadas pelo backfill (reversibilidade) | ~190 (permuta + SN) | < 1.000 (limiar que exige script de rollback) | ✅ | `migrations/rollbacks/README.md` via `_shared-metrics.md` |

### Apêndice — Top-10 maiores arquivos do backend (contexto de repositório, não exclusivo do delta)

| # | Arquivo | LOC | Tocado neste delta? |
|---|---|---|---|
| 1 | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` | 2415 | Não |
| 2 | `src/backend/domain/client/ConexosGerDocProcessoClient.ts` | 1300 | Não |
| 3 | `src/backend/domain/service/permutas/EleicaoPermutasService.ts` | 1143 | Não |
| 4 | `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` | 1140 | Não |
| 5 | `src/backend/domain/service/sispag/RemessaService.ts` | 1111 | Não |
| 6 | `src/backend/domain/client/ConexosSispagWriteClient.ts` | 1090 | Não |
| 7 | `src/backend/routes/recebimentos.ts` | 984 | Não |
| 8 | `src/backend/routes/permutas.ts` | 933 | Não |
| 9 | `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts` | 742 | **Sim (+10)** |
| 10 | `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts` | 736 | Não |

### Apêndice — Top-10 maior fan-in entre services (contexto de repositório)

| # | Service | Fan-in (arquivos que o referenciam) | Relação com o delta |
|---|---|---|---|
| 1 | `LogService` | 37 | Nenhuma |
| 2 | `ReconciliacaoPermutaService` | 9 | Consome `PermutaExecucaoRepository` (tocado) |
| 3 | `SolicitacaoNumerarioService` | 7 | Nenhuma direta |
| 4 | `RecebimentoNumerarioService` | 7 | Consome `SolicitacaoNumerarioExecucaoRepository` (tocado) |
| 5 | `EleicaoPermutasService` | 7 | Nenhuma |
| 6 | `ErpErrorInterpreter` | 6 | Nenhuma |
| 7 | `SaldoAlocacaoAdiantamentoService` | 5 | Consome `PermutaExecucaoRepository` (tocado) |
| 8 | `RemessaService` | 5 | Nenhuma |
| 9 | `NotificacaoService` | 5 | Nenhuma |
| 10 | `GestaoPermutasService` | 5 | Consome `PermutaExecucaoRepository` (tocado) |

## 3. Tactics — Cobertura no financeiro (aplicada ao delta)

| Tactic (Bass) | Implementação atual no delta | Status | Evidência |
|---|---|---|---|
| Split Module | Delta adiciona ao arquivo já acima do teto (742 LOC) em vez de extrair a lógica de carimbo de estado terminal para um módulo próprio | ⚠️ parcial | `PermutaExecucaoRepository.ts` (742 LOC, +10 no delta) |
| Increase Semantic Coherence | A responsabilidade nova (carimbar `encerrado_em`) é coesa com a responsabilidade existente do repositório (transições de estado do ledger) | ✅ presente | `markSettled`/`markParcial`/`markError` no mesmo arquivo que já concentra as transições |
| Encapsulate | O invariante "quais status congelam a data" não está encapsulado atrás do tipo `ExecucaoStatus`/`RecebimentoExecucaoStatus` já existente — é reescrito como literal SQL 3x | ⚠️ parcial | ver F-modifiability-1 |
| Use an Intermediary | `COALESCE(encerrado_em, criado_em)` funciona como um intermediário de leitura que desacopla o modelo de leitura (métricas) da coluna nova, sem exigir migração de todo o histórico de uma vez | ✅ presente | `0065...sql:114,140-141` |
| Restrict Dependencies | Nenhuma SQL fora dos repositórios toca `permuta_alocacao_execucao`/`solicitacao_numerario_execucao` diretamente; consumidores (`MetricasCicloRepository`, `routes/metricas.ts`) permaneceram intocados | ✅ presente | fan-in checado; `diff --stat` não lista esses arquivos |
| Refactor | Regra de negócio mudou copiando o corpo inteiro da função (144 linhas) em vez de isolar a parte variável | ⚠️ parcial | ver F-modifiability-2 |
| Abstract Common Services | `RecebimentoExecucaoRepository` já documenta "espelha `PermutaExecucaoRepository`"; este delta acrescenta uma 3ª cópia quase idêntica do padrão `CASE WHEN status IN (...) THEN COALESCE(encerrado_em, now())` sem extrair um helper comum | ⚠️ parcial | `RecebimentoExecucaoRepository.ts:16` (comentário "Espelha PermutaExecucaoRepository"); grep `encerrado_em` |
| Defer Binding (config/polimorfismo/plugin/registro em runtime) | N/A para este delta — a lista de status terminais é regra de negócio versionada em código/ADR, não um parâmetro de ambiente; não há caso de uso para torná-la configurável em runtime | N/A | justificativa acima |

## 4. Findings (achados)

### F-modifiability-1: Invariante "status que congela `encerrado_em`" duplicado em 3 literais SQL, desacoplado do tipo TS existente

- **Severidade**: P2 (débito técnico defensável — não bloqueia o delta, mas reabre a classe de bug que a própria ADR-0052 corrige)
- **Tactic violada**: Encapsulate
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts` (2 ocorrências, nos métodos `markSettled`/`markParcial`); `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts` (1 ocorrência)
- **Evidência (objetiva)**:
  ```
  // PermutaExecucaoRepository.ts:16
  export type ExecucaoStatus = 'pending' | 'reconciling' | 'settled' | 'error' | 'parcial';

  // mesmo arquivo, dentro do SQL de markSettled/markParcial (2x):
  encerrado_em = CASE WHEN status IN ('settled', 'parcial')
                      THEN COALESCE(encerrado_em, now()) ELSE now() END,

  // SolicitacaoNumerarioExecucaoRepository.ts, dentro do markSettled:
  encerrado_em = CASE WHEN status = 'settled'
                      THEN COALESCE(encerrado_em, now()) ELSE now() END,
  ```
- **Impacto técnico**: nenhuma referência de tipo liga a lista `('settled', 'parcial')` ao union `ExecucaoStatus`. Se um novo status terminal de sucesso for adicionado (ex.: um estado de baixa revisada manualmente), o `typecheck`/`lint` não acusam nada — os 3 literais continuam compilando e passando, e a linha nova silenciosamente conta na semana errada, exatamente o sintoma que motivou a ADR-0052 (2 linhas, R$ 503 mil, medido 18/09).
- **Impacto de negócio**: reabertura da mesma classe de erro que já exigiu uma ADR, uma migration de backfill e explicação ao cliente sobre um número de report que mudou retroativamente — próxima ocorrência tem o mesmo custo de investigação e comunicação.
- **Métrica de baseline**: 3 ocorrências independentes do mesmo invariante, 0 amarradas ao tipo `ExecucaoStatus`/`RecebimentoExecucaoStatus` (P2 — abaixo do limiar de P1 por não haver, hoje, uma segunda tentativa de mudança de status em andamento que dispute a regra).

### F-modifiability-2: Regra de negócio da métrica exige reescrever a função SQL inteira (144 linhas) a cada mudança

- **Severidade**: P2 (débito técnico defensável)
- **Tactic violada**: Refactor / Reduce Size of Module
- **Localização**: `src/backend/migrations/0065_metricas_ciclo_data_pelo_encerramento.sql:71-214` (função `metricas.metricas_ciclo`) vs. `src/backend/migrations/0058_vw_metricas_ciclo.sql`
- **Evidência (objetiva)**:
  ```
  $ diff <(corpo da função em 0058) <(corpo da função em 0065)
  # 3 blocos alterados (data_local; 2 condições de JOIN) = ~5 linhas
  # de um corpo de 144 linhas (linhas 71–214 da 0065) → ~96,5% é cópia literal da 0058
  ```
- **Impacto técnico**: Postgres exige `CREATE OR REPLACE FUNCTION` com o corpo inteiro; sem decomposição em views/funções menores (ex.: uma função por frente que já resolva `COALESCE(encerrado_em, criado_em)`), qualquer revisão de code review precisa comparar 144 linhas para achar as ~5 que mudaram — e um deslize num dos 2 ramos `UNION ALL` (Permutas vs. Recebimentos) no copy-paste passa despercebido sem um guard específico por ramo.
- **Impacto de negócio**: a 0058 já foi redefinida uma vez em 14 dias (0058 → 0065); cada nova regra de métrica carrega o mesmo risco de cópia que gerou o incidente dos R$ 503 mil — o custo de mudança futuro desta função permanece alto mesmo depois de corrigida a regra atual.
- **Métrica de baseline**: 139/144 linhas (~96,5%) idênticas entre as duas definições da função; 1 redefinição completa em 14 dias desde a criação (0058: 2026-09-14 → 0065: 2026-09-28).

## 5. Cards Kanban

### [modifiability-1] Amarrar o invariante de "status terminal" ao tipo TypeScript já existente

- **Problema**
  > O carimbo de `encerrado_em` decide quais status "congelam" a data usando 3 literais SQL independentes (`PermutaExecucaoRepository.ts` ×2, `SolicitacaoNumerarioExecucaoRepository.ts` ×1), nenhum derivado do union `ExecucaoStatus`/`RecebimentoExecucaoStatus` que já existe no mesmo arquivo. Um novo status terminal futuro não quebra typecheck nem lint — só reabre silenciosamente o bug de R$ 503 mil que a ADR-0052 corrige agora.

- **Melhoria Proposta**
  > Extrair uma constante exportada por ledger (ex.: `PERMUTA_ENCERRAMENTO_STATUSES: readonly ExecucaoStatus[] = ['settled', 'parcial']` ao lado do `export type ExecucaoStatus` em `PermutaExecucaoRepository.ts`, e equivalente em `SolicitacaoNumerarioExecucaoRepository.ts`), usada para montar o `IN (...)` e referenciada num teste que percorre `ExecucaoStatus`/`RecebimentoExecucaoStatus` garantindo que todo novo status seja classificado explicitamente (terminal ou não) antes de compilar. Tactic: Encapsulate.

- **Resultado Esperado**
  > 3 literais independentes → 1 constante por ledger (2 no total), com teste que falha se um status novo for adicionado ao union sem decisão explícita sobre `encerrado_em`. Métrica: 3 → 0 ocorrências de status terminal "solto" em string SQL sem referência ao tipo.

- **Tactic alvo**: Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Ocorrências de status terminal codificado sem referência ao tipo: 3 → 0
  - Teste de exaustividade por union de status: inexistente → 1 por ledger
- **Risco de não fazer**: próxima adição de status terminal (ex.: revisão manual de baixa) reabre a mesma classe de bug já custou 1 ADR + 1 migration de backfill + comunicação ao cliente.
- **Dependências**: nenhuma.

### [modifiability-2] Decompor `metricas.metricas_ciclo` para não exigir cópia integral a cada regra nova

- **Problema**
  > A função `metricas.metricas_ciclo` (144 linhas) já foi redefinida por inteiro uma vez em 14 dias (0058 → 0065) para mudar ~5 linhas (~3,5% do corpo). Sem decomposição, toda futura mudança de regra de data/janela exige reescrever e revisar o corpo inteiro de novo, com risco de copy-paste divergente entre os ramos Permutas/Recebimentos — o mesmo tipo de deslize que motivou a correção atual.

- **Melhoria Proposta**
  > Extrair a resolução de data por execução (`COALESCE(encerrado_em, criado_em) AT TIME ZONE 'America/Sao_Paulo'`) e a filtragem por janela em funções/CTEs menores e nomeadas por frente (ex.: `metricas.execucoes_permutas_datadas()`, `metricas.execucoes_recebimentos_datadas()`), de forma que `metricas_ciclo` apenas componha essas partes. Tactic: Refactor / Reduce Size of Module. Tocar: nova migration em cima da 0065, `vwMetricasCiclo.test.ts` (guards) e `vwMetricasCiclo.integration.test.ts`.

- **Resultado Esperado**
  > Próxima mudança de regra de data/janela toca uma função de ~10-20 linhas por frente, não a função de 144 linhas inteira. Métrica: linhas tocadas por mudança de regra de data — de ~144 (corpo inteiro redefinido) para ≤20 por frente afetada.

- **Tactic alvo**: Refactor, Reduce Size of Module
- **Severidade**: P2
- **Esforço estimado**: M (2-5d, inclui regressão dos 24 testes de integração SQL existentes)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Linhas do corpo de `metricas_ciclo` que precisam ser revalidadas a cada mudança de regra: ~144 → ≤20 por frente
  - Redefinições completas da função por ciclo de 2 semanas: 1 (observado) → alvo de tender a 0 após a decomposição
- **Risco de não fazer**: terceira correção de regra de métrica repete o padrão de copy-paste de 144 linhas, com o mesmo risco de regressão silenciosa por frente que gerou o incidente dos R$ 503 mil.
- **Dependências**: nenhuma; pode ser feito independentemente do card modifiability-1.

## 6. Notas do agente

- Escopo: revisão restrita ao delta (`git diff origin/main..HEAD`), conforme instrução do run; achados de dívida pré-existente fora do delta (ex.: `RecebimentoExecucaoRepository`/`recebimento_execucao` com 0 linhas em produção, `NumerarioExecucaoRepository` — trilha de geração de SN, tabela distinta) foram investigados e descartados por não serem tocados nem consumidos pela função de métricas (confirmado em `0058_vw_metricas_ciclo.sql:24-25`).
- Cross-QA: F-modifiability-2 (Refactor de função SQL sem ORM) ecoa a nota de Deployability sobre migrations raw-SQL — cada regra nova é redeploy de schema, não config. F-modifiability-1/2 também tangenciam Testability: os 24 testes de integração SQL + 21 guards estáticos são hoje a única rede que pegaria uma divergência entre os 3 literais de status ou entre os ramos Permutas/Recebimentos — sem eles, a duplicação seria puramente estrutural sem detecção.
- Apêndices de Top-10 (LOC e fan-in) foram calculados no repositório inteiro (não apenas no delta) para dar contexto ao `qa-consolidator`, conforme mandato da seção 2; os achados e cards, porém, permanecem restritos ao delta.
