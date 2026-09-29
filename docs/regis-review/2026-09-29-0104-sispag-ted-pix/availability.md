---
qa: Availability
qa_slug: availability
run_id: 2026-09-29-0104
agent: qa-availability
generated_at: 2026-09-28T00:00:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista finaliza lote SISPAG com itens TED/PIX (flags ligadas em PRD) | Leitura de cadastro do favorecido (`cmn025/cmnPessoasPix`, contas) lenta/indisponível no Conexos durante a geração da remessa | `RemessaService.gerarRemessaSerializado` → `DestinoPagamentoResolver` → `ConexosSispagClient` | Operação normal, escrita live habilitada | Falhar ANTES de qualquer escrita nativa (fail-closed), registrar no ledger, permitir nova tentativa idempotente sem duplicar lote/remessa | 0 remessas duplicadas; 0 lotes nativos pela metade; falha visível ao analista no mesmo request |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos backend (não-teste) que usam Executor | 11 (ConexosBaseClient, Fin014, SispagWrite, Titulos, Nde, Baixa, Bcb, PostgreeDatabaseClient, RecebimentoPipelineService, constants, RetryExecutor) | n/a | ⚠️ | `grep -rln RetryExecutor\|FallbackExecutor\|PollExecutor src/backend` |
| Leituras do delta (chaves PIX/contas) com retry | 100% — via `base.runWithRetry` (2 retries, 500ms, jitter 200ms, sem retry em recusa determinística) | ≥80% | ✅ | `ConexosBaseClient.ts:154-162`, `ConexosSispagClient.ts` (delta) |
| Escritas fin015 não-idempotentes com retry | 0 (tentativa única por desenho) | 0 | ✅ | `ConexosSispagWriteClient.ts:183` |
| Idempotência da remessa | chave `remessa:${lote.id}` + ledger `beginExecution` + advisory lock por lote + curto-circuito | presente | ✅ | `RemessaService.ts:204,261-269,422,457` |
| Timeout do cliente Conexos | 40 000 ms explícito (axios legado); sem timeout por chamada nas leituras novas | 100% explícito | ⚠️ | `src/backend/services/conexos.ts:121` |
| Timeout BcbClient | 10 000 ms | explícito | ✅ | `BcbClient.ts:57` |
| Fila SQS/DLQ | N/A — sem SQS; sem `infra/` | 100% | ⚠️ não medível | CLAUDE.md |
| Alarmes CloudWatch | ⚠️ **Não medível localmente**: não existe `infra/`; deploy Render. Recomendação: alerta sobre `remessa_execucao` em status falho/indeterminado. | ≥5 | ⚠️ | — |
| Guardas de transição de estado | `FOR UPDATE OF i, l` só em RASCUNHO + `versaoEsperada` (conflito otimista) | presente | ✅ | `LotePagamentoRepository.ts:511-542` |
| Catch no fluxo de remessa | 1 catch no fluxo principal: ledger.fail + log + re-throw (sem engolir) | 0 silenciosos | ✅ | `RemessaService.ts:744-752` |
| Referências a `shared_account_id` | 0 (sem infra) | 0 | ✅ | grep |
| Testes | 164 suites / 2570 (backend) verdes | verde | ✅ | `_shared-metrics.md` |
| MTTR real / tempo candidato→conciliado | ⚠️ **Não medível localmente**: requer logs de produção. Recomendação: métrica de duração das transições `candidato → conciliado`. | — | ⚠️ | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | `routes/health.ts` (readiness); sem sonda ativa do Conexos | ⚠️ parcial | `routes/health.ts`, `http/readinessState.ts` |
| Heartbeat | workflows de cron (`reaper-sispag.yml`) sem heartbeat de saída | ⚠️ parcial | `.github/workflows/` |
| Monitor | logs via LogService; sem alarmes/dashboards no repo | ⚠️ parcial | `RemessaService.ts:747` |
| Timestamp | ledger e trilha `destino_audit` com timestamps | ✅ presente | migração 0066 |
| Sanity Checking | `RemessaCnabValidator` (delta: segmento B, forma de lançamento), `DestinoManualValidator`, titularidade I10i | ✅ presente | `RemessaCnabValidator.ts` |
| Condition Monitoring | contagem de linhas descartadas no boundary de chaves PIX | ⚠️ parcial | `ConexosSispagClient.ts` (delta) |
| Voting | irrelevante: sem componentes redundantes computando o mesmo valor | N/A | — |
| Exception Detection | erros tipados `Destino*Error`, `DocumentoFavorecidoIndisponivelError`; Zod nos boundaries | ✅ presente | `domain/errors/` |
| Self-Test | testes de paridade flags OFF; sonda manual supervisionada não executada | ⚠️ parcial | `probe-sispag-ted-pix-supervisionado.ts` |
| Active Redundancy | single-instance Render/Postgres | ❌ ausente | CLAUDE.md |
| Passive Redundancy | idem | ❌ ausente | — |
| Spare | idem | ❌ ausente | — |
| Exception Handling | ledger.fail + re-throw; retomada por etapa (`retomarDe`) | ✅ presente | `RemessaService.ts:485-490,744` |
| Rollback | trilha só-inclusão; sem compensação de lote nativo criado (mitigado por preflight antes de escrever) | ⚠️ parcial | `RemessaService.ts:490-500` |
| Software Upgrade | flags default OFF permitem ativação gradual e kill-switch | ✅ presente | `EnvironmentVars.ts` (delta), `sispagLiveWriteEnabled` |
| Retry | `RetryExecutor` em leituras; escritas não-idempotentes sem retry | ✅ presente | `ConexosBaseClient.ts:154` |
| Ignore Faulty Behavior | linha de chave PIX inválida descartada e contada | ✅ presente | `ConexosSispagClient.ts` (delta) |
| Degradation | item sem destino/titular divergente barra o lote e volta ao analista; destino manual como saída (flag) | ✅ presente | `DestinoPagamentoResolver.ts`, `InformarDestinoDialog.tsx` |
| Reconfiguration | flags TED/PIX/manual independentes | ⚠️ parcial | `RemessaService.ts:247` |
| Shadow | sem execução sombra; hipóteses H1,H3–H7 validadas direto em PRD | ❌ ausente | `_shared-metrics.md` |
| State Resynchronization | consulta ao ERP para execução indeterminada; `retomarDe` | ✅ presente | `RemessaService.ts:~750` |
| Escalating Restart | `gracefulShutdown`; sem escalonamento | ⚠️ parcial | `http/gracefulShutdown.ts` |
| Non-Stop Forwarding | irrelevante: sem plano de dados separado | N/A | — |
| Removal from Service | kill-switch `sispagLiveWriteEnabled` por frente | ✅ presente | `RemessaService.ts:253` |
| Transactions | `FOR UPDATE` + versão otimista; advisory lock por lote | ✅ presente | `LotePagamentoRepository.ts:542` |
| Predictive Model | ausente | ❌ ausente | — |
| Exception Prevention | Zod, validadores, resolver antes da escrita | ✅ presente | `DestinoManualValidator.ts` |
| Increase Competence Set | preflight de destino evita lote nativo parcial | ✅ presente | `RemessaService.ts:490` |

