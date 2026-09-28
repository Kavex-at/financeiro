---
type: regis-review-kanban
run_id: 2026-09-28-1534-metricas-encerramento
total: 13
counts: { p0: 0, p1: 1, p2: 9, p3: 3 }
---

# Kanban — financeiro — 2026-09-28-1534-metricas-encerramento

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado
> Esperado. Ordem: P0 (S → XL), depois P1, P2, P3, cada bloco ordenado por esforço (S < M < L < XL).
>
> Escopo desta revisão: DELTA da branch `worktree-metrica-ciclo-data-conclusao` vs. `origin/main`
> (ADR-0051, migration `0064_metricas_ciclo_data_pelo_encerramento.sql`). Os 8 agentes de QA
> produziram 16 cards ao todo; 2 pares foram consolidados por serem a mesma causa-raiz com a mesma
> solução técnica (ver notas em cada card consolidado), e 1 card (`fault-tolerance-1`) foi removido
> da lista ativa por decisão do orquestrador — ver seção "Resolvido nesta revisão" ao final.

## P0 — Crítico

Nenhum finding atingiu severidade P0 nesta revisão.

## P1 — Alto

### [testability-1] Testar a transição error → settled (e settled → settled) contra Postgres real, com o trigger 0057 ativo

**QA**: Testability + Fault Tolerance (consolida `fault-tolerance-2` — mesma causa-raiz, mesma solução)
**Tactic alvo**: Executable Assertions / Sandbox / Self-Test
**Esforço**: S (≤1d) — infraestrutura (`describeComBanco`, Postgres 17 no CI, `emTransacao`) já existe e é reaproveitada
**Findings**: F-testability-1, F-fault-tolerance-2

**Problema**
> Os dois repositórios de ledger tocados pela delta (`PermutaExecucaoRepository`, `SolicitacaoNumerarioExecucaoRepository`) implementam a regra central da ADR-0051 — carimbar `encerrado_em` no primeiro encerramento e sobrescrevê-lo quando um retry de `error` liquida — mas os 5 testes novos só verificam que o texto do `UPDATE` contém o `CASE` esperado, via mock de `PostgreeDatabaseClient`. Nenhum teste, unitário ou de integração, executa essas queries contra um Postgres real; o único teste de integração que valida o comportamento (`vwMetricasCiclo.integration.test.ts`) insere `encerrado_em` diretamente via SQL, sem passar pelo repositório. Adicionalmente, a suíte que roda contra Postgres real aplica a migration do trigger `permuta_execucao_bloqueia_reabertura` (0057), mas nunca chama os métodos do repositório — a prova de que o `CASE WHEN status ...` lê o valor antigo da linha e não colide com o trigger existe apenas como verificação manual desta revisão.

**Melhoria Proposta**
> Adicionar, dentro de `vwMetricasCiclo.integration.test.ts` (reaproveitando `describeComBanco` + `emTransacao`, assim o teste continua coberto pelo job `backend-sql`/`test:sql` sem mexer no glob), casos que instanciam `PermutaExecucaoRepository` e `SolicitacaoNumerarioExecucaoRepository` com um `PostgreeDatabaseClient` real e chamam: (a) `markSettled` duas vezes na mesma chave — preserva o `encerrado_em` do primeiro settle; (b) `beginExecution → markError → markSettled` — o `encerrado_em` nasce NULL, vira T1 no `markError`, vira T2 (≠ T1) no `markSettled` seguinte; (c) tentativa de reabrir/`markError` sobre uma linha com baixa já confirmada pelo trigger 0057 — deve ser recusada. Tactic alvo: Executable Assertions (tornar a garantia comportamental) e Sandbox (reusar a transação isolada já existente).

**Resultado Esperado**
> Testes de integração (Postgres real) exercitando `markSettled`/`markParcial`/`markError` dos dois repositórios: 0 → ≥3. Os 5 testes de regex existentes continuam como guarda estática rápida, agora suplementados por prova de execução real do ramo `error → settled` que é o motivo de existir da ADR-0051, e pela interação com o trigger 0057.

**Métricas de sucesso**
- Testes de integração (DB real) invocando `markSettled`/`markParcial`/`markError`: 0 → ≥3
- Cobertura do ramo `error(T1) → settled(T2)` sobrescrevendo `encerrado_em`: não coberto → coberto por execução real
- Cobertura da recusa do trigger 0057 sobre baixa confirmada: verificação manual → teste automatizado

