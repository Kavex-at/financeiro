---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-07-29-0243-recebimentos-sn
agent: qa-fault-tolerance
generated_at: 2026-07-29T02:43:00Z
scope: backend
score: 8
findings_count: 6
cards_count: 6
---

# Fault Tolerance — Regis-Review

> Escopo (feature-gate): delta do `gerarSolicitacaoNumerario` (SN) — o serviço `SolicitacaoNumerarioService`,
> o seam `enviarAoErp`, o `NotImplementedError`, o stub `ProcessoProviderStub`, a rota
> `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` (e a `GET .../processos`), o modal
> `AlocarProcessosDialog` + o cliente `processarSolicitacaoNumerario`, e a ontologia
> `actions/recebimentos/gerar-solicitacao-numerario.md` + `integrations/conexos-com299-gerdoc.md`.
> A propriedade de segurança load-bearing é o **DRY-RUN invariante**: não existe caminho de escrita
> ao Conexos alcançável a partir da rota SN — validado abaixo por evidência.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "Processar" (duplo-clique, retry após 5xx, ou POST replay) | Requisição repetida ao POST `/recebimentos/transacoes/:txnId/solicitacao-numerario` **ou** invocação (futura) do seam `enviarAoErp` | Rota SN + `SolicitacaoNumerarioService.gerar` / `.enviarAoErp` + placeholder `gcdCod=0` + regra `encomenda-percentuais` não-resolvida | Operação normal — feature em **DRY-RUN-ONLY** (sem credenciais HML, sem contrato HAR confirmado, sem write-enabled flag) | Sistema (a) constrói e devolve payload dry-run **sem** POST ao ERP; (b) qualquer invocação do envio real falha com `NotImplementedError` (501, `retryable:false`); (c) autoriza somente `admin` + filial-permitida; (d) rate-limita a rota "write-ish" | **0** POSTs ao Conexos disparados pelo caminho SN (grep-verificado); 100% das SNs marcadas `dryRun:true`; 501 em qualquer chamada a `enviarAoErp`; 403 cross-filial; ≤10 req/min por IP |

> Nota autoral (fault-tolerance framing): o seam `NotImplementedError` é uma **Substitution** deliberada — o
> caminho de escrita é substituído por uma falha determinística que preserva a consistência (o ERP
> nunca vê um documento com `gcdCod=0` placeholder ou com o valor cru errado da regra encomenda
> não-resolvida). Custo de negócio: nenhum documento errado; custo de operação: analista vê apenas
> simulação até a homologação-first fechar.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas HTTP a Conexos (POST/PUT/DELETE) originadas do caminho SN | **0** | 0 (dry-run) | ✅ | `grep -rn "ConexosClient\|axios\|fetch\|http" src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts` → só imports `LogService`, `NotImplementedError`, tipos |
| Imports HTTP-shape no `SolicitacaoNumerarioService` | 0 (apenas `LogService` + tipos) | 0 | ✅ | `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:1-15` |
| Testes cobrindo "no reachable ERP write" | 1 (`enviarAoErp throws NotImplementedError`) | ≥1 | ✅ | `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.test.ts:77-88` |
| Testes cobrindo cross-filial (403) na rota SN | 1 | ≥1 | ✅ | `src/backend/routes/recebimentos.test.ts:260-273` |
| Testes cobrindo payload malformado (400 Zod) | 1 | ≥1 | ✅ | `src/backend/routes/recebimentos.test.ts:275-286` |
| Idempotência aplicada à rota SN (`Idempotency-Key` / ledger / dedupe por hash) | **0** | 1 se/quando `enviarAoErp` for cabeado | ⚠️ | `grep -n "Idempotency-Key\|idempotencyKey" src/backend/routes/recebimentos.ts` — só o `pipeline/run` a possui (linhas 84-86); a rota SN não |
| Handle de idempotência no wire com299 documentado na ontologia (o "hook" para o futuro emit) | **0** ocorrências de `docVldFinalizado` na ontologia | 1 (referência explícita ao campo/estado que o futuro `enviarAoErp` verificará) | ❌ | `grep -rn "docVldFinalizado" ontology/` → nenhum resultado |
| Timeout configurado no seam `enviarAoErp` | N/A (seam lança antes de qualquer I/O) | Herdar `ERP_WRITE_TIMEOUT_MS = 8000` do `constants.ts` quando cabeado | ⚠️ | `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:117-121`; constante já existe em `src/backend/domain/interface/recebimentos/constants.ts:100` |
| Audit trail persistido (write DB) do "Processar" (quem/quando/qual processo) | **0** — só log estruturado em memória (`LogService.info`, `BUSINESS_INFO`) | ≥1 registro persistido por invocação do "Processar", mesmo dry-run (rastro do que o operador simulou) | ⚠️ | `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:97-107` (log info, sem repositório) |
| Placeholders no payload dry-run que quebrariam consistência se um POST fosse cabeado hoje | 3 (`gcdCod=0`, `docTip='SN'`/`docVldTipo='SN'` unconfirmed, `items[*].{prjCod,ctpCod,tpcCod,cfoEspCod}=0`) | 0 | ⚠️ | `src/backend/domain/interface/recebimentos/constants.ts:130-140`; `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:86-93` |
| `valor` da SN calculado com a regra `encomenda-percentuais` | **0** — usa `valorTransacao` cru (`TODO(encomenda-percentuais)`) | 1 (regra resolvida antes de qualquer POST real) | ❌ | `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:60-62` |
| Fallback frontend "constrói dry-run local" quando o backend erra | 1 (`buildDryRunFallback`) | 0 (mascara falha real do backend com uma simulação silenciosa) | ⚠️ | `src/frontend/lib/recebimentos.ts:391-428`, `461-492` |

