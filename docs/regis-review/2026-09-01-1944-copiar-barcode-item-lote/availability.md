---
qa: Availability
qa_slug: availability
run_id: 2026-09-01-1944
agent: qa-availability
generated_at: 2026-09-01T19:44:00-03:00
scope: all
score: 7
findings_count: 5
cards_count: 5
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

Escopo restrito ao delta `copiar-barcode-item-lote` — o cenário é o do botão de copiar
alimentado por `SispagPainelService.linhasDigitaveisDoLote`, que lê `fin015` no Conexos
durante a expansão do card do lote.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG expande um `LoteCard` de lote com remessa gerada; Conexos `fin015` está intermitente (timeout, 5xx ou reset TCP) | 1 requisição HTTP `GET /sispag/lotes/:id/linhas-digitaveis` por expansão; até `500` itens por lote no page-size fixo | `ConexosSispagWriteClient.listarLinhasDigitaveisDoLote` (read com `runWithRetry`) + `SispagPainelService.linhasDigitaveisDoLote` (catch-all → `[]`) + `LoteCard.tsx` (`.catch` → `Map` vazio) | Operação normal do painel, com o lote já em `REMESSA_GERADA`. Cada expansão dispara uma leitura ao ERP; o resto do card (retorno, títulos, modalidades) segue vivo | O `RetryExecutor` (2 tentativas, 500 ms + jitter 200 ms, pula 4xx determinístico) tenta absorver; se falhar, o serviço captura, emite `BUSINESS_WARN` e devolve `[]`; a UI simplesmente não pinta o botão de copiar | 0% dos cards derrubados por falha do fin015; MTTD por operador = "nunca vê"; MTTD por SRE = tempo entre falha e alguém rodar `grep BUSINESS_WARN` (não medível — não há alarme sobre esta chave de log) |

Ponto de atenção que o delta introduz: a política "serviço nunca lança" transforma **queda
do Conexos** e **lote sem boleto** no mesmo sinal observado pela analista — o botão
some. É degradação graciosa **na tela** e falha silenciosa **na operação**. O único
canal de detecção é o log `BUSINESS_WARN`, sem métrica agregada nem alarme.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas externas do delta envelopadas em Executor | 1/1 (`listarLinhasDigitaveisDoLote` → `base.runWithRetry`) | 100% | ✅ | `src/backend/domain/client/ConexosSispagWriteClient.ts:395` |
| Timeout HTTP explícito no cliente Conexos usado pelo delta | ausente no `ConexosBaseClient` (defeito herdado, fora do delta) | ≥1 timeout de request | ⚠️ | `grep -n "timeout" src/backend/domain/client/ConexosBaseClient.ts` → 0 hits |
| Retentativa com backoff no read | 2 tentativas, 500 ms + jitter 200 ms, `shouldRetry` filtra recusa determinística | ≥1 retry com jitter em reads | ✅ | `src/backend/domain/client/ConexosBaseClient.ts:154-165` |
| Idempotência (leitura, sem efeito colateral) | leitura pura de `fin015/finItemSispag/list`, sem write | leitura idempotente | ✅ | `src/backend/domain/client/ConexosSispagWriteClient.ts:400-436` |
| Diagnóstico do erro logado no fallback | apenas `err.message`; perde `endpoint`, `code`, `statusCode`, `priCod` do `ConexosError` | preservar campos tipados do `ConexosError` | ⚠️ | `src/backend/domain/service/sispag/SispagPainelService.ts:252-262` |
| Sinal observável para SRE quando o botão some por falha | `LogService.warn` com `LOG_TYPE.BUSINESS_WARN`, sem contador/CloudWatch metric filter/alarme | ≥1 métrica agregada + alarme por taxa de falha | ⚠️ | `src/backend/domain/service/sispag/SispagPainelService.ts:253` |
| Feedback ao usuário sobre falha da leitura | nenhum — a UI vira "sem boletos" indistinto | pelo menos um marcador visual "não foi possível carregar linhas" | ❌ | `src/frontend/app/sispag/components/LoteCard.tsx:163-166` (`.catch(() => setLinhas(new Map()))`) |
| Cancelamento de fetch em unmount | flag `vivo` bloqueia `setState`, mas a request continua até o fim | `AbortController` | ⚠️ | `src/frontend/app/sispag/components/LoteCard.tsx:153-169` |
| Cobertura de teste no caminho de falha | 4 cenários (feliz, rascunho sem chamar ERP, lote inexistente, falha do ERP → `[]` + WARN) + assertiva anti-vazamento da linha nos logs | ≥3 cenários de falha | ✅ | `src/backend/domain/service/sispag/SispagPainelService.test.ts:391-458` |
| Guard de autorização (evita amplificação por scraping) | `requireRole('admin')` no route + teste que rejeita `viewer` com 403 | admin-only em endpoints que expõem destino de pagamento | ✅ | `src/backend/routes/sispag.ts:65`, `src/backend/routes/sispag.test.ts:158-169` |
| Estado degradado do card em rascunho (não chama ERP) | short-circuit em `nativeFlpCod == null` → `[]`, sem gastar chamada | short-circuit em estado inelegível | ✅ | `src/backend/domain/service/sispag/SispagPainelService.ts:245-247` |