**Risco de não fazer**
> Um refactor futuro do `UPDATE` (reordenar `SET`, trocar para query builder) inverte silenciosamente a semântica `COALESCE`/`CASE` e reintroduz a distorção de R$ 503 mil já medida e corrigida — com CI verde, porque o único teste que hoje pegaria isso (regex de string) só quebra se a string mudar, não se o comportamento mudar.

**Dependências**: nenhuma.

## P2 — Médio

### [availability-1] Adicionar barreira de esquema para a imutabilidade de encerrado_em

**QA**: Availability
**Tactic alvo**: Sanity Checking
**Esforço**: S (≤1d)
**Findings**: F-availability-1

**Problema**
> O invariante "encerrado_em não anda para trás de um encerramento terminal (settled/parcial)" existe só como convenção repetida em 2 repositórios (PermutaExecucaoRepository, SolicitacaoNumerarioExecucaoRepository). Nenhuma barreira de esquema impede uma terceira escrita de violá-lo.

**Melhoria Proposta**
> Adicionar um TRIGGER BEFORE UPDATE (ou CHECK combinado com uma função) em permuta_alocacao_execucao e solicitacao_numerario_execucao que rejeite (ou registre) qualquer tentativa de mover encerrado_em para uma linha cujo status OLD já era settled/parcial e cujo encerrado_em OLD não era NULL. Escopo: nova migration (0065), sem tocar os repositórios existentes.

**Resultado Esperado**
> Invariante passa a ser garantido pelo banco, não só pela disciplina de 2 arquivos TypeScript. Métrica: 0 → 1 barreira de esquema (CHECK/TRIGGER) protegendo encerrado_em.

**Métricas de sucesso**
- Barreiras de esquema sobre encerrado_em: 0 → ≥1

**Risco de não fazer**
> Um script de correção manual futuro (ou uma nova frente reaproveitando o padrão sem repetir o CASE WHEN) reintroduz silenciosamente o mesmo defeito que a ADR-0051 corrigiu, e ninguém percebe até o número publicado errar de novo.

**Dependências**: nenhuma.

---

### [deployability-1] Automatizar a verificação pós-deploy de métricas recalculadas

**QA**: Deployability
**Tactic alvo**: Deployment observability
**Esforço**: S (≤1d)
**Findings**: F-deployability-1

**Problema**
> A migration 0064 recalcula um número já publicado à Columbia (R$ 503.066,69 conhecidos em 2 linhas), mas a única conferência prevista é uma query manual colada em ontology/_inbox/. Não há gate de CI nem cron que confirme, contra o banco real, que o recálculo saiu como o ADR-0051 previu.

**Melhoria Proposta**
> Adicionar um passo (script npm run verify:metricas-ciclo ou job leve) que roda a consulta de ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md contra produção logo após o boot aplicar uma migração em metricas.*, e publica o resultado (log estruturado ou anexo ao report do ciclo) em vez de depender de alguém copiar/colar à mão.

**Resultado Esperado**
> Toda migração que mexe em metricas.metricas_ciclo() sai do boot com uma confirmação automatizada anexada ao log/relatório. Métrica: 0 → 1 verificação automatizada por deploy de migração em metricas.*.

**Métricas de sucesso**
- Verificações automatizadas pós-deploy de migrações em metricas.*: 0 → 1 por deploy
- Tempo entre deploy e confirmação do número recalculado: indeterminado (manual) → < 1 execução de boot

**Risco de não fazer**
> Um próximo recálculo de série publicada (padrão já repetido entre 0058/0060 e 0064) some novamente na dependência de alguém lembrar de rodar a query manual antes do report do ciclo.

**Dependências**: nenhuma.

---

### [modifiability-1] Amarrar o invariante de status terminal ao tipo TypeScript já existente — consolida integrability-1

**QA**: Modifiability + Integrability (consolida `integrability-1` — mesma causa-raiz, mesma solução técnica)
**Tactic alvo**: Encapsulate / Abstract Common Services
**Esforço**: S (≤1d)
**Findings**: F-modifiability-1, F-integrability-1