⚠️ **Não medível localmente (produção):** MTBF/MTTR do seam, taxa de duplo-clique no botão "Processar",
proporção de retries do frontend em produção. Requer telemetria (CloudWatch/RUM) — hoje o log é
estruturado (`LogService.info` com `type: 'BUSINESS_INFO'`), mas não há métrica de contador exposta.

## 3. Tactics — Cobertura no nf-projects (framing autoral fault-tolerance)

| Tactic | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution (Avoid) | Caminho de escrita ao Conexos substituído por `NotImplementedError` no seam `enviarAoErp` — nenhuma via alcançável dispara POST | ✅ presente | `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:117-121`; `src/backend/domain/errors/NotImplementedError.ts:1-27` (retryable=false) |
| Replacement (Avoid) | `ProcessoProviderInterface` + DI token `PROCESSO_PROVIDER_TOKEN` — troca-se `ProcessoProviderStub` pela fonte real sem tocar rota/serviço (reduz risco de acoplamento na hora do swap) | ✅ presente | `src/backend/domain/interface/recebimentos/ports.ts:228-236, 351`; `src/backend/domain/recebimentosContainer.ts:55` |
| Predictive Model (Avoid) | Dry-run **é** o modelo preditivo — devolve o payload que **seria** enviado (`{dryRun:true, docConfig, payload}`) para inspeção humana antes do write real | ✅ presente | `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:58-110`; `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:48-67` (`PayloadPreview`) |
| Increase Competence Set (Avoid) | Human-in-the-loop — o operador **escolhe** o processo candidato e revisa o payload antes de qualquer envio; rate-limit + `requireRole('admin')` na rota "write-ish" | ✅ presente | `src/backend/routes/recebimentos.ts:199-234`; ontologia `preconditions[1]` — "Operador aciona 'Alocar' e ESCOLHE um processo" |
| Sanity Checking (Detect) | Zod no boundary: `gerarSolicitacaoNumerarioSchema` valida body (rota) → 400 em payload malformado; `NotImplementedError.statusCode=501` sinaliza a categoria correta | ✅ presente | `src/backend/routes/recebimentos.ts:181-190, 205-209`; teste `recebimentos.test.ts:275-286` |
| Comparison (Detect) | N/A — não há execução ao vivo para comparar contra estado esperado; a comparação será a reconciliação `docVldFinalizado 0→1` no com299, ainda não modelada (ver F-fault-tolerance-2) | ⚠️ parcial | `grep -rn "docVldFinalizado" ontology/` → 0 |
| Timestamp (Detect) | `docDtaEmissao`/`dtaVencimento` derivados de `dataReferencia` (`new Date()` na rota) e log com `type: 'BUSINESS_INFO'` estruturado por invocação | ✅ presente | `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:63, 80-81, 97-107` |
| Timeout (Detect) | Não aplicável ao dry-run (nenhuma I/O); constante alvo `ERP_WRITE_TIMEOUT_MS=8000ms` está pronta para o seam real via `ExternalCallOptions.timeoutMs` | ⚠️ parcial | `src/backend/domain/interface/recebimentos/constants.ts:100`; `ports.ts:45-49` (`ExternalCallOptions`) |
| Condition Monitoring (Detect) | `LogService.info` estruturado por invocação (`type: 'BUSINESS_INFO'`, `dryRun:true`, `priCod`, `filCod`, `gcdDesNome`, `ator`) — permite grep post-mortem | ✅ presente | `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:97-107` |
| Self-Test (Detect) | Suíte cobre "no reachable ERP write" (unitário) e cross-filial/malformed (integração de rota) | ✅ presente | `SolicitacaoNumerarioService.test.ts:77-88`; `recebimentos.test.ts:234-287` |
| Voting (Detect) | N/A — não há redundância replicada; a arquitetura é single-writer humana | N/A | — |
| Redundancy (Contain) | Frontend tem `buildDryRunFallback` local — **atenção**: isso é redundância que **mascara** uma falha real do backend (P2 abaixo). No servidor, não há redundância (nem faria sentido para um seam desabilitado) | ⚠️ parcial | `src/frontend/lib/recebimentos.ts:391-428, 489-491` |
| Recovery — Forward (Contain) | O uso de `NotImplementedError` já **é** forward-recovery: qualquer invocação do envio real transita a operação para um estado inequívoco (501) que o operador reprocessa quando o gate abrir | ✅ presente | `src/backend/domain/errors/NotImplementedError.ts:6-15` |
| Recovery — Backward (Contain) | N/A — não há transação DB nem estado externo mutado (dry-run) para reverter | N/A | — |
| Reintroduction — Shadow / State Resync / Escalating Restart (Contain) | N/A (seam desabilitado); shadow é o próprio dry-run: constrói o mesmo payload que seria enviado | N/A | — |
| Rollback (Recover) | N/A no dry-run; quando o write real for cabeado, o `RecebimentoExecucaoRepository` ledger (Fase 5) fornecerá o write-ahead — não usado pelo caminho SN nesta iteração | ⚠️ parcial | `src/backend/domain/interface/recebimentos/ports.ts:260-306` (ledger existe para Recebimento, **não** para SN ainda) |
| Repair State (Recover) | N/A — sem estado próprio (nem local, nem remoto) alterado pelo SN dry-run | N/A | — |
| Idempotent Replay (Recover) | **Ausente** na rota SN — nem `Idempotency-Key` header, nem hash-de-conteúdo, nem ledger próprio. A rota irmã `POST /recebimentos/pipeline/run` já faz o namespacing correto (`receb:${ator}:${headerKey ?? correlationId}`) e serve de padrão | ❌ ausente | `src/backend/routes/recebimentos.ts:181-236` (nada de `Idempotency-Key`) vs. `:84-86` (`pipeline/run`) |
| Compensating Transaction (Recover) | N/A hoje (sem write). Quando cabeado: com299 não expõe "undo" limpo de um `gerDocProcesso`; a política correta é **forward** (roteamento para fila de exceção do analista) — já é o desenho implícito, precisa doc | ⚠️ parcial | ontologia `conexos-com299-gerdoc.md` não descreve a política de compensação/forward para o futuro emit |
| Reconcile (Recover) | Não há reconciliação SN vs. Conexos (é dry-run). A ontologia menciona `docVldFinalizado` como handle previsto **no prompt**, mas não aparece nem no código nem no `.md` — precisa ser explicitado | ❌ ausente | `grep -rn "docVldFinalizado" ontology/ src/backend/` → 0 resultados |
| Quarantine (Recover) | O próprio seam quarentena o envio: `retryable:false` + `statusCode:501` deixa claro para qualquer executor que o item não deve ser reenfileirado | ✅ presente | `src/backend/domain/errors/NotImplementedError.ts:14-15` |

