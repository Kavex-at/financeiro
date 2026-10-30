---
type: regis-review-report
run_id: 2026-10-30-sispag-dda-paridade
generated_at: 2026-10-30T00:00:00Z
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Fault Tolerance, Performance, Testability, Modifiability)
scope: reduced — 4 of 8 QAs (Availability, Deployability, Integrability, Security omitidos por desenho)
total_cards: 20
total_p0: 0
total_p1: 1
total_p2: 9
total_p3: 10
overall_score: 7.6
---

# Regis-Review (reduzido) — `sispag-dda-paridade` — 2026-10-30

> **Escopo reduzido deliberado.** Esta revisão cobre 4 dos 8 QAs do Bass — Fault Tolerance,
> Performance, Testability e Modifiability. Availability, Deployability, Integrability e Security
> **não foram rodados**, por decisão do time (feature é "paridade visual + cache + filtros server-side",
> sem mudança de superfície de rede, deploy, contrato externo ou autenticação). A omissão **não** é
> falha do pipe; a limitação está registrada na seção 7.

## 1. Executive scorecard

Pesos aplicados (ponderação proporcional ao impacto do delta): Fault Tolerance 1.3, Modifiability 1.2,
Performance 1.0, Testability 1.0 — total 4.5. QAs omitidos não entram no peso.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Fault Tolerance | 8.0 | 0 | 0 | 3 | 1 | F-fault-tolerance-1: `EmptyDdaFileError` agregado em `BUSINESS_INFO` genérico — divergência silenciosa |
| Performance | 7.0 | 0 | 1 | 3 | 2 | F-performance-1: cache consolidada não invalida após mutações de lote |
| Testability | 8.0 | 0 | 0 | 1 | 4 | F-testability-1: `ConsolidacaoBoletoDdaCache` sem suíte própria — LRU e corrida contra `invalidar()` sem rede |
| Modifiability | 7.5 | 0 | 0 | 2 | 3 | F-modifiability-1: pedaços "shared" moram na pasta da outra aba |
| **Overall** | **7.6** | **0** | **1** | **9** | **10** | — |

**P0?** Nenhum. O delta não introduz risco estrutural que bloqueie merge. O único P1 (performance-1)
é consistência percebida pela UI, não corrupção de estado — e está sendo endereçado nesta PR (ver §2).

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais ← **estamos aqui**
- 9–10: estado-da-arte para o estágio atual

## 2. Itens remediados nesta PR (pós-review)

Após a revisão, os seguintes itens foram priorizados e **estão sendo corrigidos no próprio PR que
abriga a feature**. Devem ser marcados como `Resolvido` no acompanhamento:

| Card | QA | Severidade | Correção aplicada |
|---|---|---|---|
| `performance-1` | Performance | P1 | Invalidação de `ConsolidacaoBoletoDdaCache` nos handlers de mutação de lote (criar/incluir/remover/finalizar/reabrir/cancelar/retirar) |
| `performance-2` | Performance | P2 | `MAX_ENTRADAS` reduzido para 2 (uma entrada por escopo), limitando o teto de residente da cache |
| `testability-1` | Testability | P2 | Suíte dedicada `ConsolidacaoBoletoDdaCache.test.ts` cobrindo LRU, geração durante inflight, TTL e single-flight |
| `modifiability-1` | Modifiability | P2 | Cinco pedaços shared (`ChipFiltro`, `SegmentosComTotal`, `PilulasFiltroAtivo`, `PaginacaoTabela`, `botoesDeCard`) movidos para pasta neutra; imports atualizados nos dois lados |
| `fault-tolerance-1` | Fault Tolerance | P2 | `EmptyDdaFileError` logado em `BUSINESS_WARN` distinto, com `ddcCod` e `code = 'DDA_FILE_EMPTY'` propagado para `avisoDaRun` |

> Com estes cinco endereçados, o P1 do delta cai para 0 e os P2 vão de 9 → 4 **após o merge**.

## 3. Top risks (cross-QA) — restantes após §2

> Lista reduzida — só os 5 mais relevantes depois de contar as remediações desta PR. Ordenados por
> severidade × leverage × blast radius.

### R-1: pool DDA pode envelhecer silenciosamente (snapshot stale)
- **QAs afetados**: Fault Tolerance (primário), Performance (invalidação depende de sync)
- **Findings de origem**: F-fault-tolerance-2 (prioridade de adiados), F-fault-tolerance-3 (sem self-test de staleness)
- **Evidência**: `BoletoDdaService.ts:200-215` ordena `[...novos, ...relidos]` — relidos "azarados"
  caem no fim da fila por N passadas; `repo.ultimaSincronizacao()` é lido só para exibição, sem alarme.
- **Impacto técnico**: pool com `sincronizado_em` velho segue respondendo às telas; `temBoleto` da
  carteira mente.
