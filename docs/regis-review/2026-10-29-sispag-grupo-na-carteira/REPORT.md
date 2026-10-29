---
type: regis-review-report
run_id: 2026-10-29-sispag-grupo-na-carteira
generated_at: 2026-10-29T00:00:00Z
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (reduced delta review — 4 QAs)
review_mode: reduced-delta
qas_reviewed: [fault-tolerance, modifiability, security, testability]
qas_skipped: [availability, deployability, integrability, performance]
qas_skipped_reason: by design — reduced review of the uncommitted delta, same shape as the 2026-10-27 run of sispag-vinculo-data-divergente
total_cards: 15
total_p0: 0
total_p1: 3
total_p2: 6
total_p3: 6
overall_score: 7.3
---

# Regis-Review (reduzido) — financeiro — 2026-10-29-sispag-grupo-na-carteira

> **Escopo**: review reduzido do delta não commitado da feature `sispag-grupo-na-carteira` (base `adfaf786`, v0.78.0). Rodaram 4 das 8 QAs — Fault Tolerance, Modifiability, Security e Testability — por desenho, replicando a mesma política do review de 2026-10-27 em `sispag-vinculo-data-divergente`. **A ausência de Availability, Deployability, Integrability e Performance não é falha**: o delta não toca pipeline, infra, contratos externos novos nem caminhos de latência mensurável — reavaliá-los nesta janela seria ruído.
>
> **Confirmação explícita**: **nenhum P0 foi encontrado** em nenhum dos 4 QAs. Os três agents com score alto (Fault Tolerance 8, Security 8, Testability 7) o fazem com justificativa objetiva: o caminho novo é um *refusal* 409 explícito, não um write path; não há SQL nova; não há endpoint novo. Modifiability (6) sinaliza erosão arquitetural em arquivos já grandes, não defeito funcional.

## 1. Executive scorecard

Pesos aplicados (SaaS financeiro multi-tenant, escritas que movem dinheiro) — **4 QAs do subset**:
- Security 1.5, Fault Tolerance 1.3, Modifiability 1.2, Testability 1.0 — soma = 5.0.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---:|---:|---:|---:|---:|---|
| Fault Tolerance | 8.0 | 0 | 0 | 1 | 2 | F-fault-tolerance-1: fail-closed silencioso de `bloqueioRepo.listAtivos` reintroduz, durante incidente, o defeito que a emenda ADR-0077 corrige |
| Modifiability | 6.0 | 0 | 1 | 2 | 2 | F-modifiability-1: `BoletoSuggestionService` em 1477 LOC / 41 imports / 17 injeções — seam saturado |
| Security | 8.0 | 0 | 0 | 2 | 0 | F-security-1: mesma falha silenciosa derruba o guard 409 de 1:1 do boleto do grupo sem alarme |
| Testability | 7.0 | 0 | 2 | 2 | 1 | F-testability-2: `listTitulosEmLotesComprometidos` entra no `Promise.all` sem fallback — rejeição derruba a carteira inteira |
| **Overall (ponderado)** | **7.3** | **0** | **3** | **6** | **6** | — |

Interpretação:
- 0–3 risco estrutural; 4–6 dívida defensável; 7–8 saudável com oportunidades pontuais; 9–10 estado-da-arte.
- O overall 7.3 reflete o padrão típico de um delta cirúrgico sobre um seam já reconhecidamente grande: regras novas estão bem isoladas, cobertas por teste e observáveis — mas aumentaram a massa de dois arquivos que já estavam fora do p95.

## 2. Top risks (consolidado cross-QA)

Dado o escopo reduzido e a ausência de P0, listamos **5 riscos consolidados** (não 10 — enxerto artificial seria ruído num delta deste tamanho).