## 4. Findings (achados)

### F-fault-tolerance-1: Zero caminhos de escrita ao Conexos alcançáveis pela rota SN — invariante DRY-RUN verificado

- **Severidade**: P3 (informativo — a propriedade **passa**; este finding é a evidência positiva que sustenta o score)
- **Tactic violada**: nenhuma — **Substitution** e **Predictive Model** presentes
- **Localização**: `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:1-122`; `src/backend/routes/recebimentos.ts:199-237`; `src/backend/domain/errors/NotImplementedError.ts:1-27`
- **Evidência (objetiva)**:
  ```
  # imports do serviço SN — só LogService + tipos, ZERO clients HTTP:
  $ grep -n "import" src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts
  1:import 'reflect-metadata';
  2:import { inject, injectable } from 'tsyringe';
  3:import NotImplementedError from '../../errors/NotImplementedError.js';
  4:import { SOLICITACAO_NUMERARIO_DOC_CONFIG, ... } from '../../interface/recebimentos/constants.js';
  10:import type { GerDocProcessoSelectionDTOCab, Processo, SolicitacaoNumerarioDryRun, } from '../../interface/recebimentos/GerDocProcesso.js';
  15:import LogService from '../LogService.js';

  # seam desabilitado:
  117:    public enviarAoErp = async (_payload: GerDocProcessoSelectionDTOCab): Promise<never> => {
  118:        throw new NotImplementedError(
  119:            'com299/gerDocProcesso live POST is disabled — dry-run only until HML/HAR confirm gcdCod + payload',
  120:        );
  121:    };

  # busca por qualquer POST/write a com299 na base:
  $ grep -rn "com299/gerDocProcesso\|enviarAoErp" src/backend/ --include="*.ts"
  # → apenas o próprio service, testes, ontologia, e a NotImplementedError (todos declarativos, nenhum consumidor invoca `.enviarAoErp`)
  ```
