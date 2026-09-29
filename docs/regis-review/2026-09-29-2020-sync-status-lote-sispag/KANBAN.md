---
type: regis-review-kanban
run_id: 2026-09-29-2020
total: 32
unique_deliverables: 28
counts: { p0: 0, p1: 3, p2: 21, p3: 8 }
---

# Kanban — financeiro — 2026-09-29-2020

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3. Desempate de esforço pela ordem dos QAs do relatório.
> Feature revisada: `sync-status-lote-sispag` (`--quick`, escopo restrito aos diretórios tocados).
> **P0: nenhum.** Nenhum QA registrou finding ou card P0 nesta execução.
> Os 32 cards são copiados verbatim dos 8 QAs; 4 pares são duplicatas de entrega (ver linha "Consolidação" dentro dos cards). Entregas únicas: 28. IDs originais mantidos.

---

## P0 — Crítico

_Nenhum card P0 nesta execução._

---

## P1 — Alto

### [availability-2] Tornar o staleness da sincronização sensível à janela útil

**QA**: Availability
**Tactic alvo**: Heartbeat
**Esforço**: M
**Findings**: F-availability-2

**Problema**
> Limite de 64 h para cadência de 1 h (`stalenessLimits.ts:99-108`) faz uma parada de cron aparecer só 2 dias depois; o GitHub pode atrasar ou desativar schedules.

**Melhoria Proposta**
> Limite consciente de calendário: ~3 h dentro da janela 11–22 UTC em dia útil, descontando fins de semana. Alternativa: exibir "última sincronização bem-sucedida" no card do lote. Tactic: Heartbeat / Monitor.

**Resultado Esperado**
> Detecção de cron parado: 64 h → ≤ 3 h úteis.

**Métricas de sucesso**
- Tempo até alerta de cron parado em dia útil: 64 h → ≤ 3 h
- Falsos alertas em fins de semana: 0 mantido

**Risco de não fazer**
> status de lotes defasado por até 2 dias úteis sem ninguém saber.

**Dependências**: regra `staleness-por-pipeline`

---

### [fault-tolerance-3] Gravar trilha de auditoria da transição de lote e da situação dos itens

**QA**: Fault Tolerance
**Tactic alvo**: Repair State (audit trail)
**Esforço**: M
**Findings**: F-fault-tolerance-3

**Problema**
> Transições de status e mudanças de situação de item pela sincronização não deixam linha de trilha (quem/quando/de-para/prova) no banco; só logs.

**Melhoria Proposta**
> Criar `lote_pagamento_transicao_audit` (lote, de, para, origem `SINCRONIZACAO_CRON|MANUAL|CONCILIACAO`, ator, evidência resumida, em) e inserir dentro de `aplicarSincronizacao`, na mesma transação; passar o ator do "Sincronizar agora". Migration + rollback.

**Resultado Esperado**
> 100% das transições reconstruíveis a partir do banco.

**Métricas de sucesso**
- Transições com linha de trilha: 0% → 100%

**Risco de não fazer**
> numa disputa sobre "quem marcou este lote como pago", a resposta depende de logs rotativos.

**Dependências**: nenhuma (cruza com Security/auditabilidade)

**Consolidação**: `security-1` (ator do clique manual) é subconjunto desta trilha; se este card for executado, `security-1` vira critério de aceite dele. `security-1` continua válido como quick win isolado.

---

### [testability-5] Iniciar cobertura dos jobs de cron e quebrar RemessaService.test.ts [pré-existente]

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity
**Esforço**: L
**Findings**: F-testability-6

**Problema**
> Razão de teste em `jobs/` é 3/71 (0,04) e `RemessaService.test.ts` tem 2218 linhas.

**Melhoria Proposta**
> Extrair o padrão do teste de `sincronizar-lotes-sispag.test.ts` (exit code, run em error, mensagem redigida) como helper e aplicar aos jobs SISPAG (`ingest-sispag`, `reaper-sispag`); dividir o teste da Remessa por responsabilidade.

**Resultado Esperado**
> Razão de teste em `jobs/`: 0,04 → 0,10 (3 → 7 arquivos); maior arquivo de teste: 2218 → ≤ 800 linhas.

**Métricas de sucesso**
- Testes de jobs: 3 → 7
- Arquivos de teste > 1000 LOC: 2 → 0

