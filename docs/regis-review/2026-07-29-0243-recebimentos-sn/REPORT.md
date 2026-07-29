---
type: regis-review-report
run_id: 2026-07-29-0243-recebimentos-sn
generated_at: 2026-07-29T02:55:00Z
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: feature-gate — gerarSolicitacaoNumerario (SN) delta on branch fix/recebimentos-alocar-sn
total_cards: 47
total_p0: 0
total_p1: 14
total_p2: 24
total_p3: 9
overall_score: 7.8
gate_verdict: PASS-WITH-FOLLOWUPS (DRY-RUN safe to ship; explicit must-fix-before-wire-real backlog)
---

# Regis-Review — SN (`gerarSolicitacaoNumerario`) — 2026-07-29-0243

## Executive summary

O delta `gerarSolicitacaoNumerario` é um dos mais disciplinados que o pipe já produziu neste repositório. A feature nasce **DRY-RUN-only por design** — o seam `enviarAoErp` lança `NotImplementedError` (501, `retryable:false`), o `gcdCod=0` é placeholder documentado, o `PROCESSO_PROVIDER_TOKEN` é um port swappable via DI e a família de rotas fica escondida atrás de `RECEBIMENTOS_ENABLED` com default fail-safe. **Zero caminhos de escrita ao Conexos são alcançáveis** — provado por grep + 1 teste unitário dedicado.

Nesse enquadramento, o gate **passa**: 8/8 QAs verdes (mínimo 7.0), overall 7.8/10, **zero P0**, 12 P1, 25 P2, 9 P3. Todos os P1/P2 são melhorias marginais sobre uma base saudável ou dívidas condicionalmente perigosas — inertes hoje, load-bearing quando o `enviarAoErp` for cabeado (Módulo 5 / pós-HML).

O relatório separa deliberadamente dois orçamentos:

1. **Ship-now-safe (dry-run):** merge do delta pode acontecer imediatamente. Follow-ups vão para o inbox e são endereçados no ritmo normal do time.
2. **Must-fix-before-wire-real:** conjunto de 6-8 cards que **precisam** estar fechados antes de qualquer PR que remova o `throw new NotImplementedError` do seam. Este é o gate real de compliance financeira.

## 1. Executive scorecard

Pesos aplicados (financeiro / multi-tenant / write-path a Conexos):
Security 1.5 · Fault Tolerance 1.3 · Availability 1.2 · Modifiability 1.2 · Testability 1.0 · Performance 1.0 · Integrability 0.9 · Deployability 0.9 · **Σ = 9.0**

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7.0 | 0 | 1 | 3 | 2 | F-availability-2: FE mascara falha do backend com fallback silencioso indistinguível |
| Deployability | 8.0 | 0 | 2 | 3 | 0 | F-deployability-1: Rollback do SN não documentado (kill-switch existe, procedimento não) |
| Integrability | 7.5 | 0 | 3 | 3 | 0 | F-integrability-5: `gcdCod=0` placeholder — 1 patch trivial vira POST inválido ao ERP |
| Modifiability | 8.2 | 0 | 3 | 2 | 1 | F-modifiability-1: `gcdCod=0` duplicado BE↔FE — divergência silenciosa no dia do go-live |
| Performance | 8.0 | 0 | 0 | 3 | 3 | F-performance-1: `ProcessoProviderInterface` não expõe `ExternalCallOptions/timeoutMs` |
| Fault Tolerance | 8.0 | 0 | 2 | 3 | 1 | F-fault-tolerance-3: Ontologia não define handle de idempotência/reconciliação wire-level |
| Security | 8.0 | 0 | 3 | 3 | 0 | F-security-4: Claim `permissions.filiais` não provisionado — guard de cross-filial passa vazio |
| Testability | 8.0 | 0 | 0 | 4 | 2 | F-testability-3: Rota constrói `new Date()` inline — timestamps do payload não-verificáveis |
| **Overall** | **7.8** | **0** | **12** | **25** | **9** | — |

Score interpretation:
- 0–3: estrutural risk — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais ← **onde estamos**
- 9–10: estado-da-arte para o estágio atual

## 2. Gate verdict

**PASS-WITH-FOLLOWUPS.** O delta pode ser mergeado como está.

Justificativa objetiva:
- Zero P0 em 8 QAs (invariante do gate: só P0 bloqueia).
- Invariante DRY-RUN verificado por evidência (grep + `SolicitacaoNumerarioService.test.ts:77-88`): não existe caminho de escrita alcançável ao Conexos.
- 4 camadas de defesa em profundidade (`RECEBIMENTOS_ENABLED` fail-safe → `requireRole('admin')` → `assertUserCanActOnFilial` + `heavyRouteLimiter` → `NotImplementedError` no seam).
- 740/740 backend tests + 104/104 frontend tests verdes; coverage do delta 95.45% linhas / 90.9% funções.
- Zero P0 de Security (nenhum secret hardcoded, nenhum `process.env` cru, nenhum SQL cru, nenhum `dangerouslySetInnerHTML`).

