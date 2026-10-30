
---
type: regis-review-report
run_id: 2026-10-30-2243-dda-pool-limpo
generated_at: 2026-10-30T23:30:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: diff não commitado da feature `dda-pool-limpo` (23 arquivos — 742/-35 LOC)
total_cards: 33
total_p0: 0
total_p1: 5
total_p2: 16
total_p3: 12
overall_score: 7.0
---

# Regis-Review — financeiro — 2026-10-30-2243-dda-pool-limpo

## 1. Executive scorecard

**Pesos aplicados (perfil financeiro / escritas que movem dinheiro, mesmo em feature read-only)**: Security 1.5, Fault Tolerance 1.3, Availability 1.2, Modifiability 1.2, Testability 1.0, Performance 1.0, Integrability 0.9, Deployability 0.9 (total 9.0).

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---:|---:|---:|---:|---:|---|
| Availability | 7.0 | 0 | 0 | 2 | 1 | F-availability-1: `listInativosRecentes` (acessório) dentro de `Promise.all` sem fallback — falha dela derruba a aba inteira |
| Deployability | 6.0 | 0 | 1 | 3 | 1 | F-deployability-1: enum `BoletoDdaSituacao` cresceu 2 valores; sem contract test e com rolling deploy FE/BE, UI antiga renderiza `undefined` |
| Integrability | 7.5 | 0 | 0 | 3 | 1 | F-integrability-1: `arquivos: number` obrigatório sem shim; `contagem`/`totais` ganharam 2 keys obrigatórios |
| Modifiability | 7.0 | 0 | 0 | 4 | 2 | F-modifiability-4: adicionar 1 situação ao enum = 7 arquivos frontend + 2 backend; registry único ausente |
| Performance | 6.0 | 0 | 1 | 3 | 0 | F-performance-1: `saiuDaCarteira` é O(free × inativos) — +436 ms a 23 k boletos (medido no PRD-copy) |
| Fault Tolerance | 7.0 | 0 | 2 | 0 | 3 | F-fault-tolerance-2: `TITULO_SAIU_CARTEIRA` esconde boleto da lista padrão + somas com match frouxo (±R$0,05 / ±10 d) sobre qualquer `ativo=false` (inclui cancelado/renegociado/previsão) |
| Security | 8.0 | 0 | 0 | 0 | 2 | F-security-1: `titulosSaidos.credor` herda sensibilidade de títulos ativos — defensivo para futura role somente-DDA |
| Testability | 7.0 | 0 | 1 | 1 | 3 | F-testability-1: `listInativosRecentes` sem unit nem integração — mesma classe de bug da ADR-0070 (incidente 2026-10-14) |
| **Overall** | **7.0** | **0** | **5** | **16** | **12** | — |

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

**Leitura rápida.** Diff disciplinado, com uma melhoria estrutural real (extração de `JANELA_CARTEIRA_*` para `libs/calendar/JanelaCarteira.ts`) e três fraquezas repetidamente apontadas por 2+ especialistas: (i) a nova query `listInativosRecentes` entrou num `Promise.all` sem fallback, sem timeout, sem teste e com predicado não-sargável; (ii) o rolling deploy FE/BE ficou mais arriscado porque o contrato ganhou campo obrigatório + 2 valores no enum, sem shim; (iii) a classificação `TITULO_SAIU_CARTEIRA` **esconde** boletos da lista padrão com matching frouxo e sem telemetria. Nenhum achado P0 foi aberto pelos especialistas — foi mantido assim no consolidado (feature é 100% read-only; não existe caminho de duplo pagamento, outbox nem transação cross-ERP a defender).

## 2. Top 10 risks (cross-QA)

Composto = severidade × dinheiro em risco × leverage (quantos QAs apontam a mesma coisa).

