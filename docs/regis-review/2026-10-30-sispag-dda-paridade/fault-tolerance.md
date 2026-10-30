---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-30-sispag-dda-paridade
agent: qa-fault-tolerance
generated_at: 2026-10-30T00:00:00Z
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos `fin124` (DDA) | respostas intermitentes: lentidão, 504, lista vazia, novo arquivo com muitos itens | `BoletoDdaService.sincronizar` + `ConsolidacaoBoletoDdaCache` + snapshot em `boleto_dda*` | passada disparada por ingestão (10 s de orçamento) ou botão (60 s) | sync NÃO apaga snapshot em caso de resposta vazia; passada sempre devolve resumo em ≤ 60 s; cache invalidado ao fim de toda sync; falhas e adiamentos contados em separado | `arquivosLidos` = `alvo − falhas − adiados`; 0 incidente de "pool DDA zerado" por resposta vazia; p99 da sync manual ≤ 60 s |

> O risco financeiro aqui é indireto, mas real: um pool DDA zerado ou envelhecido por 60 dias faz a aba Boletos DDA e o flag `temBoleto` da carteira mentirem — a análise manual vê "sem boleto" e aprova um pagamento sem o código de barras, que o banco recusa na remessa.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Guard `fin124` vazio preserva snapshot | presente, lança `EmptyDdaFileError` antes de qualquer escrita | presente | ✅ | `src/backend/domain/repository/sispag/BoletoDdaRepository.ts:52-65` |
| Prazo da sync manual | 60 000 ms (`BOLETO_DDA_PRAZO_MS`) | ≤ orçamento HTTP, > tempo médio de leitura | ✅ | `src/backend/domain/service/sispag/BoletoDdaService.ts:42-47`; `src/backend/routes/sispag.ts:1616-1623` |
| Advisory lock exclusivo da sync DDA | `726354820`, distinto da ingestão (`726354819`) | distinto por domínio | ✅ | `BoletoDdaService.ts:33`; `IngestaoPagamentosService.ts:36` |
| Invalidação dos caches após sync | `sugestoesCache.invalidar()` + `consolidadoCache.invalidar()` em `finally` dentro do lock | sempre, mesmo em falha parcial | ✅ | `BoletoDdaService.ts:166-174` |
| Single-flight no `ConsolidacaoBoletoDdaCache` | `emVoo` + geração para descartar escrita obsoleta | presente | ✅ | `ConsolidacaoBoletoDdaCache.ts:54-72` |
| Falha de uma listagem não é cacheada | não entra em `entradas`, remove de `emVoo` no `finally` | presente | ✅ | `ConsolidacaoBoletoDdaCache.ts:65-72` |
| TTL do cache de consolidação | 30 000 ms | curto o suficiente para não mascarar sync externa | ✅ | `ConsolidacaoBoletoDdaCache.ts:5` |
| Contagens pós-sync (`arquivosLidos`, `falhas`, `arquivosAdiados`) | derivadas da resposta de cada tarefa; `arquivosLidos = alvo − falhas − adiados` | exatas | ✅ | `BoletoDdaService.ts:217-234` |
| Alerta ao operador quando `fin124` devolve vazio e snapshot tem itens | somente `BUSINESS_INFO` ("falha ao ler arquivo do fin124") agrupado com qualquer outra falha | WARN agregado, com identidade do arquivo | ⚠️ | `BoletoDdaService.ts:224-233` |
| Priorização de `arquivosAdiados` na próxima passada | nenhuma — a ordem de `listarArquivos` é a mesma; os mesmos arquivos novos podem ser lidos antes dos adiados | adiados primeiro, para não ficarem indefinidamente nos últimos 15 % do batch | ⚠️ | `BoletoDdaService.ts:200-215` |
| Reconciliação pool local ↔ `fin124` (snapshot stale) | releitura por 60 dias; depois disso o arquivo é mantido sem releitura; `EmptyDdaFileError` repetido mantém dado antigo "para sempre" sem alerta de staleness | janela + detector de staleness por `sincronizado_em` | ⚠️ | `BoletoDdaService.ts:38-42,200-213` |
| Teste de concorrência do cache | presente — duas listagens em paralelo compartilham a execução | presente | ✅ | `BoletoDdaService.test.ts:349-367` |