### R-1: Fail-closed silencioso de `bloqueioRepo.listAtivos` desarma o guard 409 em incidente parcial
- **QA(s) afetados**: Fault Tolerance, Security, Modifiability, Testability (quatro)
- **Findings de origem**: F-fault-tolerance-1 (P2), F-security-1 (P2), F-modifiability-5 (P3), F-testability-1 (P1) — ver §3 CC-1
- **Evidência sintetizada**: `BoletoSuggestionService.ts:1095-1110` captura qualquer erro de `bloqueioRepo.listAtivos`, loga `BUSINESS_WARN` e retorna `undefined`; a service converte em `gruposSugeridos = []`; `desfecho.grupoSugerido` fica indefinido; `confirmarUm` deixa de recusar o 1:1 do boleto que fecha o grupo (`:1283-1294`). Só há `log.warn` — sem contador, sem alarme, sem flag no payload.
- **Impacto técnico**: durante indisponibilidade parcial do Postgres (ou lock em `bloqueio_duplicidade`), a tela regride para o 1:1 pré-emenda ADR-0077 e o servidor **não** recusa a confirmação individual.
- **Impacto de negócio**: janela de reocorrência exata do incidente de 2026-10-29 — analista confirma 1:1 um boleto que paga o grupo inteiro (R$ 26.369,85 no PRD do caso RHENUS). A duplicata de caixa só é detectada na conciliação subsequente.
- **Cards relacionados**: fault-tolerance-1, security-1, modifiability-5, testability-1
- **Custo de inação em 6 meses**: 1 incidente de infra parcial × 1 analista ativo na janela = recorrência do defeito que motivou a emenda. Premissa explícita: a emenda ADR-0077 foi feita *porque* o custo contábil é não desprezível; expor isso a um fail-open silencioso anula o investimento.

### R-2: Nova leitura `listTitulosEmLotesComprometidos` sem isolamento no `Promise.all` da carteira
- **QA(s) afetados**: Testability, Fault Tolerance
- **Findings de origem**: F-testability-2 (P1)
- **Evidência sintetizada**: `BoletoSuggestionService.ts:1155-1172` — a nova chamada entra no `Promise.all` principal sem o wrapper tolerante de `marcasOuNenhuma`. Rejeição derruba `listarSugestoes` inteiro (regressão no caminho quente da carteira, que antes nem tocava `com298` nesse ponto).
- **Impacto técnico**: lock ou SQL lenta em `com298` → `500` na carteira inteira (não "sugestão de grupo apaga, 1:1 segue").
- **Impacto de negócio**: durante corte do dia, a tela do SISPAG some; analista recarrega sem causa visível.
- **Cards relacionados**: testability-2
- **Custo de inação em 6 meses**: pequeno enquanto `com298` for estável; crítico no primeiro episódio de contenção no ERP.

### R-3: `BoletoSuggestionService` ultrapassou 1477 LOC / 41 imports — seam saturado
- **QA(s) afetados**: Modifiability, Testability
- **Findings de origem**: F-modifiability-1 (P1)
- **Evidência sintetizada**: `wc -l` = 1477 (p95 do repo ~400); `grep -c '^import '` = 41 (alvo ≤ 15); 17 injeções no construtor (2 novas neste delta). Toda feature SISPAG (confirmação em conjunto, DPS, grupo sugerido) cai aqui.
- **Impacto técnico**: tempo de orientação dentro do arquivo cresce feature a feature; `BoletoSuggestionService.test.ts` já flerta com os 5 s por suite — o próximo *flake* para a esteira.
- **Impacto de negócio**: review do Regis-Review no mesmo arquivo paga pedágio crescente; risco ao SLA de liberar remessa até 15:00 em dias de pressão.
- **Cards relacionados**: modifiability-1, modifiability-2
- **Custo de inação em 6 meses**: assumindo 2 features/mês tocando este seam, projeção de 1700+ LOC em 3 meses e dependência explícita do Yuri como *bus factor* para debug.

### R-4: Reconciliação grupo×1:1 vazou para dentro do motor 1:1
- **QA(s) afetados**: Modifiability, Performance (apontada pelo agent, não auditada neste review)
- **Findings de origem**: F-modifiability-2 (P2), F-modifiability-3 (P2)
- **Evidência sintetizada**: `MotorSugestaoBoleto.ts:349-417, 510-534` — três métodos privados (`aplicarGrupoSugerido`, `marcarGrupoSugerido`, `sugestoesValidas`) operam sobre `gruposSugeridos`. `sugestoesValidas` depende do `avaliar`+`FORCA` internos (regra I21v "não roubar 1:1 forte alheio") — invisível quando se procura no motor de grupo.
- **Impacto técnico**: a próxima emenda da ADR-0077 (ex.: tornar grupo "confirmável automático") será codificada aqui porque o preparo já conhece o ponteiro; motor 1:1 e motor de grupo se fundem subrepticiamente.
- **Impacto de negócio**: debug lento no primeiro incidente ("por que o grupo sumiu?"); teste A/B de tolerância de grupo passa a esbarrar no 1:1.
- **Cards relacionados**: modifiability-2, modifiability-3
- **Custo de inação em 6 meses**: cada iteração do produto sobre I21v/I21w vai pagar o preço de reler o motor 1:1 inteiro.

