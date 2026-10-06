---
type: regis-review-kanban
run_id: 2026-10-06-1356
total: 27
counts: { p0: 0, p1: 6, p2: 16, p3: 5 }
---

# Kanban — financeiro — 2026-10-06-1356

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3. Dentro de mesma prioridade e esforço, ordem por peso do QA (Security primeiro).
> Escopo: feature `sispag-verificacoes-ted-pix`, `--quick`, delta vs origin/main. Cards copiados verbatim dos arquivos de seção; IDs originais preservados. A linha "Sobreposição" foi adicionada pelo consolidador para sinalizar cards que atacam a mesma causa-raiz (não foram fundidos). Não há cards P0 nesta rodada.

---

## P0 — Crítico

_Nenhum card nesta prioridade._

---

## P1 — Alto

### [fault-tolerance-1] Tratar retorno falso da remoção pelo sistema e abortar a transação

**QA**: Fault Tolerance
**Prioridade**: P1
**Tactic alvo**: Rollback
**Esforço**: S
**Findings**: F-fault-tolerance-1
**Fonte**: `fault-tolerance.md` (seção 5)
**Sobreposição**: testability-1

**Problema**
> `retirarSemDado` ignora o `false` de `removerItemPeloSistema`; com lote finalizado no meio, descarta alertas e abre pendência RETIRADO sem remover o item.

**Melhoria Proposta**
> Se o retorno for `false`, lançar dentro do `withTransaction` (rollback) e tratar como item não verificável nesta passada (PENDENTE/skip). Teste de integração com lote FINALIZADO. Tactic: Rollback.

**Resultado Esperado**
> Estado nunca divergente entre item, alertas e pendência; callsites que ignoram o retorno: 1 → 0.

**Métricas de sucesso**
- Retorno verificado: 0/1 → 1/1
- Teste de corrida finalizar x remoção: 0 → 1

**Risco de não fazer**
> pendências e alertas que mentem sobre o lote, corroendo a confiança na trilha de auditoria.

**Dependências**: nenhuma

---

### [availability-1] Definir timeout e deadline nas leituras Conexos do caminho síncrono

**QA**: Availability
**Prioridade**: P1
**Tactic alvo**: Exception Detection / Degradation
**Esforço**: S
**Findings**: F-availability-1, F-availability-2
**Fonte**: `availability.md` (seção 5)
**Sobreposição**: performance-2, availability-2

**Problema**
> `ConexosBaseClient` não define timeout (0 de 1 cliente Conexos), e `finalizarLote` agora faz leituras ao vivo do `fin064` na requisição do analista. Um Conexos lento pende a finalização sem erro claro.

**Melhoria Proposta**
> Aplicar `AbortSignal.timeout` (ex.: 15-20s) em `ConexosBaseClient` para leituras (escritas irreversíveis seguem em tentativa única) e um deadline total para `VerificacaoTedPixService`; ao estourar, marcar o item PENDENTE (já é o comportamento fail-closed). Tactic: Exception Detection + Degradation.

**Resultado Esperado**
> Finalização responde em tempo limitado com itens PENDENTES e mensagem clara. Clientes Conexos com timeout: 0% → 100%.

**Métricas de sucesso**
- Clientes Conexos com timeout explícito: 0% → 100%
- p95 da verificação em `finalizarLote`: sem medida → medido e < 10s

**Risco de não fazer**
> em dia de corte de pagamento, um Conexos degradado trava a finalização sem diagnóstico e ocupa a sessão compartilhada.

**Dependências**: nenhuma (checar impacto do timeout em leituras paginadas longas de outros jobs).

---

### [deployability-1] Escrever reverses 0076-0079 e a seção de rollout/rollback da ADR-0063 no DEPLOY.md

**QA**: Deployability
**Prioridade**: P1
**Tactic alvo**: Rollback
**Esforço**: S
**Findings**: F-deployability-1
**Fonte**: `deployability.md` (seção 5)

**Problema**
> As migrations 0076-0079 não têm reverse e o DEPLOY.md não menciona a feature. Voltar o backend deixa trigger de só-inclusão, colunas de conferência e CHECK de permissões ampliado sem passo documentado.