> ⚠️ **Não medível localmente**: taxa real de `BUSINESS_WARN`
> `linhasDigitaveisDoLote: leitura do fin015 falhou` em produção. Requer CloudWatch
> Logs Insights (ou o equivalente na infra atual de Render/Supabase). Recomendação:
> instrumentar um contador (metric filter no CloudWatch quando migrar; enquanto isso,
> um `LogService.count` ou um `logfmt` que a query de painel do Render agrupe) e alarme
> quando a taxa passar de X% das expansões de card num intervalo de 15 min.

> ⚠️ **Não medível localmente**: MTTR — quanto tempo entre falha do fin015 e
> alguém agir. Como o único sinal é `BUSINESS_WARN` sem alarme, o MTTR real é
> "até um analista abrir chamado dizendo 'sumiu o botão de copiar'". Recomendação
> igual à métrica acima.

> ⚠️ **Não medível localmente**: métricas de Terraform/tenants — repositório
> não tem `infra/` (confirmado em `_shared-metrics.md`).

## 3. Tactics — Cobertura no nf-projects

Escopo delta: só tactics diretamente aplicáveis à leitura opcional que o botão de
copiar adiciona.

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A — leitura sob demanda, sem healthcheck próprio do endpoint | N/A | — |
| Heartbeat | N/A — não há loop periódico neste caminho | N/A | — |
| Monitor | `LogService.warn` no fallback do serviço, mas SEM métrica/alarme derivado — operador precisa varrer log manualmente | ⚠️ parcial | `SispagPainelService.ts:253` |
| Timestamp | N/A — chamada única, sem ordenação temporal a validar | N/A | — |
| Sanity Checking | `LINHA_DIGITAVEL_SCHEMA` (`z.string().regex(/^\d{47}$/)`) descarta item malformado sem contaminar a resposta; `LOTE`  → early return em `nativeFlpCod == null` | ✅ presente | `ConexosSispagWriteClient.ts:76-84`, `SispagPainelService.ts:245-247` |
| Condition Monitoring | N/A no delta | N/A | — |
| Voting | N/A — fonte única (fin015) | N/A | — |
| Exception Detection | `try/catch` no client (converte para `ConexosError` via `toConexosError`) e no serviço (converte para `[]` + WARN); frontend `.catch` também presente | ✅ presente | `ConexosSispagWriteClient.ts:435-437`, `SispagPainelService.ts:252-263`, `LoteCard.tsx:163-166` |
| Self-Test | N/A — sem probe/self-check no delta | N/A | — |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A — fonte única | N/A | — |
| Passive Redundancy | N/A | N/A | — |
| Spare | N/A | N/A | — |
| Exception Handling | Duas camadas: client sobe `ConexosError` tipado; serviço captura e degrada | ✅ presente | `SispagPainelService.ts:252-263` |
| Rollback | N/A — leitura, sem estado a reverter | N/A | — |
| Software Upgrade | N/A no delta | N/A | — |
| Retry | `runWithRetry` (2 tentativas, 500 ms + jitter 200 ms, `shouldRetry` filtra 4xx determinístico) — composição correta com o `catch` do serviço (esgota retries antes de degradar) | ✅ presente | `ConexosSispagWriteClient.ts:409`, `ConexosBaseClient.ts:154-165` |
| Ignore Faulty Behavior | `.safeParse` no schema descarta linha inválida sem contaminar a resposta | ✅ presente | `ConexosSispagWriteClient.ts:426-433` |
| Degradation | Serviço devolve `[]` em vez de lançar → card do lote continua vivo; frontend simplesmente não pinta o botão | ✅ presente (com ressalva de diagnóstico em F-availability-1) | `SispagPainelService.ts:262`, `LoteCard.tsx:163-166` |
| Reconfiguration | N/A no delta | N/A | — |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | N/A | N/A | — |
| State Resynchronization | Recarga natural na próxima expansão do card (`useEffect` reage a `[aberto, isRascunho, l.id]`), mas sem refresh manual — se falhou uma vez com o card já aberto, fica travado no `Map` vazio até colapsar/re-expandir | ⚠️ parcial | `LoteCard.tsx:154-170` |
| Escalating Restart | N/A — leitura por request | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | N/A no delta | N/A | — |
| Transactions | N/A — leitura | N/A | — |
| Predictive Model | ❌ ausente — não há sinal antecipado ("Conexos oscilando, botão pode sumir") | ❌ ausente | — |
| Exception Prevention | Short-circuit em rascunho evita chamar o ERP quando o dado não existe por definição (previne falha "por gasto") | ✅ presente | `SispagPainelService.ts:245-247` |
| Increase Competence Set | Schema Zod amplia o repertório de "linha ruim" que o cliente sabe rejeitar sem colapsar | ✅ presente | `ConexosSispagWriteClient.ts:76-84` |

