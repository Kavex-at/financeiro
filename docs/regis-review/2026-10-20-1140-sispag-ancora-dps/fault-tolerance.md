---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-20-1140
agent: qa-fault-tolerance
generated_at: 2026-10-20T12:00:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 4
---

# Fault Tolerance — Regis-Review (reduzido: delta `sispag-ancora-dps`, ADR-0073)

## 1. Cenário Geral (Bass General Scenario aplicado ao Financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Cron `ingest-sispag` (3x/dia) e a analista na tela de sugestões | GED/Conexos devolve 401/403/5xx, PDF trocado ou ilegível; `titulo_dps` ausente ou inacessível no banco | `LeitorDpsService`, `TituloDpsRepository`, `BoletoSuggestionService.sugerirAgora` | Produção, sessão Conexos compartilhada, job como último passo do workflow | A falha de um título fica isolada e gravada (`ERRO` + motivo). A sugestão de boleto segue funcionando sem a âncora. Nenhum DPS errado entra sem prova. A analista continua confirmando. | 0 escrita no ERP; 0 título perdido por falha de outro; sugestão disponível mesmo com `titulo_dps` fora; DPS errado detectado antes de ser gravado como `LIDO` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas no ERP no delta | 0 (só `GET`/`POST` de leitura em `psq014`, `com298`, `arq020`) | 0 | ✅ | `ConexosGedClient.ts:39-45` |
| Isolamento por título no job | try/catch por título, grava `ERRO` + motivo (máx. 300 caracteres) | 100% | ✅ | `LeitorDpsService.ts:104-120` |
| Gravação idempotente | `UPSERT` por `(fil_cod, doc_cod, tit_cod)`; `tentativas + 1`; `concurrency: ingest-sispag` | idempotente | ✅ | `TituloDpsRepository.ts:54-84`, `ingest-sispag.yml:31-33` |
| Limite de releitura | 12 h entre tentativas, máx. 3, `LIDO` nunca relido, 40 títulos por execução | limitado | ✅ | `SelecaoLeituraDps.ts:11-13,53-58`, `ler-dps-nfse.ts:9` |
| Semântica do exit code | `exit 1` só se `alvos>0 && lidos===0 && erros===alvos` | falha sistêmica visível | ⚠️ cobre só 100% de falha | `ler-dps-nfse.ts:31` |
| Leituras do cenário com isolamento de falha | 0 de 7 no `Promise.all`, inclusive `dpsRepo.listarLidos` | a nova leitura opcional isolada | ❌ | `BoletoSuggestionService.ts:871-879` |
| Checagem cruzada NFS-e do PDF × título | só quando o PDF traz NFS-e **e** o título tem `numeroDocumento` | obrigatória na escolha por "PDF único" | ⚠️ | `LeitorDpsService.ts:154-162,182-183` |
| Tentativas consumidas por falha transitória (HTTP, sessão) | contam como as de erro de conteúdo (3 x 12 h = 36 h até desistir) | transitórias não contam | ⚠️ | `TituloDpsRepository.ts:69`, `LeitorDpsService.ts:108-118` |
| Timeout por passo do novo job | só o `timeout-minutes: 20` do job inteiro | passo com limite próprio | ⚠️ | `ingest-sispag.yml:38,70-71` |

> ⚠️ **Não medível localmente**: taxa real de `ERRO` por execução, quantas sessões Conexos o cron consome e a duração do passo em PRD. Requer a tabela `titulo_dps` em produção e o log das Actions. Recomendação: logar `alvos/lidos/erros/esgotados` (já há um `console.log`) e olhar as 3 primeiras execuções.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Zod nas fronteiras do GED; download em formato inesperado vira erro; NFS-e do PDF diferente da do título vira `ERRO`. Lacuna: sem NFS-e no PDF ou no título, a checagem é pulada. | ⚠️ parcial | `ConexosGedClient.ts:141-158`, `LeitorDpsService.ts:154-162` |
| Timeout | Herdado do `ConexosBaseClient`; passo sem timeout próprio. Não medido neste delta. | ⚠️ parcial | `ingest-sispag.yml:38` |
| Condition Monitoring | `exit 1` em falha total aciona o passo `if: failure()` do workflow. Falha parcial só aparece no log. | ⚠️ parcial | `ler-dps-nfse.ts:31`, `ingest-sispag.yml:84-94` |
| Timestamp | `lido_em` e `tentativas` por título, usados pela seleção | ✅ presente | `SelecaoLeituraDps.ts:53-58` |
| Quarantine | `ERRO`/`SEM_PDF`/`SEM_DPS_NO_PDF` gravados com motivo; título sem DPS segue o desfecho anterior (ambíguo/fraco) para a analista | ✅ presente | `LeitorDpsService.ts:81-88` |
| Idempotent Replay | `UPSERT` e job reexecutável; `LIDO` não é relido | ✅ presente | `TituloDpsRepository.ts:54-84` |
| Recovery (forward) | Nova tentativa após 12 h, até 3. Depois disso é abandono silencioso, sem reset nem reprocesso manual. | ⚠️ parcial | `SelecaoLeituraDps.ts:56` |
| Compensating Transaction / Rollback | N/A: o delta não faz escrita no ERP; só `titulo_dps`, local, por `UPSERT` | N/A | `ConexosGedClient.ts:39-45` |
| Graceful Degradation (Increase Competence Set) | O motor aceita `dps` vazio, mas `listarLidos` não tem fallback se a consulta falhar | ⚠️ parcial | `TituloDpsRepository.ts:25-37`, `BoletoSuggestionService.ts:878` |
| Redundancy / Voting | N/A: fonte única (o PDF no GED), sem segunda fonte para cruzar | N/A | — |