**Problema**
> O carimbo de encerrado_em decide quais status "congelam" a data usando 3 literais SQL independentes (PermutaExecucaoRepository.ts x2, SolicitacaoNumerarioExecucaoRepository.ts x1), nenhum derivado do union ExecucaoStatus/RecebimentoExecucaoStatus que já existe no mesmo arquivo — 5 sites de escrita ao todo (contando markError), 0 abstração compartilhada. Um novo status terminal futuro não quebra typecheck nem lint — só reabre silenciosamente o bug de R$ 503 mil que a ADR-0051 corrige agora. Cada integração de escrita futura no roadmap (Conexos fin010 write-side, Nexxera) que precisar contar para as mesmas métricas terá que replicar a expressão à mão, com o mesmo risco de drift.

**Melhoria Proposta**
> Extrair uma constante exportada por ledger (ex.: PERMUTA_ENCERRAMENTO_STATUSES: readonly ExecucaoStatus[] = ['settled', 'parcial'] ao lado do export type ExecucaoStatus em PermutaExecucaoRepository.ts, e equivalente em SolicitacaoNumerarioExecucaoRepository.ts), usada para montar o IN (...) nos métodos de escrita. Adicionar um teste que percorre ExecucaoStatus/RecebimentoExecucaoStatus garantindo que todo novo status seja classificado explicitamente (terminal ou não) antes de compilar, e 1 teste cruzando os dois repositórios provando que a doutrina do ADR-0051 é a mesma nos dois ledgers.

**Resultado Esperado**
> 5 sites de escrita com a expressão duplicada → 1 fonte compartilhada por ledger (2 no total), com teste de exaustividade e teste cross-repo. Métrica: sites com status terminal "solto" em string SQL sem referência ao tipo: 5 → 0; testes de consistência cross-repo (Permuta x SN): 0 → ≥1.

**Métricas de sucesso**
- Ocorrências de status terminal codificado sem referência ao tipo: 5 → 0
- Teste de exaustividade por union de status: inexistente → 1 por ledger
- Teste de consistência cross-repo: 0 → ≥1

**Risco de não fazer**
> Próxima adição de status terminal (ex.: baixa revisada manualmente) ou próxima integração de escrita (Conexos fin010, Nexxera) reabre a mesma classe de bug que já custou 1 ADR + 1 migration de backfill + comunicação ao cliente — sem teste que pegue o desvio, porque cada repositório só valida a própria cópia.

**Dependências**: nenhuma.

### [integrability-2] Sinalizar no payload quando uma janela já apurada foi recalculada desde a última leitura

**QA**: Integrability
**Tactic alvo**: Versioning strategy / Backward-compatibility shims
**Esforço**: S (≤1d) para o registro da decisão; M (2-5d) se implementado
**Findings**: F-integrability-2

**Problema**
> Este delta muda, por decisão deliberada, o valor de semanas já publicadas ao cliente (R$ 503.066,69 em 2/190 linhas na última medição). O contrato de wire (MetricaCiclo) não tem nenhum campo que sinalize essa quebra para um consumidor automatizado — hoje só o kavex-report-ciclo é o consumidor, e ele não faz cache entre ciclos, mas o roadmap já prevê mais integrações lendo dados do financeiro.

**Melhoria Proposta**
> Não é obrigatório para este delta (nenhum consumidor atual depende de imutabilidade), mas registrar em ontology/_inbox/metricas-ciclo-regis-followups.md a decisão de adicionar, na próxima mudança de contrato, um campo leve (ex.: hash/checksum da leitura, ou series_version) que permita a um consumidor detectar retroatividade sem comparar valor a valor.

**Resultado Esperado**
> Próxima correção retroativa (haverá outra, dado que o ledger é upsert por natureza) é detectável programaticamente por quem consome a API, não só por quem lê o ADR. Métrica: mecanismo de sinalização de revisão — ausente → definido em ADR/contrato.

**Métricas de sucesso**
- Mecanismo de sinalização de revisão no payload: ausente → definido em ADR/contrato

**Risco de não fazer**
> Um futuro consumidor que arquive/cacheie leituras semanais (razoável para "semana fechada") herda dados obsoletos sem meio de saber que deveria reler.

**Dependências**: nenhuma.

---

### [fault-tolerance-3] Rodar a consulta de validação do backfill contra produção e quantificar o viés residual