> ⚠️ **Não medível localmente**: taxa real de respostas vazias do `fin124` em PRD. Requer um painel de logs filtrado por `BUSINESS_INFO` com `message = 'sincronização DDA: falha ao ler arquivo do fin124'` e `erro` começando com `DDA_FILE_EMPTY`. Recomendação: separar `BUSINESS_WARN` para o caso `EmptyDdaFileError` (ver F-fault-tolerance-1) e expor contagem semanal.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | guard `EmptyDdaFileError` antes de `DELETE … NOT (dit_cod = ANY(…))`; a resposta "vazia" do ERP é tratada como suspeita, não como verdade | ✅ | `BoletoDdaRepository.ts:52-65` |
| Timeout | sync manual com `prazoMs = 60_000`; ingestão com o mesmo prazo via `DDA_PRAZO_NA_INGESTAO_MS`; passada sempre devolve resumo | ✅ | `BoletoDdaService.ts:42-47,203-213`; `IngestaoPagamentosService.ts:34,203-212` |
| Comparison | `arquivosLidos` vs `alvo.length` e `falhas` vs `arquivosAdiados` publicam a saúde da passada | ✅ | `BoletoDdaService.ts:217-234` |
| Condition Monitoring | log `BUSINESS_INFO` da sync concluída inclui `triggeredBy` e contagens; `IngestaoPagamentosService.avisoDaRun` propaga o estado DDA (`PARCIAL`/`FALHOU`) para a run | ✅ | `BoletoDdaService.ts:238-244`; `IngestaoPagamentosService.ts:328-342` |
| Voting | N/A — fonte única (`fin124`); não há como votar entre réplicas. | N/A | — |
| Self-Test | nenhum healthcheck que verifica o pool recentemente sincronizado (ver F-fault-tolerance-3) | ⚠️ parcial | — |
| Redundancy (State) | `boleto_dda_arquivo.sincronizado_em` + snapshot local permitem seguir operando mesmo com o `fin124` fora | ✅ | `BoletoDdaRepository.ts` |
| Rollback | transação por arquivo em `salvarArquivo` (arquivo + itens atômicos) | ✅ | `BoletoDdaRepository.ts:47-85` |
| Idempotent Replay | upsert por `(ddc_cod, dit_cod)` + reread da releitura por 60 dias; passadas repetidas convergem | ✅ | `BoletoDdaRepository.ts:88-116` |
| Reintroduction (Shadow) | `BoundedConcurrency` com `FANOUT_LIMIT = 3`; sync é read-only no ERP, sem efeito colateral monetário | ✅ | `BoletoDdaService.ts:34,200-215` |
| Reconcile | releitura de 60 dias e invalidação do cache no final da sync; falta reconciliação periódica para arquivos > 60 dias que nunca convergiram (ver F-fault-tolerance-3) | ⚠️ parcial | `BoletoDdaService.ts:38-42` |
| Compensating Transaction | N/A — sync é somente leitura; não há escrita externa a compensar. | N/A | — |
| Quarantine | arquivo cancelado pelo ERP sai pelo flag `cancelado_em`, não é apagado | ✅ | `BoletoDdaRepository.ts:52-54,122-131` |
| Substitution / Replacement / Predictive Model / Increase Competence Set | N/A — não há componente redundante ou crítico que justifique esses tactics na sync do DDA. | N/A | — |

## 4. Findings (achados)