### R-1: `TITULO_SAIU_CARTEIRA` pode ocultar boleto legítimo e causar pagamento atrasado
- **QA(s) afetados**: Fault Tolerance, Availability, Modifiability
- **Findings de origem**: F-fault-tolerance-2
- **Evidência sintetizada**: `ConsolidacaoBoletoDda.ts:184–220, 331–343`; `PaginacaoBoletoDda.ts:68–72, 236–241, 354–358`. O filtro usa só `ativo = FALSE AND vencimento IS NOT NULL` + match ±R$0,05 / ±10 dias — sem `pago = TRUE` nem `pes_cod`. Boleto classificado some de `contagem.todas`, `totais.todas` e "urgentes".
- **Impacto técnico**: um título **cancelado**, **renegociado** ou **previsão** com valor/data próxima faz o novo boleto desaparecer silenciosamente da lista padrão.
- **Impacto de negócio**: pagamento vencido → multa/juros ao fornecedor; cenário realista para contas mensais de valor próximo (energia, assinatura) com ciclo anterior cancelado no ERP.
- **Cards relacionados**: fault-tolerance-2, availability-1 (fallback), performance-3 (freshness)
- **Custo de inação em 6 meses**: 1 incidente de boleto perdido por tenant/trimestre basta para pagar a correção. Premissa: razão `inativos cancelados / inativos quitados` > 0 no PRD (não medível localmente, mas inevitável pela semântica do fin010).

### R-2: Falha em `listInativosRecentes` indisponibiliza a aba inteira
- **QA(s) afetados**: Fault Tolerance, Availability, Integrability
- **Findings de origem**: F-fault-tolerance-1, F-availability-1, F-integrability-4
- **Evidência sintetizada**: `BoletoDdaService.ts:136–144`. 4 queries em `Promise.all`; a nova (que alimenta uma situação **escondida por padrão**) é tratada como peer das essenciais. Rejeição → 500 na aba.
- **Impacto técnico**: regressão de disponibilidade — feature acessória bloqueia feature crítica.
- **Impacto de negócio**: janela de pagamento inviável quando a query degrada (índice ruim após `ANALYZE`, carteira grande).
- **Cards relacionados**: availability-1, fault-tolerance-1, integrability-2, fault-tolerance-5
- **Custo de inação em 6 meses**: um incidente em dia de fechamento = horas de retrabalho + pagamento atrasado. Mitigação é 1 PR de ~30 min (`Promise.allSettled` + log WARN).

### R-3: Rolling deploy FE↔BE expõe UI ao enum/campo novo sem fallback
- **QA(s) afetados**: Deployability, Integrability, Modifiability
- **Findings de origem**: F-deployability-1, F-deployability-2, F-deployability-4, F-integrability-1
- **Evidência sintetizada**: Render builda em 5–8 min; Vercel em <1 min. Enum ganhou `FORA_JANELA` + `TITULO_SAIU_CARTEIRA`; `BoletoDdaConsolidado.arquivos: number` é obrigatório em ambos os lados; `contagem`/`totais` ganharam 2 keys obrigatórios. `BoletoDda.ts:60-67` ↔ `sispag.ts:1675-1681,1715` escritos a mão em dois arquivos. 0 contract tests.
- **Impacto técnico**: durante a janela de defasagem, FE antigo recebe `undefined` em `ORDEM_SITUACAO[sit]` / `rotulos[sit]` → tabela com "undefined", chip de total zerado, `contagem.todas` divergente.
- **Impacto de negócio**: analista vê números inconsistentes no SISPAG na janela em que o Yuri valida o deploy — perda de confiança no painel.
- **Cards relacionados**: deployability-1, deployability-2, deployability-4, integrability-1, deployability-3 (kill-switch mitiga o blast)
- **Custo de inação em 6 meses**: 2 releases/mês da aba (histórico v0.80, v0.81) × ~5 min de UI quebrada = ritual de ansiedade recorrente.