## 4. Findings

### F-availability-1: Leituras de cadastro do favorecido no caminho crítico sem timeout por chamada e sem cache

- **Severidade**: P2
- **Classificação**: IN_DELTA
- **Tactic violada**: Retry (sem orçamento de tempo) / Monitor
- **Localização**: `src/backend/domain/service/sispag/DestinoPagamentoResolver.ts:122,133`; `ConexosSispagClient.ts` (`listChavesPixFavorecido`)
- **Evidência**:
  ```
  const contas = await this.contas(contexto);   // 1 chamada Conexos por item TED
  const chaves = await this.chaves(contexto);   // 1 chamada Conexos por item PIX
  ```
  Retry (1+2 tentativas) x timeout 40s do axios => pior caso por leitura ≈ 3 x 40s = 120s, multiplicado pelos itens do lote, dentro de um request HTTP.
- **Impacto técnico**: lote grande com Conexos lento estoura o tempo do request/proxy antes de qualquer escrita (fail-closed, sem dano), mas trava o analista e segura o lock por lote.
- **Impacto de negócio**: remessa atrasada em dia de fechamento; sem perda financeira.
- **Métrica de baseline**: pior caso teórico 120s por leitura (calculado de 40000ms x 3); nº de leituras = nº de itens TED/PIX (não medido em produção).

### F-availability-2: Sem alerta ativo sobre falhas de remessa

- **Severidade**: P2
- **Classificação**: PRE_EXISTING (agravado pelo delta, que adiciona novos modos de falha)
- **Tactic violada**: Monitor
- **Localização**: `RemessaService.ts:744-752` (só log); sem `infra/`
- **Evidência**: falha vira `ledger.fail` + `logService.error`; nenhum alerta ativo. Contagem de alarmes: não medível.
- **Impacto técnico**: falha só é vista quando o analista abre o painel.
- **Impacto de negócio**: atraso de pagamento descoberto tarde. Sem baseline numérico, permanece P2.
- **Métrica de baseline**: não medível localmente.