## 4. Findings (achados)

### F-availability-1: Fallback silencioso mascara indisponibilidade do Conexos para a analista

- **Severidade**: P2
- **Tactic violada**: Degradation (parcialmente correta; o problema é a **detecção** que ela apaga, não a degradação em si)
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:252-263`, `src/frontend/app/sispag/components/LoteCard.tsx:163-166`
- **Evidência (objetiva)**:
  ```ts
  // service — engole tudo em []:
  } catch (err) {
      await this.logService.warn({
          type: LOG_TYPE.BUSINESS_WARN,
          message: 'linhasDigitaveisDoLote: leitura do fin015 falhou',
          data: { loteId, flpCod: nativeFlpCod,
                  motivo: err instanceof Error ? err.message : 'desconhecido' },
      });
      return [];
  }
  ```
  ```tsx
  // frontend — .catch silencioso, sem toast, sem estado de erro:
  .catch(() => {
      if (vivo) setLinhas(new Map()) // sem linha → sem botão; nada quebra
  })
  ```
  Estado observado: `curl -w "%{http_code}\n"` no endpoint sempre retorna `200`, mesmo com o
  ERP fora — dois cenários (lote sem boleto e Conexos indisponível) produzem exatamente o
  mesmo payload `{itens: []}`.
- **Impacto técnico**: qualquer alarme baseado em `5xx` do endpoint nunca vai disparar.
  A única evidência é o log `BUSINESS_WARN`, que hoje não tem métrica agregada nem alarme.
- **Impacto de negócio**: analista pode assumir "esse lote não tem boleto DDA" e ir buscar
  a linha em outro lugar (planilha, e-mail, sistema espelho) — usa uma fonte que **não é o
  que o ERP anexou**. Risco de pagar boleto errado ou de valor errado. Não é blast direto,
  mas o desenho da degradação apaga o único sinal que permitiria intervir antes do incidente.
- **Métrica de baseline**: 100% dos erros do fin015 na leitura de linha digitável são
  indistinguíveis de "sem boleto" no cliente (grep no log é a única detecção).

### F-availability-2: Log do fallback perde a estrutura do `ConexosError`

- **Severidade**: P2
- **Tactic violada**: Monitor (diagnosticabilidade insuficiente)
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:256-262`
- **Evidência (objetiva)**:
  ```ts
  data: { loteId, flpCod: nativeFlpCod,
          motivo: err instanceof Error ? err.message : 'desconhecido' },
  ```
  O `ConexosError` (`src/backend/domain/errors/ConexosError.ts:30-46`) expõe `endpoint`,
  `code` (`CONEXOS_UPSTREAM_TIMEOUT` | `..._ERROR` | `..._REJECTED`), `statusCode`,
  `priCod` e `retryable`. O serviço só extrai `.message` e joga o resto fora.