### R-4: `saiuDaCarteira` é O(free × inativos) e já custa +436 ms em pool prod-like
- **QA(s) afetados**: Performance, Availability
- **Findings de origem**: F-performance-1
- **Evidência sintetizada**: harness factor=12 (23 292 boletos × 2 832 inativos) → +436 ms de overhead do novo bloco; 65 M comparações; `filter` linear por boleto onde `indexarAbertos` já resolve o mesmo problema por busca por faixa de centavos.
- **Impacto técnico**: `consolidar` cold hoje em 2 859 ms a 23 k; percepção de travamento, risco de double-click/reload, pressão de CPU no Render.
- **Impacto de negócio**: a aba é aberta dezenas de vezes/dia; cada invalidação do cache paga o custo integral.
- **Cards relacionados**: performance-1
- **Custo de inação em 6 meses**: se os inativos retornados crescerem de 2,8 k para 10 k, overhead vai a ~1,5 s/consolidação fria — linear.

### R-5: Query SQL `listInativosRecentes` não-sargável + sem teste de borda civil + sem `LIMIT`/timeout
- **QA(s) afetados**: Performance, Testability, Availability, Fault Tolerance
- **Findings de origem**: F-performance-2, F-testability-1, F-availability-2, F-fault-tolerance-5
- **Evidência sintetizada**: `TituloAPagarRepository.ts:252-269`. `(vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date` — função sobre coluna invalida a parte `vencimento` do índice composto. Em PRD-copy 77% das linhas retornadas pelo índice são refiltradas em memória do DB. Zero teste unit, zero integração civil (mesmo padrão da ADR-0070, incidente 2026-10-14 que custou 15 lotes/79 itens desfeitos). Sem `LIMIT`, sem `statement_timeout` dedicado.
- **Impacto técnico**: crescimento silencioso conforme `titulo_a_pagar` acumula inativos (hoje 12 k; projeção 3 anos: ~100 k).
- **Impacto de negócio**: incidente idêntico à ADR-0070 é possível — borda civil deslocando 3h, boletos sumindo em dias de virada.
- **Cards relacionados**: performance-2, testability-1, availability-2, fault-tolerance-5, security-2
- **Custo de inação em 6 meses**: 1 incidente de borda custa mais que todos os 4 cards somados.

### R-6: Observabilidade da feature ≈ 0 — regressão só é vista pelo analista reclamando
- **QA(s) afetados**: Deployability, Performance, Fault Tolerance, Availability
- **Findings de origem**: F-deployability-5, F-performance-4, F-fault-tolerance-4, F-availability-3
- **Evidência sintetizada**: nenhum `LogService.message` por sub-query / por fase; sem contador de ocorrências de `FORA_JANELA`/`TITULO_SAIU_CARTEIRA`; sem release marker; sem `durationMs` separando `cache hit` / `consolidarEscopo` / `comGrupo`.
- **Impacto técnico**: regressão de latência ou de taxa de ocultação só é detectada por chamado.
- **Impacto de negócio**: MTTR de investigação cresce; validação pós-deploy depende da UI do operador.
- **Cards relacionados**: performance-3, deployability-5, fault-tolerance-4, availability-3
- **Custo de inação em 6 meses**: observabilidade é pré-requisito dos cards perf-4 (freshness) e perf-1 (ganho de busca binária) — sem log estruturado, não dá para provar o ganho em prod.

### R-7: Cache do consolidado não invalida quando `ativo` muda — stale financeiro
- **QA(s) afetados**: Performance, Fault Tolerance
- **Findings de origem**: F-performance-3
- **Evidência sintetizada**: `BoletoDdaService.ts:101-109`. Chave do `ConsolidacaoBoletoDdaCache` é `[escopo, hoje, sincronizadoEm, carteiraEm, lotesVersao, sugestoesVersao]` — nenhum componente derivado de `titulosSaidos`. Depende de `carteiraEm` ser bumpado em TODA transição `ativo=TRUE→FALSE`; invariante não garantida nem testada. Baixar TTL para mitigar destrói a economia de 2,9 s.
- **Impacto técnico**: analista pode ver `SEM_TITULO` em linha cujo título **acabou** de sair da carteira.
- **Impacto de negócio**: decisão de pagamento com dado estale.
- **Cards relacionados**: performance-4 (depende de performance-3)
- **Custo de inação em 6 meses**: baixo em regime estável; crescente conforme o volume de transições diárias de `ativo` cresce.

