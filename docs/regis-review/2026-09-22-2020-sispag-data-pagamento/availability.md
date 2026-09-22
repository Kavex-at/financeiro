---
qa: Availability
qa_slug: availability
run_id: 2026-09-22-2020-sispag-data-pagamento
agent: qa-availability
generated_at: 2026-09-22T20:20:00-03:00
scope: backend + frontend (delta da branch fix/sispag-data-pagamento vs origin/main)
score: 8
findings_count: 4
cards_count: 4
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG (Flavia/Rene) escolhendo a data de débito da remessa, sob concorrência (duplo clique, duas abas, dois operadores) ou falha de rede/processo no meio da escrita | `POST /sispag/lotes/:id/remessa` com `dataDebito` ausente/inválida/fora da janela, chegando enquanto uma tentativa anterior para o MESMO lote ainda está em voo ou morreu sem confirmar | `DebitDateService`, `BankingCalendar`, `RemessaService.gerarRemessaSerializado`/`resolverDataDebito`, `lote_pagamento.data_debito`, `ConexosSispagWriteClient.criarLote` (fin015) | Produção, janela diária estreita antes do corte bancário; escrita real no ERP é irreversível pela aplicação (só desfeita cancelando o lote nativo no fin015) | O sistema bloqueia a data inválida/congelada ANTES de qualquer escrita (fail-closed), serializa por advisory lock por lote, e uma execução interrompida é reconciliada consultando o ERP antes de decidir repetir o `criarLote` — nunca cria um segundo lote nativo por causa da nova coluna | 0 lotes nativos duplicados por corrida ou por retry; 100% das datas fora de `[hoje_BRT, min(vencimento)] ∩ diasUteisBancarios` barradas antes do POST no fin015; mensagem de erro (`DebitDateOutsideWindowError`/`DebitDateFrozenError`) sempre indica a ação de correção em 1 frase |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Bug de fuso corrigido pelo delta (`hojeUtc()` UTC-meia-noite → `todayBrt()`) | Corrigido; 2 testes dedicados ao horário-limite (23h30 e meia-noite BRT) | Regressão coberta por teste | ✅ | `src/backend/domain/libs/calendar/BankingCalendar.test.ts:89-98` |
| Validação I8a executada ANTES de qualquer escrita no ERP | Sim — `resolverDataDebito` roda antes do bloco `try { await this.write.criarLote(...) }` | 100% das escritas financeiras precedidas de validação de domínio | ✅ | `src/backend/domain/service/sispag/RemessaService.ts:322-327,437-457` |
| Persistência `data_debito` write-ahead (antes do POST remoto) | Sim — `loteRepo.setDataDebito` chamado antes de `write.criarLote` | Write-ahead em toda escrita ERP nova | ✅ | `RemessaService.ts:452-459` |
| Erros de domínio novos com `retryable` classificado corretamente | 2/2 (`DebitDateOutsideWindowError.retryable=false`, `DebitDateFrozenError.retryable=false`) — ambos corretos: repetir o mesmo POST sem mudar a data não resolveria | 100% dos `HandlerError` novos classificados | ✅ | `DebitDateErrors.test.ts:1-10` |
| Migração aditiva sem backfill nem downtime | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS data_debito DATE` (nullable, sem `NOT NULL`/`DEFAULT`) | Zero downtime em toda migration | ✅ | `src/backend/migrations/0061_lote_data_debito.sql` |
| Dependência externa nova introduzida pelo cálculo de feriados | 0 — calendário bancário calculado em código (Páscoa por algoritmo), sem API/tabela externa | Minimizar superfície de dependência externa | ✅ | `BankingCalendar.ts:30-31` ("sem tabela, sem rede, sem dependência nova") |
| Cobertura de feriados do `BankingCalendar` | Nacionais fixos + móveis (Páscoa, Carnaval, Corpus Christi) + Consciência Negra desde 2024 | 100% dos feriados da praça bancária de cada conta pagadora | ⚠️ | `BankingCalendar.ts:36` (gap autoadmitido: "feriados municipais/estaduais e 31/12 — são valor de praça") |
| Rotas GET novas desta feature com rate limiter (`heavyRouteLimiter`) | 0 de 1 (`GET /sispag/lotes/:id/remessa/janela` não usa `heavyRouteLimiter`, ao contrário da rota irmã `POST .../remessa`) | Consistência com o padrão já adotado em `/contas-pagadoras` (mesmo arquivo) | ⚠️ | `src/backend/routes/sispag.ts:390-410,442-453` |
| Retry/backoff no fetch de leitura do frontend (`fetchJanelaDataDebito`) | 0 tentativas automáticas — fetch único, erro vira mensagem definitiva na tela | ≥1 retry com backoff para leituras críticas ao fluxo de escrita | ⚠️ | `src/frontend/lib/sispag.ts:530-531`; `GerarRemessaDialog.tsx:120-135` |
| Suites de teste (backend/frontend) do repositório passando | 144 (backend) + 48 (frontend) | 100% | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: frequência real de rejeição do ERP por feriado de praça (municipal/estadual) não coberto pelo `BankingCalendar`, e MTTR de uma remessa presa em `RemessaEmDuvidaError`/`DebitDateFrozenError`. Requer logs de produção (Render, hoje sem CloudWatch/dashboard — `infra/` não existe neste repositório). Recomendação: quando a infra Terraform existir, instrumentar contagem de ocorrências de `DebitDateOutsideWindowError`/`DebitDateFrozenError` por `motivo`, e tempo entre `FINALIZADO` e `REMESSA_GERADA` por lote.
> ⚠️ **Não medível localmente**: injeção de falha (crash do processo entre `setDataDebito` e `criarLote`) para confirmar o comportamento do dado órfão descrito em F-availability-2 — requer teste de chaos/fault-injection, fora do escopo `--quick`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A — não há checagem síncrona de vida entre serviços relevante a este delta (fluxo é request/response HTTP, não um mesh de serviços) | N/A | — |
| Heartbeat | N/A — sistema é batch/request-response no Express/Render; sem processo de longa duração que precise emitir heartbeat neste delta | N/A | — |
| Monitor | ⚠️ parcial — o middleware de log `[RES] ${requestId} ... → ${status}` captura os novos códigos 409/422 (`DATA_DEBITO_FORA_DA_JANELA`, `DATA_DEBITO_CONGELADA`), mas não há dashboard/alarme (infra Terraform/CloudWatch não existe neste repo) | ⚠️ | `src/backend/http/buildApp.ts:65-76`; ver nota "não existe `infra/`" no `CLAUDE.md` |
| Timestamp | ✅ presente — é o núcleo da correção deste delta: `todayBrt()` substitui `hojeUtc()` (meia-noite UTC), eliminando o bug em que o dia trocava às 21h de Brasília | ✅ | `BankingCalendar.ts:108-114`; `RemessaService.ts` (remoção de `hojeUtc` local) |
| Sanity Checking | ✅ presente — `civilDateSchema` (Zod, regex + validade de calendário) na borda da rota; `DebitDateService.validate` checa janela/dia útil antes de qualquer escrita | ✅ | `src/backend/routes/sispag.ts:422-432`; `DebitDateService.ts:112-149` |
| Condition Monitoring | ✅ presente — `resolverDataDebito` detecta a condição "data congelada no passado com `finalizarLote` ainda pendente" e barra antes de deixar o ERP recusar | ✅ | `RemessaService.ts:1075-1090` (bloco `finalizarPendente && congelada < todayBrt()`) |
| Voting | N/A — fonte única de verdade (Postgres local + ERP), sem redundância comparativa de múltiplas fontes independentes | N/A | — |
| Exception Detection | ✅ presente — 2 classes de erro tipadas novas (`DebitDateOutsideWindowError`, `DebitDateFrozenError`) implementam `HandlerError` com `code`/`statusCode`/`retryable`/`userMessage` explícitos; item sem vencimento é fail-closed (janela vazia) em vez de ser ignorado | ✅ | `DebitDateOutsideWindowError.ts`; `DebitDateFrozenError.ts`; `DebitDateService.ts:65-72` |
| Self-Test | ❌ ausente — nenhum smoke-test de boot valida o `BankingCalendar` contra um calendário de referência (ex.: comparar com o calendário BCB); a suíte de unidade cobre casos fixos, não um self-check em runtime | ❌ | `grep -rn "self-test\|selfTest" src/backend` → vazio |
| Active Redundancy | N/A — dependência única no Conexos (fin015); não há caminho paralelo redundante aplicável a este fluxo | N/A | — |
| Passive Redundancy | N/A — idem | N/A | — |
| Spare | N/A — não há spare/standby relevante a este delta | N/A | — |
| Exception Handling | ✅ presente — mensagens de erro em pt-BR acionáveis ("cancele o lote nativo flp X no fin015 e gere de novo"), mapeadas para o `statusCode` correto (422/409) e reproduzidas no cliente frontend (`sispagRequest`) | ✅ | `DebitDateFrozenError.ts:42-51`; `src/frontend/lib/sispag.ts:490-494` |
| Rollback | ⚠️ parcial — não há rollback/compensação explícita do `data_debito` gravado no Postgres se o `criarLote` subsequente falhar (ver F-availability-2); o valor fica órfão até ser recalculado silenciosamente na próxima tentativa | ⚠️ | `RemessaService.ts:452-462` |
| Software Upgrade | ✅ presente — migração `0061` aditiva, `NULL`-safe, sem backfill, documentada explicitamente para deploy sem downtime; lotes legados tratados como caso de primeira classe (`congelada === undefined`) | ✅ | `src/backend/migrations/0061_lote_data_debito.sql`; `RemessaService.ts:1049-1057` |
| Retry | ⚠️ parcial — a reconciliação com o ERP (`sincronizarComErp`, pré-existente, reutilizada por este delta) cobre retomada de uma escrita interrompida; mas o fetch de leitura novo no frontend (`fetchJanelaDataDebito`) e o `POST .../remessa` não usam `RetryExecutor`/backoff no cliente — só o `heavyRouteLimiter` e o advisory lock do lado do servidor | ⚠️ | `RemessaService.ts:225-300` (retomada); `src/frontend/lib/sispag.ts:530-531` (sem retry) |
| Ignore Faulty Behavior | N/A — não aplicável; o padrão do domínio é sempre fail-closed, nunca ignorar | N/A | — |
| Degradation | ✅ presente — lote nativo legado (criado antes da migração 0061, sem `data_debito` persistida) segue sem congelar a data, logando um aviso em vez de quebrar o fluxo | ✅ | `RemessaService.ts:1049-1057` |
| Reconfiguration | N/A — não há reconfiguração dinâmica de topologia relevante a este delta | N/A | — |
| Shadow | N/A — não aplicável a este fluxo | N/A | — |
| State Resynchronization | ✅ presente (reutilizado) — `sincronizarComErp` consulta o fin015 para determinar a etapa real após uma interrupção, e agora também decide se a `dataDebito` persistida bate com o lote nativo real antes de prosseguir | ✅ | `RemessaService.ts:225-300`; `DebitDateFrozenError` usado dentro dessa reconciliação |
| Escalating Restart | N/A — não há processo de longa duração/pod a reiniciar neste delta (Express request/response) | N/A | — |
| Non-Stop Forwarding | N/A — não aplicável | N/A | — |
| Removal from Service | N/A — não aplicável a este delta (sem fleet/instância a remover de serviço) | N/A | — |
| Transactions | ⚠️ parcial — `setDataDebito` (Postgres) e `criarLote` (chamada de rede ao ERP) não formam uma transação distribuída; write-ahead cobre o cenário "sei o que ia escrever", mas não desfaz a gravação local se a chamada remota nunca acontecer (ver F-availability-2) | ⚠️ | `RemessaService.ts:452-459` |
| Predictive Model | N/A — fora de escopo deste delta (não há modelo preditivo de falha aplicável à escolha de data de débito) | N/A | — |
| Exception Prevention | ✅ presente — validação de forma (Zod) na borda + validação de domínio (I8a) impedem que uma data malformada ou fora da janela sequer chegue perto de uma escrita no ERP | ✅ | `routes/sispag.ts:422-449`; `DebitDateService.ts:112-149` |
| Increase Competence Set | ✅ presente — calendário bancário calculado em código elimina a necessidade de uma API/tabela de feriados externa (uma classe inteira de falha de disponibilidade evitada); a correção do fuso (`todayBrt`) elimina a classe de bug do `hojeUtc()` | ✅ | `BankingCalendar.ts:17-38` |

## 4. Findings (achados)

### F-availability-1: `BankingCalendar` não cobre feriados municipais/estaduais nem 31/12

- **Severidade**: P2
- **Tactic violada**: Exception Prevention (parcial) / Sanity Checking
- **Localização**: `src/backend/domain/libs/calendar/BankingCalendar.ts:36`
- **Evidência (objetiva)**:
  ```
  /**
   * ...
   * Fora de escopo (gap P1): feriados municipais/estaduais e 31/12 — são valor de praça.
   */
  ```
- **Impacto técnico**: a janela `[hoje_BRT, min(vencimento)] ∩ diasUteisBancarios` pode classificar como "dia útil" uma data que, na praça bancária real da conta pagadora (ex.: feriado municipal de São Paulo), não é dia útil. O ERP validaria (R1/R2) na hora do `finalizarLote`, então a falha seria detectada, mas depois de o `criarLote` já ter acontecido.
- **Impacto de negócio**: reexecução manual pela analista às vésperas do corte bancário diário; risco maior justamente nos dias em que o calendário nacional não cobre a praça específica (comum em capitais e feriados religiosos estaduais).
- **Métrica de baseline**: gap autoadmitido no código-fonte (comentário do próprio time); 0 ocorrências medidas em produção (não instrumentado — ver seção 2).

### F-availability-2: Gravação de `data_debito` sem transação/compensação com o `criarLote` remoto

- **Severidade**: P2
- **Tactic violada**: Transactions / Rollback
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:449-462`
- **Evidência (objetiva)**:
  ```ts
  // I8b — a data persistida junto da marca d'água, ANTES do POST: a partir do
  // `criarLote` ela está no lote nativo e não muda mais.
  await this.loteRepo.setDataDebito({ loteId: lote.id, dataDebito });
  await this.ledger.setRequestPayload(key, { ... });
  // (1) lote nativo
  const criado = await this.write.criarLote({ ... });
  ```