**Gate paralelo (não bloqueia o merge, bloqueia o wire-real):** qualquer PR futuro que remova `throw new NotImplementedError` do `enviarAoErp` deve incluir referência explícita ao fechamento dos 6 cards agrupados em §4 (must-fix-before-wire-real). Isto vira uma business-rule dedicada (`fault-tolerance-1` já propõe o texto).

## 3. Top 10 risks (cross-QA, ranked por severidade × leverage × business impact)

### R-1: Wire-real prematuro do `enviarAoErp` sem idempotência, sem valor correto, sem reconciliação, sem ledger
- **QAs afetados:** Fault Tolerance, Availability, Integrability, Security, Modifiability
- **Findings de origem:** F-fault-tolerance-2 (idempotência), F-fault-tolerance-3 (handle wire-level), F-fault-tolerance-4 (`encomenda-percentuais` unresolved), F-fault-tolerance-5 (audit persistido), F-availability-3, F-availability-4, F-integrability-5, F-modifiability-1, F-modifiability-3
- **Evidência sintetizada:** rota `POST /solicitacao-numerario` não consulta `Idempotency-Key` (rota irmã `pipeline/run:84-86` já faz); `valorSn = valorTransacao` cru com `TODO(encomenda-percentuais)` em `SolicitacaoNumerarioService.ts:60-62`; `gcdCod=0` placeholder tanto no BE (`constants.ts:132`) quanto no FE fallback (`lib/recebimentos.ts:397`); nenhum handle wire-level de reconciliação documentado na integration `conexos-com299-gerdoc.md`; nenhum ledger persistido para SNs geradas.
- **Impacto técnico:** primeira remoção do `throw` no seam expõe simultaneamente 4 vetores independentes: duplicidade por retry, valor errado (regra pendente), config divergente FE↔BE, ausência de base de reconciliação retroativa.
- **Impacto de negócio:** primeira SN real disparada = numerário duplicado OU valor errado OU documento não-rastreável no ERP. Custo estimado: retrabalho contábil, estorno manual, risco de compliance com auditoria interna Columbia.
- **Cards Kanban relacionados:** fault-tolerance-1, fault-tolerance-2, fault-tolerance-3, fault-tolerance-4, fault-tolerance-5, integrability-5, modifiability-1, modifiability-3, availability-3, availability-4
- **Custo de inação em 6 meses:** se HML abrir credencial e o time cabear o seam sem passar pelo checklist, primeira janela de execução real emite N SNs inválidas — custo direto de reversão manual + custo reputacional com a Columbia (Kavex apresentou automação como "safe by design"). Premissa: 1 sprint de trabalho de conciliação + 1 rodada de comunicação executiva com o cliente.

### R-2: `filiais` claim ausente no JWT — defesa cross-filial estruturalmente presente mas desarmada
- **QAs afetados:** Security, Availability
- **Findings de origem:** F-security-4
- **Evidência sintetizada:** `filialAuthz.ts:45-50` retorna `true` quando `permitidas === undefined`; docstring reconhece: "current Supabase JWT only carries `sub`/`email`/`role` — there is NO per-filial claim yet"; nenhum token de produção carrega o claim hoje.
- **Impacto técnico:** um `admin` de qualquer filial hoje faz POST SN para qualquer outra e recebe 200. A ACL multi-tenant é uma promessa de código; a defesa real hoje é apenas `requireRole('admin')`.
- **Impacto de negócio:** enquanto for dry-run, dano é reputacional / apresentação. Quando `enviarAoErp` cabear (R-1), um admin de SP move dinheiro para MG sem receber 403 — vetor direto de fraude interna ou erro operacional grave.
- **Cards Kanban relacionados:** security-4
- **Custo de inação em 6 meses:** o custo é assimétrico — provavelmente zero incidente por 6 meses, mas o primeiro incidente é um evento de crise. Provisionar o claim custa 1-2 dias de Edge Function + rollout coordenado.

### R-3: FE mascara falhas de backend com fallback silencioso — analista vê "sucesso" sob 5xx real
- **QAs afetados:** Availability, Fault Tolerance, Integrability, Testability, Deployability
- **Findings de origem:** F-availability-2, F-fault-tolerance-6, F-testability-5, F-modifiability-2 (parcialmente)
- **Evidência sintetizada:** `lib/recebimentos.ts:461-492` — `catch { return buildDryRunFallback(processo, valorTransacao) }`. `catch` vazio, sem `console.warn`, sem breadcrumb. Shape retornado é idêntico ao do backend. Toast em `AlocarProcessosDialog.tsx:118-120` diz "simulação gerada" mesmo para fallback local. Padrão `fonte:'banco'|'fixture'` existe em `fetchPainelRecebimentos` mas foi omitido nas duas novas funções.
- **Impacto técnico:** qualquer 5xx / 403 / erro de rede vira sucesso no UI, com payload fabricado localmente (`gcdCod=0`, códigos de rateio zerados). Erros de config (`RECEBIMENTOS_ENABLED=false → 403`) ficam invisíveis. Sinal de disponibilidade percebida = 0.
- **Impacto de negócio:** no dry-run, corrói auditabilidade da demo (payload apresentado ≠ payload que o BE geraria). No wire-real, transforma "POST ao ERP falhou" em "SN dry-run gerada" — o analista assume falso sucesso.
- **Cards Kanban relacionados:** availability-2, fault-tolerance-6, testability-5, modifiability-2
- **Custo de inação em 6 meses:** dias/semanas de backend degradado sem detecção; drift silencioso entre `buildDryRunFallback` e `SolicitacaoNumerarioService.gerar`.