**Risco de não fazer**
> crons falhando silenciosamente por mais seis meses.

**Dependências**: nenhuma.

---


## P2 — Médio

### [availability-1] Isolar falha por lote na passada de sincronização

**QA**: Availability
**Tactic alvo**: Exception Handling
**Esforço**: S
**Findings**: F-availability-1

**Problema**
> `sincronizarTodos` chama `processarLote` sem `try/catch` (`SincronizacaoLoteService.ts:127-129`); um erro de banco em um lote aborta os demais e se repete a cada hora.

**Melhoria Proposta**
> Envolver `processarLote` em `try/catch` no loop, registrar via `LogService` (pt-BR), devolver resultado de falha com contagem própria em `ResumoSincronizacao` e fechar a run como `partial`. Manter exit 1 só quando todas as unidades falham. Tactic: Exception Handling. Tocar `SincronizacaoLoteService.ts`, `SincronizarLotesSispagJob.ts` e testes.

**Resultado Esperado**
> Um lote com falha não impede os demais: lotes não processados por exceção de um vizinho: N-1 → 0.

**Métricas de sucesso**
- Lotes sincronizados numa passada com 1 lote defeituoso: 0 (abortada) → N-1
- Teste com exceção de repositório no meio da lista: ausente → presente

**Risco de não fazer**
> um lote "envenenado" congela a sincronização dos demais até intervenção manual.

**Dependências**: nenhuma

**Consolidação**: mesma entrega de `fault-tolerance-1` (ambos cobrem o try/catch por lote em `sincronizarTodos`). Executar uma vez; `fault-tolerance-1` fica como duplicata rastreável.

---

### [availability-4] Desacoplar o minuto do cron das demais rotinas que usam a sessão Conexos

**QA**: Availability
**Tactic alvo**: Reconfiguration
**Esforço**: S
**Findings**: F-availability-4

**Problema**
> O :35 coincide com `reconciliar-nde` e ambos compartilham o mesmo usuário Conexos com limite de sessões; o próprio workflow deixa o deslocamento como TODO.

**Melhoria Proposta**
> Mover o cron para um minuto sem colisão (ex.: :50) e manter um mapa único de horários dos crons; avaliar reutilizar a sessão persistida em vez de novo login. Tactic: Reconfiguration.

**Resultado Esperado**
> Crons Conexos no mesmo minuto: 2 → 1; falsos `job-falhou` por `MAX_SESSIONS`: 0.

**Métricas de sucesso**
- Crons Conexos por minuto de disparo: 2 → 1

**Risco de não fazer**
> alerta de credencial falso ou sincronização perdida em hora de pico, minando a confiança no alerta.

**Dependências**: nenhuma

**Consolidação**: mesma entrega de `deployability-2` (colisão do :35 com `reconciliar-nde`). Antes de escolher o minuto, conferir todos os `cron:` (DEPLOY.md espaça em :00/:20/:40; availability sugere :50, deployability :05). Entrega única.

---

### [deployability-1] Atualizar o orçamento de sessões do DEPLOY.md e ler o teto do Supavisor

**QA**: Deployability
**Tactic alvo**: Surge Protection
**Esforço**: S (≤1d)
**Findings**: F-deployability-1

**Problema**
> O sétimo cron entrou sem atualizar a tabela "Budget de sessões do pooler", que hoje afirma 6 crons/49 sessões. O teto real do pooler nunca foi lido.

**Melhoria Proposta**
> Atualizar a linha dos crons (7 crons, 56 sessões) em `DEPLOY.md`; ler `max_client_conn` no dashboard do Supabase e registrá-lo. Considerar checagem simples que compare o número de workflows com `schedule` à tabela.

**Resultado Esperado**
> Tabela = realidade; teto conhecido e comparado ao pior caso de 56.

**Métricas de sucesso**
- Crons documentados: 6 → 7
- Teto do pooler: desconhecido → registrado

**Risco de não fazer**
> o próximo cron empurra o pior caso acima do teto e o sintoma vira 5xx mascarado por retry.

**Dependências**: acesso ao dashboard Supabase

---

### [deployability-2] Mover o cron de sincronização para minuto livre

**QA**: Deployability
**Tactic alvo**: Surge Protection
**Esforço**: S (≤1d)
**Findings**: F-deployability-2

