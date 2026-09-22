# SISPAG read-path hardening — follow-ups (Regis quick)

> Branch `fix/sispag-read-harden`, 2026-07-11. Tweak que fechou os cards Regis
> **integrability-1** e **availability-sispag-1** da Fatia 1+2 (KANBAN
> `docs/regis-review/2026-07-07-1841-sispag-painel-montagem/`). Regis **quick**
> (PatternGuardian + qa-availability + qa-integrability + qa-fault-tolerance no delta).
> **Zero P0.** Os três QA convergiram: o delta é melhoria estrita.

## Remediado nesta tweak ✅
- **integrability-1** — `listTitulosAPagar` tinha `catch {}` cru que engolia qualquer erro
  (500/timeout/rede) e caía para leitura **sem filtro** de milhares de linhas. Agora o método
  privado `isFilterRejected(err)` (`err.response?.status === 400`) só reconhece a recusa de filtro
  do Conexos como fallback legítimo; erro transitório é **re-lançado** (`throw err`).
- **availability-sispag-1** — os 6 reads SISPAG (`listTitulosAPagar`, `getTituloAPagar`,
  `isDocInternacional`, `listExteriorDocCods`, `listLotes`, `listBorderosAPagar`) agora envolvem
  `listGenericPaginated` em `this.base.runWithRetry(...)` → paridade de retry (2 tentativas/500ms/
  jitter200) com os demais `Conexos*Client`.
- **P1 observabilidade (parcial da integrability-1)** — o braço de fallback agora emite
  `Logger.warn` (não-silencioso), para que um drift sistemático do filtro no `fin064` vire sinal em
  vez de degrade oculto (o próprio modo de falha que o card fecha).

## Follow-ups (→ tickets, NÃO implementados)
| id | prio | finding | nota |
|----|------|---------|------|
| ~~rh-1~~ | ~~P1~~ | ~~`isFilterRejected` casa QUALQUER 400~~ | **FECHADO em 2026-09-22** (branch `fix/sispag-boundary-fail-closed`). Resolvido SEM o fixture que o card pedia: a auditoria não achou nenhum 400 de recusa de filtro medido no repo, mas achou os vizinhos que tornam a premissa improvável — filtro DESCONHECIDO é silenciosamente ignorado (não dá 400) e coluna NÃO-FILTRÁVEL responde **500**, não 400. O único 400 de filtro medido (`Generic.REQUIRED_FILTER_ERROR`, fin052/fin134/fin095) **se nomeia no corpo**. Daí o predicado novo: 400 **＋** corpo que cite `REQUIRED_FILTER_ERROR`/`filtro` ou nomeie um dos campos que a chamada mandou. 400 mudo ou de outra causa **propaga**. |
| rh-2 | P3 | `RetryExecutor` compartilhado usa `shouldRetry` default (`() => true`) → um 400 determinístico é retentado 2× (~1s morto) antes de cair no fallback | cross-cutting (afeta todos os `Conexos*Client`, não só SISPAG). Adicionar `shouldRetry` que não retenta 4xx no `ConexosBaseClient`. Fora do escopo desta tweak (mudaria a política global). |
| rh-3 | P3 | sem métrica de retries-por-endpoint (`ConexosRetryCount{endpoint}`) → Conexos degradado só vira alarme via Log Insights manual | soma-se ao backlog Regis de observabilidade (era v0.9.2); não abrir card novo isolado. |
| rh-4 | P3 | timeout do axios (40s) + `retries:2` amplifica o tempo total antes de propagar se o Conexos pendurar | herdado do base client; fora do delta. |

> **Confirmado pelos gates:** I1 (read-only ao ERP) 100% (nenhuma escrita adicionada); PatternGuardian
> PASS (DDD/tsyringe/acesso/Zod OK); consumidores a montante (`IngestaoPagamentosService` anti-fantasma
> por `filiaisLidas`, `LotePagamentoService.incluirTitulo` fail-closed) tratam a propagação corretamente.