### R-4: Contrato Zod órfão — payload nunca é validado antes de sair pela rede
- **QAs afetados:** Integrability, Security, Fault Tolerance
- **Findings de origem:** F-integrability-2
- **Evidência sintetizada:** `gerDocProcessoSelectionDTOCabSchema` e `processoSchema` estão em `GerDocProcesso.ts:39-116` mas nenhum módulo do backend os importa. A rota redigita um schema inline (`recebimentos.ts:181-190`) para o mesmo shape. `gerar()` não valida o payload construído. Dois schemas para o mesmo campo convivem.
- **Impacto técnico:** drift silencioso — mudar o DTO em um lugar não força atualização no outro. `gerDocProcessoSelectionDTOCabSchema` (validação do PAYLOAD final antes do POST) simplesmente não roda.
- **Impacto de negócio:** primeiro POST real ao Conexos pode enviar shape divergente do swagger e o operador só descobre pelo erro do ERP. Custo: rodada extra de HML + debug + re-teste.
- **Cards Kanban relacionados:** integrability-2, modifiability-2 (efeito cascata FE)
- **Custo de inação em 6 meses:** cada tweak do provider (HML corrigindo `docTip`, adicionando campo obrigatório) exige tocar 4+ arquivos; probabilidade de deploy inconsistente FE↔BE cresce.

### R-5: Ausência de `ExternalCallOptions/timeoutMs` no seam `enviarAoErp` e no `ProcessoProviderInterface` — reintroduz cenário `LOGIN_ERROR_MAX_SESSIONS`
- **QAs afetados:** Availability, Performance, Integrability
- **Findings de origem:** F-availability-4, F-performance-1, F-performance-2, F-integrability-1
- **Evidência sintetizada:** 3/4 ports write da Frente IV (`NexxeraGateway`, `ErpReceivablesGateway`, `NdeEmitter`) aceitam `opts?: ExternalCallOptions`; `enviarAoErp` e `ProcessoProviderInterface.listCandidatosParaTransacao` **não** aceitam. FE `fetchProcessosParaTransacao` também não usa `AbortController/AbortSignal.timeout`. Constantes já existem (`ERP_WRITE_TIMEOUT_MS=8000`, `RECEBIMENTO_RETRY_ATTEMPTS=3`).
- **Impacto técnico:** um Conexos travado sob incidente pinará worker Express até o timeout global do Node/Render (~30s), esgotando pool e degradando outras rotas do Express. Mesmo cenário que motivou o incidente `LOGIN_ERROR_MAX_SESSIONS` na Frente II.
- **Impacto de negócio:** durante um incidente Conexos, o operador não tem feedback rápido; painel de Recebimentos trava.
- **Cards Kanban relacionados:** availability-4, performance-1, performance-2, integrability-1
- **Custo de inação em 6 meses:** custo de fix pós-fato ≈ 1 dia (M) vs. 15 min agora — repetição do incidente com MTTR ~4h + rollback.

### R-6: Dívida de CVE high (backend axios + frontend deps) — infraestrutura vulnerável carregando dinheiro
- **QAs afetados:** Security, Availability
- **Findings de origem:** F-security-5, F-security-6
- **Evidência sintetizada:** backend `npm audit` = 3 high (axios <1.18.0 — GHSA-42h9-826w-cgv3 DoS, GHSA-xj6q-8x83-jv6g prototype pollution auth, GHSA-pmv8-rq9r-6j72 DoS) + 2 moderate. Frontend `npm audit` = 6 high + 1 low. Feature SN não introduz deps, mas monta UI money-adjacent sobre esse baseline.
- **Impacto técnico:** vetor DoS por payload malformado ou prototype pollution em auth subfields; XSS/SSRF potencial no frontend (depende da triagem por-CVE).
- **Impacto de negócio:** quando `enviarAoErp` for cabeado, o cliente HTTP que envia payload SN ao Conexos é vulnerável — DoS por recursion em resposta malformada do ERP derruba o worker. Compliance/auditoria de segurança fica com dívida visível.
- **Cards Kanban relacionados:** security-5, security-6
- **Custo de inação em 6 meses:** exposição contínua; risco assimétrico (baixa probabilidade × alto impacto se explorado).