**Problema**
> `sincronizar-lotes-sispag` e `reconciliar-nde` disparam no `:35` (12x/dia útil) usando o mesmo usuário Conexos, sujeito a `LOGIN_ERROR_MAX_SESSIONS`.

**Melhoria Proposta**
> Trocar o cron para minuto livre (ex.: `5 11-22 * * 1-5`), respeitando a regra de espaçamento registrada em `reaper-sispag.yml`; atualizar o comentário do workflow.

**Resultado Esperado**
> Coincidências 12/dia → 0; sem falhas de sessão cruzadas.

**Métricas de sucesso**
- Execuções simultâneas no mesmo minuto: 12/dia → 0

**Risco de não fazer**
> alertas `job-falhou` intermitentes que ensinam o time a ignorar alertas.

**Dependências**: nenhuma

**Consolidação**: duplicata de `availability-4` (mesma colisão do :35). Entrega única; validar o minuto livre contra todos os workflows.

---

### [deployability-3] Documentar deploy e rollback da 0069 no DEPLOY.md

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S (≤1d)
**Findings**: F-deployability-3

**Problema**
> A feature traz migration + rota + front acoplados, mas o DEPLOY.md não diz a ordem, a janela do cron que migra antes do Render, nem como reverter.

**Melhoria Proposta**
> Seção no padrão da 0066: ordem "backend primeiro", janela `npm run migrate` dos crons, comando do reverse `0069...rollback.sql`, pré-condição sobre `alerta` com tipos novos (confirmar que o script trata). Pós-deploy: conferir `[boot-migrate] aplicada(s) 1: 0069`.

**Resultado Esperado**
> Rollback executável por qualquer pessoa em ≤15 min sem ler código.

**Métricas de sucesso**
- Passos de deploy/rollback documentados da feature: 0 → 1 seção completa

**Risco de não fazer**
> front antes do backend gera 404 no botão; rollback improvisado com constraint de alerta.

**Dependências**: nenhuma

---

### [integrability-1] Devolver `legivel:false` quando linhas de baixa falham no schema

**QA**: Integrability
**Tactic alvo**: Adhere to Standards / Abstract Common Services
**Esforço**: S
**Findings**: F-integrability-4, F-integrability-2

**Problema**
> `lerBaixasTitulo` descarta linhas inválidas e retorna `legivel:true` com lista vazia, mascarando drift do `com308`.

**Melhoria Proposta**
> Se `rows.length > 0` e alguma linha falhar no schema, retornar `legivel:false` com motivo "N linhas com schema inválido" e logar a contagem. Unificar `motivoDeFalha`/`statusDe` em um helper no `ConexosBaseClient`.

**Resultado Esperado**
> Drift de schema aparece no motivo/alerta; um único extrator de status HTTP.

**Métricas de sucesso**
- Linhas rejeitadas silenciosas: N → 0
- Helpers de status HTTP: 2 → 1

**Risco de não fazer**
> mudança de layout do Conexos passa despercebida por meses.

**Dependências**: nenhuma

---

### [integrability-2] Gravar fixtures reais de fin064, fin052 detalhe e com308 e testar o parsing

**QA**: Integrability
**Tactic alvo**: Contract testing
**Esforço**: S
**Findings**: F-integrability-3

**Problema**
> Os clients novos são testados com objetos inline, sem contract test contra respostas gravadas.

**Melhoria Proposta**
> Capturar respostas anonimizadas (as de 24–25/08 já citadas no código) em `__fixtures__/` e usá-las nos testes de `lerSituacaoTitulo`, `lerBaixasTitulo` e `listDetalhe`; incluir casos com `titMny*` NULL e 403.

**Resultado Esperado**
> 3/3 leituras com teste de contrato por fixture.

**Métricas de sucesso**
- Endpoints com fixture: 0/3 → 3/3

**Risco de não fazer**
> regressão de forma só descoberta em produção como lote sem decisão.

**Dependências**: nenhuma

**Consolidação**: mesma entrega de `testability-2` (fixtures Conexos gravadas). Entrega única; as fixtures servem ao contract test dos clients e ao `SincronizacaoLoteService.test.ts`.

---

### [performance-1] Carregar lotes da sincronização em query única

**QA**: Performance
**Tactic alvo**: Reduce Overhead
**Esforço**: S
**Findings**: F-performance-1