**QA**: Fault Tolerance
**Tactic alvo**: Reconcile
**Esforço**: S (≤1d, depende só de acesso de leitura a produção)
**Findings**: F-fault-tolerance-3

**Problema**
> O backfill da 0064 (encerrado_em = atualizado_em) é uma aproximação declarada, com o mesmo viés conhecido do bug original para linhas terminais re-clicadas antes da migration. O tamanho desse viés residual pós-fix não foi medido (leitura de produção negada nesta sessão).

**Melhoria Proposta**
> Executar a consulta já preparada em ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md contra produção, comparando encerrado_em pós-backfill com o instante real de liquidação reconstruído a partir de erp_response/histórico de auditoria disponível, e anexar o resultado ao report do ciclo em que este delta entra.

**Resultado Esperado**
> Número concreto de linhas (e R$) ainda afetadas pelo viés residual do backfill, documentado no report — ou confirmação de que são 0. Métrica: viés residual, "não medido" → valor numérico.

**Métricas de sucesso**
- Viés residual quantificado: desconhecido → valor numérico (linhas e R$)

**Risco de não fazer**
> A Columbia pode continuar recebendo, para um subconjunto pequeno e não identificado de baixas antigas, o mesmo tipo de número errado que este ciclo inteiro existiu para corrigir — sem saber que ainda existe.

**Dependências**: acesso de leitura ao Postgres de produção (negado ao agente nesta sessão).

---

### [security-1] Registrar a origem do carimbo de encerrado_em para distinguir backfill aproximado de encerramento real

**QA**: Security
**Tactic alvo**: Audit Trail
**Esforço**: S (≤1d)
**Findings**: F-security-1

**Problema**
> A migração 0064 backfilled ~190 linhas usando atualizado_em como proxy de encerrado_em, e a própria migração documenta que essa aproximação pode estar errada para linhas re-clicadas pós-liquidação. Hoje não há como, olhando a linha, saber se o encerrado_em é exato (gravado por markSettled/markParcial/markError depois da 0064) ou aproximado (backfill).

**Melhoria Proposta**
> Adicionar uma coluna booleana leve (encerrado_em_aproximado ou similar) gravada true só pelo backfill da 0064 e nunca pelas escritas normais dos repositórios, permitindo que o report do ciclo e qualquer auditoria futura filtrem/anotem os pontos de baixa confiança sem precisar reconstruir a lógica da migração. Arquivos: nova migration 006X, PermutaExecucaoRepository.ts, SolicitacaoNumerarioExecucaoRepository.ts.

**Resultado Esperado**
> A trilha de auditoria distingue explicitamente "encerramento medido" de "encerramento reconstruído por aproximação" — 0 linhas ambíguas hoje → 100% das linhas com proveniência marcada.

**Métricas de sucesso**
- Linhas com proveniência de encerrado_em marcada: 0% → 100%
- Ressalva do report do ciclo: genérica → escopada às semanas com linhas aproximadas

**Risco de não fazer**
> Se uma reconciliação futura (auditoria externa, cliente, ou o próprio time) encontrar divergência num valor de semana passada, não há como hoje distinguir "erro no sistema" de "aproximação documentada do backfill de 28/09" sem reler o código da migração.

**Dependências**: nenhuma.

---

### [performance-1] Registrar a expressão COALESCE(encerrado_em, criado_em) como a assinatura definitiva a indexar quando performance-1 (pré-existente) for tratado

**QA**: Performance
**Tactic alvo**: Increase Resource Efficiency
**Esforço**: S (≤1d) — é só atualizar a anotação do follow-up existente, não codar índice
**Findings**: F-performance-1, F-performance-2

**Problema**
> O performance-1 pré-existente (custo O(janelas x linhas) de metricas_ciclo()) segue aberto e inalterado por este delta — medido 12,8 ms → 193,0 ms (W=6 → W=111, 5.000 linhas sintéticas). O delta muda o predicado de junção de criado_em para COALESCE(encerrado_em, criado_em), e nenhum índice cobre nenhuma das duas colunas. Sem registrar isso agora, o próximo agente que pegar o performance-1 vai redescobrir do zero que o índice precisa ser de expressão sobre COALESCE, não sobre uma coluna simples.