- **Impacto técnico**: quando o BUSINESS_WARN aparece no log, o SRE não consegue distinguir
  timeout de 5xx nem contar rejeição determinística — perde a classificação que o
  `RetryExecutor` já fez de graça a montante. Diagnóstico exige logar-plus-repetir para reproduzir.
- **Impacto de negócio**: MTTR maior do que precisa ser quando o incidente é reportado por
  analista. Como o volume esperado desse endpoint é baixo, cada evento é raro e precioso —
  jogar fora a classificação é caro por chamada.
- **Métrica de baseline**: 4 campos úteis do `ConexosError` (`code`, `statusCode`, `endpoint`,
  `retryable`) → 0 preservados no log de fallback.

### F-availability-3: Nenhuma métrica/alarme derivado do `BUSINESS_WARN` deste caminho

- **Severidade**: P2
- **Tactic violada**: Monitor
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:253` (fonte do
  evento); sem contra-parte de instrumentação no repo (nem `Grep -rn "MetricData\|metric_filter"`
  encontra algo neste caminho).
- **Evidência (objetiva)**:
  ```
  $ grep -rn "linhasDigitaveisDoLote" src/backend | wc -l
  6   # tudo é source + testes; nenhuma métrica agregada
  ```
- **Impacto técnico**: o único caminho de detecção da falha silenciosa (ver F-availability-1)
  é uma busca textual em log. Não há alarme por taxa, não há visualização em painel.
- **Impacto de negócio**: MTTD real é "quando alguém reclamar". Cria dependência de
  vigilância humana num sinal que foi projetado para ser invisível ao humano.
- **Métrica de baseline**: 0 alarmes/painéis com esta chave de log; 1 tipo de log
  (`BUSINESS_WARN`) genérico compartilhado com ≥7 outros lugares (`grep BUSINESS_WARN` conta 15+
  origens), o que dificulta filtrar por causa específica.

### F-availability-4: `useEffect` não usa `AbortController` — request órfão sob toggle rápido

- **Severidade**: P3
- **Tactic violada**: Exception Prevention (baixo, cosmético)
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:153-170`
- **Evidência (objetiva)**:
  ```tsx
  React.useEffect(() => {
      if (!aberto || isRascunho) return
      let vivo = true
      fetchLinhasDigitaveis(l.id)
        .then((itens) => { if (!vivo) return; setLinhas(...) })
        .catch(() => { if (vivo) setLinhas(new Map()) })
      return () => { vivo = false }
  }, [aberto, isRascunho, l.id])
  ```
  A flag `vivo` impede `setState`, mas o fetch em curso não é cancelado (`AbortController`
  ausente). Se a analista abre-fecha-abre um card com o ERP lento, cada expansão emite
  uma nova request; nenhuma é cancelada.
- **Impacto técnico**: sob load com N cards e Conexos lento, um único analista pode empilhar
  requests que continuam consumindo conexão HTTP e ciclos do worker Express até timeout do
  sistema operacional. Não é derramamento cross-tenant, mas é desperdício preventível.
- **Impacto de negócio**: irrelevante em uso normal; começa a doer quando o Conexos está
  degradado — exatamente o momento em que preservar recurso importa.
- **Métrica de baseline**: 0 requests canceladas de 100% (não há `AbortController` no caminho).

### F-availability-5: Sem recovery manual — card preso no `Map` vazio até re-expandir

