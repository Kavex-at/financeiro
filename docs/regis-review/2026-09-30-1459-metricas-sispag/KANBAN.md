---
type: regis-review-kanban
run_id: 2026-09-30-1459-metricas-sispag
total: 13
counts: { p0: 0, p1: 0, p2: 8, p3: 5 }
---

# Kanban — financeiro — 2026-09-30-1459-metricas-sispag

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.
> Escopo: gate de feature sobre o delta de `fix/metricas-sispag` (métricas SISPAG, migration 0070, ADR-0056). Não é varredura do repo.
> Deduplicação: 18 cards brutos dos 8 QAs viraram 13. Mesclados: availability-1 + fault-tolerance-2 + integrability-2; fault-tolerance-1 + testability-1; integrability-1 + modifiability-3; modifiability-1 + availability-2. O card deployability-2 foi rebaixado de P2 para P3 (ver o card). Detalhes na seção 7 do REPORT.md.

---

## P0 — Crítico

Nenhum card. Os 8 QAs não reportaram P0 e a consolidação não promoveu nenhum.

---

## P1 — Alto

Nenhum card.

---

## P2 — Médio

### [availability-1] Expor o estado do sync de lotes junto do KPI SISPAG

**QA**: Availability (mescla Fault Tolerance e Integrability)
**Tactic alvo**: Condition Monitoring
**Esforço**: S
**Findings**: F-availability-2, F-fault-tolerance-2, F-integrability-1
**Cards mesclados**: availability-1, fault-tolerance-2, integrability-2

**Problema**
> O KPI "Pagamentos aceitos" depende de `lote_pagamento_item.situacao`, preenchida pelo cron `sincronizar-lotes-sispag`. Se o cron falha ou atrasa, 0% parece rejeição do banco (0 de 11 aceitos hoje).
> (fault-tolerance-2) Título enviado com `situacao` NULL conta como "aguardando retorno" indefinidamente; se o cron parar (já ocorreu em 23/09 por credencial), o painel mostra 0% aceito sem alerta. Hoje: 13 títulos, 0 aceitos.
> (integrability-2) Semana sem `situacao` sincronizada aparece como 0% aceito, indistinguível de rejeição total (11/11 títulos sem situação na leitura de 30/09).

**Melhoria Proposta**
> Condition Monitoring: devolver na leitura o instante do último sync bem-sucedido e avisar na tela quando passar do limite (ex.: 24h). Tocar `MetricasCicloRepository`, `MetricasCicloService`, `page.tsx`.
> (fault-tolerance-2) Alternativa/complemento: expor a idade do título mais antigo sem `situacao` e marcar `parcial` acima de um limiar (ex.: 2 dias úteis), ou fazer o job de sync falhar quando processar 0 títulos com carteira não vazia. Opcional, junto: guarda `AND status <> 'settled'` em `fail` (F-fault-tolerance-3, pré-existente).
> (integrability-2) Expor a contagem de pendentes no rótulo. **Já implementado** (verificação do orquestrador): o rótulo do % lê "X de Y títulos, Z aguardando retorno". Resta apenas o sinal de defasagem do cron.

**Resultado Esperado**
> Defasagem do sync visível: 0 sinais hoje → 1 aviso quando o sync passar de 24h. Sync parado detectado em ≤ 1 dia útil (hoje: indetectável pela métrica).

**Métricas de sucesso**
- Aviso de sync atrasado: ausente → presente
- Tempo para detectar sync parado: indefinido → ≤ 1 dia útil
- Títulos sem situação visíveis no rótulo: já atendido (não → sim)

**Risco de não fazer**
> Leitura de 0% como rejeição em semana de falha do cron; painel exibe aceite atrasado como se fosse real por semanas; report semanal errado ao gestor após nova falha de credencial.

**Dependências**: ADR-0055 (cron de sincronização)

---

### [fault-tolerance-1] Cobrir o efeito de `settle`/`fail` sobre `encerrado_em` em Postgres real

**QA**: Fault Tolerance (mescla Testability)
**Tactic alvo**: Idempotent Replay (Sandbox)
**Esforço**: S
**Findings**: F-fault-tolerance-1, F-testability-1
**Cards mesclados**: fault-tolerance-1, testability-1

**Problema**
> Os testes do repositório só conferem o texto do SQL por regex; a propriedade "re-settle não move `encerrado_em`, fail sobrescreve" não é exercitada contra Postgres. A lógica está correta por leitura, mas sem rede de proteção.
> (testability-1) O carimbo `encerrado_em` (que define a semana das métricas SISPAG) só é validado por regex de texto SQL; o comportamento "1º encerramento imóvel, retry sobrescreve erro" não roda em PG real.