**Melhoria Proposta**
> Atualizar o card performance-1 existente (em ontology/_inbox/metricas-historico-6-semanas-regis-followups.md) com a assinatura exata do índice necessário: CREATE INDEX ... ON permuta_alocacao_execucao ((COALESCE(encerrado_em, criado_em) AT TIME ZONE 'America/Sao_Paulo')) WHERE dry_run = false; e equivalente em solicitacao_numerario_execucao. Não implementar agora (ledger ainda pequeno, sem urgência) — só documentar.

**Resultado Esperado**
> Quando performance-1 for endereçado: tempo de implementação do índice reduzido (decisão de design já registrada), sem precisar re-derivar a expressão a partir do SQL da 0064.

**Métricas de sucesso**
- Anotação do índice de expressão presente no follow-up performance-1: ausente → presente

**Risco de não fazer**
> Quando o ledger crescer o suficiente para o performance-1 virar prioridade (projeção: ~1-2 anos), quem pegar o card vai precisar reconstruir esta análise (duas colunas nuláveis, AT TIME ZONE, COALESCE) do zero.

**Dependências**: card performance-1 do ciclo metricas-historico-6-semanas (não duplicar, apenas enriquecer).

### [availability-2] Distinguir "falha nova" de "falha antiga que retentou" na métrica de ciclo

**QA**: Availability
**Tactic alvo**: Condition Monitoring
**Esforço**: M (2-5d) — nova coluna + backfill + ajuste da função + testes
**Findings**: F-availability-2

**Problema**
> markError carimba encerrado_em = now() a cada falha, sem limite. Uma execução presa em retry por semanas aparece só na semana do último erro, nunca nas semanas anteriores em que já estava falhando — a série perde a idade real do problema. Nota: este comportamento é intencional por decisão da ADR-0051 (D1); este card não o contraria, apenas adiciona a observabilidade que falta em cima da decisão já tomada.

**Melhoria Proposta**
> Preservar também o instante da PRIMEIRA falha (ex.: nova coluna primeiro_erro_em, carimbada só quando NULL) e expor no relatório de ciclo (ou num painel operacional separado) quantas execuções em error têm primeiro_erro_em mais antigo que N semanas — sinal de item cronicamente preso, hoje invisível na métrica agregada.

**Resultado Esperado**
> Operação consegue distinguir "1 falha nova esta semana" de "1 falha de 6 semanas atrás que só tentou de novo". Métrica: 0 → 1 indicador de idade de falha crônica na série de métricas.

**Métricas de sucesso**
- Indicador de idade de falha crônica na métrica de ciclo: ausente → presente

**Risco de não fazer**
> Um título/baixa preso há meses continua parecendo "problema desta semana" toda vez que o agendador tenta de novo, escondendo do analista quanto tempo o item já está fora do fluxo automático.

**Dependências**: nenhuma; pode vir depois do availability-1 (mesma família de colunas de auditoria).

---

### [modifiability-2] Decompor metricas.metricas_ciclo para não exigir cópia integral a cada regra nova

**QA**: Modifiability, Performance
**Tactic alvo**: Refactor / Reduce Size of Module
**Esforço**: M (2-5d, inclui regressão dos 24 testes de integração SQL existentes)
**Findings**: F-modifiability-2

**Problema**
> A função metricas.metricas_ciclo (144 linhas) já foi redefinida por inteiro uma vez em 14 dias (0058 → 0064) para mudar ~5 linhas (~3,5% do corpo). Sem decomposição, toda futura mudança de regra de data/janela exige reescrever e revisar o corpo inteiro de novo, com risco de copy-paste divergente entre os ramos Permutas/Recebimentos.

**Melhoria Proposta**
> Extrair a resolução de data por execução (COALESCE(encerrado_em, criado_em) AT TIME ZONE 'America/Sao_Paulo') e a filtragem por janela em funções/CTEs menores e nomeadas por frente (ex.: metricas.execucoes_permutas_datadas(), metricas.execucoes_recebimentos_datadas()), de forma que metricas_ciclo apenas componha essas partes. Tocar: nova migration em cima da 0064, vwMetricasCiclo.test.ts (guards) e vwMetricasCiclo.integration.test.ts.

**Resultado Esperado**
> Próxima mudança de regra de data/janela toca uma função de ~10-20 linhas por frente, não a função de 144 linhas inteira.