- **Impacto técnico**: se o processo cair (ou o Lambda/dyno reiniciar) entre `setDataDebito` e a resposta de `criarLote`, `lote_pagamento.data_debito` fica preenchido sem `native_flp_cod` correspondente. Na retomada, `resolverDataDebito` só considera "congelada" quando **ambos** existem (`RemessaService.ts:1053`), então o valor órfão é silenciosamente ignorado e recalculado — não há dano funcional (nenhuma escrita chegou ao ERP), mas o dado fica inconsistente sem log de limpeza.
- **Impacto de negócio**: baixo risco de dano direto (comportamento observado é "recalcula e segue"), mas cria ruído para quem investigar `lote_pagamento` diretamente no banco durante um incidente — o campo `data_debito` pode não refletir o que de fato foi tentado.
- **Métrica de baseline**: não medível localmente (requer fault-injection); 0 testes que simulam crash exatamente entre as duas escritas (os testes existentes de `RemessaService.test.ts` para retomada cobrem falha DEPOIS do `criarLote`, via `RemessaEmDuvidaError`/reconciliação — não o intervalo específico entre `setDataDebito` e `criarLote`).

### F-availability-3: `GET /sispag/lotes/:id/remessa/janela` sem rate limiter, inconsistente com o padrão do arquivo