**Melhoria Proposta**
> Adicionar um caso no suite `test:sql` que chame `settle` duas vezes (e `fail` → `settle`) via `RemessaExecucaoRepository` real e afirme `encerrado_em` e `status`. Tocar `vwMetricasCiclo.integration.test.ts` ou novo teste ao lado do repositório.
> (testability-1) 3 casos: pending→settle carimba; settle→settle não move; error→settle sobrescreve.

**Resultado Esperado**
> 3 testes de regex → 3 regex + testes de efeito real; efeito de re-settle coberto: 0 → 1 cenário (meta do FT) / casos de `settle`/`fail` em PG real 0 → 3 (meta da Testability). Meta consolidada: 3 casos.

**Métricas de sucesso**
- Casos de efeito real de `settle`/`fail` em PG real: 0 → 3
- Regex passa a ser complementar, não a única prova

**Risco de não fazer**
> Uma refatoração do SQL que preserve o regex mas mude o efeito desloca remessas entre semanas da métrica sem alarme. Erro não toca dinheiro nem o ledger.

**Dependências**: Nenhuma

---

### [security-1] Decidir e registrar a audiência do valor SISPAG em /metricas

**QA**: Security
**Tactic alvo**: Authorize Actors
**Esforço**: S
**Findings**: F-security-1

**Problema**
> O KPI de R$ e % SISPAG passou a ser servido por `metricas:ver`, sem exigir `sispag:ver`. Não há registro de quantos usuários têm uma permissão sem a outra.

**Melhoria Proposta**
> Consultar em produção os usuários com `metricas:ver` e sem `sispag:ver`. Se houver, aceitar por escrito (nota na ADR-0056/0053, pois Métricas é visão gerencial) ou omitir as chaves `sispag_*` na rota quando o usuário não tiver `sispag:ver`.

**Resultado Esperado**
> Audiência do dado SISPAG documentada. Usuários com metricas:ver sem sispag:ver: desconhecido → contado e aceito, ou 0.

**Métricas de sucesso**
- Usuários com metricas:ver sem sispag:ver: não medido → contado (0 ou aceito)

**Risco de não fazer**
> A conta `kavex-report-ciclo` ou um analista de outro módulo passa a receber valores de pagamento sem que ninguém tenha decidido isso.

**Dependências**: Nenhuma

---

### [deployability-1] Criar reverse executável da 0070

**QA**: Deployability (citado também por Availability, Fault Tolerance e Integrability como "reversão só em prosa")
**Tactic alvo**: Rollback
**Esforço**: S
**Findings**: F-deployability-1 (relacionado: F-availability-3)

**Problema**
> A 0070 faz backfill e recria a função de métricas, mas o caminho de volta está só em comentário. As migrations 0054/0055/0063/0066/0069 têm `rollbacks/*.rollback.sql`.

**Melhoria Proposta**
> Adicionar `rollbacks/0070_metricas_ciclo_sispag.rollback.sql` com o corpo da função da 0065 e `UPDATE ... SET encerrado_em = NULL` (coluna pode ficar, é inerte). Registrar no `rollbacks.test.ts` (lista de reverses esperada).

**Resultado Esperado**
> Reverse aplicável com um `psql -f`; teste garante correspondência migration/reverse. Reverses para migrations com backfill: 0 de 1 → 1 de 1.

**Métricas de sucesso**
- Reverse executável da 0070: ausente → presente
- Teste `rollbacks.test.ts` verde com o novo par

**Risco de não fazer**
> Reversão manual e sujeita a erro na próxima regressão da série de métricas (recompor ~260 linhas sob pressão).

**Dependências**: Nenhuma

---

### [integrability-1] Pinar o contrato de `/metricas/ciclo` com teste de fixture

**QA**: Integrability (mescla Modifiability)
**Tactic alvo**: Contract testing (Encapsulate)
**Esforço**: S
**Findings**: F-integrability-2, F-modifiability-2
**Cards mesclados**: integrability-1, modifiability-3 (este era P3; a mescla assume P2 do card principal)

**Problema**
> O payload é consumido pelo frontend e pela skill `kavex-report-ciclo` por chaves em string, sem schema nem fixture; o delta adiciona 2 chaves nesse conjunto.
> (modifiability-3) As chaves (`sispag_titulos_aceitos_pct`, ...) existem em dois lugares (SQL e `METRICA`) sem verificação cruzada.

**Melhoria Proposta**
> Teste de contrato (Contract testing) em `routes/metricas.test.ts` com fixture JSON contendo as chaves esperadas, e Zod no `fetchMetricasCiclo` (`lib/metricas.ts`) que tolere chaves desconhecidas. Registrar as chaves como contrato no ADR-0056.
> (modifiability-3) Teste que compara o conjunto de chaves devolvido pela função (test:sql) com `METRICA`, nos dois sentidos.