- **Impacto técnico**: nenhum documento com `gcdCod=0` placeholder ou valor cru errado da regra encomenda pode ser criado no ERP a partir deste caminho — a consistência com o Conexos é preservada por Substitution.
- **Impacto de negócio**: risco de emissão indevida de Solicitação de Numerário = 0 nesta iteração; a homologação-first pode prosseguir sem risco de "vaza um POST".
- **Métrica de baseline**: `0` POSTs alcançáveis; `1` teste unitário garantindo `NotImplementedError` em `enviarAoErp`.

### F-fault-tolerance-2: Rota SN "write-ish" sem `Idempotency-Key` — replay do POST re-executa o dry-run silenciosamente

- **Severidade**: P2 (médio — hoje o efeito é apenas re-emitir um log `BUSINESS_INFO` e devolver o mesmo payload; quando o seam real for cabeado, este mesmo endpoint precisa ganhar idempotência antes do primeiro POST real, senão vira P0)
- **Tactic violada**: **Idempotent Replay** (Recover)
- **Localização**: `src/backend/routes/recebimentos.ts:199-237`
- **Evidência (objetiva)**:
  ```
  $ grep -n "Idempotency-Key\|idempotencyKey" src/backend/routes/recebimentos.ts
  53:// POST /recebimentos/pipeline/run — dispara o coordinator stubbed. `Idempotency-Key` honrado
  84:        // `Idempotency-Key` de header explícito também é namespaced pelo sub.
  85:        const headerKey = req.header('Idempotency-Key');
  86:        const idempotencyKey = `receb:${ator}:${headerKey ?? parsed.data.correlationId}`;
  # → a rota /solicitacao-numerario (linhas 199-237) NÃO consulta `Idempotency-Key`, não cria ledger, não hash-namespaceia por ator
  ```
- **Impacto técnico**: em dry-run, um duplo-clique cria dois logs `BUSINESS_INFO` idênticos e devolve dois payloads idênticos (sem efeito colateral externo). Quando `enviarAoErp` for cabeado sem antes tornar a rota idempotente, dois cliques = dois documentos criados no ERP (duplo-execution de write financeiro — o exato anti-padrão do dossiê).
- **Impacto de negócio**: hoje, nenhum; futuro, potencial de 2ª SN emitida indevidamente por processo — reconciliação manual e possível risco de duplicidade contábil.
- **Métrica de baseline**: `0/1` rotas SN honrando idempotência; a rota irmã `pipeline/run` já faz certo em `routes/recebimentos.ts:84-86`.

### F-fault-tolerance-3: Ontologia não define o handle de idempotência para o futuro emit (`docVldFinalizado` ou equivalente)