- **Severidade**: P3
- **Tactic violada**: Exception Prevention
- **Localização**: `src/backend/routes/sispag.ts:442-453` (comparar com `routes/sispag.ts:390-410`, `/contas-pagadoras`)
- **Evidência (objetiva)**:
  ```ts
  router.get(
      '/lotes/:id/remessa/janela',
      asyncHandler(async (req, res) => {
          await bootstrapAppContainer();
          const service = container.resolve(DebitDateService);
          ...
  ```
  (sem `heavyRouteLimiter`, ao contrário de `POST /lotes/:id/remessa`, linha 461, que tem `requireRole('admin'), heavyRouteLimiter`)
- **Impacto técnico**: cada chamada recomputa feriados e itera todos os dias entre `hoje` e o menor vencimento (`DebitDateService.computeWindow`, loop `for (let d = min; d <= max; ...)`); sem limite de taxa, um cliente com token válido pode gerar chamadas repetidas sem custo de rede externo (não toca o ERP), aumentando carga no único processo Node do Render.
- **Impacto de negócio**: risco baixo isoladamente (payload pequeno, sem I/O externo), mas é a única leitura nova do fluxo de remessa sem o guard que as rotas irmãs já adotam nesta mesma revisão de arquivo.
- **Métrica de baseline**: 0 de 1 rotas GET introduzidas por este delta usam `heavyRouteLimiter` (a única rota POST introduzida, sim: 1/1).