**Melhoria Proposta**
> Criar `rollbacks/0076..0079*.rollback.sql` (0079 restaurando o CHECK anterior após remover linhas das permissões novas; 0078 documentando que a trilha não se apaga) e uma seção em `DEPLOY.md` com ordem (backend, migrations, frontend), verificações por passo e rollback. Tactic: Rollback.

**Resultado Esperado**
> Rollback de código+schema da feature em ≤ 15 min seguindo um runbook. Reverses: 0/4 → 4/4.

**Métricas de sucesso**
- Reverses para migrations da feature: 0/4 → 4/4
- Menções ao ADR-0063 no DEPLOY.md: 0 → seção completa

**Risco de não fazer**
> o primeiro incidente pós-merge vira improviso em produção financeira.

**Dependências**: nenhuma

---

### [modifiability-1] Extrair queries da conferência/duplicidade do LotePagamentoRepository

**QA**: Modifiability
**Prioridade**: P1
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-1
**Fonte**: `modifiability.md` (seção 5)
**Sobreposição**: testability-3

**Problema**
> O repositório tem 1060 LOC (+210 nesta feature) e uma função com complexidade 20; schema do lote ripples num só arquivo.

**Melhoria Proposta**
> Split Module: mover as queries novas (alerta/conferência/bloqueio) para os repositórios por agregado já existentes (`AlertaItemLoteRepository`, `BloqueioDuplicidadeRepository`) ou um `LoteConferenciaRepository`; refatorar a função da linha 197.

**Resultado Esperado**
> LotePagamentoRepository <= 700 LOC, complexidade <= 15.

**Métricas de sucesso**
- LOC do repositório: 1060 → <= 700
- Funções com complexidade > 15: 1 → 0

**Risco de não fazer**
> o arquivo passa de 1300 LOC em 6 meses com a próxima frente SISPAG.

**Dependências**: nenhuma

---

### [modifiability-2] Mover endpoints de verificação para um router dedicado e remover acesso direto a repository

**QA**: Modifiability
**Prioridade**: P1
**Tactic alvo**: Restrict Dependencies
**Esforço**: M
**Findings**: F-modifiability-2
**Fonte**: `modifiability.md` (seção 5)
**Sobreposição**: testability-3

**Problema**
> `routes/sispag.ts` tem 1163 LOC e 34 imports, e importa client/repositories, furando a cadeia Service.

**Melhoria Proposta**
> Restrict Dependencies + Split Module: criar `routes/sispagVerificacao.ts` (duplicidade, conferência, pendências) que só resolve Services; expor via Services o que hoje vem de repository.

**Resultado Esperado**
> Rotas sem imports de client/repository; arquivo principal <= 800 LOC.

**Métricas de sucesso**
- Imports de repository/client em routes/sispag.ts: 4 → 0
- Fan-out: 34 → <= 20

**Risco de não fazer**
> migração Lambda precisa partir um arquivo de 1200+ LOC sob pressão.

**Dependências**: nenhuma

---

### [performance-1] Reaproveitar a leitura da fin064 entre cliques (cache curto por filial) e medir o volume real

**QA**: Performance
**Prioridade**: P1
**Tactic alvo**: Maintain Multiple Copies of Data
**Esforço**: M
**Findings**: F-performance-1
**Fonte**: `performance.md` (seção 5)
**Sobreposição**: availability-1, performance-2

**Problema**
> Cada troca de modalidade TED/PIX relê a fin064 da filial inteira (até 50 chamadas seriais) dentro da requisição HTTP. O `Map` de leituras só vive durante uma chamada.

**Melhoria Proposta**
> Primeiro rodar o `probe-duplicidade-titulos` só para obter o `count` por filial (não rodado nesta revisão). Depois criar um cache em memória por filial com TTL curto (por exemplo 60–120s) em `ConexosSispagClient` ou num `FilialTitulosCache` injetável, com invalidação ao finalizar. Falha de leitura nunca vai para o cache (preserva I13b, falha fechada). No `finalizarLote`, ignorar o cache (leitura fresca) para não aprovar sobre dado velho. Alternativa: verificar em lote ao final da revisão, em vez de por clique.