### R-5: Escopo multi-filial do painel SISPAG sem filtro por usuário (débito pré-existente, ampliado)
- **QA(s) afetados**: Security
- **Findings de origem**: F-security-3 (P2)
- **Evidência sintetizada**: `BoletoSuggestionService.ts:1156-1200` — `tituloRepo.listAtivos`, `loteRepo.listTitulosEmLotesComprometidos`, `bloqueioRepo.listAtivos` não recebem `usuario`/`filCod[]`. O novo campo `grupoSugerido` é mais um atributo da mesma linha multi-filial. Delta não introduz o débito; amplia a superfície.
- **Impacto técnico**: analista com acesso ao painel vê `ddcCod/ditCod/numeroBoleto/nTitulos/valorBoletoCentavos` de qualquer filial.
- **Impacto de negócio**: baixo hoje (os valores já apareciam); crítico quando o SSO corporativo + RBAC entrar — vira o primeiro vetor de vazamento cross-filial do produto.
- **Cards relacionados**: security-2
- **Custo de inação em 6 meses**: proporcional ao timing do SSO/RBAC; se o roadmap de produto adiantar, vira retrabalho sob pressão.

## 3. Cross-cutting findings

### CC-1: Fallback silencioso em `marcasOuNenhuma` / `gruposSugeridos` (deduplicado explicitamente)
- **Aparece em**: Fault Tolerance, Security, Modifiability, Testability
- **Findings consolidados**:
  - F-fault-tolerance-1 (P2) — Condition Monitoring sem alarme
  - F-security-1 (P2) — Audit Trail / Detect Intrusion ausente; desarma o guard 409
  - F-modifiability-5 (P3) — payload não carrega flag `sugestaoGrupoDegradada`, feature-flag implícita sem contrato
  - F-testability-1 (P1) — o ramo `catch` interno de `gruposSugeridos` (que embrulha `motorGrupo.sugerir` + `CenarioGrupoBoleto.paraMotor1a1`) **nunca** executa no suite; o teste que diz cobri-lo falha na leitura de marcas, não no motor
- **Diagnóstico unificado**: existe um fail-closed de defesa (que é a decisão correta — fail-closed, não fail-open), mas ele é **silencioso em quatro dimensões**: (1) sem contador agregado, (2) sem campo no payload, (3) sem teste exercitando o ramo real, (4) desarmando o guard 409 em cadeia. Qualquer indisponibilidade parcial do leitor de marcas → regressão funcional ao caminho pré-emenda ADR-0077 — e ninguém sabe.
- **Recomendação consolidada**: executar **testability-1 + fault-tolerance-1 + security-1 + modifiability-5** como pacote único em um `/feature-tweak`:
  1. Elevar `log.warn` para `log.error` (ou emitir contador `sispag.sugestao_grupo_desligada_total`) quando o fallback dispara.
  2. Expor `sugestaoGrupoDegradada: true` no `ListagemSugestoes`.
  3. Cobrir os dois ramos de catch (motor + marcas) com teste nomeado.
  Opcional (mais forte): tratar falha de `bloqueioRepo` como erro no `sugerirAgora` e devolver 503 em vez de servir 1:1 sem guard.

### CC-2: Erosão dos dois seams grandes do SISPAG (BoletoSuggestionService + MotorSugestaoBoleto)
- **Aparece em**: Modifiability, Testability
- **Findings consolidados**: F-modifiability-1, F-modifiability-2, F-modifiability-3
- **Diagnóstico unificado**: a feature está bem localizada e o `CenarioGrupoBoleto` é textbook *Abstract Common Services* aplicado no primeiro re-uso. Porém, o custo é concentrado em arquivos que já estavam saturados: `BoletoSuggestionService` cresceu de 1402 → 1477 LOC; `MotorSugestaoBoleto` de 1243 → 1374. A regra I21v foi codificada **dentro** do motor 1:1 reusando `avaliar`+`FORCA` — elegante mas invisível quando se busca pelo motor de grupo.
- **Recomendação consolidada**: card `modifiability-1` (Split Module → `SugestaoCenarioLoader`) + `modifiability-2` (extrair `ReconciliadorGrupoE1a1` puro). Ambos esforço S/M; o retorno é imediato em legibilidade e em tempo de suite.