**Problema**
> `sincronizarTodos` chama `getLoteComItens` por id (1+N queries sequenciais).

**Melhoria Proposta**
> Adicionar `getLotesComItens(ids)` com `WHERE id = ANY($ids)` + itens em segunda query e usar em `sincronizarTodos`. Tactic: Reduce Overhead.

**Resultado Esperado**
> Queries de carga por passada: 1+N → 2.

**Métricas de sucesso**
- queries de carga por passada: 1+N → 2

**Risco de não fazer**
> passada cresce linear com lotes; ganho pequeno, custo trivial.

**Dependências**: nenhuma

---

### [performance-2] Reduzir leituras fin064 de itens terminais na janela de estorno

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: S
**Findings**: F-performance-2

**Problema**
> Todo item de lote BAIXADO (30 d) é relido no Conexos 12×/dia só para detectar estorno.

**Melhoria Proposta**
> Para lotes BAIXADO, checar estorno em cadência menor (1×/dia), pulando lotes com sincronização recente (`tocarSincronizacao` já registra). Tactic: Increase Resource Efficiency.

**Resultado Esperado**
> Chamadas fin064/dia dos lotes BAIXADO: 12×itens → 1×itens (−92%).

**Métricas de sucesso**
- chamadas Conexos/dia (lotes BAIXADO): 12×N → 1×N
- novos 504/MAX_SESSIONS nos crons concorrentes: 0

**Risco de não fazer**
> pressão crescente nas sessões Conexos compartilhadas com o robô.

**Dependências**: decisão de negócio sobre latência aceitável de detecção de estorno

---

### [performance-3] Impor deadline de passada e gravar resumo parcial

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: S
**Findings**: F-performance-3

**Problema**
> Sem orçamento de tempo, o kill de 15 min do workflow perde o resumo e deixa lotes sem sincronizar.

**Melhoria Proposta**
> Deadline interno (ex.: 10 min) checado entre lotes; ordenar por sincronização mais antiga para rodízio justo; gravar JobRun parcial. Tactics: Bound Execution Times / Prioritize Events.

**Resultado Esperado**
> Passadas mortas por timeout do workflow: n/d → 0; lote mais defasado ≤ 2 h mesmo com Conexos lento.

**Métricas de sucesso**
- passadas com timeout do workflow: n/d → 0
- defasagem máxima de lote: n/d → ≤ 2 h

**Risco de não fazer**
> com Conexos degradado, os lotes do fim da fila deixam de sincronizar silenciosamente.

**Dependências**: performance-4 (métricas)

**Consolidação**: sobreposição parcial com `availability-3` (deadline da passada); o circuit breaker fica em `availability-3`.

---

### [fault-tolerance-1] Isolar falha por lote em `sincronizarTodos`

**QA**: Fault Tolerance
**Tactic alvo**: Recovery (forward) / isolamento de falha
**Esforço**: S
**Findings**: F-fault-tolerance-1

**Problema**
> Uma exceção de banco em um lote interrompe o laço e impede a sincronização dos demais na mesma passada; o job só reporta exit 1.

**Melhoria Proposta**
> Envolver `processarLote` em try/catch por lote, contar como resultado `ERRO` no `ResumoSincronizacao`, logar e seguir. O job fecha PARTIAL (ou ERROR se todos falharem). Tocar `SincronizacaoLoteService.ts` e `SincronizarLotesSispagJob.ts` (+ testes).

**Resultado Esperado**
> Um lote defeituoso não atrasa os demais: lotes não processados após uma exceção, de "todos os restantes" para 0.

**Métricas de sucesso**
- Lotes não processados após uma exceção: N restantes → 0

**Risco de não fazer**
> um lote com dado inesperado trava a sincronização horária inteira até intervenção manual.

**Dependências**: nenhuma

**Consolidação**: duplicata de `availability-1` (mesmo try/catch por lote). Entrega única, fechar os dois cards juntos.

---

### [fault-tolerance-2] Propagar o desfecho do fechamento por lote na conciliação L9/L10

**QA**: Fault Tolerance
**Tactic alvo**: Comparison / Reconcile
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> `ConciliacaoRetornoService` ignora o resultado de `aplicarEventosRetorno`; lote pulado por conflito aparece em `lotesAfetados` e o ledger liquida.

