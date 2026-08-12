---
qa: Availability
qa_slug: availability
run_id: 2026-08-12-1315
agent: qa-availability
generated_at: 2026-08-12T13:15:00-03:00
scope: backend
score: 7.5
findings_count: 4
cards_count: 4
---

# Availability — Regis-Review

> Escopo restrito ao delta da branch `fix/nde-descricao-item` (worktree
> `/home/inteli/kavex-worktrees/nde-descricao-item`). Avalio a etapa 3.5 nova (`etapaDescricaoItem`)
> e o impacto dela na disponibilidade do fluxo "Processar" de Frente IV (Recebimentos/NDe).
> Não reaudito a plataforma inteira — o mérito de tactics genéricas do backend (RetryExecutor,
> ConexosBaseClient, ledger de execução) já foi coberto em runs anteriores; aqui só apuro o que o
> delta muda ou aciona.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "Processar" numa alocação cujo cliente tem `dpeVld1DescrNfe = 4 (Descrição DI)` | Etapa 3.5 executa 2 a 4 chamadas síncronas ao Conexos (`com297/comDocProdutos` list + `preDescrProdutoNf` + item GET + PUT) e o ERP pode ficar lento/indisponível durante uma delas | `RecebimentoNumerarioService.etapaDescricaoItem` + `ConexosNdeFiscalClient` (`listItensNde`, `lerItemNde`, `preDescricaoProdutoNf`, `gravarDescricaoItemNde`) | Fluxo REAL (`conexosWriteEnabled=true`, `conexosDryRun=false`); NDe já GERADA (com297 gerDocProcesso concluído); fiscal/obs/homologar ainda NÃO executados | Falha aqui é fail-closed ANTES de qualquer escrita irreversível (com300 RMW, geraObs, homologar); a execução é marcada `status=error`, `etapa=nota-debito`, e o ledger permite retomada — a próxima tentativa reentra na etapa 3.5 porque ela é auto-idempotente pelo estado do documento (a linha continua com `dprLngDescrNf` vazio) | 100% das falhas transitórias do ERP nesta etapa PARAM antes do com300; 0% de NDe homologada com descrição vazia; retomada consome no máximo os mesmos 3 round-trips (o LIST detecta que o campo já foi gravado quando a tentativa anterior sucedeu na escrita) |