- **Severidade**: P3
- **Tactic violada**: State Resynchronization
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:154-170`
- **Evidência (objetiva)**: o `useEffect` só dispara em mudança de `[aberto, isRascunho, l.id]`.
  Não há botão "recarregar linhas digitáveis" nem retry automático após falha inicial. Se o
  fetch falha na primeira tentativa e a analista mantém o card aberto (por 30 min, digamos),
  o Conexos pode voltar mas o `Map` continua vazio — e o botão continua ausente.
- **Impacto técnico**: sinal de disponibilidade recuperada só chega ao usuário via ação
  manual (colapsar + re-expandir).
- **Impacto de negócio**: MTTR percebido pelo analista maior do que MTTR real do sistema.
  Baixo, mas real.
- **Métrica de baseline**: 0 caminhos automáticos de re-tentativa após falha no cliente.

## 5. Cards Kanban

### [availability-1] Diferenciar "sem boleto" de "falha ao ler" no contrato do endpoint

- **Problema**
  > Hoje `GET /sispag/lotes/:id/linhas-digitaveis` devolve `{itens: []}` tanto quando o lote
  > está em rascunho e não tem boleto associado quanto quando o Conexos fin015 caiu no
  > meio do request. A analista vê o mesmo estado nos dois cenários (o botão de copiar
  > simplesmente não aparece) e, sob falha do ERP, pode buscar a linha em outra fonte não
  > verificada — um caminho de erro que a feature devia estar prevenindo.

- **Melhoria Proposta**
  > Enriquecer o payload com um marcador de origem, ex.: `{itens: [...], degraded: boolean,
  > reason?: 'draft' | 'no_boleto' | 'conexos_unavailable'}`. Preservar o comportamento
  > atual de nunca lançar (a degradação em si é correta), mas separar o sinal na resposta.
  > No frontend, quando `degraded === true`, pintar um discreto ícone de alerta em vez do
  > botão de copiar, com tooltip "Não foi possível carregar as linhas — tente novamente
  > em instantes". Tactic Bass: Degradation acompanhada de Exception Detection observável
  > pelo consumidor.

- **Resultado Esperado**
  > Analista distingue visualmente ausência legítima de falha transitória; SRE consegue
  > medir "quantas vezes o endpoint degradou" via `count(degraded=true)` no log de
  > request. Métrica observável: hoje 0% dos cenários de falha são discerníveis pelo
  > cliente → alvo 100%.

- **Tactic alvo**: Degradation + Exception Detection (Bass — Recover / Detect)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - % de respostas do endpoint que distinguem "vazio legítimo" de "erro degradado": 0% → 100%
  - Falhas do fin015 visíveis à analista na UI: 0 → todas
- **Risco de não fazer**: em uma janela de instabilidade do Conexos, analista paga boleto
  vindo de fonte não conferida. Nenhum guard-rail do sistema pega isso hoje.
- **Dependências**: nenhuma

### [availability-2] Preservar campos do `ConexosError` no `BUSINESS_WARN`

- **Problema**
  > O `catch (err)` do serviço só extrai `.message`. `ConexosError` classifica upstream
  > entre `CONEXOS_UPSTREAM_TIMEOUT`, `..._ERROR` e `..._REJECTED`, com `statusCode`,
  > `endpoint`, `retryable` — tudo jogado fora quando o log é escrito.

- **Melhoria Proposta**
  > No branch de catch, testar `err instanceof ConexosError` e serializar `code`,
  > `statusCode`, `endpoint` e `retryable` como campos separados do `data`. Manter
  > `motivo` para causas não-tipadas (fallback). Tactic Bass: Monitor com granularidade
  > adequada.

- **Resultado Esperado**
  > Log passa a permitir agrupar por classe de falha sem precisar parsear `motivo`.
  > Métrica: 0 campos tipados hoje → 4 campos preservados (`code`, `statusCode`,
  > `endpoint`, `retryable`).

- **Tactic alvo**: Monitor (Bass — Detect)
- **Severidade**: P2
- **Esforço estimado**: S (≤0.5d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Campos do `ConexosError` preservados no log: 1 (`.message`) → 5
  - Tempo p/ triagem de incidente (autodeclarado por SRE): "abrir chamado + reproduzir" → "grep + agrupar"
- **Risco de não fazer**: cada incidente reincidente consome triagem manual do zero.
- **Dependências**: nenhuma

### [availability-3] Instrumentar métrica agregada + alarme de taxa de falha no endpoint

- **Problema**
  > A queda silenciosa (F-availability-1) só é detectável por `grep BUSINESS_WARN`. Não
  > há painel, não há alarme. Em janela típica de indisponibilidade parcial do Conexos
  > (30 min), ninguém é acionado até analista abrir chamado.

- **Melhoria Proposta**
  > Adicionar um contador dedicado — nome estável, ex.: `sispag.linhas_digitaveis.fallback`
  > — incrementado no catch do serviço. Enquanto o repo não migra para AWS, materializar
  > como uma chave `metric` estruturada no log que a query padrão do Render/Supabase
  > consegue agrupar. Definir alarme "≥N eventos em 15 min" ligado ao canal SRE. Tactic
  > Bass: Monitor + Predictive Model (thresholded).

- **Resultado Esperado**
  > SRE recebe alerta antes do primeiro chamado de analista. Métrica: MTTD passa de
  > "reclamação humana" para "≤15 min após início da falha".

- **Tactic alvo**: Monitor (Bass — Detect)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — depende do que existe hoje para alarme sobre log)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Alarmes cobrindo este caminho: 0 → 1
  - MTTD estimado: "só via chamado" → ≤15 min
- **Risco de não fazer**: uma janela de degradação passa em branco na operação até
  alguém somar 2+2 lendo log manualmente — o que raramente acontece.
- **Dependências**: idealmente feito depois de availability-2 (para poder agrupar pela
  classe de erro), mas independente na prática.

### [availability-4] `AbortController` no `useEffect` do LoteCard

- **Problema**
  > O `useEffect` que busca linhas digitáveis usa flag `vivo` para evitar `setState` após
  > unmount, mas não cancela a request em si. Sob Conexos lento e analista abrindo/fechando
  > cards em sequência, empilham-se requests órfãs consumindo worker.

- **Melhoria Proposta**
  > Trocar a flag `vivo` por `AbortController` e propagar o `signal` até `apiFetch`
  > (`fetchLinhasDigitaveis` aceitando `RequestInit` opcional). No cleanup, `controller.abort()`.
  > Tactic Bass: Exception Prevention.

- **Resultado Esperado**
  > Requests em voo são canceladas ao colapsar/desmontar. Sob load, worker preservado.

- **Tactic alvo**: Exception Prevention (Bass — Prevent)
- **Severidade**: P3
- **Esforço estimado**: S (≤0.5d)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Requests órfãs sob toggle rápido: N → 0
- **Risco de não fazer**: irrelevante em uso normal; começa a pesar em momento de
  degradação — quando preservar recurso mais importa.
- **Dependências**: nenhuma

### [availability-5] Botão "recarregar linhas" quando o fetch falha

- **Problema**
  > Se o primeiro fetch falha e a analista mantém o card aberto, não há caminho automático
  > nem manual de re-tentativa até colapsar/re-expandir. O botão de copiar fica ausente
  > mesmo depois do Conexos voltar.

- **Melhoria Proposta**
  > Guardar estado de erro no `useState` (não só `Map` vazio) e, quando presente, exibir
  > um pequeno ícone de "recarregar" perto da coluna de modalidade que dispara novo fetch
  > sob demanda. Depende do card availability-1 para saber quando pintar. Tactic Bass:
  > State Resynchronization.

- **Resultado Esperado**
  > MTTR percebido pela analista alinhado ao MTTR real do Conexos. Métrica: interações
  > manuais para recuperar (colapsar+expandir → 1 clique) mantidas em 1, mas com feedback
  > explícito de "houve falha".

- **Tactic alvo**: State Resynchronization (Bass — Recover / Reintroduction)
- **Severidade**: P3
- **Esforço estimado**: S (≤0.5d)
- **Findings relacionados**: F-availability-5
- **Métricas de sucesso**:
  - Caminhos manuais de recovery no cliente: 0 → 1
- **Risco de não fazer**: fricção residual em incidentes; não crítico.
- **Dependências**: availability-1 (compartilha o marcador de degradação no payload).

## 6. Notas do agente

- Escopo estritamente delta. Timeout HTTP do `ConexosBaseClient` (via `LegacyConexosShape`,
  sem `timeout` explícito no `axios.create`) é defeito herdado que amplifica a superfície
  de risco deste read, mas não é criado pelo delta — deixado para uma review não-`--quick`
  sobre o cliente base.
- A pergunta central do prompt ("degradação graciosa ou falha silenciosa?") tem a mesma
  resposta que os cards contam: a **degradação** está bem construída (`runWithRetry` no
  client, catch no serviço, `Map` vazio no cliente que apenas oculta o botão — nada quebra
  o card), mas a **detecção** que a acompanha é fraca (log genérico, sem métrica agregada,
  sem sinal ao consumidor). Cards availability-1..3 endereçam justamente esse desequilíbrio.
- O `runWithRetry` compõe corretamente com o `catch` do serviço: o executor esgota as
  tentativas antes de sobrar exceção — o serviço só degrada depois que o retry falhou.
  Nada a ajustar aí.
- Cross-QA: security (LGPD/LC 105) confirma valor do `requireRole('admin')`; observability
  se sobrepõe a availability-2 e availability-3 (log estruturado + métrica).