**Melhoria Proposta**
> Coletar o resultado por lote, devolver `lotesFechados`/`lotesPulados` na resposta e, havendo pulado ou exceção, chamar `ledger.fail` (como na varredura incompleta) para permitir nova passada.

**Resultado Esperado**
> Resposta HTTP e ledger refletem o que foi de fato gravado; lote pulado deixa de ser silencioso.

**Métricas de sucesso**
- Resultados de fechamento propagados: 0/1 → 1/1

**Risco de não fazer**
> a analista acredita que o lote fechou; a defasagem só some no próximo cron.

**Dependências**: nenhuma

---

### [security-1] Gravar o ator no sincronizar manual

**QA**: Security
**Tactic alvo**: Audit Trail
**Esforço**: S
**Findings**: F-security-1

**Problema**
> `POST /lotes/:id/sincronizar` chama `sincronizarLote(id)` sem o usuário; a transição de status do lote disparada por clique não é atribuível.

**Melhoria Proposta**
> Passar `ator(req)` para `sincronizarLote` e registrá-lo no log/evento da transição (`SincronizacaoLoteService`, `routes/sispag.ts`). O cron grava `cron` como ator.

**Resultado Esperado**
> Toda transição de status do lote com ator identificável (0/1 → 1/1 endpoints).

**Métricas de sucesso**
- Endpoints de sync com ator: 0/1 → 1/1

**Risco de não fazer**
> a auditoria não consegue dizer quem sincronizou/fechou um lote.

**Dependências**: nenhuma

**Consolidação**: subconjunto de `fault-tolerance-3` (ator na trilha de auditoria). Pode sair antes, como quick win.

---

### [testability-2] Gravar fixtures dos clients Conexos usados pela sincronização

**QA**: Testability
**Tactic alvo**: Recordable Test Cases
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> `ConexosSispagClient` e `ConexosTitulosClient` são testados com payloads inline; nenhum client do Conexos tem `__fixtures__`.

**Melhoria Proposta**
> Gerar fixtures anonimizadas a partir da sonda `validate-sync-status-lote-sispag-v1.ts` (Recordable Test Cases) e usá-las nos testes dos clients e no `SincronizacaoLoteService.test.ts` (T1, T2, T5).

**Resultado Esperado**
> Fixtures de client Conexos: 0 → 4 (fin064, PSQ_018, fin052, detalhe de retorno); testes de client baseados em fixture: 0 → 2 arquivos.

**Métricas de sucesso**
- Fixtures gravadas de Conexos: 0 → 4

**Risco de não fazer**
> mudança de contrato do ERP passa nos testes e falha em produção.

**Dependências**: nenhuma.

**Consolidação**: duplicata de `integrability-2` (fixtures Conexos). Entrega única.

---

### [availability-3] Adicionar orçamento de tempo e limite de falhas consecutivas na passada

**QA**: Availability
**Tactic alvo**: Exception Prevention
**Esforço**: M
**Findings**: F-availability-3, F-availability-5

**Problema**
> Sem orçamento interno, uma passada lenta é morta pelo `timeout-minutes: 15` sem `finishRun`, e um Conexos fora do ar recebe o ciclo completo de retry por item.

**Melhoria Proposta**
> Prazo interno (ex.: 12 min) checado entre lotes; ao estourar, parar, fechar `partial` com contagem de lotes não processados e priorizar por `sincronizado_em` mais antigo. Acrescentar circuit breaker leve (N falhas consecutivas do Conexos encerram a passada como `error`). Tactic: Exception Prevention.

**Resultado Esperado**
> Runs órfãs em `running`: possíveis → 0; chamadas ao Conexos após N falhas consecutivas: ilimitadas → 0.

**Métricas de sucesso**
- Runs terminadas por timeout do workflow: não medível → 0
- Chamadas ao Conexos após falhas consecutivas: ilimitadas → limitadas a N

**Risco de não fazer**
> com a carteira crescendo, a passada é cortada e o Painel mostra runs fantasma.

**Dependências**: availability-1

**Consolidação**: sobrepõe `performance-3` (deadline interno da passada + resumo parcial). Executar `performance-3` primeiro; `availability-3` acrescenta o circuit breaker por falhas consecutivas.

---

### [integrability-3] Extrair fachada de leitura de situação do título (anti-corruption layer)