Contra-cenário do custo do delta:
> Analista roda "Processar" num tenant cujo Conexos está com p95 elevado → o request HTTP soma AGORA `listItensNde` + `lerItemNde` + `gravarDescricaoItemNde` (+ opcional `preDescricaoProdutoNf`) na cauda de um caminho que já emitia SN, borderô, baixa, NDe, com300, com131, homologar e poll SEFAZ. Sem timeout HTTP explícito no `ConexosBaseClient` (débito herdado, ver F-availability-1), qualquer um dos novos round-trips pode segurar o request até o timeout do proxy Render, o que não é falha da etapa mas dela aparente.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas ERP síncronas ADICIONADAS por execução (caso "descrição vazia", N=1 item) | 3 obrigatórias (`listItensNde` + `lerItemNde` + `gravarDescricaoItemNde`) + 1 best-effort (`preDescricaoProdutoNf`) | ≤ 1 quando o campo já vem preenchido (caso comum na maioria dos tenants) | ⚠️ atende no caso comum (só o LIST; ver `RecebimentoNumerarioService.ts:1477` — `if (item.dprLngDescrNf !== undefined) continue`), degrada linearmente com nº de itens vazios | `RecebimentoNumerarioService.ts:1456-1506` |
| Chamadas ERP no caso "campo já preenchido" (no-op) | 1 (só `listItensNde`) | 1 | ✅ | `RecebimentoNumerarioService.ts:1458-1477` |
| Idempotência da etapa (retomada não duplica escrita) | Auto-idempotente pelo estado do documento — o LIST detecta `dprLngDescrNf` já preenchido e pula | Retomada segura sem etapa monotônica no ledger | ✅ Coberto por teste "RETOMADA de execução que já falhou na homologação passa pela correção" (`RecebimentoNumerarioService.test.ts:1658-1674`) e por "já homologada: não mexe no item" (`:1676-1691`) | `RecebimentoNumerarioService.ts:1441-1445, 1456, 1477` |
| Fail-closed antes de escrita irreversível | Sim — falha na etapa 3.5 marca `status=error`, `etapa=nota-debito`; `gravarDocFiscal`/`gerarObservacoes`/`homologar` NÃO são chamados | 100% dos casos de falha param antes do com300 | ✅ Coberto por teste "falha ao gravar a descrição é FAIL-CLOSED" (`RecebimentoNumerarioService.test.ts:1635-1646`) | `RecebimentoNumerarioService.ts:455-456, 489-491, 1786` |
| Retry policy das chamadas da etapa | LIST/GET envelopados em `runWithRetry` (política compartilhada, 1 retry + 500 ms + jitter); PUT em `putGenericOnce` (sem retry, coerente com com300/com131) | LIST/GET retryable, PUT write-once | ✅ `ConexosNdeFiscalClient.ts:264-266, 312, 397-402` |
| Guard de conteúdo (recusa gravar descrição vazia no ERP) | Cliente rejeita antes do POST se `descricao.trim() === ''` | Fail-closed no boundary | ✅ `ConexosNdeFiscalClient.ts:389-396` |
| Guard de sucesso (recusa eco vazio como se fosse sucesso) | Cliente lança `ConexosError` se o eco do PUT vem sem `dprLngDescrNf` | Nunca declara sucesso silencioso | ✅ `ConexosNdeFiscalClient.ts:404-413` |
| `preDescricaoProdutoNf` é degradação apropriada (nunca lança) | Sim — try/catch engole, retorna `undefined`, cai no próximo fallback do `resolverDescricaoItem` (prdDesNome → default hardcoded) | Degradation | ✅ `ConexosNdeFiscalClient.ts:340-347`, `RecebimentoNumerarioService.ts:1520-1541` |
| Cadeia de fallback para o texto da descrição | 4 níveis: `NDE_DESCRICAO_ITEM_FALLBACK` (env) → `preDescrProdutoNf` (ERP) → `prdDesNome` (join do produto) → `NDE_GERACAO_DEFAULTS.produtoNome` (hardcoded) | ≥ 3 níveis independentes | ✅ `RecebimentoNumerarioService.ts:1509-1541` |
| Timeout HTTP explícito no cliente que carrega as 4 novas chamadas | **AUSENTE** no `ConexosBaseClient`/`ConexosLegacyClient` (débito herdado da plataforma — `BcbClient` tem `timeout: 10_000`, os Conexos não) | 100% dos clientes externos com timeout | ❌ **Agravado pelo delta** — o "Processar" já era longo, agora tem +3 (comum) a +4 (com preDescr) chamadas Conexos sem teto de tempo | `grep 'axios.create\|timeout:' src/backend/domain/client/*.ts` → só `BcbClient.ts:57` |
| Observabilidade específica da etapa 3.5 (métrica/contador/alarme) | Só logs `BUSINESS_WARN` textuais em sucesso da correção (`RecebimentoNumerarioService.ts:1491-1505`) e em "sem linha de item" (`:1466-1473`). Nenhuma métrica agregada, nenhum alarme configurado | Contador de "NDe corrigidas" e alarme se >X%/dia | ⚠️ Sem instrumentação — a única forma de saber a taxa hoje é grep em log | `RecebimentoNumerarioService.ts:1466-1506` |
| Cobertura de teste: falha por indisponibilidade da LEITURA (`listItensNde`/`lerItemNde`) | **AUSENTE** — só existe teste para `gravarDescricaoItemNde` rejeitando; sem teste equivalente para o LIST/GET rejeitarem (que também é fail-closed no fluxo, mas quero garantia contratual) | ≥ 1 teste por endpoint | ⚠️ | `RecebimentoNumerarioService.test.ts:1635` (só PUT) |
| Cobertura de teste: no-op, precedência de fallback, retomada, homologado, sem-item | 5 cenários cobertos | ≥ 4 | ✅ `RecebimentoNumerarioService.test.ts:1527-1691` |
| Typecheck / lint / testes | typecheck OK; lint exit 0 (32 warnings pré-existentes); 1132 passed / 14 failed pré-existentes na main | Delta não introduz regressão | ✅ | `_shared-metrics.md` |

