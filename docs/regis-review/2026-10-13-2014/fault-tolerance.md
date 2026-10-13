---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-13-2014
agent: qa-fault-tolerance
generated_at: 2026-10-13T20:30:00-03:00
scope: backend
score: 8
findings_count: 5
cards_count: 4
---

# Fault Tolerance — Regis-Review (delta `5a17d3e..HEAD`, sispag-dda-na-ingestao)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Cron 07h/12h/16h, abertura de tela (TTL 30 min) ou botão manual | `fin124` lento, indisponível (403/5xx) ou com schema alterado durante a sincronização do pool DDA dentro da ingestão | `IngestaoPagamentosService.sincronizarDda` -> `BoletoDdaService.sincronizar` -> `BoletoDdaRepository.salvarArquivo` | Produção, robô Conexos com cap de sessões, pool PG com 5 conexões | A ingestão de títulos conclui; o pool anterior é mantido; cada arquivo é gravado inteiro ou nada; a degradação fica visível (`dda.estado`, `error_message`, WARN); nenhuma decisão de dinheiro depende do pool | 0 ingestões derrubadas por falha DDA; 0 arquivos meio-gravados; 0 remessas decididas com base no pool; ingestão ≤ 60 s + arquivos em voo |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Falha/lock/prazo DDA derruba a ingestão | 0 caminhos (`catch` captura tudo; `IngestLockBusyError` -> `ocupada`) | 0 | ✅ | `IngestaoPagamentosService.ts` `sincronizarDda` (diff) |
| Atomicidade por arquivo DDA | 1 transação (upsert arquivo + DELETE órfãos + upsert itens) | 1 tx/arquivo | ✅ | `BoletoDdaRepository.ts:48-75` |
| Idempotência do re-sync | UPSERT por `ddc_cod`/`dit_cod` + DELETE por `NOT ANY` (reaplicável); arquivo com falha continua "desconhecido" e volta como novo | idempotente | ✅ | `BoletoDdaRepository.ts`, `BoletoDdaService.ts:119-140` |
| Decisão de dinheiro validada ao vivo no envio | 1 de 1: `listarTitulosPendentes` (fin064 ao vivo) -> `temBoletoDda` -> `BoletoSemCodigoBarrasError` | 100% | ✅ | `RemessaService.ts:1030-1080` |
| Leituras de `boleto_dda` na remessa | 0 (`RemessaService` não importa BoletoDda*) | 0 | ✅ | `grep -n "boleto_dda\|BoletoDda" RemessaService.ts` -> vazio |
| `doc_esp_numero` preservado por COALESCE | sim (`COALESCE(EXCLUDED, atual)`) | sim | ✅ | `TituloAPagarRepository.ts:133` |
| Deadlock entre locks | 0 possíveis: ambos `pg_try_advisory_lock` (não bloqueante), ordem única ingestão(726354819) -> DDA(726354820); DDA nunca toma o da ingestão | 0 | ✅ | `PostgreeDatabaseClient.ts:210-231`, grep de `*_LOCK_KEY` |
| Folga do pool PG durante a fase DDA | 5 conexões (max) - 2 locks - 3 tx concorrentes (`FANOUT_LIMIT=3`) = **0 de folga** (antes: 1) | >= 1 | ⚠️ | `PostgreeDatabaseClient.ts:37`, `BoletoDdaService.ts:29` |
| Timeout duro em chamadas `fin124` | 0 encontrados (`ConexosDdaClient`/`ConexosBaseClient`: grep `timeout\|AbortSignal` vazio) | 100% | ⚠️ | grep nos dois arquivos |
| Prazo de 60 s é duro | não: checado só ao INICIAR cada arquivo; em voo termina sem limite (até 3 arquivos x até 60 páginas x retry) | duro | ⚠️ | `BoletoDdaService.ts:138` |
| Guarda de sanidade em `listarItens` | 0 (`safeParse` falho = linha descartada em silêncio; lista vazia dispara `DELETE ... NOT ANY('{}')` = apaga o arquivo) | >= 1 | ⚠️ | `ConexosDdaClient.ts:83-86`, `BoletoDdaRepository.ts:67-70` |
| Testes do delta cobrindo falha/ocupada/parcial | 4 casos DDA na ingestão + 3 no `BoletoDdaService` | cobrir 4 estados | ✅ | `IngestaoPagamentosService.test.ts`, `BoletoDdaService.test.ts` |
| Stuck-state reaper / reconciliação ERP | não medido neste delta (fora do escopo; pré-existente) | presente | ⚠️ não avaliado | n/a |