### F-availability-4: Fetch da janela de débito no frontend sem retry/backoff

- **Severidade**: P3
- **Tactic violada**: Retry
- **Localização**: `src/frontend/lib/sispag.ts:530-531`; `src/frontend/app/sispag/components/GerarRemessaDialog.tsx:120-135`
- **Evidência (objetiva)**:
  ```ts
  export const fetchJanelaDataDebito = (loteId: string) =>
    sispagRequest<JanelaDataDebito>(`/sispag/lotes/${loteId}/remessa/janela`, { method: 'GET' })
  ```
  ```tsx
  fetchJanelaDataDebito(l.id)
    .then((j) => { ... })
    .catch((e: unknown) => {
      if (vivo) setErroCarga(e instanceof Error ? e.message : 'Falha ao carregar a janela.')
    })
  ```
- **Impacto técnico**: uma falha de rede transitória (comum em VPN/Wi-Fi corporativo) vira um estado de erro definitivo na tela (mitigável fechando/reabrindo o diálogo, que reexecuta o `useEffect`, mas exige ação manual da analista).
- **Impacto de negócio**: fricção operacional pontual no fluxo mais sensível a horário do sistema (o corte bancário diário); não é perda de dado nem de disponibilidade do backend, só UX degradada.
- **Métrica de baseline**: 0 tentativas de retry configuradas (`grep -rn "retry\|backoff" src/frontend/lib/sispag.ts src/frontend/app/sispag/components/GerarRemessaDialog.tsx` → nenhum resultado).