### F-availability-3: Campo do documento do favorecido é hipótese não validada; falha fechada torna a feature indisponível se errado

- **Severidade**: P2
- **Classificação**: IN_DELTA
- **Tactic violada**: Shadow / Self-Test
- **Localização**: `ConexosSispagClient.ts` (`CAMPO_DOCUMENTO_FAVORECIDO = 'pesNumCpfCnpj'`)
- **Evidência**: comentário "HIPÓTESE — a confirmar"; campo ausente devolve `undefined` e a titularidade falha fechada. Sem HML.
- **Impacto técnico**: se o nome estiver errado, 100% dos itens com destino de cadastro ficam bloqueados (degradação segura, não corrupção). Flags OFF por padrão limitam o raio.
- **Impacto de negócio**: TED/PIX não sai no go-live até corrigir; analista cai no destino manual.
- **Métrica de baseline**: 0 leituras de produção confirmando o campo.

### F-availability-4: Complexidade cognitiva crescente no orquestrador de remessa

- **Severidade**: P3
- **Classificação**: IN_DELTA (+2, 91→93) sobre base PRE_EXISTING
- **Tactic violada**: Exception Prevention
- **Localização**: `RemessaService.gerarRemessaSerializado`
- **Evidência**: Biome cognitive complexity 93 (fonte: `_shared-metrics.md`).
- **Impacto técnico**: risco de regressão em retomada/indeterminado.
- **Impacto de negócio**: risco de escrita duplicada em manutenção futura.
- **Métrica de baseline**: 93 (medido).

## 5. Cards Kanban

### [availability-1] Limitar tempo e volume das leituras de cadastro no preflight

- **Problema**
  > O preflight de destino faz uma leitura Conexos por item TED/PIX, com retry e timeout de 40s, dentro do request. Pior caso teórico de 120s por leitura.
- **Melhoria Proposta**
  > Memoizar leituras por `pesCod` na execução do `DestinoPagamentoResolver` e aplicar orçamento de tempo total do preflight; falhar fechado com mensagem clara ao exceder.
- **Resultado Esperado**
  > Leituras por lote: N itens → nº de favorecidos distintos; falha por orçamento em tempo limitado (valor a calibrar).
- **Tactic alvo**: Retry / Degradation
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Chamadas Conexos por lote: N itens → nº de favorecidos distintos
- **Risco de não fazer**: lotes grandes travam o analista quando o Conexos degrada.
- **Dependências**: nenhuma

### [availability-2] Alerta ativo para remessa falha/indeterminada

- **Problema**
  > Falhas de remessa só são gravadas em ledger e log; ninguém é avisado.
- **Melhoria Proposta**
  > Cron/GH Action (ou alerta do Render) que consulta `remessa_execucao` em falha/indeterminado além de um limite e notifica o time; instrumentar duração `candidato → conciliado`.
- **Resultado Esperado**
  > Detecção de falha: manual → automática; alarmes ativos: 0 → ≥5.
- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Alarmes ativos: 0 → ≥5
- **Risco de não fazer**: pagamentos atrasados descobertos pelo cliente.
- **Dependências**: definição do canal de notificação

### [availability-3] Confirmar o campo de documento do favorecido antes do go-live

- **Problema**
  > `CAMPO_DOCUMENTO_FAVORECIDO` é hipótese; se errado, a titularidade falha fechada para todos os itens de cadastro.
- **Melhoria Proposta**
  > Executar a sonda supervisionada, fixar o campo e adicionar teste de contrato com amostra real anonimizada; manter flags OFF até lá.
- **Resultado Esperado**
  > Leituras de produção confirmando o campo: 0 → ≥1; hipóteses validadas: 0 → todas do checklist.
- **Tactic alvo**: Shadow / Self-Test
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Leituras de produção confirmando o campo: 0 → ≥1
- **Risco de não fazer**: go-live sem TED/PIX funcional e analistas presos ao destino manual.
- **Dependências**: janela de teste supervisionado em PRD

F-availability-4 sem card próprio: débito de complexidade, a ser endereçado por refatoração (modifiability).

## 6. Notas do agente

- Modo --quick: análise estática do delta; sem rodar testes (usei `_shared-metrics.md`).
- Sem `infra/`: DLQ, alarmes e isolamento multi-tenant não medíveis.
- Pontos fortes: idempotência (chave por lote, ledger, advisory lock), escritas não-idempotentes sem retry, preflight antes de qualquer escrita, flags default OFF.
- Cross-QA: F-availability-3 e F-availability-4 tocam testability/modifiability. Nenhum P0.