⚠️ **Não medível localmente**: latência p95 real do "Processar" antes × depois do delta em tenant produtivo. Requer telemetria de HTTP/handler no Render. Recomendação: instrumentar histogram por etapa (`sn`, `fin014`, `nota-debito`, `descricao-item`, `fiscal-done`, `obs-done`, `homologado`, `poll`) na tabela de execução ou em log estruturado; o Kanban tem card específico (`availability-2`).

⚠️ **Não medível localmente**: MTTR real quando a etapa começa a falhar em massa (ex.: contrato do `com297/comDocProdutos` PUT muda). Requer CloudWatch Logs Insights (alvo) — hoje é Render + Supabase, sem dashboard operacional. Recomendação: quando a plataforma migrar para Lambda/CloudWatch, promover os `BUSINESS_WARN` desta etapa a metric filter.

## 3. Tactics — Cobertura no nf-projects

Escopo: tactics do Bass **exercitadas ou omitidas pelo delta**. Tactics que não são responsabilidade
deste delta (fora do caminho da etapa 3.5) ficam `N/A — fora do escopo do delta`.

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A — fora do escopo do delta (não há ping do Conexos aqui; a saúde da etapa é aferida pela própria chamada de negócio) | N/A | — |
| Heartbeat | N/A — fora do escopo do delta | N/A | — |
| Monitor | Só logs textuais (`BUSINESS_WARN` no sucesso da correção e no caminho "sem item"); nenhum contador/histogram/métrica agregada específica da etapa | ⚠️ parcial | `RecebimentoNumerarioService.ts:1466-1473, 1491-1505` |
| Timestamp | N/A — nada temporal específico da etapa (o `emitidaEm` da NDe segue em `etapaHomologar`) | N/A | — |
| Sanity Checking | (a) LIST → só age em `dprLngDescrNf === undefined` (após trim/normalização no client); (b) cliente REJEITA descrição vazia antes do POST; (c) cliente REJEITA eco vazio como sucesso; (d) service NUNCA re-toca item já-homologado | ✅ presente | `ConexosNdeFiscalClient.ts:83-87, 389-396, 404-413`; `RecebimentoNumerarioService.ts:1456, 1477` |
| Condition Monitoring | N/A — sem sonda de tendência específica desta etapa | N/A | — |
| Voting | N/A — endpoint único do ERP, sem redundância a votar | N/A | — |
| Exception Detection | Client encapsula tudo em `ConexosError({endpoint, cause})` com contexto do item (docCod/fisCod/prdCod/dprCodSeq); service captura no `catch` do `rodarEtapas` e transforma em `status:error` + `registrarFalha` (`markError` + log estruturado) | ✅ presente | `ConexosNdeFiscalClient.ts:293-295, 316-319, 407-412, 415-418`; `RecebimentoNumerarioService.ts:489-491, 1753-1788` |
| Self-Test | N/A — fora do escopo do delta | N/A | — |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A — fonte única (Conexos) | N/A | — |
| Passive Redundancy | N/A | N/A | — |
| Spare | N/A | N/A | — |
| Exception Handling | O `rodarEtapas` cerca a etapa 3.5 no mesmo `try/catch` das etapas fiscais; qualquer throw vira `registrarFalha` → `markError` no ledger + log; `preDescricaoProdutoNf` demonstra o padrão de degradação (try/catch → undefined) | ✅ presente | `RecebimentoNumerarioService.ts:438-491, 1753-1788`; `ConexosNdeFiscalClient.ts:340-347` |
| Rollback | N/A — a etapa 3.5 é o ÚLTIMO passo antes de tocar o fiscal; se falhar, nada fiscal foi tocado (fail-closed cumpre o papel do rollback aqui); reverter o próprio PUT de descrição não faz sentido (o campo tinha nada) | N/A (justificado) | Ordem em `RecebimentoNumerarioService.ts:451-460` |
| Software Upgrade | N/A — fora do escopo do delta | N/A | — |
| Retry | LIST/GET: `runWithRetry` (política compartilhada); PUT (`gravarDescricaoItemNde`): `putGenericOnce` deliberadamente sem retry (mesma política do com300/com131 — RMW não é retryable sem re-leitura, e a re-leitura acontece na retomada da execução, não dentro da chamada); `preDescricaoProdutoNf` é best-effort sem retry (falhar aqui derrubaria por causa de uma sugestão) | ✅ presente | `ConexosNdeFiscalClient.ts:264-266, 312, 397-402, 340-347` |
| Ignore Faulty Behavior | `preDescricaoProdutoNf` é o exemplo canônico: falhar não derruba a etapa, só cai no próximo fallback | ✅ presente | `ConexosNdeFiscalClient.ts:340-347` |
| Degradation | Cadeia de 4 níveis do texto da descrição: env explícito → sugestão do ERP → cadastro do produto → default hardcoded. Nunca devolve vazio. Compartilhada tanto pelo caso "ERP sugestivo devolveu string vazia" quanto pelo "rota indisponível" | ✅ presente | `RecebimentoNumerarioService.ts:1509-1541` |
| Reconfiguration | N/A — fora do escopo do delta | N/A | — |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | N/A — dry-run existe globalmente (`conexosWriteEnabled/conexosDryRun`), mas não é uma execução em sombra da etapa 3.5 em produção | N/A | `RecebimentoNumerarioService.ts:270-272` |
| State Resynchronization | A retomada é ESTADO-DO-DOCUMENTO, não etapa monotônica no ledger: uma execução que morreu em `obs-done`/homologação re-entra na etapa 3.5 na próxima tentativa, o LIST vê `dprLngDescrNf` ainda vazio e reprocessa; se a tentativa anterior já gravou, o LIST devolve preenchido e é no-op — sem ledger extra | ✅ presente | `RecebimentoNumerarioService.ts:1441-1445, 1456-1477`; teste `:1658-1674` |
| Escalating Restart | N/A — não há restart hierárquico neste caminho | N/A | — |
| Non-Stop Forwarding | N/A — fora do escopo do delta | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | N/A — não há flag específica para desligar apenas a etapa 3.5. O `NDE_DESCRICAO_ITEM_FALLBACK` desliga a decisão automática forçando um texto explícito, mas não desliga a etapa em si. Aceito como parcial — para desligar de vez a etapa, hoje seria preciso `conexosDryRun=true` (que desliga TUDO). Ver card `availability-4` | ⚠️ parcial | `RecebimentoNumerarioService.ts:1524-1526` |
| Transactions | RMW correto: `lerItemNde` GET a linha inteira (~105 campos, `.passthrough()` preserva) → PUT com a linha inteira modificada. Sem risco de "campo omitido vira null" porque o objeto vem íntegro do GET. Sem transação distribuída (o ERP não expõe), o guard de eco (sucesso ⟺ eco não-vazio) é o discriminador | ✅ presente | `ConexosNdeFiscalClient.ts:62-77, 302-320, 383-419` |
| Predictive Model | N/A — fora do escopo do delta | N/A | — |
| Exception Prevention | Cliente valida o input com Zod no boundary (`.passthrough()` para preservar RMW; `.coerce` nos ints), trunca em `DESCRICAO_IMPRESSAO_MAX=4000` ANTES de enviar (respeita `maxLength` do swagger), rejeita descrição vazia. Service pula loop se `dprLngDescrNf` já preenchido (evita PUT desnecessário) e pula tudo se `etapaAtingida('homologado')` (evita mexer em nota já emitida) | ✅ presente | `ConexosNdeFiscalClient.ts:20-77, 80-87, 388-396`; `RecebimentoNumerarioService.ts:1456, 1477` |
| Increase Competence Set | Cadeia de fallback amplia o "conjunto de entradas aceitáveis" que a etapa consegue tratar sem parar (`resolverDescricaoItem`) | ✅ presente | `RecebimentoNumerarioService.ts:1509-1541` |