### F-fault-tolerance-1: `EmptyDdaFileError` é agregado em `BUSINESS_INFO` genérico — divergência silenciosa

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:217-233`
- **Evidência (objetiva)**:
  ```ts
  falhas += 1;
  await this.logService.warn({
      type: LOG_TYPE.BUSINESS_INFO, // nível INFO, mensagem genérica
      message: 'sincronização DDA: falha ao ler arquivo do fin124',
      data: { ddcCod: alvo[i]?.ddcCod,
          erro: r.reason instanceof Error ? r.reason.message : String(r.reason) },
  });
  ```
  O guard do `BoletoDdaRepository` lança `EmptyDdaFileError` com `code = 'DDA_FILE_EMPTY'`, mas o serviço empacota todas as falhas num só `BUSINESS_INFO` sem distinguir o caso "ERP devolveu vazio para arquivo com N itens em snapshot" das falhas HTTP/transientes. O `code` não é propagado.
- **Impacto técnico**: um arquivo que persistentemente devolve vazio no `fin124` nunca é visível como classe à parte; o snapshot envelhece indefinidamente dentro da janela de 60 dias e some de releitura depois disso (mantido eterno sem alerta). Fora do pool fica indistinguível de falha de rede.
- **Impacto de negócio**: a aba "Boletos DDA" e o flag `temBoleto` da carteira passam a refletir dados velhos; a analista pode aprovar remessa sem código de barras, que o banco recusa (I15s / ADR-0079).
- **Métrica de baseline**: 0 % das ocorrências de `DDA_FILE_EMPTY` propagam o `code` para o log; 100 % entram como `BUSINESS_INFO` em `IngestaoPagamentosService.avisoDaRun` como "pool DDA parcial" indiferenciado.

### F-fault-tolerance-2: `arquivosAdiados` não têm prioridade na próxima passada — risco de inanição

- **Severidade**: P2
- **Tactic violada**: Reconcile
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:200-215`
- **Evidência (objetiva)**:
  ```ts
  const novos  = arquivos.filter((a) => !conhecidos.has(a.ddcCod));
  const relidos = arquivos.filter(
      (a) => conhecidos.has(a.ddcCod) && (a.importadoEm ?? 0) >= corte,
  );
  const alvo: ArquivoDda[] = [...novos, ...relidos];
  // ...
  if (limite !== undefined && Date.now() > limite) return null; // adiado
  ```
  A ordem de `alvo` é determinada pela ordem retornada pelo `fin124`. Em um dia com muitos "novos", o budget de 10 s (ingestão) pode drenar antes de chegar nos relidos; os mesmos relidos ficam para o fim da fila na passada seguinte, atrás de novos arquivos do dia.
- **Impacto técnico**: um conjunto de relidos "azarados" pode ficar adiado em sequência de passadas, enquanto a aba exibe sincronizado_em recente para os outros arquivos (falso senso de frescor global).
- **Impacto de negócio**: boletos "a vencer" podem não aparecer na aba a tempo da próxima remessa; a analista precisa clicar manualmente em "Atualizar DDA" para forçar o recovery, o que é discoverable, mas não automático.
- **Métrica de baseline**: hoje a persistência do adiamento não é medida; a métrica "idade mediana do pior arquivo adiado" não existe no log.

### F-fault-tolerance-3: ausência de self-test / staleness alarm sobre `sincronizado_em`

- **Severidade**: P2
- **Tactic violada**: Self-Test
- **Localização**: `src/backend/domain/repository/sispag/BoletoDdaRepository.ts:135-141`, `src/backend/domain/service/sispag/BoletoDdaService.ts:85-109`
- **Evidência (objetiva)**: `repo.ultimaSincronizacao()` devolve o `max(sincronizado_em)` do arquivo e é usado só para exibição ("sincronizadoEm" na resposta) e para a chave do cache. Nenhum job periódico compara esse valor com `now()` e emite WARN quando ele passa de um limiar (p.ex., > 3 h sem sync bem-sucedida). O cron hoje depende exclusivamente da ingestão de pagamentos (que também pode estar em `IngestLockBusyError` ou `FALHOU`).
- **Impacto técnico**: se a ingestão parar (lock bloqueado, erro recorrente, cron pausado) e ninguém clicar "Atualizar DDA", o pool envelhece sem sinal explícito ao operador.
- **Impacto de negócio**: equivale ao mesmo risco de F-fault-tolerance-1 (pool envelhecido → falso "sem boleto" → remessa recusada), mas por causa raiz distinta.
- **Métrica de baseline**: nenhum alarme sobre `now() - max(sincronizado_em)`; cobertura: 0 %.