**QA**: Integrability
**Tactic alvo**: Use an Intermediary / Orchestrate
**Esforço**: M
**Findings**: F-integrability-1

**Problema**
> O `SincronizacaoLoteService` depende de 3 clients Conexos e 8 dependências no total, o que encarece qualquer upgrade do Conexos.

**Melhoria Proposta**
> Criar um gateway `@injectable` que agrega `lerSituacaoTitulo`, `lerBaixasTitulo` e as leituras de retorno, expondo tipos de domínio; o service depende só do gateway. Fazer no próximo `/feature-tweak` que tocar o service.

**Resultado Esperado**
> Clients Conexos injetados no service: 3 → 1.

**Métricas de sucesso**
- Dependências do service: 8 → 6

**Risco de não fazer**
> upgrade do Conexos v2 cascateia pelo service central.

**Dependências**: nenhuma

---

### [modifiability-1] Dividir SincronizacaoLoteService em carga, casamento e aplicação

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-1

**Problema**
> O serviço novo tem 626 LOC, 16 imports e três responsabilidades misturadas (carga do Conexos, casamento por chave composta, avaliação de retorno).

**Melhoria Proposta**
> Extrair a carga (PSQ_018 e paginação) para um serviço próprio e o casamento de linhas para função pura ao lado de `DecisaoStatusLote`; manter o serviço como orquestrador. Arquivo: `SincronizacaoLoteService.ts`.

**Resultado Esperado**
> 626 -> <= 350 LOC; fan-out 16 -> <= 10; testes atuais continuam verdes.

**Métricas de sucesso**
- LOC do serviço: 626 -> <= 350
- imports: 16 -> <= 10

**Risco de não fazer**
> o serviço vira o próximo `RemessaService` (1602 LOC) em 6 meses.

**Dependências**: nenhuma

---

### [modifiability-2] Quebrar LotePagamentoRepository por responsabilidade

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M
**Findings**: F-modifiability-2

**Problema**
> 1047 LOC com 7 JOINs; escrita, painel e sincronização convivem no mesmo arquivo.

**Melhoria Proposta**
> Separar `LoteSincronizacaoRepository` (listLotesSincronizaveis, item_situacao) e um repositório de leitura para o painel. Manter SQL parametrizado.

**Resultado Esperado**
> 1047 -> <= 600 LOC por arquivo; JOINs por repositório <= 5.

**Métricas de sucesso**
- LOC máximo por repositório: 1047 -> <= 600

**Risco de não fazer**
> toda migration SISPAG toca o mesmo arquivo, com conflito frequente entre sessões paralelas.

**Dependências**: nenhuma

---

### [security-4] Alarme de falha de autenticação e conclusão da auth em 3 passos

**QA**: Security
**Tactic alvo**: Detect Intrusion / Revoke Access
**Esforço**: M
**Findings**: F-security-4

**Problema**
> Não há alarme de falha de login nem revogação fina de permissões concluída; ações financeiras dependem de uma permissão única.

**Melhoria Proposta**
> Concluir o PR #93 (permissões no banco) e agregar 401/403 em métrica com alerta por limiar no Painel de Operação.

**Resultado Esperado**
> Falhas de autenticação/autorização detectáveis; revogação imediata.

**Métricas de sucesso**
- Alarmes de falha de auth: 0 → 1

**Risco de não fazer**
> força bruta ou uso indevido de credencial passam sem alerta.

**Dependências**: PR #93

---

### [testability-1] Cobrir SQL do LotePagamentoRepository em Postgres real

**QA**: Testability
**Tactic alvo**: Sandbox
**Esforço**: M
**Findings**: F-testability-2

**Problema**
> Só 4 dos 28 métodos públicos do repositório são exercitados em banco real; o restante (incluindo leituras novas de sincronização) valida SQL contra pool mockado.

**Melhoria Proposta**
> Estender a suíte `test:sql` (Sandbox) com casos para os demais métodos alterados no delta, reutilizando o setup de `0069…integration.test.ts` extraído para helper compartilhado.

**Resultado Esperado**
> Métodos do `LotePagamentoRepository` com teste em Postgres real: 4/28 → 12/28; casos de integração do repositório: 5 → 12.

**Métricas de sucesso**
- Métodos com teste em banco real: 4 → 12
- Tempo do job `test:sql`: registrar baseline e manter < 2 min