## 4. Findings (achados)

### F-availability-1: `ConexosBaseClient` sem timeout HTTP — agravado pelo delta

- **Severidade**: P1
- **Tactic violada**: Prevent Faults — Exception Prevention (não impedir que uma dependência lenta consuma o request do usuário)
- **Localização**: `src/backend/domain/client/ConexosBaseClient.ts` (delegator sem timeout); `src/backend/domain/client/ConexosLegacyClient.ts` (grep `axios.create` não encontra `timeout:`); AGRAVADO por `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1456-1506` (adiciona 2–4 chamadas Conexos síncronas)
- **Evidência (objetiva)**:
  ```
  $ grep -n 'axios.create\|timeout:' src/backend/domain/client/*.ts
  src/backend/domain/client/BcbClient.ts:57:  this.http = axios.create({ baseURL: SGS_BASE_URL, timeout: 10_000 });
  # (nenhum resultado equivalente para ConexosBaseClient/ConexosLegacyClient)
  ```
  ```
  # Chamadas Conexos ADICIONADAS pelo delta, no caso "descrição vazia" (execução real do bug):
  #   1) listItensNde         POST com297/comDocProdutos/list   (runWithRetry)
  #   2) preDescricaoProdutoNf GET  com297/.../preDescrProdutoNf (best-effort, opcional)
  #   3) lerItemNde           GET  com297/comDocProdutos/{...}   (runWithRetry)
  #   4) gravarDescricaoItemNde PUT com297/comDocProdutos        (putGenericOnce)
  ```