## 5. Cards Kanban

### [availability-1] Cobrir feriados bancários por praça no `BankingCalendar`

- **Problema**
  > O `BankingCalendar` só cobre feriados nacionais (fixos + móveis via Páscoa); feriados municipais/estaduais e 31/12 estão fora de escopo (`BankingCalendar.ts:36`). Uma conta pagadora numa praça com feriado local pode ter uma data aceita pela janela I8a e recusada pelo Conexos na hora do `finalizarLote`.

- **Melhoria Proposta**
  > Estender `BankingCalendar.holidays(year)` para aceitar uma praça (ex.: código da agência/conta pagadora) e uma tabela de feriados municipais/estaduais — carregada de configuração (SSM/planilha versionada), não hardcoded no algoritmo. Tactic alvo: Exception Prevention. Tocar `BankingCalendar.ts`, `DebitDateService.computeWindow` (passar a praça da conta pagadora escolhida) e a origem de dados da tabela.

- **Resultado Esperado**
  > `isBusinessDay`/`holidays` aceitam a praça da conta pagadora; janela I8a nunca sugere um dia que a praça real não trabalha. Métrica: cobertura de feriados de praça 0% → 100% das praças usadas pelas contas pagadoras cadastradas.

- **Tactic alvo**: Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Feriados de praça cobertos: 0 → 100% das praças com conta pagadora ativa
  - Rejeições do ERP por `flpDtaCredito` em feriado de praça: desconhecido hoje → instrumentado e tendendo a 0
- **Risco de não fazer**: em 6 meses, cada nova filial/conta pagadora numa praça com calendário próprio reintroduz o mesmo sintoma que a ADR-0049 já corrigiu para o caso nacional — a analista volta a perder uma tentativa de remessa perto do corte bancário.
- **Dependências**: nenhuma.

### [availability-2] Logar/instrumentar `data_debito` órfão (persistido sem `native_flp_cod`)

- **Problema**
  > `setDataDebito` grava a data no Postgres antes de chamar `criarLote` no fin015 (write-ahead correto), mas se o processo cair entre as duas chamadas, o valor fica órfão — sem `native_flp_cod` — e é silenciosamente recalculado na próxima tentativa, sem nenhum log que sinalize a inconsistência (`RemessaService.ts:449-462,1049-1057`).

- **Melhoria Proposta**
  > Em `resolverDataDebito`, quando `flpCodExistente` é `undefined` mas `lote.dataDebito` já está preenchido (o sinal do órfão), emitir `logService.warn` com `loteId`/`dataDebito anterior`/`dataDebito recalculada` antes de seguir. Tactic alvo: Condition Monitoring. Tocar `RemessaService.ts` (método `resolverDataDebito`).