## 4. Findings (achados)

### F-fault-tolerance-1: `titulo_dps` ausente ou inacessível derruba toda a sugestão de boleto, não só a âncora

- **Severidade**: P1
- **Tactic violada**: Graceful Degradation (isolamento de falha de uma dependência opcional)
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:871-879`; `src/backend/domain/repository/sispag/TituloDpsRepository.ts:25-37`
- **Evidência (objetiva)**:
  ```
  const [titulos, boletos, pares, rejeitadas, confirmadas, emLotes, dps] = await Promise.all([
      ..., this.dpsRepo.listarLidos(),
  ]);
  ```
  `sugerirAgora` é usado por `calcularCenario` (listagem), por `confirmar` (linha 272) e por `desfechosAgora`. O `safeParse` do repositório protege contra linha inválida, não contra a consulta falhar (relação inexistente, conexão).
- **Impacto técnico**: se o código novo subir antes da migration `0087` (o gotcha do `BootMigrator` mostra que isso já aconteceu) ou se a leitura falhar, `Promise.all` rejeita. A lista de sugestões e o `confirmar` dão erro, embora o DPS seja um sinal acessório que "não sobe tier".
- **Impacto de negócio**: a analista perde a sugestão de boleto DDA inteira (todos os credores) por causa de uma melhoria que só ajuda MULTILOG.
- **Métrica de baseline**: 1 leitura nova sem isolamento entre 7 no `Promise.all`; 3 caminhos (listar, confirmar, leitor) dependem dela.

### F-fault-tolerance-2: DPS errado pode virar `LIDO` definitivo (PDF "único" sem checagem cruzada)

- **Severidade**: P2
- **Tactic violada**: Sanity Checking / Comparison
- **Localização**: `src/backend/domain/service/sispag/LeitorDpsService.ts:154-162,182-183`
- **Evidência (objetiva)**:
  ```
  if (lido.nfse && nfseTitulo && digitos(lido.nfse) !== nfseTitulo) { ...ERRO }
  ...
  if (pdfs.length === 1 && unico) return { arquivo: unico };
  ```
  O fallback "único PDF da pasta" escolhe o arquivo sem provar que é a NFS-e do título. A checagem NFS-e×título só roda se o PDF traz NFS-e e o título tem `numeroDocumento`. `LIDO` nunca é relido (`SelecaoLeituraDps.ts:55`). Se a NFS-e for substituída ou cancelada no GED, o DPS fica velho para sempre.
- **Impacto técnico**: um DPS de outro título do mesmo processo entra como prova de escopo e como âncora `DPS_IGUAL`. Segundo o contexto, a âncora reserva o boleto antes das outras camadas e pode tirá-lo do título certo.
- **Impacto de negócio**: contido, porque a âncora não sobe tier nem alarga limite e a analista confirma. O risco real é induzir a escolha do boleto errado numa fila grande, e não há caminho para invalidar um `LIDO` errado.
- **Métrica de baseline**: 2 caminhos aceitam o PDF sem prova de NFS-e (PDF sem NFS-e legível; título sem `numeroDocumento`); 0 caminhos para reler um `LIDO`. Nos 5 títulos validados ao vivo o DPS bateu com o previsto (4 lidos, 1 CT-e sem DPS), então a taxa de erro em PRD ainda não foi observada.

### F-fault-tolerance-3: falha transitória gasta as 3 tentativas e o título é abandonado sem sinal

- **Severidade**: P2
- **Tactic violada**: Recovery (forward) / Condition Monitoring
- **Localização**: `src/backend/domain/service/sispag/LeitorDpsService.ts:104-120`; `src/backend/domain/repository/sispag/TituloDpsRepository.ts:69`; `src/backend/jobs/ler-dps-nfse.ts:31`
- **Evidência (objetiva)**: `lerComSeguranca` grava `ERRO` para qualquer exceção (401, 403, 5xx, timeout, sessão derrubada pelo cap de sessões ou pela senha do cron). `registrar` soma 1 a cada gravação. Depois de 3 tentativas a seleção para (`SelecaoLeituraDps.ts:56`).
- **Impacto técnico**: uma indisponibilidade do Conexos, ou o robô sem permissão no `arq020`, consome até 40 títulos por execução. Em 36 h (3 execuções x 12 h) todos ficam abandonados, e nada os reabre. O `exit 1` só dispara se 100% falharem, então um erro sistêmico com 1 sucesso passa. Essa falha parcial só aparece no log.
- **Impacto de negócio**: os títulos ambíguos voltam a depender de triagem manual, sem aviso de que a automação desistiu deles.
- **Métrica de baseline**: tentativas por título = 3 (fixo); contagem de títulos esgotados exposta = 0; limiar do `exit 1` = 100% de erro.

### F-fault-tolerance-4: passo novo sem timeout próprio, em cron que divide a sessão Conexos

- **Severidade**: P3
- **Tactic violada**: Timeout / Condition Monitoring
- **Localização**: `.github/workflows/ingest-sispag.yml:38,70-71`; `src/backend/domain/service/sispag/SelecaoLeituraDps.ts:46-47`
- **Evidência (objetiva)**: o job tem `timeout-minutes: 20` para todos os passos. O leitor faz até 40 títulos, cada um com cerca de 4 chamadas sequenciais ao Conexos mais o download do PDF e a extração com pdfjs. É o terceiro processo do workflow a autenticar. O comentário do workflow (linhas 7-11) já registra que o GitHub atrasa schedules em 2-5 h, o que pode sobrepor o passo ao cron de Permutas (09:00 UTC), que usa a mesma conta. `SEM_DPS_NO_PDF` (CT-e, determinístico) é relido até 3 vezes.
- **Impacto técnico**: o passo é o último, então um timeout só perde o que faltava e as linhas já gravadas ficam. Pelo mesmo motivo, ele não atrasa nem bloqueia a ingestão ou a formação de lotes. O risco é gastar uma sessão Conexos em janela em que outro cron roda.
- **Impacto de negócio**: baixo. No pior caso, uma sessão derrubada faz outro cron falhar e gera alerta.
- **Métrica de baseline**: 0 timeouts por passo; duração do passo em PRD não medida.

## 5. Cards Kanban

### [fault-tolerance-1] Degradar a sugestão sem DPS quando `titulo_dps` falhar

- **Problema**
  > `BoletoSuggestionService.sugerirAgora` lê `titulo_dps` dentro do `Promise.all` do cenário. Se a tabela não existir (migration não aplicada) ou a consulta falhar, a listagem, o `confirmar` e o leitor quebram juntos, por causa de um sinal que só ajuda um credor.
- **Melhoria Proposta**
  > Em `sugerirAgora`, envolver `dpsRepo.listarLidos()` com `.catch` que devolve `[]` e registra `logService.warn` ("DPS indisponível: sugestão sem âncora"), sem expor erro de banco. Teste unitário: `listarLidos` rejeita e `listarSugestoes`/`confirmar` seguem com o motor recebendo `dps: []`. O `desfechosAgora` herda o comportamento. O leitor não deve gravar nada nesse estado.
- **Resultado Esperado**
  > Falha em `titulo_dps` degrada para o comportamento anterior à ADR-0073. Leituras do cenário que derrubam a sugestão por dependência opcional: 1 → 0.
- **Tactic alvo**: Graceful Degradation
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Caminhos de sugestão que falham com `titulo_dps` fora: 3 → 0
  - Teste cobrindo o fallback: 0 → 1
- **Risco de não fazer**: o próximo deploy com ordem errada, ou uma indisponibilidade pontual do banco, derruba a tela de sugestões de boleto, e o diagnóstico aponta para uma tabela de apoio.
- **Dependências**: nenhuma

### [fault-tolerance-2] Exigir prova de NFS-e no PDF escolhido e permitir invalidar um DPS lido

- **Problema**
  > O leitor aceita o "único PDF da pasta" e só confere a NFS-e quando as duas pontas a trazem. Um `LIDO` errado ou velho nunca é relido e funciona como prova de escopo e âncora.
- **Melhoria Proposta**
  > Em `LeitorDpsService.ler`, no caminho "PDF único" sem NFS-e comparável (PDF sem NFS-e legível, ou título sem `numeroDocumento`), gravar `SEM_DPS_NO_PDF` com motivo "NFS-e não comprovada" em vez de `LIDO`. Acrescentar um caminho de invalidação (script de job ou `UPDATE` documentado em runbook) que devolve o título ao estado de releitura e zera `tentativas`. Opcional: guardar o `adfCodSeq` ou o tamanho do PDF para detectar troca no GED.
- **Resultado Esperado**
  > Todo `LIDO` tem NFS-e conferida. Existe um procedimento para corrigir um DPS errado. Caminhos que aceitam sem prova: 2 → 0.
- **Tactic alvo**: Sanity Checking / Comparison
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - `LIDO` sem NFS-e conferida: possível → 0
  - Caminho de invalidação documentado: 0 → 1
- **Risco de não fazer**: um DPS errado fica ancorando o boleto de outro título por tempo indefinido. A analista pode aceitar o boleto errado por confiar na âncora.
- **Dependências**: definir o rigor da prova com a analista (a NFS-e falta em algum layout municipal?)

### [fault-tolerance-3] Não queimar tentativas em falha transitória e sinalizar esgotados

- **Problema**
  > Qualquer exceção (401, 403, 5xx, timeout) vira `ERRO` e consome uma das 3 tentativas. Uma queda do Conexos ou do robô abandona dezenas de títulos em 36 h, e o `exit 1` só dispara com 100% de erro.
- **Melhoria Proposta**
  > Classificar a falha em `lerComSeguranca`: erro de transporte, sessão ou permissão (HTTP 401/403/429/5xx, timeout) não incrementa `tentativas` (parâmetro no `registrar`). Parar o loop após N falhas transitórias seguidas (circuit breaker), preservando a cota do Conexos. O job loga `esgotados` (títulos com `tentativas>=3` e `ERRO`) e faz `exit 1` se a taxa de erro passar de um limiar (por exemplo 50%) ou se houver esgotados novos.
- **Resultado Esperado**
  > Uma queda de até 36 h não esgota a cota de tentativas. Falha parcial grave dispara o alerta. Limiar do `exit 1`: 100% → configurável (padrão 50%).
- **Tactic alvo**: Recovery (forward) / Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Tentativas consumidas por falha transitória: 100% → 0%
  - Esgotados visíveis no log/alerta: não → sim
- **Risco de não fazer**: o primeiro incidente de sessão ou permissão no Conexos esvazia a fila de leitura sem ninguém notar, e a âncora DPS deixa de cobrir os casos para os quais foi criada.
- **Dependências**: [fault-tolerance-2] pode compartilhar a mudança em `registrar`

### [fault-tolerance-4] Dar timeout próprio ao passo do leitor e não reler o que é determinístico

- **Problema**
  > O passo `ler-dps-nfse` divide o `timeout-minutes: 20` do job, autentica mais uma vez no Conexos e relê até 3 vezes um `SEM_DPS_NO_PDF` determinístico (CT-e).
- **Melhoria Proposta**
  > Adicionar `timeout-minutes: 8` ao passo no workflow. Em `SelecaoLeituraDps.podeLer`, não reler `SEM_DPS_NO_PDF` com o mesmo `arquivo`, e só reler `SEM_PDF` e `ERRO`. Medir a duração e o número de logins nas 3 primeiras execuções.
- **Resultado Esperado**
  > O passo tem teto próprio de tempo. Chamadas ao Conexos desperdiçadas em CT-e: até 3 por título → 1.
- **Tactic alvo**: Timeout
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Passo com timeout próprio: 0 → 1
  - Releituras de `SEM_DPS_NO_PDF`: 3 → 1
- **Risco de não fazer**: um passo travado consome a janela do job e gera alerta de falha em um workflow que já terminou o trabalho importante.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta. Não li `MotorSugestaoBoleto` (`reservarPorDps`); a gravidade de F-2 depende de como a âncora reserva o boleto, conforme `_shared-metrics.md`.
- Pontos fortes: leitura somente, isolamento por título, `UPSERT` idempotente, `concurrency` no workflow, limites de releitura e passo posicionado por último (nunca bloqueia carteira e formação).
- Não verifiquei timeouts do `ConexosBaseClient`/`getBinary` (fora do delta). Cruza com Availability e Performance.
- O alerta de falha parcial e a trilha de `ERRO` cruzam com Observability e Testability (o fluxo `pdfjs` e o ao vivo não estão no jest).
- Cruza com Security: o PDF de terceiro processado em memória no servidor (F-2: prova de origem do PDF).