> Não medível localmente: p95 real da fase DDA em produção (a ADR cita "a medir em produção"). Recomendação: gravar `duracaoMs` do passo DDA na run.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Zod nas linhas do `fin124`, mas linha inválida some em silêncio e resposta vazia é tratada como "arquivo vazio" | ⚠️ parcial | `ConexosDdaClient.ts:83` |
| Timeout | Prazo lógico de 60 s antes de iniciar arquivo; sem timeout em chamada em voo | ⚠️ parcial | `BoletoDdaService.ts:138` |
| Condition Monitoring | `dda.estado`, WARN, `error_message` da run, aviso de pool > 8 h na aba | ✅ presente | `IngestaoPagamentosService.ts` `avisoDaRun`; `ddaDefasado.ts` |
| Timestamp | `sincronizado_em` por arquivo; `ultimaSincronizacao` exposta | ✅ presente | `BoletoDdaRepository.ts:131` |
| Recovery (forward) | Falha DDA -> mantém pool anterior; arquivo falho retenta como "novo" na próxima rodada | ✅ presente | `sincronizarDda`; `executarSincronizacao` |
| Rollback | Transação por arquivo (`withTransaction`) | ✅ presente | `salvarArquivo` |
| Idempotent Replay | UPSERT + DELETE por conjunto; COALESCE em `doc_esp_numero` | ✅ presente | `TituloAPagarRepository.ts:130-133` |
| Quarantine / Degradação | Lock ocupado -> `ocupada` (sem aviso); prazo -> `parcial` | ✅ presente | `sincronizarDda` |
| Compensating Transaction | N/A: nenhuma escrita no ERP nesta mudança (read-only `fin124`) | N/A | ADR-0067 "Não muda" |
| Comparison / Voting | Decisão de dinheiro reconferida ao vivo (fin064) no envio, independente do pool | ✅ presente | `RemessaService.ts:1030-1080` |
| Reconcile / Stuck-state | Ausente para o pool (só aviso visual > 8 h na aba; nenhum alarme server-side) | ⚠️ parcial | ADR-0067 §5 |

## 4. Findings

### F-fault-tolerance-1: prazo de 60 s é "soft" e sem timeout nas chamadas em voo; acopla a ingestão a `fin124`