**Resultado Esperado**
> Leituras de fin064 por lote editado: M (um por item) → 1 por filial dentro do TTL. p95 da troca de modalidade: medir (baseline) → ≤ 2s.

**Métricas de sucesso**
- Leituras fin064 por troca: 1 completa → 0 dentro do TTL
- p95 da rota de modalidade: a medir → ≤ 2s

**Risco de não fazer**
> com volume maior em PRD, a revisão obrigatória do lote passa a estourar timeout e sobrecarrega a sessão Conexos compartilhada.

**Dependências**: medir o `count` real de fin064 por filial (probe).

---


## P2 — Médio

### [security-1] Adicionar CHECK de segregação em `lote_pagamento` e guard no RemessaService

**QA**: Security
**Prioridade**: P2
**Tactic alvo**: Separate Entities
**Esforço**: S
**Findings**: F-security-1
**Fonte**: `security.md` (seção 5)

**Problema**
> A regra conferente ≠ finalizador existe só no serviço. O banco aceita `conferido_por = finalizado_por`, e a remessa só confere se `conferido_por` está preenchido.

**Melhoria Proposta**
> Nova migration com `CHECK (conferido_por IS NULL OR conferido_por IS DISTINCT FROM finalizado_por)` (comparação em minúsculas). No `RemessaService`, repetir `ConferenciaLoteRule.impedimento(lote, lote.conferidoPor)` como invariante (defesa em profundidade).

**Resultado Esperado**
> O banco recusa gravação autoconferida. Pontos de aplicação da regra: 1 → 3.

**Métricas de sucesso**
- Constraints de DB para dual control: 0 → 1
- Pontos de aplicação: 1 → 3

**Risco de não fazer**
> Um caminho futuro (job, script, rota) esquece a regra e a fraude que a feature previne volta a ser possível.

**Dependências**: nenhuma

---

### [availability-2] Instrumentar duração da verificação e alertar falha do job de perfil

**QA**: Availability
**Prioridade**: P2
**Tactic alvo**: Monitor
**Esforço**: S
**Findings**: F-availability-2, F-availability-3
**Fonte**: `availability.md` (seção 5)
**Sobreposição**: performance-4, availability-1, fault-tolerance-3

**Problema**
> Não há métrica de duração da verificação TED/PIX nem notificação ativa de falha do cron semanal; só staleness e status do Actions.

**Melhoria Proposta**
> Logar duração por filial e total em `LogService` (campo estruturado) e adicionar passo `if: failure()` de notificação no workflow `calcular-perfil-canal.yml`. Tactic: Monitor.

**Resultado Esperado**
> MTTR e p95 passam a ser medíveis; falha do job notifica em minutos, não na próxima leitura de staleness.

**Métricas de sucesso**
- Métricas de duração disponíveis: 0 → 2 (por filial, total)
- Detectores de falha do job: 1 (staleness) → 2 (staleness + notificação)

**Risco de não fazer**
> perfil defasado e lentidão passam despercebidos até reclamação do analista.

**Dependências**: availability-1 (para o p95 fazer sentido com timeout)

---

### [modifiability-3] Centralizar constantes de tempo e externalizar janelas/limiares da verificação

**QA**: Modifiability
**Prioridade**: P2
**Tactic alvo**: Defer Binding
**Esforço**: S
**Findings**: F-modifiability-3, F-modifiability-4
**Fonte**: `modifiability.md` (seção 5)
**Sobreposição**: deployability-4

**Problema**
> `DIA_MS` replicado 3 vezes; janela de 30 dias e limiares só mudam por deploy.

**Melhoria Proposta**
> Abstract Common Services: `libs/time/Duration.ts` com `DIA_MS`; Defer Binding: ler janela/limiares via EnvironmentProvider com default atual.

**Resultado Esperado**
> 1 definição de DIA_MS; limiares ajustáveis sem alterar código.

**Métricas de sucesso**
- Duplicações de DIA_MS: 3 → 1
- Parâmetros externalizados: 0 → >= 3