**Resultado Esperado**
> Renomear uma chave quebra o CI. 0 testes de contrato → 1 fixture cobrindo todas as chaves de `METRICA`; chave renomeada num lado quebra o CI, não a tela.

**Métricas de sucesso**
- Chaves do contrato cobertas por teste: 0 → 100% (`METRICA`)
- Chaves com verificação cruzada SQL ↔ front: 0 → 10

**Risco de não fazer**
> Renomeação silenciosa quebra o report semanal; KPI mostra "—" silenciosamente após renomear.

**Dependências**: modifiability-2 (opcional)

---

### [testability-2] Caso de borda de fuso na semana do SISPAG

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S
**Findings**: F-testability-2

**Problema**
> Nenhuma remessa semeada fica perto do limite semanal; a conversão para `America/Sao_Paulo` só é verificada por regex.

**Melhoria Proposta**
> Semear remessa encerrada 23:59 -03 no último dia da semana B e outra 00:01 -03 na semana C; assertar semanas distintas.

**Resultado Esperado**
> Casos de borda de janela no SISPAG: 0 → 2.

**Métricas de sucesso**
- Casos de borda de fuso: 0 → 2

**Risco de não fazer**
> Erro de semana em remessa noturna, só visto pelo analista. As remessas rodam ~16h BRT, então o risco hoje é baixo.

**Dependências**: Nenhuma

---

### [modifiability-2] Registry de métricas no frontend

**QA**: Modifiability
**Tactic alvo**: Defer Binding
**Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> KPIs, colunas do histórico e skeleton são escritos à mão por métrica (5 pontos por frente).

**Melhoria Proposta**
> Defer Binding: array `FRENTES = [{titulo, pctKey, rsKey, rotulo}]` em `lib/metricas.ts`; `page.tsx` mapeia KPI, colunas e skeleton (`length`/`columns` derivados) a partir dele.

**Resultado Esperado**
> Nova frente = 1 entrada no array.

**Métricas de sucesso**
- Pontos editados por frente: 5 → 1

**Risco de não fazer**
> Divergência skeleton/tabela a cada frente nova; custo pequeno mas recorrente.

**Dependências**: Nenhuma

---

### [modifiability-1] Isolar a definição de cada frente em metricas_ciclo

**QA**: Modifiability (mescla Availability)
**Tactic alvo**: Abstract Common Services (Removal from Service)
**Esforço**: M
**Findings**: F-modifiability-1, F-modifiability-3, F-availability-1
**Cards mesclados**: modifiability-1, availability-2

**Problema**
> Cada frente nova recopia a função inteira (3 cópias, 264 linhas na última) e a versão vigente só se descobre lendo a migration mais recente.
> (availability-2) As 3 frentes saem de uma só função SQL; erro na CTE de uma indisponibiliza toda a tela.

**Melhoria Proposta**
> Refactor: extrair cada frente para função SQL própria (`metricas.frente_permutas(...)`, `frente_sispag(...)`) e deixar `metricas_ciclo` como união. A próxima frente edita só a função dela. Alternativa mínima: teste de contrato comparando as CTEs antigas com a versão anterior.
> (availability-2) Leitura por frente no service (ou funções por frente), devolvendo as demais com marca `indisponível`. Só vale se houver evidência de erro em produção.

**Resultado Esperado**
> Nova frente = 1 função nova + 1 linha na união, sem recopiar CTEs alheias. Frentes servidas independentemente: 0 de 3 → 2 de 3 disponíveis com 1 CTE falha.

**Métricas de sucesso**
- Linhas recopiadas por nova frente: ~215 → < 40
- Frentes disponíveis com 1 CTE falha: 0 de 3 → 2 de 3

**Risco de não fazer**
> A próxima frente adiciona nova cópia de ~250 linhas e mais risco de regressão em Permutas; um incidente de métricas apaga o relatório inteiro (0 incidentes observados até hoje).

**Dependências**: Nenhuma; fazer junto com a próxima frente de métrica.

---

## P3 — Baixo

### [availability-3] Garantir transação explícita nas migrations de função + backfill

**QA**: Availability
**Tactic alvo**: Transactions
**Esforço**: S
**Findings**: F-availability-3

**Problema**
> A 0070 mistura DDL, backfill e `CREATE OR REPLACE` sem BEGIN/COMMIT visível; a reversão só existe em comentário.

**Melhoria Proposta**
> Transactions: confirmar que o runner executa cada arquivo em transação, ou embrulhar em `BEGIN; ... COMMIT;`; guardar o down como script (coberto por deployability-1).