- **Impacto de negócio**: analista aprova remessa sem código de barras → banco recusa (I15s / ADR-0079).
- **Cards relacionados**: `fault-tolerance-2`, `fault-tolerance-3`
- **Custo de inação em 6 meses**: 1–3 incidentes de "remessa recusada por boleto faltante" por semestre
  (premissa: ingestão falha silenciosamente em ~0,5% dos ciclos; sem alarme, descoberta pelo banco).

### R-2: consolidações órfãs ocupam o event loop por até ~6 s após `invalidar()`
- **QAs afetados**: Performance, Fault Tolerance (secundário)
- **Findings**: F-performance-6
- **Evidência**: `ConsolidacaoBoletoDdaCache.ts:55-66` — `invalidar()` zera `emVoo` mas a promessa
  prossegue; o próximo chamador inicia outro cold em paralelo.
- **Impacto técnico**: pico duplo de CPU no fim da ingestão quando a aba já está aberta.
- **Impacto de negócio**: janelas de latência percebidas (6 s a 12 s somados) na operação da manhã.
- **Cards**: `performance-6`
- **Custo de inação**: baixo em volume atual (1 réplica, operação da manhã), aumenta se a frequência
  de sync subir.

### R-3: observabilidade do `fin124` segue agregada em `BUSINESS_INFO` para causas != `DDA_FILE_EMPTY`
- **QAs afetados**: Fault Tolerance (primário), Testability (sem fixture de resposta vazia)
- **Findings**: F-fault-tolerance-1 (parcial — o `DDA_FILE_EMPTY` entra em WARN pela correção desta PR,
  mas as **outras** causas de falha continuam agrupadas), F-testability-3
- **Evidência**: pós-correção, o `catch` de `executarSincronizacao` diferencia `DDA_FILE_EMPTY` do resto;
  504/timeout/rede ainda caem num só balde.
- **Cards**: parte residual de `fault-tolerance-1`, `fault-tolerance-3`
- **Custo de inação**: diagnóstico de incidente DDA segue custando leitura de log livre em vez de
  dashboard por classe.

### R-4: `routes/sispag.ts` acumula LOC a cada feature (1 976 LOC, +52 neste delta)
- **QAs afetados**: Modifiability (primário), Testability (arquivo gigante dificulta coverage focada)
- **Findings**: F-modifiability-2
- **Evidência**: `wc -l src/backend/routes/sispag.ts` = 1 976; `listaQuery` ficou embutido.
- **Impacto técnico**: next-feature cost cresce linearmente.
- **Impacto de negócio**: cada feature SISPAG paga ~1–2 h extras de leitura/edição; multiplicado por
  ~2 features/mês no setor = ~24 h/ano de atrito puro.
- **Cards**: `modifiability-2`
- **Custo de inação**: dívida acumulável; recomenda-se fatiar **fora** desta feature (blast radius).

### R-5: facetas, contagens e totais recalculados em cada warm hit (3 passagens O(24k))
- **QAs afetados**: Performance
- **Findings**: F-performance-3
- **Evidência**: `PaginacaoBoletoDda.ts:220-255` — `facetas()` + `totalizar()` em O(N) a cada troca
  de página/ordem/busca, mesmo com facetas invariantes do escopo cacheado.
- **Impacto técnico**: warm p50 ~60 ms em vez de ≤ 25 ms viáveis.
- **Impacto de negócio**: UX de folhear a aba. Sensível em dias de pico.
- **Cards**: `performance-3`
- **Custo de inação**: baixo; a aba continua utilizável, só não é snappy.

## 4. Cross-cutting findings

### CC-1: consistência de cache de consolidação depende de todas as fontes bumparem versão
- **Aparece em**: Performance (F-performance-1 — já tratado nesta PR), Testability (F-testability-1 —
  LRU/geração sem rede), Modifiability (contrato da chave não está documentado em um só lugar).
- **Diagnóstico unificado**: a chave da cache tem 5 insumos (`escopo | hoje | sincronizadoEm |
  carteiraEm | sugestoesCache.versao`) e um 6º implícito (`listTitulosEmLotesAbertos`). Sem documento
  canônico, cada nova fonte vira risco de staleness.
- **Recomendação consolidada**: além da invalidação nesta PR (`performance-1`), documentar o contrato
  da chave de cache (comentário + teste) e manter `testability-1` como rede para regressão. A ADR-0067
  (emenda 2026-10-30) já é o lugar natural; basta amendamento curto.

### CC-2: observabilidade do pool DDA (staleness, classes de falha, prioridade de adiados)
- **Aparece em**: Fault Tolerance (F-fault-tolerance-1 parcial, F-fault-tolerance-2, F-fault-tolerance-3).
- **Diagnóstico unificado**: três sintomas distintos (ERP vazio, adiados em fila, sem sync há > N horas)
  com uma causa comum — não existe medição operacional por classe sobre `fin124`.