**Risco de não fazer**
> calibração pós-go-live exige redeploy a cada ajuste.

**Dependências**: nenhuma

---

### [performance-2] Dar um orçamento de tempo à leitura da fin064 e paginar com paralelismo limitado

**QA**: Performance
**Prioridade**: P2
**Tactic alvo**: Bound Execution Times / Increase Concurrency
**Esforço**: S
**Findings**: F-performance-3
**Fonte**: `performance.md` (seção 5)
**Sobreposição**: availability-1

**Problema**
> A leitura serial de até 50 páginas não tem deadline global. Em lentidão do ERP, a rota excede o timeout do proxy e deixa a verificação incompleta.

**Melhoria Proposta**
> Deadline global (por exemplo 20s) em `listTitulosParaDuplicidade` com erro tipado que vira `PENDENTE`. Depois da página 1, que dá o `count`, buscar as demais com `bounded.run` (paralelismo 3–4, o mesmo utilitário do `PerfilCanalService`). Cuidado com o limite de sessão do Conexos.

**Resultado Esperado**
> Tempo da leitura completa para N=10 páginas: ~10 × p50 → ~3 × p50. Nenhuma requisição acima de 25s.

**Métricas de sucesso**
- Duração máxima da leitura: sem teto → ≤ 25s
- Páginas em voo: 1 → ≤ 4

**Risco de não fazer**
> 502 intermitente na tela de lote quando o Conexos degradar.

**Dependências**: nenhuma.

---

### [performance-3] Remover ou usar o filtro de favorecido no servidor para `listTitulosFavorecidoParaDuplicidade`

**QA**: Performance
**Prioridade**: P2
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: S
**Findings**: F-performance-2
**Fonte**: `performance.md` (seção 5)

**Problema**
> O recorte por favorecido lê a filial inteira e filtra em memória.

**Melhoria Proposta**
> Confirmar quem chama o método. Se ninguém, apagar. Se houver chamador, testar em ambiente seguro (não rodar contra Conexos nesta revisão) se o fin064 aceita `pesCod#EQ`, e passar o filtro no corpo.

**Resultado Esperado**
> Linhas trazidas por chamada de recorte: até 50.000 → apenas as do favorecido (ordem de dezenas).

**Métricas de sucesso**
- Linhas por chamada: ≤ 50.000 → ≤ 100

**Risco de não fazer**
> código morto ou caro fica como armadilha para o próximo chamador.

**Dependências**: confirmar o campo de filtro no ERP.

---

### [testability-2] Injetar gerador de ids nos repositórios do sispag

**QA**: Testability
**Prioridade**: P2
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-2
**Fonte**: `testability.md` (seção 5)

**Problema**
> Três repositórios novos chamam `randomUUID()` direto (6 sites), então os testes não controlam ids nem afirmam a trilha com precisão.

**Melhoria Proposta**
> Criar `IdProvider` (`@singleton() @injectable()`) em `domain/libs/` e injetá-lo em `AlertaItemLoteRepository`, `BloqueioDuplicidadeRepository`, `VerificacaoEventoRepository`. Tactic: Limit Non-Determinism.

**Resultado Esperado**
> Sites de aleatoriedade sem provedor no delta 6 → 0; testes de repositório afirmam o id exato.

**Métricas de sucesso**
- `randomUUID` direto em `repository/sispag/`: 6 → 0

**Risco de não fazer**
> Cada novo repositório copia o padrão; o custo de teste da trilha cresce.

**Dependências**: nenhuma.

---

### [deployability-2] Verificação de pré-requisito do rollout (perfil populado) antes de liberar a verificação

**QA**: Deployability
**Prioridade**: P2
**Tactic alvo**: Scale Rollouts
**Esforço**: S
**Findings**: F-deployability-2
**Fonte**: `deployability.md` (seção 5)
**Sobreposição**: fault-tolerance-3

**Problema**
> O disparo manual do job de perfil é o passo que habilita o alerta de canal; nada confirma que rodou.