### R-8: `IngestaoPagamentosService` ainda usa `Date.now()` cru para a mesma janela
- **QA(s) afetados**: Testability, Modifiability, Fault Tolerance
- **Findings de origem**: F-testability-2
- **Evidência sintetizada**: `IngestaoPagamentosService.ts:367-368`. Mesmo arquivo que agora importa `JANELA_CARTEIRA_*`. `ConsolidacaoBoletoDda` usa `calendar.todayBrt()` + `addDays`. Até 3h de divergência em corridas na virada do dia (00:00 BRT ≈ 03:00 UTC).
- **Impacto técnico**: janela ingerida ≠ janela consolidada em bordas; impossível testar o ingestor sem `jest.useFakeTimers`.
- **Impacto de negócio**: baixo-frequência / alto-custo-de-diagnóstico.
- **Cards relacionados**: testability-2
- **Custo de inação em 6 meses**: dívida "tocada" — o PR mexeu no arquivo. Momento certo para fechar.

### R-9: Fan-out alto da enum `BoletoDdaSituacao` — cada situação nova paga 9 arquivos
- **QA(s) afetados**: Modifiability, Integrability, Deployability
- **Findings de origem**: F-modifiability-4
- **Evidência sintetizada**: a mesma informação por situação está em `SITUACAO_BADGE`, `ROTULO_SITUACAO_DDA`, `ORDEM_SITUACAO`, `SEGMENTOS`, `segmentoDe`, `situacoesDoSegmento`, `totalDoSegmento`, `ORDEM` do `RegrasBoletoDda`, mais a união `|` em `lib/sispag.ts`. Switches gêmeos sem exaustividade typecheck.
- **Impacto técnico**: cada iteração do produto que adiciona um estado paga 9 arquivos; typecheck não protege ramos esquecidos.
- **Impacto de negócio**: aba teve 2 releases num mês — atrito cumulativo mensurável.
- **Cards relacionados**: modifiability-4 (M)
- **Custo de inação em 6 meses**: ~4 situações novas projetadas × ~4h de retrabalho de UI cada = ~2 dias/ano desperdiçados em bugs de "esqueci o `ORDEM`".

### R-10: `PaginacaoBoletoDda.totalizar` complexity 19 + regra "esconder saídos" em 3 pontos
- **QA(s) afetados**: Modifiability, Testability
- **Findings de origem**: F-modifiability-1, F-modifiability-2
- **Evidência sintetizada**: Biome `noExcessiveCognitiveComplexity` → 19 (teto 15) em `totalizar`. A regra "sem pedido explícito → esconde `TITULO_SAIU_CARTEIRA` de facetas, lista, totais" aparece em 3 lugares: derivação `escondeSaidos`, filtro de facetas, `continue` no laço de totais.
- **Impacto técnico**: cada chip novo mexe no mesmo laço; esquecer um sítio é silencioso (o teste de total passa, o de faceta não).
- **Impacto de negócio**: regressão silenciosa em `totais.urgentes*` / "Vencem hoje" do painel.
- **Cards relacionados**: modifiability-1, modifiability-2
- **Custo de inação em 6 meses**: um bug "chip e lista discordam" por release = 1h de debug cada.

## 3. Cross-cutting findings