### R-7: Rollback e canary do SN inexistentes — big-bang habilita para todas as filiais simultaneamente
- **QAs afetados:** Deployability, Availability
- **Findings de origem:** F-deployability-1 (runbook), F-deployability-3 (canary por filial), F-deployability-4 (drift env), F-deployability-5 (dessincronia FE↔BE)
- **Evidência sintetizada:** `docs/runbooks/` tem só `fin010-write-cutover.md`; nada para SN. `isRecebimentosEnabled()` e `recebimentosGate` são booleans globais — não têm dimensão `filCod`. 12 chaves em `render.yaml` estão em `sync: false` (incluindo `RECEBIMENTOS_ENABLED`, `CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`). BE (Render) e FE (Vercel) auto-deployam em paralelo sem coordenação.
- **Impacto técnico:** no dia do primeiro rollout, 100% dos analistas veem o modal simultaneamente; incidente afeta todos. Operador reverte lendo código-fonte. Uma mudança acidental de `CONEXOS_DRY_RUN` no dashboard não deixa rastro no repo.
- **Impacto de negócio:** MTTR alto em incidente Frente IV; ausência de filial-piloto para primeiro rollout real da SN.
- **Cards Kanban relacionados:** deployability-1, deployability-3, deployability-4, deployability-5
- **Custo de inação em 6 meses:** cada deploy da Frente IV segue sendo experimento em produção; incidente eventual custa MTTR maior por leitura de código.

### R-8: `errorMiddleware` achata `HandlerError.statusCode` — `NotImplementedError` (501) vira 500 opaco
- **QAs afetados:** Availability, Fault Tolerance
- **Findings de origem:** F-availability-1
- **Evidência sintetizada:** `errorMiddleware.ts:35-37` sempre responde `HTTP 500 {error:'Internal server error'}`. Nunca lê `statusCode` do `HandlerError`. `NotImplementedError.ts:11-25` define `statusCode:501`, `code:'NOT_IMPLEMENTED'`, `retryable:false` — todos ignorados.
- **Impacto técnico:** quando `enviarAoErp` for chamado por engano (ou em teste manual), resposta será 500 genérico. Alarms downstream que discriminam por status são cegados.
- **Impacto de negócio:** fadiga de alerta (endpoint deliberadamente desativado gera ruído 500 como se fosse falha real).
- **Cards Kanban relacionados:** availability-1
- **Custo de inação em 6 meses:** dívida barata (S, ≤1d); custo real é o ruído acumulado em alarms.

### R-9: DTO SN duplicado literalmente BE↔FE + `buildDryRunFallback` no FE re-implementa o payload builder
- **QAs afetados:** Modifiability, Integrability, Fault Tolerance
- **Findings de origem:** F-integrability-3, F-modifiability-1, F-modifiability-2
- **Evidência sintetizada:** 4 interfaces (`Processo`, `TmpCom068DTOItem`, `GerDocProcessoSelectionDTOCab`, `DocConfig`) e 1 fábrica (`buildDryRunFallback`) duplicadas 1:1 entre `src/frontend/lib/recebimentos.ts:311-428` e `src/backend/domain/interface/recebimentos/GerDocProcesso.ts:19-134`. Constantes hardcoded no FE (`790`, `'SN'`) em vez de reusar `SOLICITACAO_NUMERARIO_*` do BE.
- **Impacto técnico:** fan-out de mudança = 2 para qualquer alteração de shape. Qualquer tweak do swagger com299 exige N edições coordenadas.
- **Impacto de negócio:** probabilidade de deploy inconsistente FE↔BE cresce; preview mostrado ao stakeholder pode divergir do payload real.
- **Cards Kanban relacionados:** integrability-3, modifiability-1, modifiability-2
- **Custo de inação em 6 meses:** cada nova rota FE que consumir SN engorda o gap; débito estrutural.

### R-10: Ausência de instrumentação (APM + `MetricsPortInterface.emit`) — baseline zerada para o dia do wire-real
- **QAs afetados:** Performance, Availability, Integrability
- **Findings de origem:** F-performance-4, F-availability-5, F-integrability-6, F-fault-tolerance-5 (parcial — audit persistido)
- **Evidência sintetizada:** `grep -rn "opentelemetry\|dd-trace\|newrelic" src/backend` → 0. `MetricsPortStub` está registrado (`recebimentosContainer.ts:53`) mas não é injetado no `SolicitacaoNumerarioService`. Log estruturado existe (`BUSINESS_INFO`) mas não vai para tabela persistida.
- **Impacto técnico:** métricas de p95 declaradas no doc são especulativas. Sem baseline histórica de "quantas SNs simuladas por dia", não há eixo de comparação no dia do wire-real. MTTD (mean-time-to-detect) alto.
- **Impacto de negócio:** cada issue de perf vira arqueologia; entrada no wire-real cega.
- **Cards Kanban relacionados:** performance-4, availability-5, integrability-6, security-3
- **Custo de inação em 6 meses:** primeira reclamação "está lento" post-cabo custa uma sprint de investigação; falsos alarmes / picos passam despercebidos.