- **Severidade**: P2
- **Tactic violada**: Timeout
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:135-142`; `src/backend/domain/client/ConexosDdaClient.ts:112-143`
- **Evidência (objetiva)**:
  ```
  if (limite !== undefined && Date.now() > limite) return null;   // só antes de iniciar
  const itens = await this.dda.listarItens(...)                    // sem timeout; até 60 páginas x 1000
  ```
- **Impacto técnico**: uma chamada pendurada em `fin124` mantém o lock da ingestão (726354819) e a run em `running`; o limite real é 60 s + (3 arquivos em voo x MAX_PAGINAS 60 x retry). Antes do delta a carteira não dependia de `fin124`.
- **Impacto de negócio**: a carteira SISPAG (3 cargas/dia + abertura de tela) pode ficar sem atualizar por causa de um acessório; a tela mostra "em andamento" por até `RUN_PRESA_MS` = 10 min.
- **Métrica de baseline**: 0 timeouts duros na chamada; orçamento declarado 60 s vs ingestão típica ~10 s (6x).

### F-fault-tolerance-2: folga de pool PG zero durante a fase DDA

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring / Redundancy (capacidade)
- **Localização**: `PostgreeDatabaseClient.ts:37,210-231`; `BoletoDdaService.ts:29`
- **Evidência (objetiva)**:
  ```
  poolMaxConnections = 5 ; FANOUT_LIMIT = 3
  ingestão (1 client p/ lock) + DDA (1 client p/ lock) + 3 x salvarArquivo (withTransaction) = 5/5
  ```
- **Impacto técnico**: sem deadlock (locks não bloqueantes, ordem única), mas qualquer outra requisição (painel, tela abrindo, que é justamente quem dispara a ingestão) espera até `poolConnectionTimeoutMillis` = 5 s e pode estourar. Janela curta (transações de ms), mas coincide com o horário de uso da tela.
- **Impacto de negócio**: erro intermitente de 5xx na abertura da tela SISPAG logo depois de um sync DDA.
- **Métrica de baseline**: folga 0/5 (era 1/5 no botão manual: 1 lock + 3 tx).

### F-fault-tolerance-3: arquivo DDA com itens ilegíveis ou lista vazia é gravado como "vazio" e apaga os boletos existentes

- **Severidade**: P2
- **Tactic violada**: Sanity Checking
- **Localização**: `ConexosDdaClient.ts:83-86`; `BoletoDdaRepository.ts:67-70`
- **Evidência (objetiva)**:
  ```
  if (parsed.success) itens.push(...)   // falha de parse: descarta, sem contar
  DELETE FROM boleto_dda WHERE ddc_cod=$1 AND NOT (dit_cod = ANY($2))   // $2 = [] apaga tudo do arquivo
  ```
- **Impacto técnico**: drift de schema do `fin124` (ou resposta degradada com 200 e `rows: []`) em um arquivo relido resulta em `total_itens=0`, `status` sucesso e perda dos boletos do arquivo; agora acontece sem humano, na janela de 60 dias, 3x/dia. O ADR-0040 isola o dinheiro (validação ao vivo no envio), então o dano é de casamento/aba (falso "boleto sem DDA"), recuperável na próxima leitura sã.
- **Impacto de negócio**: candidatos de boleto somem da aba e do casamento até a próxima sincronização saudável; analista vê "sem DDA" falso.
- **Métrica de baseline**: 0 guardas; janela de releitura 60 d x pool ~160 arquivos x >= 3 execuções/dia (contra 0 automáticas antes).

### F-fault-tolerance-4: DDA parcial/falho vira "sucesso" e a carteira é considerada fresca por 30 min; sem sinal server-side persistente

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring
- **Localização**: `IngestaoPagamentosService.ts` (`avisoDaRun`, `runRepo.finishRun status:'success'`); `CarteiraAtualizacaoService.ts:78`
- **Evidência (objetiva)**:
  ```
  status: 'success' + errorMessage: "pool DDA falhou (...)"      // único sinal persistido
  findLatestSuccessFinishedAt() < ttl (30 min) -> ESTADO_CARTEIRA.FRESCA
  ```
- **Impacto técnico**: `ocupada` é silencioso por desenho; falha persistente do DDA (ex.: 403 do robô, já ocorrido com `titulosPendentes`) só aparece como texto em `error_message` e `::warning::` do cron; não há contador de falhas consecutivas nem alerta. A defesa efetiva é o aviso visual > 8 h na aba.
- **Impacto de negócio**: pool parado por 1 dia útil até alguém olhar a aba (repete o incidente de 08/10 -> 13/10, só que com sinal fraco).
- **Métrica de baseline**: 1 sinal (aviso visual, limiar 8 h); 0 alarmes server-side; incidente de origem: 5 dias parado.

### F-fault-tolerance-5: arquivos adiados por prazo (relidos) ficam sem trilha persistida

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring / Timestamp
- **Localização**: `BoletoDdaService.ts:119-146`
- **Evidência (objetiva)**:
  ```
  alvo = [...novos, ...relidos]; arquivosAdiados só vai ao resultado/log, não à run
  ```
- **Impacto técnico**: relidos (vínculo ERP com título é atualizado depois da importação) são sempre atrás dos novos; em carga inicial grande podem ser adiados por várias rodadas sem métrica persistida. Convergência existe (novos acabam), mas não é observável.
- **Impacto de negócio**: vínculos recém-feitos no ERP demoram a aparecer na aba; baixo.
- **Métrica de baseline**: 0 campos persistidos de `arquivosAdiados` (só log + `error_message` texto).

## 5. Cards Kanban

### [fault-tolerance-1] Impor timeout duro à fase DDA dentro da ingestão

- **Problema**
  > O prazo de 60 s só é checado antes de iniciar cada arquivo; chamadas `fin124` em voo não têm timeout e a fase mantém o lock da ingestão. A carteira passou a depender de um acessório sem teto real.

- **Melhoria Proposta**
  > Envolver `sincronizarDda` em `Promise.race` com teto absoluto (ex.: 90 s) e `AbortSignal`/timeout por página em `ConexosDdaClient.listarTudo`, convertendo estouro em `parcial`/`falhou` (Timeout). Tocar `IngestaoPagamentosService.sincronizarDda`, `ConexosDdaClient`.

- **Resultado Esperado**
  > Pior caso da fase DDA limitado e testado: hoje sem limite -> <= 90 s; carteira nunca fica presa por `fin124`.

- **Tactic alvo**: Timeout
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Timeouts duros na fase DDA: 0 -> 1 por chamada e 1 global
  - Duração máxima da fase DDA: ilimitada -> <= 90 s
- **Risco de não fazer**: uma lentidão do `fin124` trava a atualização da carteira em horário de pagamento.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Recuperar folga do pool durante a fase DDA

- **Problema**
  > Lock da ingestão + lock DDA + 3 `salvarArquivo` concorrentes consomem 5/5 conexões do pool, sem folga para requisições da tela que dispara a ingestão.

- **Melhoria Proposta**
  > Reduzir `FANOUT_LIMIT` para 2 quando `prazoMs` estiver presente (modo ingestão), ou subir `poolMaxConnections` para 8 se o pooler permitir. Documentar a conta do pool ao lado da constante.

- **Resultado Esperado**
  > Folga de pool 0/5 -> >= 1 conexão durante a fase DDA.

- **Tactic alvo**: Redundancy (capacidade) / Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Conexões livres no pior instante: 0 -> >= 1
- **Risco de não fazer**: erros 5xx intermitentes na abertura da tela, difíceis de reproduzir.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Barrar substituição de arquivo DDA por lista vazia ou parse parcial

- **Problema**
  > `listarItens` descarta linhas inválidas em silêncio e `salvarArquivo` com lista vazia apaga todos os boletos do arquivo; agora a releitura é automática 3x/dia.

- **Melhoria Proposta**
  > Em `listarItens`, contar linhas rejeitadas e lançar erro se rejeitadas > 0 (ou razão alta); em `executarSincronizacao`, se `itens.length === 0` e o arquivo já tinha `total_itens > 0`, tratar como falha (arquivo preservado, conta em `falhas`). Sanity Checking + Repair State.

- **Resultado Esperado**
  > Drift de schema não apaga o pool: arquivos apagados por resposta vazia/ilegível 0 por incidente (hoje sem guarda).

- **Tactic alvo**: Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Guardas contra substituição vazia: 0 -> 2 (parse e vazio-sobre-cheio)
  - Teste de regressão: 0 -> 1 por guarda
- **Risco de não fazer**: uma mudança de layout do Conexos esvazia o pool em silêncio e a aba mostra "boleto sem DDA" até alguém notar.
- **Dependências**: nenhuma.

### [fault-tolerance-4] Persistir contagem de DDA adiado/falho e alertar em falha consecutiva

- **Problema**
  > DDA falho ou parcial só aparece como texto em `error_message` de uma run `success`; a carteira fica "fresca" por 30 min e não há alarme server-side se o pool não avança.

- **Melhoria Proposta**
  > Gravar `dda_estado` e `dda_arquivos_adiados` na run (coluna ou JSON) e alertar quando N runs consecutivas não terminarem `sincronizado` ou `ultimaSincronizacao` passar de 8 h em dia útil (reutilizar o `StalenessDetector`). Condition Monitoring.

- **Resultado Esperado**
  > Pool parado detectado pelo servidor em <= 1 ciclo de cron (hoje depende de alguém abrir a aba após 8 h).

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-4, F-fault-tolerance-5
- **Métricas de sucesso**:
  - Sinais server-side de pool defasado: 0 -> 1
  - Tempo de detecção: 5 dias (incidente de 08-13/10) -> <= 1 ciclo de cron (~4-5 h)
- **Risco de não fazer**: repetição do incidente de 5 dias com sinal fraco.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Verificado no código: a decisão que move dinheiro não lê o pool. `RemessaService` relê o fin064 ao vivo (`listarTitulosPendentes`) e usa `temBoletoDda` do ERP; boleto sem DDA vivo falha alto (`BoletoSemCodigoBarrasError`). Pool desatualizado ou parcial só afeta aba/casamento. Observação fora do delta: `FormacaoLotesService` agrupa por `temBoleto` persistido (flag do ERP lido na ingestão), pré-existente; o delta apenas encurta a defasagem.
- Locks: sem deadlock possível (`pg_try_advisory_lock` não bloqueante, ordem fixa, unlock em `finally`); contenção gera `ocupada`, que é correto. Sessão de lock em pooler transaction-mode é risco pré-existente, não do delta.
- COALESCE confirmado: `doc_esp_numero` não é zerado por rodada sem o campo (efeito colateral aceito: o ERP não consegue limpá-lo). Migration 0083 aditiva e nullable, sem reverse necessário.
- Cross-QA: F-1 e F-2 -> Availability/Performance; F-4 -> Security/Auditabilidade (trilha na run); F-3 -> Testability (teste de regressão).