### CC-1: `listInativosRecentes` é um sítio único que acende 6 QAs ao mesmo tempo
- **Aparece em**: Availability, Fault Tolerance, Integrability, Performance, Testability, Security
- **Findings**: F-availability-1 + F-availability-2, F-fault-tolerance-1 + F-fault-tolerance-5, F-integrability-4, F-performance-2, F-testability-1, F-security-3
- **Diagnóstico unificado**: a query foi introduzida como "só mais uma leitura", mas carrega 6 dívidas simultâneas — está dentro de `Promise.all` sem try/catch dedicado (como `gruposOuNenhum` tem), sem `LIMIT`, sem `statement_timeout`, com predicado não-sargável, sem unit test, sem integração civil (mesma classe da ADR-0070), e serve uma situação **escondida por padrão**. Falha + lentidão + ocultação silenciosa + regressão de borda, tudo em 18 linhas de SQL + 8 de orquestração.
- **Recomendação consolidada**: 2 cards resolvem para todos os QAs: **(a)** `fault-tolerance-1` / `integrability-2` / `availability-1` — isolar com `catch → []` + `LogService.warn`; **(b)** `performance-2` + `testability-1` + `availability-2` — reescrever o predicado para ser sargável, adicionar `LIMIT` de defesa, unit + integração de borda civil.

### CC-2: Contrato FE↔BE duplicado + rolling deploy sem shim
- **Aparece em**: Deployability, Integrability, Modifiability
- **Findings**: F-deployability-1 + F-deployability-2 + F-deployability-4, F-integrability-1, F-modifiability-4
- **Diagnóstico unificado**: `BoletoDda.ts` (back) e `sispag.ts` (front) são duas fontes do mesmo contrato, escritas à mão. O diff adicionou 5 chaves em ambos, com uma obrigatória (`arquivos`). Nenhum teste do CI falha se um lado sair de sincronia; nenhum shim durante o rolling deploy.
- **Recomendação consolidada**: **(a)** `deployability-1` (FE tolerante a enum desconhecido) + **(b)** `deployability-4` (contract test ou shared type) + **(c)** `modifiability-4` (registry único no FE).

### CC-3: Observabilidade da feature ≈ 0
- **Aparece em**: Deployability, Performance, Fault Tolerance, Availability
- **Findings**: F-deployability-5, F-performance-4, F-fault-tolerance-4, F-availability-3
- **Diagnóstico unificado**: nem a aba nem o `consolidar` emitem log estruturado ao `LogService` para `FORA_JANELA`/`TITULO_SAIU_CARTEIRA`, `durationMs` por fase, release marker, contagem diária.
- **Recomendação consolidada**: 1 card consolida — `performance-3` ("instrumentar `durationMs` nas fases de `BoletoDdaService.listar` + emitir `logService.message('boletos dda consolidado', { counts: contagem })`").

### CC-4: Encapsulamento vazado — `LIMITE_DIAS_SAIDO` e o halo da janela
- **Aparece em**: Modifiability, Integrability
- **Findings**: F-modifiability-3, F-modifiability-6, F-integrability-3 (parcial)
- **Diagnóstico unificado**: `LIMITE_DIAS_SAIDO` ficou `export`ado só para o service calcular o range do SQL — detalhe interno virou API pública. O recorte `-25 .. +55` existe só como aritmética inline.
- **Recomendação consolidada**: `modifiability-3` resolve ambos (`janelaDeInativosParaSaidaDaCarteira(calendar, hoje)` em `JanelaCarteira.ts` com `LIMITE_DIAS_SAIDO` privado).

### CC-5: `TITULO_SAIU_CARTEIRA` sem telemetria + cache possivelmente estale + classificação frouxa
- **Aparece em**: Fault Tolerance, Performance, Security (lateral)
- **Findings**: F-fault-tolerance-2, F-performance-3, F-security-1
- **Diagnóstico unificado**: a mesma classificação (i) esconde boleto com matching frouxo; (ii) não entra na chave do cache; (iii) expõe credor/valor de inativos a toda role `sispag:ver`.
- **Recomendação consolidada**: encadear `fault-tolerance-2` com `performance-4` (freshness do cache). `security-1` é cosmético hoje.

## 4. Quick wins (≤5 dias úteis)