**Métricas de sucesso**
- Linhas do corpo de metricas_ciclo que precisam ser revalidadas a cada mudança de regra: ~144 → ≤20 por frente
- Redefinições completas da função por ciclo de 2 semanas: 1 (observado) → tende a 0 após a decomposição

**Risco de não fazer**
> Terceira correção de regra de métrica repete o padrão de copy-paste de 144 linhas, com o mesmo risco de regressão silenciosa por frente que gerou o incidente dos R$ 503 mil.

**Dependências**: nenhuma; pode ser feito independentemente do card modifiability-1.

## P3 — Baixo

### [deployability-2] Desambiguar "coluna aditiva + backfill" na tabela de decisão do runbook de rollback

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S (≤1d)
**Findings**: F-deployability-2

**Problema**
> docs/runbooks/rollback.md classifica migrações em "aditiva" (segura) ou "destrutiva, inclui backfill que sobrescreve" (não reverta sozinho), mas a 0064 — como a 0058/0060 antes dela — é as duas coisas: coluna nova + UPDATE que preenche linhas existentes. Sob a meta de "reverter em ≤5min sem consultar ninguém", a tabela não deixa claro que "backfill numa coluna recém-criada" pertence à linha segura.

**Melhoria Proposta**
> Acrescentar uma linha (ou nota) explícita: "coluna nova + backfill que só preenche a própria coluna nova, nunca sobrescreve dado existente em outra coluna → segura, mesma linha de 'aditiva'". Referenciar a 0064 como exemplo real.

**Resultado Esperado**
> Um operador sob pressão decide em ≤5min sem precisar interpretar qual das duas linhas da tabela se aplica a uma migração no padrão coluna-nova-mais-backfill.

**Métricas de sucesso**
- Ambiguidade da tabela de decisão para o padrão "coluna nova + backfill": presente → resolvida

**Risco de não fazer**
> MTTR maior num incidente futuro que reaproveite o mesmo padrão de migração (já seria o 3º caso: 0058/0060, 0064, e o próximo).

**Dependências**: nenhuma.

---

### [security-2] Blindar markError com a mesma guarda de terminal que markSettled/markParcial já têm para encerrado_em

**QA**: Security (overlap com Fault Tolerance)
**Tactic alvo**: Audit Trail
**Esforço**: S (≤1d)
**Findings**: F-security-2

**Problema**
> markError sobrescreve status e (desde este delta) encerrado_em incondicionalmente, sem o CASE WHEN status IN (...) THEN COALESCE(...) que protege as escritas irmãs markSettled/markParcial. Nenhum teste do delta cobre a sequência markSettled seguido de markError sobre a mesma idempotency_key.

**Melhoria Proposta**
> Espelhar em markError a mesma cláusula CASE WHEN status IN ('settled', 'parcial') THEN ... ELSE now() END usada em markSettled/markParcial para encerrado_em, e considerar o mesmo tratamento para status (preservar terminal), com um teste de integração que exercite explicitamente a corrida markSettled → markError sobre a mesma chave. Arquivos: PermutaExecucaoRepository.ts, SolicitacaoNumerarioExecucaoRepository.ts, mais o teste de integração.

**Resultado Esperado**
> Uma liquidação real (settled/parcial) nunca mais pode ser revertida para error por uma escrita tardia/corrida no ledger — hoje 2 de 3 métodos de escrita terminal protegem consistentemente o par (status, encerrado_em) → alvo 3 de 3.

**Métricas de sucesso**
- Métodos de escrita terminal com guarda simétrica: 2 de 3 (markSettled, markParcial) → 3 de 3
- Teste cobrindo a corrida markSettled→markError: 0 → 1

**Risco de não fazer**
> Risco de baixa probabilidade (exige corrida real entre duas chamadas sobre a mesma chave) mas alto custo se ocorrer — uma baixa realmente liquidada apareceria como erro na trilha usada para a métrica oficial do ciclo, exigindo investigação manual para provar que o dinheiro efetivamente moveu.

**Dependências**: nenhuma; pode andar junto com qualquer follow-up de Fault Tolerance sobre o mesmo par de métodos.

---

### [availability-3] Isolar migrações de baixo risco do boot fail-fast do caminho crítico