### F-fault-tolerance-4: `ConsolidacaoBoletoDdaCache` é por processo, sem invalidação cross-réplica

- **Severidade**: P3
- **Tactic violada**: State Resync (Reintroduction)
- **Localização**: `src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.ts:1-93`
- **Evidência (objetiva)**: o cache está marcado como `@singleton() @injectable()`, com documentação explícita "LIMITE ASSUMIDO: por processo". Se o backend for escalado para N réplicas (hoje roda em instância única no Render — fora do escopo imediato), um `sincronizar` em uma réplica não invalida as outras; o TTL de 30 s limita o estrago.
- **Impacto técnico**: janela de 30 s em que listagens de réplicas que não receberam a chamada de sync podem servir uma consolidação levemente velha após uma sync disparada em outra réplica. Nenhum efeito monetário — nada que lê daqui move dinheiro.
- **Impacto de negócio**: ergonomia na UI (um F5 pode mostrar o estado anterior por até 30 s). Baixíssimo.
- **Métrica de baseline**: N/A hoje (1 réplica); registrado para quando ADR de escalabilidade for aberto.

## 5. Cards Kanban

### [fault-tolerance-1] Separar `DDA_FILE_EMPTY` em WARN agregado com identidade do arquivo

- **Problema**
  > O guard do repositório lança `EmptyDdaFileError` com `code = 'DDA_FILE_EMPTY'` para proteger o snapshot, mas o serviço de sync empacota essa classe junto com qualquer outra falha de leitura num único `BUSINESS_INFO`. Não dá para distinguir "ERP devolveu vazio" de "504 transitório" nem para contar quantas vezes o mesmo arquivo caiu nessa classe.
- **Melhoria Proposta**
  > No `catch` do `BoundedConcurrency` em `BoletoDdaService.executarSincronizacao`, detectar `error.code === 'DDA_FILE_EMPTY'` e emitir `BUSINESS_WARN` separado, com `ddcCod` e `itensNoSnapshot`. Propagar o `code` em `arquivosFalhasPorCodigo` dentro de `SincronizacaoDdaResultado` para que o `IngestaoPagamentosService.avisoDaRun` registre `pool DDA parcial (DDA_FILE_EMPTY: N arquivos)`. Tactic alvo: Condition Monitoring.
- **Resultado Esperado**
  > Log auditável por classe: 100 % das ocorrências de `DDA_FILE_EMPTY` identificadas como WARN com `ddcCod`; a run da ingestão deixa de confundir falha transitória com divergência estrutural.
- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - % de ocorrências `EmptyDdaFileError` com `code` no log: 0 % → 100 %
  - Mensagem distinta em `avisoDaRun`: ausente → presente
- **Risco de não fazer**: o pool parece saudável enquanto um subconjunto de arquivos nunca é relido com sucesso; nenhum alerta dispara até a remessa do banco cair.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Priorizar `arquivosAdiados` na próxima passada

- **Problema**
  > `alvo = [...novos, ...relidos]` segue a ordem do `fin124`; sob budget apertado (10 s na ingestão), arquivos repetidamente adiados ficam no final de todas as passadas, enquanto novos são sempre atendidos primeiro.
- **Melhoria Proposta**
  > Persistir, em `boleto_dda_arquivo`, uma marca `ultima_tentativa_em` (não confundir com `sincronizado_em`); quando um arquivo é adiado, atualizar a marca sem alterar `sincronizado_em`. No próximo start de sync, ordenar `alvo` por `(ultima_tentativa_em IS NULL DESC, ultima_tentativa_em ASC)` para dar preferência a quem está esperando há mais tempo. Tactic alvo: Reconcile.
- **Resultado Esperado**
  > Idade mediana do arquivo mais atrasado por sync fica limitada a uma passada; nenhum arquivo é adiado em sequência indefinida.
- **Tactic alvo**: Reconcile
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Idade mediana do pior arquivo adiado por passada: desconhecida → medida e ≤ 1 passada
  - Teste cobrindo "adiado por N passadas sobe de posição": ausente → presente