Cards com esforço S e severidade ≥ P2.

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| fault-tolerance-1 | Fault Tolerance | S | P1 | `Promise.allSettled` em `listInativosRecentes`; aba sobrevive à falha isolada. Casa com availability-1 e integrability-2. |
| fault-tolerance-2 | Fault Tolerance | S | P1 | `AND pago = TRUE` + casar por `pes_cod` + log — boleto cancelado deixa de esconder o novo. |
| performance-1 | Performance | S | P1 | Busca binária por faixa de centavos; overhead +436 ms → ≤ 50 ms a 23 k boletos. |
| deployability-1 | Deployability | S | P1 | FE tolerante a `BoletoDdaSituacao` desconhecida; rolling deploy para de pintar "undefined". |
| testability-1 | Testability | S | P1 | Unit + integração civil (00:00Z / 15:00Z / 23:00Z); fecha o seam da ADR-0070. |
| availability-1 | Availability | S | P2 | **Mesclado com fault-tolerance-1.** |
| availability-2 | Availability | S | P2 | `LIMIT` de defesa + confirmação do índice parcial. |
| deployability-2 | Deployability | S | P2 | `arquivos?: number` com default `?? 1` por 1 release. |
| deployability-3 | Deployability | S | P2 | `SISPAG_DDA_POOL_LIMPO_ENABLED` em `EnvironmentProvider`; MTTR rollback 10 min → ≤ 2 min. |
| integrability-1 | Integrability | S | P2 | Shim retrocompatível. Combinável com deployability-2. |
| integrability-2 | Integrability | S | P2 | **Mesclado com fault-tolerance-1.** |
| integrability-3 | Integrability | S | P2 | Janela via `EnvironmentProvider`. |
| modifiability-1 | Modifiability | S | P2 | Quebrar `totalizar` em passes nomeados; Biome 19 → ≤ 15. |
| modifiability-2 | Modifiability | S | P2 | `visibilidadePadrao(filtro)` encapsula "esconde `TITULO_SAIU_CARTEIRA`". |
| modifiability-3 | Modifiability | S | P2 | `janelaDeInativosParaSaidaDaCarteira()`; `LIMITE_DIAS_SAIDO` privado. Resolve F-modifiability-6 de brinde. |
| performance-2 | Performance | S | P2 | Predicado sargável; índice composto usado. |
| performance-3 | Performance | S | P2 | `durationMs` por fase + log de contagem. **Resolve CC-3 inteiro.** |
| testability-2 | Testability | S | P2 | Injetar `BankingCalendar` no `IngestaoPagamentosService`; remover `Date.now()` cru. |

Agregando mesclagens de CC-1 e CC-2: **~13 PRs enxutos** cobrem toda a camada P1 + a maior parte dos P2. Esforço estimado agregado: 10–15 dias de dev.

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| modifiability-4 | Modifiability (+ Integrability, Deployability) | M | Abstract Common Services | 1 situação nova = 7 arquivos frontend + 2 backend; registry `SITUACOES_DDA` reduz para ≤2. 2 releases/mês da aba (v0.80, v0.81) — payback em semanas. |
| deployability-4 | Deployability (+ Integrability) | M | Logical Grouping / Package Dependencies | 23 campos duplicados; 0 contract tests. O diff já teve que mexer em ambos os lados. Opção B (`scripts/check-contract.mjs`) é M; A (pacote compartilhado) é L. |
| performance-4 | Performance (+ Fault Tolerance) | M | Maintain Multiple Copies of Computations | Garantir `carteiraEm` bumpado em toda transição `ativo` + teste. Sem este card, `TITULO_SAIU_CARTEIRA` mostra dado estale — e baixar TTL anula o ganho de 2,9 s do cache. |

## 6. O que está bem (e por quê)