**Melhoria Proposta**
> Adicionar ao DEPLOY.md um passo com `SELECT count(*) FROM perfil_canal_fornecedor` (> 0) e, idealmente, um sinal no painel de operação (staleness já tem `stalenessLimits.ts` alterado no delta) para "perfil nunca calculado". Tactic: Scale Rollouts.

**Resultado Esperado**
> Liberação só com perfil populado; dias com perfil vazio sem aviso: até 7 → 0.

**Métricas de sucesso**
- Passos manuais sem verificação: 1 → 0

**Risco de não fazer**
> alerta silencioso por semanas sem ninguém notar.

**Dependências**: deployability-1

---

### [integrability-1] Mover getFiliais para um client de domínio

**QA**: Integrability
**Prioridade**: P2
**Tactic alvo**: Restrict Communication Paths
**Esforço**: S
**Findings**: F-integrability-1
**Fonte**: `integrability.md` (seção 5)

**Problema**
> `PerfilCanalService` depende do `ConexosBaseClient` de transporte só para `getFiliais`.

**Melhoria Proposta**
> Expor `listFiliais` em client de domínio já existente (`ConexosCadastroClient` ou `ConexosPagamentosRealizadosClient`) e remover a injeção do base no service. Tactic: Restrict Communication Paths.

**Resultado Esperado**
> Services do delta dependendo do transporte: 1 → 0.

**Métricas de sucesso**
- Services com `ConexosBaseClient` direto: 1 → 0

**Risco de não fazer**
> o padrão se replica e o upgrade do transporte atinge services.

**Dependências**: nenhuma

---

### [integrability-2] Gravar fixtures de fin010/baixas e cmn025 e testar o parse

**QA**: Integrability
**Prioridade**: P2
**Tactic alvo**: Contract testing
**Esforço**: S
**Findings**: F-integrability-2
**Fonte**: `integrability.md` (seção 5)
**Sobreposição**: integrability-3

**Problema**
> Só fin064 tem fixture; os parsers das demais fontes são testados com mocks.

**Melhoria Proposta**
> Capturar respostas reais anonimizadas (via probe já existente, nunca ad hoc em produção) e adicionar testes de parse nos dois clients. Tactic: Contract testing.

**Resultado Esperado**
> Fontes com fixture: 1/3 → 3/3.

**Métricas de sucesso**
- Fontes Conexos novas com fixture: 33% → 100%

**Risco de não fazer**
> drift do payload passa no CI e quebra o perfil de canal.

**Dependências**: nenhuma

---

### [security-2] Alarmar tentativas de autoconferência e reforçar a identidade

**QA**: Security
**Prioridade**: P2
**Tactic alvo**: Detect Intrusion
**Esforço**: M
**Findings**: F-security-2
**Fonte**: `security.md` (seção 5)

**Problema**
> `SelfConferenceError` só devolve 403. Ninguém é avisado de que alguém tentou conferir o próprio lote, e a identidade é um username normalizado.

**Melhoria Proposta**
> Registrar evento `CONFERENCIA_NEGADA` em `sispag_verificacao_evento` (append-only) e contar no painel de operação, com alerta acima de N por dia. Avaliar comparar também o `sub` imutável do Supabase, além do username.

**Resultado Esperado**
> Tentativas negadas passam a ser visíveis e auditáveis. Alarmes: 0 → 1.

**Métricas de sucesso**
- Alarmes de tentativa negada: 0 → 1
- Eventos de negação persistidos: 0% → 100%

**Risco de não fazer**
> Uma tentativa de fraude em andamento fica sem rastro além de log efêmero.

**Dependências**: nenhuma

---

### [fault-tolerance-2] Fechar as janelas de corrida de finalizar e remessa com checagem atômica

**QA**: Fault Tolerance
**Prioridade**: P2
**Tactic alvo**: Timestamp
**Esforço**: M
**Findings**: F-fault-tolerance-2, F-fault-tolerance-3
**Fonte**: `fault-tolerance.md` (seção 5)
**Sobreposição**: testability-1

**Problema**
> Gate de duplicidade (finalizar) e guarda de conferência (remessa) são lidos antes da escrita e o CAS só cobre `versao`; devolução/alerta concorrentes escapam até o fim do fluxo.