**Risco de não fazer**
> divergência SQL mock/real detectada só no cron horário.

**Dependências**: nenhuma.

---

### [modifiability-3] Tirar acesso direto a client/repositório de routes/sispag.ts

**QA**: Modifiability
**Tactic alvo**: Use an Intermediary
**Esforço**: L
**Findings**: F-modifiability-3

**Problema**
> A rota importa `ConexosSispagClient` e 3 repositórios diretamente (pré-existente); a migração para Lambda fica cara.

**Melhoria Proposta**
> Migração proporcional em `/feature-tweak`: criar services de fachada e dividir os handlers por sub-recurso (924 -> <= 600 LOC).

**Resultado Esperado**
> 4 violações -> 0; rota <= 600 LOC.

**Métricas de sucesso**
- imports client/repository em `routes/sispag.ts`: 4 -> 0

**Risco de não fazer**
> a dívida em `migration-debt.md` cresce a cada endpoint.

**Dependências**: nenhuma

---


## P3 — Baixo

### [deployability-4] Adicionar kill-switch ao sync e alinhar Node entre CI e crons

**QA**: Deployability
**Tactic alvo**: Scale Rollouts
**Esforço**: S (≤1d)
**Findings**: F-deployability-4

**Problema**
> O sync grava status de lote de hora em hora sem interruptor operacional; CI testa em Node 24 e os crons executam em 22.

**Melhoria Proposta**
> Env `SISPAG_SINCRONIZACAO_ENABLED` (padrão do repo: só `false` desliga, sem redeploy) checada pelo job com exit 0 e log; alinhar `node-version` dos 7 crons ao CI (ou vice-versa).

**Resultado Esperado**
> Desligar o sync em <1 min sem editar código; 1 versão de Node em todo o pipeline.

**Métricas de sucesso**
- Tempo para desligar o job: edição de workflow → 1 variável
- Versões de Node: 2 → 1

**Risco de não fazer**
> bug no sync corrompe leitura de status por horas antes de alguém conseguir parar.

**Dependências**: nenhuma

---

### [modifiability-4] Externalizar a janela de estorno e reduzir complexidade das duas funções

**QA**: Modifiability
**Tactic alvo**: Defer Binding / Refactor
**Esforço**: S
**Findings**: F-modifiability-4, F-modifiability-5

**Problema**
> `JANELA_ESTORNO_DIAS`, `FOLGA_RETORNO_MS` e `pageSize` são constantes de código; duas funções tocadas excedem complexidade 15.

**Melhoria Proposta**
> Ler a janela via `EnvironmentProvider` com default 30 (Defer Binding); refatorar `ConexosTitulosClient:312` e `ConciliacaoRetornoService:103` em helpers.

**Resultado Esperado**
> 3 valores hardcoded -> 0; avisos biome in-delta 2 -> 0.

**Métricas de sucesso**
- constantes hardcoded: 3 -> 0
- avisos de complexidade in-delta: 2 -> 0

**Risco de não fazer**
> ajustes operacionais continuam exigindo release completo.

**Dependências**: nenhuma

**Consolidação**: `ConexosTitulosClient.ts:312` é a função pré-existente `listTitulosAPagar`, não código novo do delta. A métrica 'avisos de complexidade in-delta: 2 -> 0' deve ser lida como 1 função tocada (`ConciliacaoRetornoService.ts:103`) + 1 pré-existente em arquivo tocado. O texto do card foi mantido verbatim.

---

### [performance-4] Instrumentar duração e chamadas Conexos; deadline na rota manual

**QA**: Performance
**Tactic alvo**: Bound Execution Times
**Esforço**: S
**Findings**: F-performance-4, F-performance-5

**Problema**
> Sem duração/contadores não há como validar os alvos; a rota manual não tem deadline próprio.

**Melhoria Proposta**
> Incluir `duracaoMs`, `lotes`, `itensLidos`, `chamadasConexos` no `ResumoSincronizacao`/JobRun; na rota, deadline de ~20 s (resposta parcial) e botão desabilitado durante a chamada no `LoteCard`. Tactic: Bound Execution Times.

**Resultado Esperado**
> Métricas visíveis no painel de operação; rota p95: ~25 s estimado para 50 itens → < 15 s.