- **Impacto técnico**: sem `timeout:` no axios do Conexos, uma chamada travada não retorna nunca; o `RetryExecutor` só age em erro, então o LIST/GET travados não são interrompidos. Com o delta, o "Processar" agora acumula 3 (comum) a 4 (com preDescr) round-trips extras no mesmo request HTTP síncrono — cada um herda o mesmo risco. O caminho já incluía SN gerar/finalizar, borderô/validar/baixar/finalizar, NDe gerar, com300 RMW, com131 obs, homologar, poll SEFAZ.
- **Impacto de negócio**: analista vê o "Processar" pendurar até o timeout do proxy Render; a execução pode ter sucedido no ERP mas o front reporta erro; retomada faz sentido pelo desenho (a idempotência protege), mas a experiência é ruim e cria chamado. Não é falha do delta em si — é débito herdado que o delta ativa mais.
- **Métrica de baseline**: 0/N clientes Conexos com timeout HTTP explícito (só `BcbClient` tem); +3 a +4 chamadas Conexos síncronas adicionadas ao caminho crítico.

### F-availability-2: Etapa 3.5 sem observabilidade agregada (só logs textuais)

- **Severidade**: P2
- **Tactic violada**: Detect Faults — Monitor
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1451-1507` (etapa) e `:1466-1473` (caminho "sem item")
- **Evidência (objetiva)**:
  ```typescript
  // service dispara APENAS logs textuais em sucesso e degradação:
  await this.logService.warn({
      type: LOG_TYPE.BUSINESS_WARN,
      message: 'Descrição de impressão do item da NDe estava VAZIA e foi gravada ...',
      data: { txnId, ndDocCod, priCod, prdCod, dprCodSeq, descricaoGravada, descricaoEco },
  });
  ```
- **Impacto técnico**: não há contador de "quantas NDe/dia precisaram de correção", nem histogram de latência da etapa, nem alarme para "taxa de correção subiu abruptamente" (poderia indicar mudança de cadastro em massa OU regressão do ERP na rota `preDescrProdutoNf`). A única forma de responder "quantos casos rodaram este mês?" hoje é `grep` no log.
- **Impacto de negócio**: se a etapa passa a falhar sistematicamente, só ficamos sabendo pelo analista, que só descobre quando a homologação da NDe subsequente for recusada. Não há gatilho proativo.
- **Métrica de baseline**: 0 métricas/alarmes específicos da etapa 3.5; 2 tipos de log (`WARN` correção + `WARN` sem-item), nenhum promovido a metric filter.

### F-availability-3: Falta teste da falha por indisponibilidade da LEITURA (`listItensNde`/`lerItemNde`)

- **Severidade**: P3
- **Tactic violada**: Detect Faults — Exception Detection (garantia contratual, não implementação)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts:1527-1691` (cobre PUT rejeitando, no-op, precedência, retomada, homologada, sem-item)
- **Evidência (objetiva)**:
  ```
  $ grep -n "mockRejectedValue" src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts | grep -i "listItensNde\|lerItemNde"
  # (nenhum resultado)
  ```
  Só `gravarDescricaoItemNde: jest.Mock).mockRejectedValue(...)` está testado (`:1639`).