**Melhoria Proposta**
> Incluir `NOT EXISTS` de alerta aberta no UPDATE de finalizar (ou bumpar `versao` ao criar alerta) e `conferido_por IS NOT NULL` no UPDATE de `REMESSA_GERADA`; reordenar para reler `versao` antes do ERP. Tactic: Timestamp / Sanity Checking.

**Resultado Esperado**
> Corridas cobertas por teste SQL; remessas órfãs por devolução concorrente: 1 janela → 0.

**Métricas de sucesso**
- Testes de concorrência no delta: 0 → 2

**Risco de não fazer**
> incidente raro, mas caro de reconciliar manualmente.

**Dependências**: fault-tolerance-1 (padrão de falha)

---

### [fault-tolerance-3] Alertar lotes com item PENDENTE ou conferência parada há mais de N horas

**QA**: Fault Tolerance
**Prioridade**: P2
**Tactic alvo**: Condition Monitoring
**Esforço**: M
**Findings**: F-fault-tolerance-4
**Fonte**: `fault-tolerance.md` (seção 5)
**Sobreposição**: availability-2, deployability-2

**Problema**
> Falha fechada correta, mas sem detecção de estagnação para itens PENDENTE e lotes FINALIZADOS sem conferência.

**Melhoria Proposta**
> Job agendado (padrão `detect-staleness`) que lista lotes nessas condições e registra em JobRun/alerta ao analista. Tactic: Condition Monitoring.

**Resultado Esperado**
> Lotes estagnados detectados em ≤ 1 ciclo; jobs de estagnação: 0 → 1.

**Métricas de sucesso**
- Tempo de detecção de lote parado: indefinido → ≤ 4h

**Risco de não fazer**
> pagamentos atrasados sem visibilidade.

**Dependências**: nenhuma

---

### [testability-1] Quebrar e ampliar a integração SQL da verificação TED/PIX

**QA**: Testability
**Prioridade**: P2
**Tactic alvo**: Sandbox
**Esforço**: M
**Findings**: F-testability-1
**Fonte**: `testability.md` (seção 5)
**Sobreposição**: fault-tolerance-1, fault-tolerance-2

**Problema**
> A integração SQL do delta tem 5 cenários longos, em sequência, para 13 invariantes e 4 repositórios. Nada prova sob concorrência que existe no máximo uma `PendenciaCadastro` ABERTA por (favorecido, tipo) ou um `BloqueioDuplicidade` ATIVO por título.

**Melhoria Proposta**
> Em `VerificacaoTedPix.integration.test.ts`, dividir cada cenário em casos independentes (setup por teste) e adicionar casos: duas aberturas concorrentes de pendência (`Promise.all`), dois bloqueios simultâneos, `OBSOLETA` na troca de contraparte (I13h) e `desfazer` com motivo auditado (I13g). Tactic: Sandbox.

**Resultado Esperado**
> Casos de integração do delta 5 → ~14; invariantes com prova em Postgres real (I13g, h, k) 3 → 3 com cenário de corrida; 0 casos de concorrência → 2.

**Métricas de sucesso**
- Casos de integração SQL do delta: 5 → 14
- Casos de concorrência: 0 → 2

**Risco de não fazer**
> Uma regressão do índice único passa no CI e a fila da analista acumula pendências duplicadas.

**Dependências**: nenhuma (job `test:sql` já existe).

---

### [testability-3] Dividir `routes/sispag.ts` e os testes de 500+ LOC

**QA**: Testability
**Prioridade**: P2
**Tactic alvo**: Limit Structural Complexity
**Esforço**: M
**Findings**: F-testability-3
**Fonte**: `testability.md` (seção 5)
**Sobreposição**: modifiability-2, modifiability-1

**Problema**
> `routes/sispag.ts` tem 1163 LOC e `routes/sispag.test.ts` 1562; `RemessaService.test.ts` chega a 2367. O custo de cada mudança em SISPAG inclui navegar esses arquivos.