**Métricas de sucesso**
- p95 "Sincronizar agora": n/d → < 15 s
- passada horária p95: n/d → < 5 min

**Risco de não fazer**
> degradação percebida só por reclamação do analista.

**Dependências**: nenhuma

---

### [fault-tolerance-4] Verificar linhas afetadas nos UPDATEs de item

**QA**: Fault Tolerance
**Tactic alvo**: Sanity Checking
**Esforço**: S
**Findings**: F-fault-tolerance-4

**Problema**
> O retorno de `tx.update` dos itens é ignorado em `aplicarSincronizacao`.

**Melhoria Proposta**
> Se `afetadas !== 1` para algum item, abortar a transação (retornar `CONFLITO`) e logar.

**Resultado Esperado**
> Nenhuma transição gravada com item não atualizado.

**Métricas de sucesso**
- UPDATEs de item checados: 0% → 100%

**Risco de não fazer**
> inconsistência silenciosa se itens passarem a ser mutáveis pós-remessa.

**Dependências**: nenhuma

---

### [security-2] Endurecer o workflow de sincronização

**QA**: Security
**Tactic alvo**: Change Default Settings
**Esforço**: S
**Findings**: F-security-2

**Problema**
> O workflow não declara `permissions:` e usa a mesma credencial Conexos dos outros crons.

**Melhoria Proposta**
> Adicionar `permissions: contents: read` (e nos demais crons); avaliar usuário Conexos dedicado, somente leitura, para o job.

**Resultado Esperado**
> Token com escopo mínimo; disputa de sessão eliminada e raio de vazamento reduzido.

**Métricas de sucesso**
- Workflows com `permissions:` explícito: 0 → todos os do escopo

**Risco de não fazer**
> vazamento de um secret compartilhado abre todos os crons.

**Dependências**: criação de usuário no Conexos (pelo cliente)

---

### [security-3] Remover a rota 410 após a janela de cache

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: S
**Findings**: F-security-3

**Problema**
> `/lotes/:id/retorno` permanece como stub apenas para telas antigas.

**Melhoria Proposta**
> Remover a rota depois de uma janela (p. ex. 2 semanas) e confirmar 0 chamadas nos logs.

**Resultado Esperado**
> Superfície mínima; 1 rota stub → 0.

**Métricas de sucesso**
- Rotas stub: 1 → 0

**Risco de não fazer**
> baixo; acúmulo de rotas mortas.

**Dependências**: deploy do frontend novo

---

### [testability-3] Asserir logs nos caminhos degradados e expor o relógio ao job

**QA**: Testability
**Tactic alvo**: Limit Non-Determinism
**Esforço**: S
**Findings**: F-testability-1, F-testability-4

**Problema**
> Falha de leitura de evento, de alerta e PSQ_018 403 só são verificados quanto à continuidade; job e rota usam `new Date()` implícito.

**Melhoria Proposta**
> Adicionar `expect(logService.warn/error).toHaveBeenCalledWith(...)` com contexto (loteId, código) nos 3 caminhos; injetar um `ClockProvider` (ou `agora` explícito no job) e fixá-lo no teste do job.

**Resultado Esperado**
> Caminhos degradados com asserção de log: 1/3 → 3/3; leituras `new Date()` não injetáveis no delta: 3 → 0.

**Métricas de sucesso**
- Asserções de log no serviço: 1 → 4
- Leituras de tempo sem injeção: 3 → 0

**Risco de não fazer**
> incidente sem pista de log e regressão de carimbo de sincronização.

**Dependências**: nenhuma.

---

### [testability-4] Adicionar testes de propriedade à DecisaoStatusLote

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-5

**Problema**
> A função pura central tem 28 casos manuais e `fast-check` (já dependência) tem 0 usos.

**Melhoria Proposta**
> Escrever propriedades: (a) decisão é idempotente para o mesmo insumo; (b) lote BAIXADO nunca transiciona; (c) rejeição em qualquer item nunca resulta em BAIXADO.

**Resultado Esperado**
> Testes de propriedade no repositório: 0 → 3; ≥ 100 execuções geradas por propriedade.

**Métricas de sucesso**
- Arquivos com `fast-check`: 0 → 1

**Risco de não fazer**
> combinações raras de itens ficam sem verificação.

**Dependências**: nenhuma.

---