**Resultado Esperado**
> Migração tudo-ou-nada: estado parcial possível → impossível.

**Métricas de sucesso**
- Estado parcial após falha: possível → impossível

**Risco de não fazer**
> Baixo; a migration é idempotente. O autor do QA não verificou se o runner já envolve o arquivo em transação.

**Dependências**: Nenhuma

---

### [deployability-2] Cobrir com teste a página de métricas sem as chaves SISPAG

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S
**Findings**: F-deployability-2
**Nota do consolidador**: severidade rebaixada de P2 para P3 e escopo reduzido. A hipótese do finding (FE antes do BE renderizaria `NaN`/`undefined`) foi verificada pelo orquestrador: `page.tsx` exibe "—" e o rodapé cai em "sem remessa na semana" quando as chaves `sispag_*` estão ausentes. Resta só travar esse comportamento com teste, se ainda não existir.

**Problema**
> FE e BE deployam separadamente; a tela nova depende de 2 chaves que só existem após a migration 0070.

**Melhoria Proposta**
> Confirmar/cobrir em `page.test.tsx` o caso "linhas sem `sispag_*`": exibir "—" em vez de valor quebrado. Alternativa: documentar no `DEPLOY.md` a ordem BE antes de FE.

**Resultado Esperado**
> Descompasso de deploy não gera `NaN`/vazio visível; 1 teste novo cobre o caso.

**Métricas de sucesso**
- Testes do caso "chave ausente": 0 → 1 (conferir se já existe antes de criar)

**Risco de não fazer**
> Baixo: o comportamento existe no código; o risco é uma regressão futura sem teste.

**Dependências**: Nenhuma

---

### [testability-3] Fechar lacunas menores (idempotência 0070, fallback criado_em, parcial no FE)

**QA**: Testability
**Tactic alvo**: Recordable Test Cases
**Esforço**: S
**Findings**: F-testability-3

**Problema**
> Rodar a 0070 duas vezes, linha `settled` com `encerrado_em` NULL e `parcial` do SISPAG na página não têm caso.

**Melhoria Proposta**
> 1 caso de reexecução do backfill, 1 caso do fallback na view, 1 caso FE de semana parcial.

**Resultado Esperado**
> Casos SISPAG em PG real 4 → 6; testes FE de SISPAG 2 → 3.

**Métricas de sucesso**
- Casos SISPAG na integração: 4 → 6

**Risco de não fazer**
> Baixo; lacuna residual.

**Dependências**: Nenhuma

---

### [performance-1] Agregar SISPAG por lote e limitar às semanas exibidas na função de métricas

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: S
**Findings**: F-performance-1, F-performance-2

**Problema**
> A CTE `sispag_itens` do 0070 resolve o LATERAL uma vez por item e varre toda a história de itens a cada `GET /metricas/ciclo`. Hoje custa ~300 comparações (30 itens × ≤10 remessas), sem efeito visível; é crescimento linear sem teto.

**Melhoria Proposta**
> Em migration futura: resolver a 1ª remessa `settled` uma vez por lote (CTE agrupada por `lote_id`) e juntar aos itens; filtrar itens pela janela das semanas exibidas. Executar só quando o volume passar de ~5k itens ou a função passar de 100 ms; medir antes com `EXPLAIN ANALYZE`.

**Resultado Esperado**
> Execuções do lookup por chamada: nº de itens (~30) → nº de lotes (~10); tempo da função estável com o crescimento do histórico.

**Métricas de sucesso**
- Execuções do lookup lateral por chamada: ~30 → ~10 (nº de lotes)
- Tempo p95 da função de métricas: medir baseline → manter < 100 ms com 10x o volume

**Risco de não fazer**
> Baixo; com 10x o volume atual (~300 itens) ainda desprezível.

**Dependências**: Nenhuma; adiar até haver EXPLAIN em produção.

---

### [security-2] Registrar em log o acesso a /metricas/ciclo

**QA**: Security
**Tactic alvo**: Audit Trail
**Esforço**: S
**Findings**: F-security-2

**Problema**
> A rota devolve agregados financeiros, agora incluindo pagamentos, e não registra quem leu (pré-existente).

**Melhoria Proposta**
> Log via `LogService` com usuário e janela consultada, sem valores. Baixa prioridade; junto de outras leituras sensíveis se houver trabalho de auditoria de leitura.

**Resultado Esperado**
> Acessos rastreáveis: 0 → 1 linha de log por consulta.

**Métricas de sucesso**
- Leituras auditadas: 0% → 100%

**Risco de não fazer**
> Sem impacto operacional relevante; só perde a capacidade forense.

**Dependências**: Nenhuma