1. **Extração de `JANELA_CARTEIRA_*` para `libs/calendar/JanelaCarteira.ts`** (Encapsulate). Antes, `IngestaoPagamentosService` tinha `15*DAY_MS`/`45*DAY_MS` literal; agora 3 call-sites importam a fonte única.
2. **Precedência explícita CAND > FORA > SAIU > SEM_TITULO** (Sanity Checking + Prioritize Events). `ConsolidacaoBoletoDda.ts:361–371`. Elimina combinações inválidas.
3. **`TITULO_SAIU_CARTEIRA` escondido por padrão de `contagem.todas`/urgentes** (Degradation + Quarantine). Decisão deliberada para a feature acessória não poluir o fluxo principal.
4. **SQL 100% parametrizado + Zod cobrindo as novas situações** (Validate Input + Rule #5). `SITUACOES_FILTRAVEIS = Object.values(BOLETO_DDA_SITUACAO)` auto-sincroniza enum HTTP com domínio — zero drift possível.
5. **`BankingCalendar` injetado na consolidação** (Limit Non-Determinism). 4 bordas da janela cobertas com datas absolutas.
6. **`colapsarCopias` com ordenação total e `comGrupo` com pivot determinístico** (Repair State). Servidor pivota `ddcCod/ditCod` antes de serializar — frontend sempre age na cópia certa.
7. **Harness de performance usou PRD-copy** (`bol.json` 1 941 + `tit.json` 4 278). Métricas 266 ms / 864 ms / 2 859 ms a factor 1/4/12 são medidas repetíveis.
8. **Testes do diff**: 95/95 passam em 12,5s; bordas de valor (±0,05) e dias (±10) cobertas simetricamente.

## 7. Limitações da análise

Não medíveis localmente:
- p95 real do endpoint em PRD; hit-rate do `ConsolidacaoBoletoDdaCache`; `EXPLAIN ANALYZE` em prod.
- Razão `inativos cancelados / inativos quitados` em PRD (crucial para dimensionar R-1).
- MTTR real da aba DDA (infra Terraform/CloudWatch não existe neste repo).
- `coverageThreshold` em `jest.config` (não há gate numérico).
- `# critical/high npm audit` novos (diff não altera `package.json`).
- Tamanho bundle Lambda / cold start / drift Terraform — `infra/` não existe.

Fora do escopo do pipe:
- Threat modeling formal, análise de superfície pública.
- Chaos engineering.
- Custo cloud.
- UX da aba DDA (DesignReviewer).
- Acessibilidade WCAG.
- Análise do legado SISPAG fora do diff.

Janela temporal: snapshot do dia 2026-10-30. Reforçar trimestralmente.

**Nota sobre P0**: nenhum achado foi classificado P0 pelos especialistas. O consolidado manteve. Justificativa consistente: feature é **100% read-only** — não há caminho de duplo pagamento, outbox, transação cross-ERP. Os eixos tipicamente P0 (idempotência de write, lock otimista) são N/A. O ladrão é **invisibilidade** (R-1) e **disponibilidade da aba** (R-2) — ambos P1. R-1 é candidato natural a P0 se um incidente de multa for documentado.

## 8. Ações recomendadas (próximos 30 dias)

1. **Sprint 1 — fechar `listInativosRecentes` em todos os eixos** (R-2, R-5, parte de R-1): `fault-tolerance-1`, `fault-tolerance-2`, `performance-2`, `testability-1`, `availability-2`. 3–4 dias.
2. **Sprint 1 — ganho de performance mensurável** (R-4): `performance-1`. 1 dia.
3. **Sprint 2 — blindar rolling deploy** (R-3): `deployability-1`, `-2`, `-3`, `integrability-1`. 2–3 dias.
4. **Sprint 2 — observabilidade da feature** (R-6 inteiro, pré-requisito de R-7): `performance-3`. 1 dia.
5. **Sprint 3 — dívidas tocadas pelo diff** (R-8, R-10, parte de R-9): `testability-2`, `modifiability-1`, `-2`, `-3`. 3 dias.

Pós-30d: `performance-4`, `modifiability-4`, `deployability-4` como débito estratégico.
```

---