### CC-3: Isolamento de leituras no `Promise.all` da `sugerirAgora`
- **Aparece em**: Testability, Fault Tolerance
- **Findings consolidados**: F-testability-2 (P1), implícito em F-fault-tolerance-1
- **Diagnóstico unificado**: `marcasOuNenhuma` tem padrão `*OuNenhuma` com fallback; `listTitulosEmLotesComprometidos` entra crua. Inconsistência de padrão num mesmo bloco produz uma dependência obrigatória nova no caminho quente da carteira.
- **Recomendação consolidada**: card `testability-2` (`comprometidosOuNenhum` + teste de rejeição). Esforço S; alinha o padrão para o próximo colaborador.

## 4. Quick wins (≤5 dias úteis, esforço S, severidade ≥ P2)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| testability-1 | Testability | S | P1 | 2/2 ramos de catch em `gruposSugeridos` cobertos; fecha CC-1 do lado teste |
| testability-2 | Testability | S | P1 | `listTitulosEmLotesComprometidos` isolado com fallback; 0 regressões silenciosas no caminho quente da carteira |
| fault-tolerance-1 | Fault Tolerance | S | P2 | Alarme/contador no fallback de marcas; MTTR do defeito "boleto do grupo aparece 1:1" ≤ 15 min |
| security-1 | Security | S | P2 | Mesmo fallback, visto do ângulo audit trail — contador `sispag.sugestao_grupo_desligada_total` emitido a cada ocorrência |
| modifiability-2 | Modifiability | S | P2 | `MotorSugestaoBoleto` < 1200 LOC; reconciliador grupo×1:1 isolado |
| modifiability-3 | Modifiability | S | P2 | Predicado explícito `rouba1a1Forte` + teste nomeado + log de descarte |
| testability-3 | Testability | S | P2 | Cobertura de `ORFA` e `EM_GRUPO` em `SITUACOES_QUE_MANTEM` (2/4 → 4/4) |
| testability-4 | Testability | S/M | P2 | Teste de integração do aviso Q8 em `SispagPanel.toggleSelecao` |

Pacote defensável como "primeira sprint pós-aprovação": executar como três `/feature-tweak`:
1. **CC-1 pack** — testability-1 + testability-5 + fault-tolerance-1 + security-1 + modifiability-5 (compartilham arquivo).
2. **CC-3 pack** — testability-2 (sozinho; S).
3. **CC-2 pack-start** — modifiability-2 + modifiability-3 (preparam o terreno para modifiability-1).

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| modifiability-1 | Modifiability, Testability | M | Split Module | `BoletoSuggestionService.ts` tem 1477 LOC vs p95 ~400 e 41 imports vs alvo ≤ 15; o preço de review cresce linearmente feature a feature e o suite associado já paga segundos em CI |
| security-2 | Security | M | Authorize Actors | 0 % das queries de leitura do painel passam filtro de filial do usuário; delta amplia a superfície do contrato (campo `grupoSugerido`). Vira retrabalho mandatório quando o SSO/RBAC entrar — a métrica alvo (100 %) está declarada |

Observação: `modifiability-1` ancora em `wc -l` = 1477 e `grep -c` = 41, ambos medidos no delta e documentados em §4 do `modifiability.md`. `security-2` ancora em "0 chamadas de `listAtivos` com parâmetro de escopo por usuário" — métrica medida por inspeção direta.

## 6. O que está bem (e por quê)