- **Impacto técnico**: o comportamento é o esperado por leitura do código (`runWithRetry` rethrow → try/catch do `rodarEtapas` → `registrarFalha` → `markError`), mas não há teste que ampare contra regressão silenciosa (ex.: alguém adicionar um `try/catch` intermediário engolindo a exceção do LIST). A tactic Exception Detection existe, mas fica sem "prova viva".
- **Impacto de negócio**: risco baixo — o comportamento existe hoje.
- **Métrica de baseline**: 1/3 endpoints da etapa cobertos por teste-de-falha (só `gravarDescricaoItemNde`); alvo: 3/3.

### F-availability-4: Sem kill switch específico para desligar a etapa 3.5 sem desligar a frente inteira

- **Severidade**: P3
- **Tactic violada**: Prevent Faults — Removal from Service
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1451-1507` e wiring de env em `src/backend/domain/libs/environment/model/EnvironmentVars.ts:135-144`
- **Evidência (objetiva)**:
  ```
  # Flags atuais no caminho Processar da Frente IV:
  #   conexosWriteEnabled          - desliga TUDO
  #   conexosDryRun                - preview de TUDO
  #   snCondPgtoAutoajuste         - desliga apenas o PUT de condição de pgto (paridade que buscamos)
  #   NDE_DESCRICAO_ITEM_FALLBACK  - força um texto explícito, mas NÃO desliga a etapa
  ```
- **Impacto técnico**: se a rota `com297/comDocProdutos` do ERP entrar em manutenção ou mudar contrato de forma bloqueante, a ÚNICA saída hoje é `conexosDryRun=true` para toda a frente. A ADR-0028 já estabeleceu o padrão de flag por-etapa (`snCondPgtoAutoajuste`) exatamente para isso.
- **Impacto de negócio**: se algo travar, a frente inteira para (ou operamos sem a correção e assumimos o risco de homologação recusada). Um `NDE_DESCRICAO_ITEM_ENABLED=false` seguido de log-e-segue para o com300 daria pouso mais suave.
- **Métrica de baseline**: 1 flag global (`conexosDryRun`) para desligar 8 etapas; alvo: flag por-etapa como já existe para `snCondPgtoAutoajuste`.

## 5. Cards Kanban

### [availability-1] Adicionar timeout HTTP explícito no `ConexosBaseClient`

- **Problema**
  > O `ConexosBaseClient`/`ConexosLegacyClient` não configura `timeout:` no axios (só `BcbClient` tem `10_000`). O delta adiciona 3 (caso comum) a 4 (com `preDescricaoProdutoNf`) chamadas Conexos síncronas ao caminho crítico do "Processar", que já era longo. Sem teto de tempo, uma chamada travada segura o request até o proxy do Render matar a conexão, e o analista vê o "Processar" pendurar mesmo quando a execução idempotente teria retomado limpo.
- **Melhoria Proposta**
  > Aplicar Bass `Exception Prevention`: definir `timeout` explícito no axios do `ConexosBaseClient`/`ConexosLegacyClient` (sugestão: 15 s por chamada; 30 s para PUTs write-once), lido de `EnvironmentProvider` (`CONEXOS_HTTP_TIMEOUT_MS`, com default seguro). Cobrir com teste unitário assertando o `timeout` no `axios.create`. Não muda a política de retry: o `RetryExecutor` já reage a erro; timeout vira erro, então entra na retomada natural das etapas idempotentes.
- **Resultado Esperado**
  > Nenhuma chamada Conexos pode segurar o Node event loop indefinidamente. Métrica: `% clientes Conexos com timeout explícito` de 0/N → N/N. Efeito colateral: a etapa 3.5 (e todas as anteriores) passam a falhar rápido em vez de pendurar, o que combina com o desenho fail-closed + retomada do serviço.
- **Tactic alvo**: Prevent Faults — Exception Prevention
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - `grep -c 'timeout:' src/backend/domain/client/Conexos*.ts`: 0 → ≥ 1
  - Testes unitários assertando timeout do axios: 0 → 1 (client base)
- **Risco de não fazer**: em 6 meses, a probabilidade de uma manutenção do ERP causar "Processar pendurado" para o analista sobe proporcionalmente ao número de etapas do fluxo; o delta acabou de somar 3–4 pontos de exposição a mais.
- **Dependências**: nenhuma (é uma linha por client).

### [availability-2] Instrumentar métrica e alarme para a etapa 3.5 (correção de descrição vazia)

- **Problema**
  > A etapa nova só emite logs textuais (`BUSINESS_WARN` em "gravou descrição" e em "sem linha de item"). Sem contador/histogram, não sabemos hoje quantas NDe/dia precisaram do conserto, nem detectamos regressão do ERP na rota `preDescrProdutoNf` sem chamado do analista. Descoberta reativa mata a proposta da etapa (que existe para PREVENIR homologação recusada).
- **Melhoria Proposta**
  > Aplicar Bass `Monitor`: incrementar contadores por saída da etapa (`nde_descricao_ok_no_op`, `nde_descricao_corrigida`, `nde_descricao_sem_item`, `nde_descricao_falha`) — enquanto a plataforma é Render+Supabase, materializar como colunas contadoras em `nota_debito_eletronica` ou em tabela dedicada de execução; quando migrar para Lambda/CloudWatch (alvo), promover para metric filter dos logs `BUSINESS_WARN`. Definir alarme "corrigidas/total > 30% por dia" (indica mudança de cadastro em massa) e "falhas > 1% por dia" (indica regressão de contrato do ERP).
- **Resultado Esperado**
  > Consulta "quantas NDe precisaram da correção este mês" respondida em segundos, sem grep de log. Métrica: `nº de métricas específicas da etapa 3.5` de 0 → ≥ 3; `nº de alarmes` de 0 → ≥ 2.
- **Tactic alvo**: Detect Faults — Monitor
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - `grep -r 'nde_descricao' src/backend`: 0 → ≥ 3 (contadores)
  - Alarmes/queries operacionais: 0 → ≥ 2
- **Risco de não fazer**: regressão do contrato ERP `com297/comDocProdutos` passa silenciosa até a homologação da primeira NDe recusar; o cliente sente antes de nós.
- **Dependências**: nenhuma para o contador; alarme depende da plataforma-alvo (CloudWatch quando existir).

### [availability-3] Cobrir teste de indisponibilidade da leitura (`listItensNde`/`lerItemNde`)

- **Problema**
  > Só `gravarDescricaoItemNde` tem teste de rejeição no `RecebimentoNumerarioService.test.ts:1635`. Não há teste equivalente para o LIST ou o READ do RMW falharem. O comportamento é o certo hoje (rethrow → try/catch do `rodarEtapas` → `registrarFalha` → `markError` → `status:error, etapa:nota-debito`), mas não há prova viva contra regressão silenciosa (alguém plantar um try/catch intermediário).
- **Melhoria Proposta**
  > Aplicar Bass `Exception Detection` como invariante de teste: adicionar 2 casos no `describe('RecebimentoNumerarioService — etapa 3.5 ...')` — (a) `listItensNde rejeita → status: error, etapa: nota-debito, sem tocar com300`; (b) `lerItemNde rejeita após LIST devolver item vazio → mesmo desfecho`.
- **Resultado Esperado**
  > Retomada e fail-closed da etapa 3.5 amparados por teste em todos os pontos de I/O, não só o PUT. Métrica: `endpoints da etapa 3.5 cobertos por teste-de-falha` de 1/3 → 3/3.
- **Tactic alvo**: Detect Faults — Exception Detection
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Testes de rejeição por endpoint da etapa 3.5: 1 → 3
- **Risco de não fazer**: baixo hoje; ganha peso quando o serviço ficar maior e alguém adicionar cache/tratamento intermediário.
- **Dependências**: nenhuma.

### [availability-4] Flag por-etapa para desligar a correção de descrição sem desligar a Frente IV

- **Problema**
  > A única forma de desligar a etapa 3.5 sem tocar o resto hoje é `conexosDryRun=true`, que desliga a frente inteira. A ADR-0028 já estabeleceu o padrão de flag por-etapa (`snCondPgtoAutoajuste`) e a etapa 3.5 caberia no mesmo desenho. Se a rota `com297/comDocProdutos` do ERP mudar de forma bloqueante em uma manutenção, hoje paramos a frente ou aceitamos correr o risco de NDe com descrição vazia.
- **Melhoria Proposta**
  > Aplicar Bass `Removal from Service`: introduzir `NDE_DESCRICAO_ITEM_ENABLED` (default `true`) em `EnvironmentVars`; quando `false`, a `etapaDescricaoItem` emite `BUSINESS_INFO` "etapa desligada por flag" e retorna, deixando a leg fiscal seguir. A ordem já garante que nada irreversível aconteceu antes dela — pular é seguro pelo desenho.
- **Resultado Esperado**
  > Operação pode desligar a correção como interruptor cirúrgico em manutenção do ERP, sem sacrificar a Frente IV. Métrica: `flags por-etapa da Frente IV` de 1 (`snCondPgtoAutoajuste`) → 2.
- **Tactic alvo**: Prevent Faults — Removal from Service
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - `grep -rn 'ndeDescricaoItemEnabled\|NDE_DESCRICAO_ITEM_ENABLED' src/backend`: 0 → ≥ 3 (env, provider, service)
  - 1 teste unitário do modo desligado.
- **Risco de não fazer**: em incidente do ERP na rota nova, a única alternativa é o kill switch global; a ADR-0028 seria descumprida na prática.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo declarado como restrito ao delta (fix/nde-descricao-item): NÃO reauditei tactics globais (SQS DLQ, dashboards, multi-tenant blast radius) porque nada do delta as toca, e o run é `--quick`. Se o consolidador quiser reabrir esse leque, dispare o run canônico sem escopo de branch.
- F-availability-1 é herdado da plataforma (`ConexosBaseClient` já entrava sem timeout antes do delta) — classifico como P1 aqui porque o delta AGRAVA a exposição (mais chamadas no caminho crítico); a decisão de contar isso como delta é minha e está explicitada. Sinalizar para `qa-fault-tolerance` (mesmo problema, ângulo diferente).
- F-availability-3 poderia ser um único teste parametrizado — deixei como 2 casos para explicitar "LIST" e "READ" (o RMW é o que mais tende a receber cache/refactor no futuro).
- Não meço latência p95 real do "Processar" (Render + Supabase, sem telemetria HTTP acessível localmente). O card `availability-2` propõe a instrumentação.