**Melhoria Proposta**
> Extrair as rotas de verificação/conferência/pendências para `routes/sispagVerificacao.ts` (o teste `sispag.verificacao.test.ts` já aponta o corte) e mover os erros → HTTP para um mapeador testável. Partir `VerificacaoTedPixService.test.ts` por invariante (I13a–j). Tactic: Limit Structural Complexity.

**Resultado Esperado**
> Maior arquivo de rota 1163 → < 600 LOC; arquivos de teste > 500 LOC em `sispag/` 5 → ≤ 3.

**Métricas de sucesso**
- LOC de `routes/sispag.ts`: 1163 → < 600
- Testes > 500 LOC em sispag: 5 → 3

**Risco de não fazer**
> O arquivo de rota passa de 1500 LOC na próxima feature de SISPAG.

**Dependências**: nenhuma.

---

### [deployability-4] Criar interruptores de env para o gate de duplicidade e a conferência obrigatória

**QA**: Deployability
**Prioridade**: P2
**Tactic alvo**: Scale Rollouts
**Esforço**: M
**Findings**: F-deployability-4
**Fonte**: `deployability.md` (seção 5)
**Sobreposição**: modifiability-3, availability-1

**Problema**
> Os três comportamentos novos que bloqueiam o fluxo não têm flag operacional; mitigação exige redeploy.

**Melhoria Proposta**
> Adicionar booleanos em `SispagVerificacaoConfig` (ex.: `SISPAG_DUPLICIDADE_GATE=on|off`, `SISPAG_CONFERENCIA_OBRIGATORIA`) lidos via `EnvironmentProvider`, com default ligado e o desligamento auditado na trilha. Tactic: Scale Rollouts.

**Resultado Esperado**
> Mitigar uma degradação do fin064 em minutos via env no Render. Flags: 0 → 2 a 3.

**Métricas de sucesso**
- Flags de ativação das verificações: 0 → ≥ 2

**Risco de não fazer**
> uma instabilidade do ERP trava finalização de lotes até o redeploy.

**Dependências**: decisão de produto (o desligamento é aceitável? fica auditado?)

---

### [integrability-3] Contar linhas degradadas pelo Zod e alertar drift

**QA**: Integrability
**Prioridade**: P2
**Tactic alvo**: Versioning strategy
**Esforço**: M
**Findings**: F-integrability-3, F-integrability-4
**Fonte**: `integrability.md` (seção 5)
**Sobreposição**: integrability-2, availability-2

**Problema**
> `.catch(undefined)` e `preprocess` engolem desvios de schema sem sinal.

**Melhoria Proposta**
> Contar campos degradados por endpoint no `LogService` e expor no painel de operação e no job semanal. Tactic: Observability of integration failures.

**Resultado Esperado**
> Drift visível em ≤1 semana; hoje 0 contadores.

**Métricas de sucesso**
- Endpoints Conexos novos com contador de degradação: 0 → 3

**Risco de não fazer**
> duplicidade falha aberta sem ninguém notar.

**Dependências**: integrability-2

---


## P3 — Baixo

### [availability-3] Logar falhas ao fechar run em vez de engolir

**QA**: Availability
**Prioridade**: P3
**Tactic alvo**: Exception Detection
**Esforço**: S
**Findings**: F-availability-4
**Fonte**: `availability.md` (seção 5)

**Problema**
> Dois `catch` best-effort no fechamento de run descartam o erro sem log.

**Melhoria Proposta**
> Trocar por `logService.warn` com `runId` e erro redigido, mantendo o não-regresso do status. Tactic: Exception Detection.

**Resultado Esperado**
> Catches sem log no delta: 2 → 0.

**Métricas de sucesso**
- Catches silenciosos no delta: 2 → 0

**Risco de não fazer**
> diagnóstico lento de runs presas.

**Dependências**: nenhuma

---

### [performance-4] Instrumentar duração da verificação e do job de perfil, e agrupar leituras de perfil

**QA**: Performance
**Prioridade**: P3
**Tactic alvo**: Manage Sampling Rate / Reduce Overhead
**Esforço**: S
**Findings**: F-performance-4, F-performance-5
**Fonte**: `performance.md` (seção 5)
**Sobreposição**: availability-2