- **Recomendação consolidada**: pacote de observabilidade (`fault-tolerance-2` + `fault-tolerance-3` +
  o resíduo de `fault-tolerance-1`) numa próxima sprint. Entregável esperado: 1 dashboard, 1 alarme
  de staleness, 1 campo persistido `ultima_tentativa_em` em `boleto_dda_arquivo`.

### CC-3: "shared de UI" sem home neutra (modifiability + testability)
- **Aparece em**: Modifiability (F-modifiability-1 — já tratado nesta PR), Testability (F-testability-2
  — componentes compartilhados sem suíte própria).
- **Diagnóstico unificado**: com os cinco componentes já em pasta neutra (correção desta PR), a próxima
  dívida é dar-lhes suíte unitária antes que a 3ª aba chegue.
- **Recomendação consolidada**: executar `testability-2` logo depois do merge desta PR, enquanto o
  contexto do move ainda é fresco.

## 5. Quick wins (≤5 dias úteis, cards com esforço S e severidade ≥ P2 **ainda em aberto**)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `fault-tolerance-3` | Fault Tolerance | S | P2 | Alarme de staleness sobre `max(sincronizado_em)` passa de 0 % → 100 % de cobertura |
| `performance-4` | Performance | S | P2 | Queries SQL por `/sispag/boletos-dda` em hit: 2 → 0; p50 warm cai ~10 ms |

> `performance-3` (memoizar facetas) é P2 mas esforço M — fica em §6. `fault-tolerance-2` é S mas
> envolve migration — tratei como M.

## 6. Strategic moves (M / L / XL — ainda em aberto)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `performance-3` | Performance | M | Reduce Overhead | p50 warm 60 ms → 25 ms (–58 %); baseline medido pelo caller |
| `fault-tolerance-2` | Fault Tolerance | M | Reconcile | elimina starvation de arquivos adiados; teste direto da "idade mediana do pior adiado" ≤ 1 passada |
| `modifiability-2` | Modifiability | M | Split Module | `routes/sispag.ts` 1 976 → ≤ 400 LOC/módulo; **fazer fora deste PR** |
| `performance-6` | Performance | M | Limit Event Response | CPU em promessa órfã após `invalidar`: ~6 s → ≤ 500 ms |
| `performance-5` | Performance | M | Reduce Overhead | gaveta por título: 2 requests → 1; payload p50 –40 % |

## 7. Limitações da análise

- **Escopo reduzido**: 4 de 8 QAs. **Availability, Deployability, Integrability e Security não foram
  rodados**. Para esta feature (sem mudança de superfície externa, auth, deploy ou contrato) a decisão
  é defensável; em features futuras que toquem rota pública, SSM, migration destrutiva ou autenticação,
  o pipe cheio precisa voltar.
- **Métricas não medíveis localmente**: taxa real de `fin124` vazio em PRD (requer painel de logs);
  footprint real da cache em bytes (requer `heapUsed` no processo Express rodando contra pool PRD);
  cobertura por diretório (não rodei `--coverage` pelo acoplamento com Postgres do integration suite).
- **O pipe não cobriu**: chaos engineering sobre a sync DDA, threat modeling do endpoint `/sispag/boletos-dda`,
  medição de custo cloud (Render), UX e acessibilidade (sinalizados no DesignReviewer, não aqui).
- **Janela temporal**: snapshot do diff do worktree `sispag-dda-paridade` sobre `v0.79.0`, em
  2026-10-30. Nenhum arquivo do checkout principal foi relido além do estritamente necessário.
- **Nenhum card foi reescrito** — todos aparecem no KANBAN.md verbatim dos arquivos QA, com apenas um
  campo adicional `Status: Resolvido nesta PR` nos cinco listados em §2.

## 8. Ações recomendadas (30 dias)

1. **Fechar os cinco cards já corrigidos nesta PR** (ver §2) após merge: atualizar status em
   `ontology/_inbox/sispag-dda-paridade-followups.md`.
2. **Sprint seguinte — pacote de observabilidade DDA**: `fault-tolerance-3` (staleness alarm) +
   `performance-4` (eliminar 2 SELECT max em hit). Esforço total ~2 dias.
3. **Backlog modifiability**: agendar `modifiability-2` (fatiar `routes/sispag.ts`) como feature própria,
   fora de um ciclo de regra de negócio, para isolar blast radius.
4. **Testability residual**: executar `testability-2` logo após o move da pasta shared (correção
   `modifiability-1` desta PR), antes que o contexto esfrie.
5. **Reavaliar escopo do Regis-Review** na próxima feature SISPAG que mudar superfície externa — rodar
   os 8 QAs completos.