## 4. Cross-cutting findings (root-cause overlap)

### CC-1: **Silêncio do FE mascara falha do backend** — mesmo pattern em 3 QAs

- **Aparece em:** Availability (F-availability-2), Fault Tolerance (F-fault-tolerance-6), Testability (F-testability-5), Integrability (parcial via drift silencioso), Modifiability (F-modifiability-2 — o fallback duplica lógica além de silenciar)
- **Diagnóstico unificado:** `lib/recebimentos.ts` implementa três funções (`fetchProcessosParaTransacao`, `processarSolicitacaoNumerario`, uma variante de `fetchPainelRecebimentos`) usando `try/catch` genérico que engole qualquer erro do backend e devolve um fixture / payload sintético local. Só `fetchPainelRecebimentos` marca `fonte:'banco'|'fixture'`. As duas novas funções do delta SN não replicaram esse padrão. O toast e a badge do modal não distinguem origem. O `catch` é literalmente vazio — sem log, sem breadcrumb, sem sinal.
- **Recomendação consolidada:** fechar cards **availability-2 + fault-tolerance-6 + testability-5** como um único delta. Adicionar `fonte: 'backend' | 'fallback-local'` ao retorno das duas funções, `console.warn` no `catch`, badge + toast na UI quando `fonte === 'fallback-local'`. Alternativa mais forte: remover `buildDryRunFallback` inteiro e obrigar retry visível (card **modifiability-2** propõe exatamente isso).

### CC-2: **`gcdCod=0` placeholder aparece em 3 lugares** — duplicação + gate único de defesa

- **Aparece em:** Modifiability (F-modifiability-1), Integrability (F-integrability-5), Fault Tolerance (F-fault-tolerance-1)
- **Diagnóstico unificado:** o `gcdCod=0` mora em (1) `constants.ts:132` (BE), (2) `lib/recebimentos.ts:397` (FE fallback), (3) implicitamente no `NotImplementedError` como única defesa contra POST inválido. Quando HML confirmar o valor real, o time terá que editar 2 arquivos em 2 stacks e um único patch de "remover o throw" transforma dry-run em POST inválido.
- **Recomendação consolidada:** endereçar em duas frentes complementares. (a) **modifiability-1**: mover `gcdCod` para env (`EnvironmentProvider.solicitacaoNumerarioGcdCod`) — fonte única. (b) **integrability-5**: adicionar env flag `SN_LIVE_WRITE_ENABLED=false` + guard `gcdCod === 0` no seam — 3 gates em vez de 1 (throw + env flag + placeholder guard). Combinados, tornam impossível cabear o seam sem passar por config explícita.

### CC-3: **Sem `ExternalCallOptions/timeoutMs` no seam SN e no port** — regressão do contrato Frente IV

- **Aparece em:** Availability (F-availability-4), Performance (F-performance-1, F-performance-2), Integrability (F-integrability-1)
- **Diagnóstico unificado:** o resto da Frente IV padronizou `opts?: ExternalCallOptions` (`ports.ts:44-49`) em 3/4 ports write; SN é o único fora do padrão. FE também não usa `AbortController`. Enquanto for dry-run, é inerte. No wire-real, reintroduz o cenário `LOGIN_ERROR_MAX_SESSIONS`.
- **Recomendação consolidada:** fechar cards **availability-4 + performance-1 + performance-2 + integrability-1** como um único delta de "paridade Frente IV". (1) Adicionar `opts?: ExternalCallOptions` na assinatura do port + do seam; (2) definir `PROCESSO_PROVIDER_TIMEOUT_MS` em `constants.ts`; (3) FE passa `signal: AbortSignal.timeout(5000)` no `apiFetch`. Baixo custo (S), alto leverage (mata 4 findings).

### CC-4: **Falta de idempotência + reconciliação + audit persistido na rota SN** — 3 lacunas independentes que compõem 1 risco

- **Aparece em:** Fault Tolerance (F-fault-tolerance-2, F-fault-tolerance-3, F-fault-tolerance-5), Availability (F-availability-3), Security (F-security-3), Testability (parcial — sem persistência não há base de asserção de reprocess)
- **Diagnóstico unificado:** rota SN não emite/consulta `Idempotency-Key` (padrão da rota irmã `pipeline/run:84-86` não foi replicado); ontologia não define handle wire-level (`docVldFinalizado` ou equivalente) para reconciliar; log `BUSINESS_INFO` roda em memória sem persistência em `audit_log`. Cada gap é benigno hoje; combinados, no dia do wire-real, formam a receita para SN duplicada + não-reconciliável + não-rastreável.
- **Recomendação consolidada:** os 3 cards (**fault-tolerance-2 idempotência**, **fault-tolerance-3 handle wire-level**, **fault-tolerance-5 ledger persistido** + **security-3 audit_log**) formam um pacote atômico. Não faz sentido fechar 1 sem os 3 — a chave de idempotência precisa de um ledger; o ledger fornece a base de reconciliação; a reconciliação precisa do handle wire-level do com299 (captura HAR HML). O card **fault-tolerance-1** (business-rule DRY-RUN) amarra os 3 como pré-requisito documentado do PR que remove `throw`.