- **Risco de não fazer**: um subconjunto de arquivos pode envelhecer silenciosamente até sair da janela de 60 dias, sem jamais ter sido relido com sucesso.
- **Dependências**: nenhuma; migration pequena no `boleto_dda_arquivo`.

### [fault-tolerance-3] Alarme de staleness sobre `max(sincronizado_em)`

- **Problema**
  > Nenhum componente observa a idade da última sync DDA bem-sucedida. Se a ingestão de pagamentos pular/falhar e a analista não clicar "Atualizar DDA", o pool envelhece sem alerta — e as decisões da aba (incluindo o flag `temBoleto` da carteira) passam a mentir.
- **Melhoria Proposta**
  > Introduzir um probe (job periódico ou healthcheck invocado pelo painel-operacao) que compara `now() - repo.ultimaSincronizacao()` com um limite (p.ex. 3 h em horário comercial BRT) e emite `BUSINESS_WARN` quando ultrapassa. Expor o número na mesma tela que já mostra `sincronizadoEm`. Tactic alvo: Self-Test.
- **Resultado Esperado**
  > Staleness do pool é observável antes do incidente; cobertura passa de 0 % para 100 % dos cenários "sem sync há > N horas".
- **Tactic alvo**: Self-Test
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3, F-fault-tolerance-1 (ambos atacam a mesma classe de risco por caminhos diferentes)
- **Métricas de sucesso**:
  - Cobertura de alarme de staleness: 0 % → 100 %
  - Tempo de detecção de "sem sync" após N horas: indefinido → ≤ 1 ciclo do probe
- **Risco de não fazer**: pool envelhecido continua sendo descoberto só quando o banco recusa a remessa.
- **Dependências**: nenhuma; alinhar o limiar com o cron da ingestão.

### [fault-tolerance-4] Documentar o limite "cache por processo" como pré-condição de escala

- **Problema**
  > O `ConsolidacaoBoletoDdaCache` é `@singleton` por processo. Documentação explícita no arquivo. A janela de 30 s de divergência cross-réplica não vira risco enquanto houver 1 réplica, mas vira dívida quando escalarmos.
- **Melhoria Proposta**
  > Adicionar o item na checklist de escala (próxima ADR de deploy / Terraform-alvo) para que ninguém escale para N réplicas sem antes mover o cache para um backend compartilhado (Redis) ou aceitar explicitamente a janela de 30 s. Tactic alvo: State Resync.
- **Resultado Esperado**
  > Nenhum deploy multi-réplica abre a janela sem decisão consciente.
- **Tactic alvo**: State Resync (Reintroduction)
- **Severidade**: P3
- **Esforço estimado**: S (só documentação / ADR amendment)
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Item na checklist de escala: ausente → presente
- **Risco de não fazer**: nenhum enquanto houver 1 réplica; latente após o pivot para Lambda-alvo.
- **Dependências**: aguardar ADR de escalabilidade / Lambda-alvo.

## 6. Notas do agente

- Escopo reduzido conforme pedido: só o diff do worktree `sispag-dda-paridade` sobre `v0.79.0`.
- Pontos fortes do delta: guard `EmptyDdaFileError` corretamente **antes** do `DELETE` (sem escrita se vazio); invalidação dos dois caches no `finally` dentro do advisory lock; `arquivosLidos = alvo − falhas − adiados` exato; single-flight + geração protegem contra write-back obsoleto no cache.
- Nenhum P0 encontrado — o delta corrige o incidente que motivou a amenda da ADR-0067 (resposta vazia apagava o snapshot) e introduz contagens precisas. Os P2 restantes são observabilidade (classificar `DDA_FILE_EMPTY`, alertar staleness) e justiça do batch (priorizar `arquivosAdiados`).
- Cross-QA: F-fault-tolerance-3 (staleness alarm) toca Testability (job periódico precisa de teste) e Performance (impacto do probe). F-fault-tolerance-2 (prioridade de adiados) toca Performance (budget de 10 s na ingestão).