**Problema**
> Nenhum volume ou duração real foi medido: a feature não registra quanto tempo a verificação leva nem quantas linhas do fin064 leu. Sem isso as decisões dos cards 1 e 2 são palpite.

**Melhoria Proposta**
> Acrescentar `duracaoMs`, `linhasFin064` e `paginas` em `data` do log `verificação TED/PIX concluída`. No job de perfil, logar nº de contas, fatias e borderôs. Opcionalmente trocar `findByPesCod` por busca em lote de `pes_cod` antes do laço (F-performance-4) e limitar a janela de contas/fatias.

**Resultado Esperado**
> Percentis p50/p95 de duração disponíveis nos logs após 1 semana em PRD; baseline medido em vez de estimado. Leituras de perfil por finalização: K → 1.

**Métricas de sucesso**
- Campos de duração no log: ausente → presente
- SELECTs de perfil por finalização: K → 1

**Risco de não fazer**
> degradação silenciosa sem número para priorizar.

**Dependências**: nenhuma.

---

### [testability-4] Cobrir repositórios e regra de conferência com piso de cobertura

**QA**: Testability
**Prioridade**: P3
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-4
**Fonte**: `testability.md` (seção 5)

**Problema**
> O piso de cobertura cobre `./domain/service/` (88/60) mas não `./domain/repository/` nem `./domain/libs/sispag/`, onde estão a regra de segunda pessoa (I13l) e o SQL do gate de duplicidade.

**Melhoria Proposta**
> Rodar `npm test -- --coverage` uma vez, anotar a cobertura real e adicionar entradas em `coverageThreshold` para `./domain/repository/sispag/` e `./domain/libs/sispag/` (piso = medido, arredondado para baixo, como o comentário do arquivo prescreve). Adicionar testes diretos de 1 linha para as 8 classes de erro (nome e código HTTP) se o piso exigir. Tactic: Executable Assertions.

**Resultado Esperado**
> Diretórios do delta com piso de cobertura 0 → 2; regressão de cobertura nesses diretórios passa a quebrar o CI.

**Métricas de sucesso**
- Entradas de `coverageThreshold` por diretório do delta: 0 → 2

**Risco de não fazer**
> A cobertura de repositório decai sem aviso no ciclo seguinte.

**Dependências**: nenhuma.

---

### [deployability-3] Alinhar Node do cron `calcular-perfil-canal` ao CI

**QA**: Deployability
**Prioridade**: P3
**Tactic alvo**: Package Dependencies
**Esforço**: S
**Findings**: F-deployability-3
**Fonte**: `deployability.md` (seção 5)

**Problema**
> O cron usa Node 22 e o CI testa em 24.

**Melhoria Proposta**
> Padronizar `node-version` (idealmente via `.nvmrc`/`node-version-file`) em todos os workflows de cron. Tactic: Package Dependencies.

**Resultado Esperado**
> Workflows fora da versão do CI: ≥ 1 → 0.

**Métricas de sucesso**
- Versões de Node distintas entre workflows: 2 → 1

**Risco de não fazer**
> falha só em runtime do cron semanal.

**Dependências**: nenhuma

---

### [security-3] Vincular a conferência ao conteúdo dos itens (hash)

**QA**: Security
**Prioridade**: P3
**Tactic alvo**: Verify Message Integrity
**Esforço**: M
**Findings**: F-security-3
**Fonte**: `security.md` (seção 5)

**Problema**
> A conferência é um booleano (`conferido_por`). Se um novo caminho permitir editar item de lote FINALIZADO, a conferência continua válida sobre conteúdo alterado.

**Melhoria Proposta**
> Gravar um hash dos itens/destinos no momento de `conferir`. O `RemessaService` recalcula e compara antes de chamar o ERP.

**Resultado Esperado**
> Alteração pós-conferência invalida a remessa. Verificações de integridade: 0 → 1.

**Métricas de sucesso**
- Verificações de integridade conferência→remessa: 0 → 1

**Risco de não fazer**
> Risco residual baixo, já aceito no gap Q10 do ADR-0063.

**Dependências**: decisão de produto sobre o gap Q10

---