- **Severidade**: P1 (alto — sem handle de idempotência **modelado**, o dia em que HML/HAR abrir vai criar pressão para cabear `enviarAoErp` **antes** do design de reconciliação estar pronto)
- **Tactic violada**: **Reconcile** (Recover) + **Comparison** (Detect)
- **Localização**: `ontology/integrations/conexos-com299-gerdoc.md:1-78`; `ontology/actions/recebimentos/gerar-solicitacao-numerario.md:1-86`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "docVldFinalizado" ontology/ src/backend/ --include="*.md" --include="*.ts"
  # → 0 resultados
  # os únicos parentes documentados são docTip / docVldTipo (tipo do documento), não um flag de "finalizado"
  ```
- **Impacto técnico**: quando `enviarAoErp` for implementado, não há um handle wire-level (ex.: `docVldFinalizado 0→1`, `titCodSeq` retornado, etc.) documentado para (a) evitar re-emissão em retry e (b) reconciliar "o que a Columbia acredita que emitiu × o que o com299 mostra como emitido". O `open-gap` da integration lista `gerdoc-payload-fields` mas **não** lista um handle de idempotência/reconciliação.
- **Impacto de negócio**: sem esse contrato modelado, a fase de "sair do dry-run" (§ "Como sair do dry-run" da integration) fica com um passo faltando; risco de duplicidade contábil (2 SNs para o mesmo processo) no primeiro reprocess da era live.
- **Métrica de baseline**: `0` menções de handle de idempotência wire-level na ontologia SN; comparar com Permutas (`ontology/business-rules/idempotencia-reconciliacao.md`) e Recebimentos (`ontology/business-rules/idempotencia-quitacao-nde.md`), que **têm** handle explícito.

### F-fault-tolerance-4: Regra `encomenda-percentuais` não-resolvida — o dry-run "de exibir para o analista" carrega o valor **errado** (cru) e existe risco de wiring precipitado

- **Severidade**: P1 (alto — o valor da SN é o dado mais consequente do payload; se `enviarAoErp` for cabeado antes de resolver a regra, todas as SNs saem com valor errado)
- **Tactic violada**: **Sanity Checking** (Detect) — o valor mostrado ao analista não passa por checagem de negócio
- **Localização**: `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:60-62, 84-93`; `ontology/actions/recebimentos/gerar-solicitacao-numerario.md:55-61`
- **Evidência (objetiva)**:
  ```
  60:        // TODO(encomenda-percentuais): regra não-resolvida — usa o valor cru da transação como o
  61:        // montante da SN. Ver ontology/_inbox/frente-iv-recebimentos-nde-plan.md §7 Q4.
  62:        const valorSn = valorTransacao;
  ```
  Ontologia (`gerar-solicitacao-numerario.md:55-61`):
  > O montante da SN usa hoje o **valor CRU da transação bancária**. A regra de **percentuais da
  > encomenda (0,1% / 0,9%)** ... é **NÃO-RESOLVIDA**. Não foi inventada.
- **Impacto técnico**: o preview mostrado no `PayloadPreview` do modal (`AlocarProcessosDialog.tsx:48-67`) exibe um `valor` que NÃO é o valor final da SN — o analista pode aprovar mentalmente um número que não passará no negócio. Se o gate for aberto e um POST vazar, **cada SN sai com valor errado**.
- **Impacto de negócio**: risco de perda contábil ou retrabalho de todas as SNs emitidas na primeira janela pós-gate; risco reputacional com a Columbia se o analista aprovar o preview esperando percentuais.
- **Métrica de baseline**: `1` TODO no código; `0` testes/regra que atestem o cálculo real; a integração `conexos-com299-gerdoc.md` marca isso como `open-gap` P1.

### F-fault-tolerance-5: Log `BUSINESS_INFO` do "Processar" não é persistido — auditoria só existe em CloudWatch (efêmera para o produto)

- **Severidade**: P2 (médio — dry-run não move dinheiro, mas o rastro do que o operador simulou é peça de exception-queue quando o real emit acontecer)
- **Tactic violada**: **Condition Monitoring** (Detect) — o rastro existe mas não é durável
- **Localização**: `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:97-107`
- **Evidência (objetiva)**:
  ```
  97:        void this.logService.info({
  98:            type: 'BUSINESS_INFO',
  99:            message: 'gerarSolicitacaoNumerario (dry-run) — nenhuma chamada ao ERP',
  100:            data: { dryRun: true, priCod, filCod, gcdDesNome, ator },
  101:        });
  # → nenhum repositório é injetado; não há INSERT em audit_trail / recebimento_execucao / equivalente
  ```
  O `RecebimentoExecucaoRepository` existe em `ports.ts:260-306` mas o `SolicitacaoNumerarioService` não o usa (é o ledger do Recebimento, não da SN — falta ledger próprio da SN ou o SN precisa passar pelo ledger do Recebimento).
- **Impacto técnico**: um analista que gerou 50 SNs simuladas ontem não consegue reconstruir a lista via query — depende da retenção do CloudWatch/aggregator externo.
- **Impacto de negócio**: quando o real emit for ligado, a fila de exceção do analista precisará conciliar "SNs simuladas ontem × SNs realmente emitidas hoje" — sem persistência local, essa conciliação é impossível de automatizar.
- **Métrica de baseline**: `0` writes DB por invocação de `gerar()`; alvo: `1` linha em ledger próprio (mesmo em dry-run, com `dryRun:true` explícito, mirror do `RecebimentoExecucaoRow.dryRun`).

### F-fault-tolerance-6: Fallback `buildDryRunFallback` do frontend mascara falha real do backend com uma simulação silenciosa

- **Severidade**: P2 (médio — degrada a detectabilidade de falhas de backend na tela; a Substitution acontece **sem alertar o analista**)
- **Tactic violada**: **Sanity Checking** (Detect) — a resposta inválida do backend é "corrigida" pelo cliente sem sinalizar
- **Localização**: `src/frontend/lib/recebimentos.ts:391-428, 461-492`
- **Evidência (objetiva)**:
  ```typescript
  // recebimentos.ts:483-491
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as Partial<SolicitacaoNumerarioDryRun>
  if (json?.payload && json?.docConfig) {
    return { dryRun: true, docConfig: json.docConfig, payload: json.payload }
  }
  return buildDryRunFallback(processo, valorTransacao)
} catch {
  return buildDryRunFallback(processo, valorTransacao)  // ← silencioso: nem log, nem toast, nem sinalização
}
  ```
  No modal (`AlocarProcessosDialog.tsx:112-125`), o `toast.success` roda mesmo se a resposta veio do fallback local — o analista **não sabe** que o backend errou.
- **Impacto técnico**: se o backend estiver rejeitando por 401/403/500/rate-limit, o analista vê a operação "sucesso — dry-run gerado" com um payload construído pelo cliente que **não passou por Zod no servidor**. Detecção de incidente = 0.
- **Impacto de negócio**: dias/semanas em que o backend está quebrado sem ninguém notar; drift de contrato entre `buildDryRunFallback` (frontend) e `SolicitacaoNumerarioService.gerar` (backend) — divergência silenciosa.
- **Métrica de baseline**: `1` fallback silencioso ativo; `0` `toast.error` disparado em erro de rede; `0` sinal visual distinto entre "servidor OK" vs. "servidor caiu → fixture local".

## 5. Cards Kanban

### [fault-tolerance-1] Documentar formalmente o invariante DRY-RUN e ancorar como decisão de arquitetura

- **Problema**
  > A propriedade "não existe caminho de escrita ao Conexos alcançável pela rota SN" é o pilar de segurança desta iteração — evidenciada por grep e por 1 teste unitário. Mas ela vive espalhada em (a) comentários JSDoc do serviço, (b) o `NotImplementedError`, (c) a integration `.md`. Sem um ADR/regra invariante nomeada, um dev futuro pode "só cabear rapidinho" o `enviarAoErp` sem passar pelas checagens (gcdCod, encomenda-percentuais, idempotência, timeout, ledger). Regis mira: transformar a propriedade em **regra invioável documentada**.
- **Melhoria Proposta**
  > Adicionar uma business-rule `ontology/business-rules/dry-run-only-com299-gerdoc.md` listando os 4 pré-requisitos que o merge do `enviarAoErp` deve cumprir (F-2 idempotência da rota, F-3 handle de reconciliação, F-4 encomenda-percentuais resolvida, F-5 ledger persistido) — cada um mapeando para o card correspondente. Referenciar do JSDoc do `enviarAoErp` e do `NotImplementedError`.
- **Resultado Esperado**
  > O invariante DRY-RUN vira uma checklist rastreável; qualquer PR que remova o `throw new NotImplementedError` obriga a apontar os 4 cards fechados. Métrica: `0 → 1` business-rule dedicada; JSDoc do `enviarAoErp` referencia a rule.
- **Tactic alvo**: Substitution + Predictive Model (Bass — Avoid Faults)
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Business-rules SN dedicadas: `0 → 1`
  - Referências cruzadas JSDoc → rule: `0 → 2` (no seam + no error)
- **Risco de não fazer**: um refactor no médio prazo pode remover o seam por "código morto", eliminando a Substitution.
- **Dependências**: nenhuma

### [fault-tolerance-2] Aplicar `Idempotency-Key` namespaced-por-ator na rota SN antes de qualquer wire-up do emit

- **Problema**
  > A rota `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` não consulta `Idempotency-Key`, não cria ledger e não hash-namespaceia (ao contrário da rota irmã `POST /recebimentos/pipeline/run:84-86` que faz `receb:${ator}:${headerKey ?? correlationId}`). Em dry-run o custo é zero — dois cliques = dois logs. No dia em que `enviarAoErp` for cabeado sem antes fechar essa lacuna, dois cliques = **duas SNs criadas no ERP** (o exato anti-padrão "double-execution de financial write" do dossiê fault-tolerance).
- **Melhoria Proposta**
  > Portar o mesmo padrão do `pipeline/run` para a rota SN: aceitar `Idempotency-Key` do header, montar `sn:${ator}:${headerKey ?? txnId}:${priCod}`. Persistir a chave em um ledger próprio (nova tabela `solicitacao_numerario_execucao` ou reusar `recebimento_execucao` se semanticamente couber). Retornar `200` idempotente (mesmo payload) se a chave já existir. Adicionar teste "duplo-POST devolve mesmo payload / não re-loga business event duas vezes".
- **Resultado Esperado**
  > Rota SN idempotente antes de o gate abrir. Métrica: `0 → 1` rotas SN honrando idempotência; `1` teste de replay comprovando não-duplicação. Pré-requisito para qualquer PR que remova o `throw` do `enviarAoErp`.
- **Tactic alvo**: Idempotent Replay (Recover)
- **Severidade**: P2 (hoje) / P0 (no dia do wire-up — precisa vir **antes** dele)
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Rotas SN com idempotência: `0/1 → 1/1`
  - Testes de replay: `0 → 1`
- **Risco de não fazer**: no primeiro dia da era live, um duplo-clique/retry de rede gera SN duplicada no Conexos; reconciliação manual pesada.
- **Dependências**: fault-tolerance-1 (para amarrar o pré-requisito na business rule)

### [fault-tolerance-3] Modelar handle de idempotência/reconciliação wire-level (`docVldFinalizado` ou o equivalente real do com299)

- **Problema**
  > A ontologia `integrations/conexos-com299-gerdoc.md` lista 3 open-gaps (gcdCod, encomenda-percentuais, gerdoc-payload-fields) mas **não** cita um handle wire-level para reconciliar "o que a Columbia acredita ter emitido × o que o com299 mostra como emitido". Sem esse contrato, o `Idempotency-Key` local (card fault-tolerance-2) só evita re-execução do MESMO processo — não protege contra "envio duplicado por dois processos/hosts" nem permite reconciliação retroativa. Os irmãos Permutas (`business-rules/idempotencia-reconciliacao.md`) e NDe (`business-rules/idempotencia-quitacao-nde.md`) já modelam esse handle; SN não.
- **Melhoria Proposta**
  > Adicionar 4º open-gap na integration `conexos-com299-gerdoc.md`: `idempotencia-e-reconciliacao-wire`. Especificar como parte da captura HAR de HML: (i) qual campo/estado o com299 devolve após `gerDocProcesso` que identifica unicamente o documento criado (candidato: `docCodSeq`, `titCodSeq`, ou combinação `{filCod, priCod, gcdCod, docDtaEmissao}`); (ii) se há um flag "finalizado" (o prompt sugere `docVldFinalizado 0→1` — validar no HAR). Documentar o job de reconciliação futura (parity com `SispagRetornoService` / `PermutaReconciler`).
- **Resultado Esperado**
  > Contrato de reconciliação SN documentado antes do wire-up. Métrica: open-gaps da integration `3 → 4` (novo gap explicitado); business-rule `idempotencia-solicitacao-numerario.md` criado apontando para o handle real capturado.
- **Tactic alvo**: Reconcile (Recover) + Comparison (Detect)
- **Severidade**: P1
- **Esforço estimado**: S (só docs/ontologia) — implementação vem depois com o HAR
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Menções de handle wire-level na integration: `0 → ≥1`
  - Business-rule dedicada: `0 → 1`
- **Risco de não fazer**: fase "sair do dry-run" fica com passo silencioso faltando; primeiro reprocess da era live pode duplicar SN por falta de reconciliação.
- **Dependências**: captura HAR HML (dependência externa)

### [fault-tolerance-4] Bloquear o wire-up do `enviarAoErp` até que `encomenda-percentuais` esteja resolvida (guard-rail no código)

- **Problema**
  > O `valor` da SN é hoje `valorTransacao` cru (`TODO(encomenda-percentuais)`), com a regra 0,1% / 0,9% oficialmente **não-resolvida**. O `PayloadPreview` do modal exibe esse valor ao analista, que pode confundir "preview aprovado" com "valor final". No dia do wire-up, se o TODO ainda existir, todas as SNs saem com valor errado.
- **Melhoria Proposta**
  > Adicionar um guard determinístico no `SolicitacaoNumerarioService.gerar`: `throw new Error('encomenda-percentuais rule unresolved — cannot leave dry-run')` **atrás de** uma flag `ENCOMENDA_PERCENTUAIS_RESOLVED = false` em `constants.ts`. Enquanto a flag for `false`, o dry-run continua funcionando (o guard só dispara se `enviarAoErp` for cabeado em um futuro PR sem trocar a flag). No preview, adicionar rótulo `"valor bruto (regra encomenda pendente)"`.
- **Resultado Esperado**
  > Impossível cabear o emit real sem antes resolver a regra + flippar a flag. Métrica: `1` flag guard; `1` rótulo visível no preview; `0` risco de POST com valor cru.
- **Tactic alvo**: Sanity Checking (Detect) + Substitution (Avoid)
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Flag guard existente: `0 → 1`
  - Rótulo `"valor bruto (regra pendente)"` no preview: `0 → 1`
- **Risco de não fazer**: primeira leva de SNs no live sai com valores errados; retrabalho manual pesado, dano contábil.
- **Dependências**: resolução da regra pelo stakeholder (dependência externa — bloqueada por §7 Q4 do `frente-iv-recebimentos-nde-plan.md`)

### [fault-tolerance-5] Persistir rastro do "Processar" em ledger (mesmo em dry-run) — fonte da fila de exceção do analista

- **Problema**
  > O log `BUSINESS_INFO` do `SolicitacaoNumerarioService.gerar` roda em memória (via `LogService`) e não é persistido em nenhum repositório. Um analista não consegue reconstruir a lista de SNs simuladas ontem via query. Quando a era live começar, a conciliação "simulado × emitido" não terá fonte.
- **Melhoria Proposta**
  > Estender `RecebimentoExecucaoRepository` para aceitar tipo `solicitacao_numerario_dry_run` (ou criar novo repo `SolicitacaoNumerarioExecucaoRepository` — decisão do Ontology-Curator). Persistir: `{ txnId, priCod, filCod, ator, gcdCod, valor, dryRun:true, criadoEm, payloadHash }`. Testar "toda invocação de gerar() insere 1 linha".
- **Resultado Esperado**
  > Rastro auditável e consultável de todas as SNs (simuladas + eventualmente reais). Métrica: `0 → 1` writes DB por invocação de `gerar()`; endpoint READ (`GET /recebimentos/solicitacoes-numerario`) pode ser adicionado depois.
- **Tactic alvo**: Condition Monitoring (Detect)
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Persistência por invocação: `0 → 1`
  - Cobertura de teste: `0 → 1` "gerar insere 1 linha em ledger"
- **Risco de não fazer**: fase live começa sem base de conciliação; retrabalho manual e risco de duplicidade não-detectável.
- **Dependências**: fault-tolerance-2 (idempotência precisa do ledger)

### [fault-tolerance-6] Tornar o fallback `buildDryRunFallback` do frontend explícito (nunca silencioso)

- **Problema**
  > `processarSolicitacaoNumerario` no frontend cai em `buildDryRunFallback` (payload construído localmente) em qualquer erro do backend (`catch {}`), sem logar, sem toast e sem sinal visual — o analista vê `toast.success('simulação gerada')` mesmo se o backend estiver caído/rejeitando 403. Detecção de incidente = 0; drift de contrato invisível.
- **Melhoria Proposta**
  > No `catch`: (i) chamar `toast.warning('Backend indisponível — usando simulação local (aviso: pode divergir do servidor)')`; (ii) etiquetar o `SolicitacaoNumerarioDryRun` com um flag `source: 'server' | 'client-fallback'`; (iii) no `PayloadPreview`, exibir badge amarela quando `source === 'client-fallback'`. Idealmente, remover o fallback silencioso e obrigar o operador a re-tentar quando o backend falhar.
- **Resultado Esperado**
  > Zero falhas silenciosas de backend mascaradas como sucesso. Métrica: `1 → 0` fallbacks silenciosos; `0 → 1` toast/badge de aviso quando o cliente cai no fallback.
- **Tactic alvo**: Sanity Checking (Detect)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-6
- **Métricas de sucesso**:
  - Fallbacks silenciosos: `1 → 0`
  - Cobertura de teste: `0 → 1` (mock 500 do backend → `toast.warning` disparado)
- **Risco de não fazer**: um bug de contrato/auth no backend passa despercebido por dias; SNs simuladas divergem entre cliente e servidor sem que ninguém note.
- **Dependências**: nenhuma

## 6. Notas do agente

- **Escopo estritamente feature-delta.** Não auditei fluxos irmãos (Permutas fin010, SISPAG remessa) — o `_shared-metrics.md` confirma que os gates permaneceram verdes.
- **Handle `docVldFinalizado` sugerido no prompt vs. realidade da ontologia.** O prompt cita `docVldFinalizado 0→1` como idempotency handle "notado" pela ontologia. Verifiquei via grep: **não existe** essa string em `ontology/` nem em `src/backend/`. A ontologia hoje só descreve `docVldTipo` (tipo do documento). Tratei isso como **falta de modelagem** (F-fault-tolerance-3) — se `docVldFinalizado` for o handle real, precisa ser explicitamente registrado; se não for, o handle correto precisa ser capturado no HAR HML.
- **Score 8/10.** A invariante DRY-RUN é fortíssima (Substitution + Predictive Model + Human-in-the-loop + teste unitário grep-verificado). Perdi 2 pontos pelos gaps que **vão** morder no dia do wire-up: sem `Idempotency-Key` na rota SN (F-2), sem handle de reconciliação modelado (F-3), regra encomenda-percentuais sem guard (F-4), sem ledger persistido (F-5) e fallback silencioso no cliente (F-6). Nenhum deles é P0 **agora**, porque nenhum POST vaza — mas os cards precisam ser fechados **antes** do PR que remova o `throw new NotImplementedError`.
- **Cross-QA (alertar o consolidator).** F-2 (idempotência) espelha `qa-security` (namespacing por ator) e `qa-availability` (replay-safety). F-5 (audit persistido) espelha `qa-security` (auditabilidade) e `qa-testability` (base para asserts de reprocess). F-4 (regra não-resolvida) espelha `qa-modifiability` (débito visível) e `qa-integrability` (contrato incompleto). F-6 (fallback silencioso) espelha `qa-integrability` (drift de contrato).