### CC-5: **Sem instrumentação (APM + MetricsPort + audit persistido)** — baseline zerada para o dia do go-live

- **Aparece em:** Performance (F-performance-4), Availability (F-availability-5), Integrability (F-integrability-6), Security (F-security-3), Fault Tolerance (F-fault-tolerance-5)
- **Diagnóstico unificado:** nenhum span/trace é coletado hoje (`grep -rn "opentelemetry\|dd-trace" src/backend` → 0). `MetricsPortStub` existe mas não é injetado no `SolicitacaoNumerarioService`. Log estruturado existe mas não vai para tabela persistida. No dia do wire-real, todos os dashboards nascem zerados sem eixo de comparação com a fase dry-run.
- **Recomendação consolidada:** dois cards se somam com pouco esforço extra. (1) **performance-4**: instalar `@opentelemetry/sdk-node` + auto-instrumentation Express (M — infra transversal, aproveita Permutas/SISPAG). (2) **integrability-6 + availability-5**: injetar `METRICS_PORT_TOKEN` no `SolicitacaoNumerarioService` (S). (3) **security-3 + fault-tolerance-5**: tabela `audit_log` compartilhada (M — alinhar com SISPAG). Combinados, dão baseline mensurável antes do wire-real.

## 5. Quick wins (esforço S, severidade ≥ P2 — defensáveis como primeira sprint pós-aprovação)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| availability-1 | Availability | S | P2 | `errorMiddleware` traduz `HandlerError.statusCode` — 0% → 100% |
| availability-2 | Availability | S | P1 | FE marca `fonte:'fallback-local'` + log — caminhos silenciosos 2 → 0 |
| availability-4 | Availability | S | P2 | `enviarAoErp` wrap com `RetryExecutor` + `timeoutMs` — pré-req wire-real |
| deployability-1 | Deployability | S | P1 | Runbook `recebimentos-sn-kill-switch.md` — 0 → 1; MTTR reversão ≤ 3 min |
| deployability-4 | Deployability | S | P2 | Cron drift detector env vars — 12 vars monitoradas em 0 → 7 dias |
| integrability-1 | Integrability | S | P1 | `enviarAoErp` aceita `ExternalCallOptions` — paridade 3/4 → 4/4 |
| integrability-2 | Integrability | S | P1 | Rota reusa DTO canônico + `.parse()` no `gerar()` — schemas órfãos 2 → 0 |
| integrability-5 | Integrability | S | P1 | Gates independentes protegendo POST live — 1 (throw) → 3 |
| integrability-6 | Integrability | S | P2 | `MetricsEvent` por-dependência SN — 0 → 1 emit por `gerar()` |
| modifiability-1 | Modifiability | S | P1 | `gcdCod` em env/SSM — sítios de mudança 2 → 1 (ou 0) |
| modifiability-2 | Modifiability | S | P1 | Remover `buildDryRunFallback` — funções duplicando shape 2 → 1 |
| modifiability-3 | Modifiability | S | P1 | Extrair `EncomendaValorCalculator` pure function — regra em 1 arquivo |
| modifiability-4 | Modifiability | S | P2 | Split `lib/recebimentos.ts` em 4 arquivos — max LOC 524 → ≤200 |
| modifiability-5 | Modifiability | S | P2 | Corrigir `set-state-in-effect` — 1 warning → 0 |
| performance-1 | Performance | S | P2 | `ExternalCallOptions.timeoutMs` no port — worst-case 30s → 5s |
| performance-2 | Performance | S | P2 | `AbortController` no `fetchProcessosParaTransacao` — timeout 5s |
| performance-3 | Performance | S | P3 | `heavyRouteLimiter` no GET — 100 req/min/IP → 10 |
| fault-tolerance-4 | Fault Tolerance | S | P1 | Flag guard `ENCOMENDA_PERCENTUAIS_RESOLVED` — 0 → 1 |
| fault-tolerance-6 | Fault Tolerance | S | P2 | Fallback FE explícito (toast + badge) — silenciosos 1 → 0 |
| security-1 | Security | S | P2 | Teste regressão `role != admin` na SN — 0/1 → 1/1 |
| security-2 | Security | S | P2 | Redigir `ator` no log SN — email → só `sub` opaco |
| security-5 | Security | S | P1 | `axios` >= 1.18.0 — high vulns backend 3 → 0 |
| testability-1 | Testability | S | P2 | Ramo `throw err` coberto nas 3 rotas — branch 63.63% → ≥80% |
| testability-2 | Testability | S | P2 | Asserção `logStub.info` (positiva + anti-PII) — 0 → 2 |
| testability-3 | Testability | S | P2 | Clock injetável na rota + asserts em timestamps — `new Date()` 5 → ≤1 |
| testability-4 | Testability | S | P2 | Estados restantes do dialog (erro + processando) — 3/5 → 5/5 |