- **Resultado Esperado**
  > Toda ocorrência de `data_debito` órfã fica visível no log estruturado (grep-ável, e instrumentável em dashboard quando a infra existir), em vez de silenciosa. Métrica: cobertura de log do cenário órfão 0% → 100%.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Cenário "órfão detectado e logado": 0% → 100% dos casos em que `flpCodExistente === undefined && lote.dataDebito !== undefined`
- **Risco de não fazer**: uma investigação futura de incidente lendo `lote_pagamento.data_debito` direto no banco pode concluir erroneamente que essa foi a data efetivamente usada no ERP, quando na verdade foi substituída numa tentativa seguinte.
- **Dependências**: nenhuma.

### [availability-3] Uniformizar rate limiting nas leituras sensíveis do fluxo de remessa

- **Problema**
  > `GET /sispag/lotes/:id/remessa/janela` (rota nova desta feature) não usa `heavyRouteLimiter`, diferente da rota irmã de escrita (`POST .../remessa`) e do precedente já registrado no mesmo arquivo para `/contas-pagadoras` ("leitura de conta corrente não é menos sensível que escrita" — `routes/sispag.ts:395-400`).

- **Melhoria Proposta**
  > Aplicar `heavyRouteLimiter` (ou um limiter mais leve dedicado a leituras) na rota `/lotes/:id/remessa/janela`, mantendo a ausência de `requireRole('admin')` se a leitura for de fato equivalente às demais leituras de lote (decisão a confirmar com o time, não assumida aqui). Tactic alvo: Exception Prevention. Tocar `routes/sispag.ts`.

- **Resultado Esperado**
  > Rotas GET novas do fluxo de remessa com limiter: 0/1 → 1/1, alinhado ao padrão do arquivo.

- **Tactic alvo**: Exception Prevention
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Rotas GET novas com rate limiter: 0/1 → 1/1
- **Risco de não fazer**: baixo isoladamente; acumula inconsistência de política entre rotas do mesmo arquivo, dificultando auditoria futura.
- **Dependências**: nenhuma.

### [availability-4] Retry com backoff no fetch da janela de débito (frontend)

- **Problema**
  > `fetchJanelaDataDebito` é uma chamada única sem retry; uma falha de rede transitória vira um erro definitivo na tela do diálogo "Gerar remessa" (`GerarRemessaDialog.tsx:120-135`), exigindo que a analista feche e reabra o diálogo manualmente para tentar de novo.

- **Melhoria Proposta**
  > Envolver a chamada em um pequeno helper de retry com backoff (1-2 tentativas, delay curto) no `lib/sispag.ts`, reaproveitando o padrão de `RetryExecutor` do backend como referência de contrato (mesmo que a implementação do frontend seja mais simples). Tactic alvo: Retry. Tocar `src/frontend/lib/sispag.ts` (`fetchJanelaDataDebito`) e, se necessário, `GerarRemessaDialog.tsx`.

- **Resultado Esperado**
  > Uma falha de rede isolada não interrompe mais o fluxo sem tentativa automática. Métrica: tentativas automáticas de retry em `fetchJanelaDataDebito` 0 → ≥1 antes de reportar erro definitivo.

- **Tactic alvo**: Retry
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Retries automáticos configurados: 0 → ≥1
- **Risco de não fazer**: fricção operacional recorrente em rede instável; não é um risco de disponibilidade do sistema, só de experiência.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo limitado ao delta (`git diff origin/main...HEAD`), conforme instrução; tactics e código pré-existentes (advisory lock, ledger `remessa_execucao`, reconciliação com o ERP, `RetryExecutor`/`FallbackExecutor`/`PollExecutor` genéricos) foram citados só como contexto de reuso, não avaliados como se fossem novos.
- Nenhum P0/P1 encontrado com evidência numérica de defeito crítico dentro deste delta — o achado mais próximo de risco real (F-availability-2, gravação não-transacional) foi classificado P2 porque o comportamento observado no código é "recalcula e segue" (sem dano funcional), não perda de dado nem escrita duplicada.
- Conexão cross-QA: F-availability-3 (rota GET sem `requireRole`/rate limit) é também candidata a achado de `qa-security` — não duplicar, só referenciar o mesmo trecho (`routes/sispag.ts:442-453`).
- `infra/`, CloudWatch e DLQ não existem neste repositório (confirmado no `CLAUDE.md` e por ausência de diretório) — todas as métricas que dependeriam disso foram marcadas como não medíveis localmente, não como "ausente" por decisão de arquitetura.