**QA**: Availability, Deployability
**Tactic alvo**: Removal from Service
**Esforço**: L (1-2 sem) — decisão de arquitetura + eventual split do BootMigrator, não uma correção pontual
**Findings**: F-availability-3

**Problema**
> O BootMigrator aborta o boot inteiro do backend se qualquer migração pendente falhar — incluindo a 0064, que só ajusta uma coluna de relatório, mas roda ALTER/UPDATE sobre as mesmas tabelas de ledger que Permutas e Recebimentos escrevem em produção. Uma falha nessa migração de baixo valor de negócio derrubaria a disponibilidade de todo o sistema de execução financeira, não só do relatório.

**Melhoria Proposta**
> Não é urgente reescrever o BootMigrator agora — mas registrar a política explicitamente: migrações que só alimentam relatório/observabilidade (sem mudar contrato de escrita das Frentes) deveriam, quando praticável, ser aditivas e testadas para tolerar skip/retry sem exigir boot fail-fast, ou aplicadas fora do caminho de boot (job manual supervisionado, como já existe para os rollbacks).

**Resultado Esperado**
> Próxima migração "só de métrica" nasce com essa pergunta feita explicitamente na revisão: "esta migração PRECISA compartilhar o fail-fast do caminho crítico?". Métrica: decisão registrada em ADR/checklist do pipeline de migração, não um número.

**Métricas de sucesso**
- N/A — item é de política/arquitetura, não de métrica pontual observável nesta review.

**Risco de não fazer**
> Aceitável no curto prazo (baixa probabilidade, migração testada e transacional); risco cresce se migrações futuras de baixo risco continuarem sendo agrupadas ao mesmo fail-fast sem essa pergunta ser feita.

**Dependências**: nenhuma; é o card de menor urgência da lista ativa.

## Resolvido nesta revisão (sem ação de código)

### [fault-tolerance-1] RESOLVIDO — Retentativa reabre execução com encerrado_em stale durante a janela "em voo"

**QA**: Fault Tolerance
**Tactic alvo**: Repair State / Condition Monitoring (finding original do agente)
**Status**: RESOLVIDO por decisão de arquitetura — nenhuma mudança de código feita ou necessária
**Findings**: F-fault-tolerance-1

**Problema (como relatado originalmente pelo agente)**
> beginExecution reabre uma linha error para retry sem limpar encerrado_em, deixando uma execução genuinamente "em voo" (reconciling/pending) com um carimbo de encerramento stale de uma falha anterior. Reproduzido em Postgres 17 local: uma linha error reaberta fica status='reconciling' com encerrado_em não-nulo herdado da falha anterior.

**Resolução (nota do orquestrador)**
> Este comportamento foi avaliado e é intencional — já documentado no cabeçalho da migration 0064 e na Decisão D1 da ADR-0051 ("um retry preso conta na semana da sua última falha"). O card originalmente proposto pelo agente (adicionar `encerrado_em = CASE WHEN status IN (...) THEN encerrado_em ELSE NULL END` ao SET do beginExecution) foi descartado por contradizer essa decisão já tomada — implementá-lo mudaria o comportamento que a ADR-0051 optou por manter. O orquestrador validou adicionalmente, de forma manual contra Postgres 17 local, a sequência markError → markSettled → markSettled (T1 grava o carimbo do erro; o markSettled seguinte sobrescreve para T2; um segundo markSettled preserva T2) e confirmou que o trigger permuta_execucao_bloqueia_reabertura (0057) recusa corretamente uma tentativa de markError sobre uma baixa já confirmada. Nenhum P0/P1 foi encontrado nessa interação.

**Por que não vira card ativo**
> O efeito é transitório e auto-corretivo (a próxima escrita terminal — settle ou novo erro — sobrescreve o carimbo), não duplica nenhuma escrita no ERP, e a decisão de design já foi tomada e documentada publicamente para a Columbia via ADR. Agir aqui seria reverter uma decisão arquitetural sem novo input que a justifique.

**Rastreabilidade**
> A mesma verificação manual que fechou este item motiva o card ativo `testability-1` (P1): codificar como teste automatizado a sequência que hoje só foi provada manualmente, para que a próxima pessoa não precise repetir a verificação à mão.

**Dependências**: nenhuma — item fechado.