**26 quick wins** (S / severidade ≥ P2). Estimado 2 sprints de 1 dev focado, com pesado paralelismo.

## 6. Strategic moves (M / L / XL — investimento com justificativa numérica)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| fault-tolerance-2 | Fault Tolerance, Availability, Security | M | Idempotent Replay | 0/1 rotas SN honrando idempotência; rota irmã `pipeline/run` já demonstra o padrão. Bloqueador direto do wire-real. |
| fault-tolerance-3 | Fault Tolerance, Integrability | S (docs) + M (impl) | Reconcile + Comparison | Open-gaps da integration 3 → 4; irmãos Permutas/NDe já modelam handle wire-level. Sem isso, "sair do dry-run" tem passo silencioso faltando. |
| fault-tolerance-5 | Fault Tolerance, Security | M | Condition Monitoring | 0 writes DB por invocação → 1 linha em ledger. Base de reconciliação retroativa é impossível sem persistência. |
| security-3 | Security, Fault Tolerance | M | Audit Trail | 0 tabelas de audit → 100% das ações persistidas. Compliance/reputação — "quem gerou SN X 3 meses atrás" hoje = "não sei". Custo 10× maior depois do wire-real. |
| security-4 | Security, Availability | M | Authorize Actors | 0% dos tokens carregam claim `filiais`; guard estruturalmente presente mas desarmado. Assimétrico: baixa probabilidade × alto impacto (evento de crise). |
| security-6 | Security, Availability | M | Limit Exposure | 6 high CVE frontend money-adjacent — necessita triagem por-CVE + possíveis major bumps (Next.js/React ecosystem). |
| integrability-3 | Integrability, Modifiability | M | Use an Intermediary | 4 interfaces + 1 fábrica duplicadas FE↔BE → 0. Cada tweak do swagger custa 4+ edições vs. 1. Débito estrutural — cresce com o tempo. |
| integrability-4 | Integrability, Testability | S (uma vez HML acessível) | Contract testing | 0 fixtures HAR versionadas → 1. Primeira homologação vira "test-in-prod" HML sem isso. |
| deployability-2 | Deployability, Testability | M | Test Deployment | 0 ambientes pré-prod → 1. Cada deploy hoje é "primeira execução real" da rota. Reduz roll-forward fixes em prod. |
| deployability-3 | Deployability | M | Scale Rollouts (Canary) | 1 dimensão de segmentação (global) → 2 (global + `filCod`). Enable "liga em Santos primeiro por 1 semana". |
| deployability-5 | Deployability, Availability | M | Version Consistency at deploy time | Janela dessincronia FE↔BE ~5min → 0s. Cada nova rota consumida do FE tem "flash de 404" pós-deploy. |
| performance-4 | Performance, Availability, Integrability | M | Meta-tactic (Instrumentation) | 0 traces → 100% das rotas cobertas. MTTD para "está lento" indefinível hoje. Infra transversal — aproveita Permutas/SISPAG. |
| performance-5 | Performance, Modifiability | M | Reduce Overhead | Payload da resposta ERP order-of-magnitude (5000 → ≤20 candidatos). Bloqueado pelo Módulo 2b (matching engine real). |
| testability-5 | Testability, Deployability, Availability | M | Executable Assertions | Funções com `fonte` 1/3 → 3/3. Cross-QA — mata a mesma raiz do CC-1 (fallback silencioso). |

## 7. O que está bem (e por quê) — ancora a credibilidade defensiva

1. **DRY-RUN invariante verificado por evidência.** Grep + 1 teste unitário (`SolicitacaoNumerarioService.test.ts:77-88`) provam: `enviarAoErp` lança `NotImplementedError(retryable:false, statusCode:501)`; zero call-sites o invocam; zero imports HTTP no service. Tactic Bass: **Substitution** + **Predictive Model** presentes.
2. **Defesa em profundidade — 4 camadas.** `RECEBIMENTOS_ENABLED=false` fail-safe em prod → `heavyRouteLimiter` (10 req/min/IP) → `requireRole('admin')` → `assertUserCanActOnFilial`. Somando com o seam desarmado, o blast-radius = 0.
3. **DI/port bem desenhado.** `PROCESSO_PROVIDER_TOKEN` (Symbol) + `ProcessoProviderInterface` + `container.registerInstance(...)` — trocar stub por real = **1 linha** em `recebimentosContainer.ts:55` sem tocar rota, service, DTO ou teste. Tactic: **Defer Binding — polymorphism (DI)**. Score de Modifiability 8.2 reflete isso.
4. **Encapsulate exemplar.** `SolicitacaoNumerarioService` tem 1 responsabilidade coesa (montar payload). 122 LOC. 2 métodos públicos. TODO `encomenda-percentuais` isolado em 1 linha (`SolicitacaoNumerarioService.ts:62`). Score de Modifiability defende isso.
5. **Zod nos boundaries.** 3/3 endpoints tocados aplicam `safeParse` no boundary (`runPipelineSchema`, `listCandidatosQuerySchema`, `gerarSolicitacaoNumerarioSchema`). Payload malformado vira 400 antes do service.
6. **Cobertura de teste do delta excepcional.** 95.45% linhas, 90.9% funções nos 4 arquivos-fonte do delta. 34 novos testes verdes (21 BE + 13 FE). 3 suites BE, 2 suites FE. Zero rede real nos units. Feedback loop rápido (BE 2.97s, FE 1.79s).
7. **Version bump lockstep FE==BE em `0.17.6`.** Script `scripts/bump-version.ps1` + job `tag-release` idempotente. CHANGELOG atualizado. Reprodutibilidade determinística no CI (`npm ci` + lockfiles commitados + Node 24 pinned).
8. **Zero P0 de Security.** Nenhum secret hardcoded, nenhum `process.env` cru no backend SN, nenhum SQL cru (stub in-memory), nenhum `dangerouslySetInnerHTML`, `DEV_AUTH_BYPASS` é opt-in explícito com warn no boot.