1. **Guard 409 explícito em `BoletoSuggestionService.confirmarUm`** (`:1283-1294`) — tactic *Limit Access*. Fecha, do lado servidor, exatamente o caminho que o incidente PRD de 2026-10-29 explorou. Teste direto em `BoletoSuggestionService.test.ts:1987-2070`.
2. **`CenarioGrupoBoleto` extraído no primeiro re-uso** (76 LOC) — tactic *Abstract Common Services* aplicada corretamente, sem especulação. Reduziu `GrupoBoletoService` em 17 LOC e padronizou a entrada do `MotorGrupoBoleto` para dois consumidores.
3. **Payload do 409 sem PII** — `BoletoSuggestionNotAvailableError` carrega `userMessage` estática e `details` só com chaves que o próprio caller mandou. Zero `linhaDigitavel`/`codigoBarras`/emissor cru. Confirmação positiva de *Limit Exposure*.
4. **Zero SQL nova e zero endpoint novo no delta** — toda leitura adicional reusa repositórios parametrizados pré-existentes. Nenhuma string com interpolação.
5. **Motor puro, teste determinístico** — `MotorSugestaoBoleto` segue sem I/O; `MotorSugestaoBoleto.grupoSugerido.test.ts` cobre 10 cenários do PRD (RHENUS 5541/5566 → boleto 129818, R$ 26.369,85) como fixture nomeada. Tactic *Recordable Test Cases* aplicada.
6. **Idempotência preservada** — `MotorGrupoBoleto.candidatos` exclui `decisoesConfirmadas`; `MotorSugestaoBoleto` preserva `CONFIRMADA` via `SITUACOES_QUE_MANTEM`. Cache `SugestaoBoletoCache` single-flight de 30 s invalidado após qualquer decisão. Sem conflito motor-vs-motor.
7. **Teste "não muta a entrada" presente** — `MotorSugestaoBoleto.grupoSugerido.test.ts:179-184` compara `JSON.stringify(e)` antes/depois. Tactic *Limit Non-Determinism*.
8. **Delta de LOC dentro do alvo declarado** — +268 linhas em `service/sispag/` vs alvo ≤ 300.

## 7. Limitações da análise

- **Review reduzido por desenho**: 4 das 8 QAs. **Não auditadas**: Availability, Deployability, Integrability, Performance. Não são "falhas de pipeline" — a decisão replica o review de 2026-10-27 (`sispag-vinculo-data-divergente`): o delta não toca pipeline de deploy, nem contratos externos novos (não há nova chamada Conexos/Nexxera), nem caminhos de latência mensurável, nem SLA de janela de disponibilidade declarada. Reavaliar essas 4 nesta janela seria ruído.
- **Métricas de produção não medíveis localmente** (sinalizadas pelos agents):
  - Contagem real de ocorrências do fallback `marcasOuNenhuma` / `gruposSugeridos` em dias úteis — requer CloudWatch/Grafana (não existe no stack atual, Render + Supabase).
  - Fan-in real de `BoletoSuggestionService` em runtime — requer tracing em HML.
  - Escopo de filial por usuário efetivo em runtime — depende do contrato de contexto autenticado (fora deste delta).
- **O pipe NÃO cobre**: chaos engineering, threat modeling formal, custo cloud, UX acessível, carga sintética em `com298`.
- **Snapshot**: 2026-10-29 sobre o delta não commitado em `.claude/worktrees/sispag-grupo-na-carteira`. Base = `adfaf786` (v0.78.0). Código é vivo; refazer no próximo ciclo que tocar o seam SISPAG.
- **Nenhum card teve ID renomeado**; cópia verbatim do que os 4 agents produziram.

## 8. Ações recomendadas (30 dias)

1. **Fechar CC-1 em um único `/feature-tweak`** — testability-1 + testability-5 + fault-tolerance-1 + security-1 + modifiability-5. Compartilham arquivo (`BoletoSuggestionService.ts`), compartilham risco (R-1), e a soma é S+S+S+S+S. Resultado: nenhum fallback silencioso sobrevive, com teste direto no ramo correto.
2. **Fechar CC-3 em seguida** — testability-2 isolado (S). Elimina a regressão potencial no caminho quente da carteira.
3. **Começar CC-2 pelos cards S** — modifiability-2 e modifiability-3 preparam o terreno (extraem reconciliador + predicado explícito). Permitem decidir sobre modifiability-1 (M) com evidência numérica atualizada antes do PR.
4. **Agendar security-2 (M)** para o ciclo que tocar o contrato de contexto autenticado — não antes, para evitar refactor dobrado.
5. **Não re-abrir** Availability/Deployability/Integrability/Performance neste delta; agendar review completo no próximo ciclo que mude pipeline, contrato externo ou SLA.