## 8. Limitações da análise

- **Não medível localmente pelos agentes (métricas de produção real):**
  - MTTR real do envio pós-go-live (requer instrumentação CloudWatch/APM).
  - p95/p99 latência das rotas em produção (sem APM em Render).
  - Taxa de fallback silencioso do FE em produção (sem Sentry/Vercel Analytics).
  - Taxa de tentativas rejeitadas por `assertUserCanActOnFilial` em produção.
  - Presença efetiva do claim `permissions.filiais` em tokens Supabase de produção.
  - Lead-time real commit→prd (métrica do dashboard Render/Vercel).
  - Bundle size delta do `AlocarProcessosDialog` (sem `next build --profile`).
- **O que o pipe não cobre nesta rodada:** chaos engineering, threat modeling formal, custo cloud, UX/acessibilidade, mutation testing (`stryker` não é dep do repo), triagem por-CVE detalhada dos 6 high do frontend, license compliance (`license-checker` não avaliado).
- **Janela temporal:** este é um snapshot do dia **2026-07-29**. O código evolui; refazer trimestralmente ou disparado por: (a) primeira remoção do `throw` do `enviarAoErp`, (b) provisionamento do claim `filiais`, (c) adição de qualquer nova rota write-ish em `/recebimentos/*`.
- **Escopo do gate:** feature-delta (5 arquivos-core BE + FE dialog + ontologia). Os 28 warnings pré-existentes de `noExcessiveCognitiveComplexity` em permutas/sispag/conexos foram documentados como contexto, não atribuídos ao delta. Fluxos irmãos (Permutas fin010, SISPAG remessa, painel de recebimentos) não foram reauditados.
- **Handle `docVldFinalizado` mencionado no prompt vs. realidade:** grep em `ontology/` e `src/backend/` retorna 0 ocorrências. Tratado em F-fault-tolerance-3 como falta de modelagem. Precisa ser explicitamente capturado no HAR HML — ou o handle correto (se não for esse) precisa ser descoberto.

## 9. Ações recomendadas (30 dias)

1. **Mergear o delta como está** (gate PASS — zero P0). Não segure a feature; ela é o exemplo mais limpo de DRY-RUN-by-design do repositório e destrava a demo com stakeholder.
2. **Sprint 1 (5 dias úteis) — Endereçar cross-cutting CC-1 (silêncio do FE) e CC-3 (paridade `ExternalCallOptions`).** Fecha em bloco: availability-2, fault-tolerance-6, testability-5, availability-4, performance-1, performance-2, integrability-1. Custo total: ~5 dias, 1 dev. Elimina 7 findings simultaneamente.
3. **Sprint 2 (5 dias úteis) — Endereçar cross-cutting CC-2 (`gcdCod` fonte única + gates).** Fecha em bloco: modifiability-1, integrability-5, modifiability-2. Elimina 3 findings e transforma o gate contra POST inválido em 3 camadas independentes. Prepara o terreno para o dia do HML.
4. **Antes de qualquer PR que remova `throw new NotImplementedError`, exigir fechamento do pacote CC-4 (idempotência + reconciliação + audit persistido).** Cards: fault-tolerance-1 (business-rule), fault-tolerance-2, fault-tolerance-3, fault-tolerance-4, fault-tolerance-5, security-3. Isto é o gate real do wire-real — não negociável.
5. **Estratégico (paralelo aos itens 2-4):** security-4 (claim `filiais`) + security-5 (bump axios). Ambos são condição para operação multi-tenant segura. security-4 é bloqueante para a fase real em qualquer cliente com mais de 1 filial ativa.
6. **Planejar Sprint 3-4 para os strategic moves M:** performance-4 (APM), integrability-3 (compartilhar DTOs), deployability-2 (staging). São os que pagam juros a longo prazo — não bloqueiam o wire-real do SN, mas destravam qualidade sustentada de todas as próximas features Frente IV.
