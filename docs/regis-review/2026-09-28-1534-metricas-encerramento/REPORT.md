---
type: regis-review-report
run_id: 2026-09-28-1534-metricas-encerramento
generated_at: 2026-09-28T19:10:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
total_cards: 13
total_p0: 0
total_p1: 1
total_p2: 9
total_p3: 3
overall_score: 7.7
---

# Regis-Review — financeiro — 2026-09-28-1534-metricas-encerramento

> **Escopo desta revisão**: apenas o DELTA da branch `worktree-metrica-ciclo-data-conclusao` vs.
> `origin/main` — ADR-0051 ("métricas do ciclo datam a execução pelo encerramento") e a migration
> `0064_metricas_ciclo_data_pelo_encerramento.sql`. 12 arquivos, +721/−5. Dívida pré-existente fora
> do delta não foi reaberta como finding — só citada como contexto quando um agente precisou dela
> para explicar um achado (ex.: `performance-1`, já aberto em ciclo anterior).

## 1. Executive scorecard

Pesos aplicados (produto financeiro multi-tenant que executa escritas que movem dinheiro — permuta,
SISPAG, GED): Security 1.5, Fault Tolerance 1.3, Availability 1.2, Modifiability 1.2, Testability 1.0,
Performance 1.0, Integrability 0.9, Deployability 0.9 — peso total 9.0.

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7.0 | 0 | 0 | 2 | 1 | F-availability-1: invariante de imutabilidade de encerrado_em só existe em SQL de aplicação |
| Deployability | 8.0 | 0 | 0 | 1 | 1 | F-deployability-1: recálculo de número já publicado sem verificação automatizada pós-deploy |
| Integrability | 8.0 | 0 | 0 | 2 | 0 | F-integrability-1: regra de carimbo duplicada 5x em SQL literal, sem abstração compartilhada |
| Modifiability | 7.5 | 0 | 0 | 2 | 0 | F-modifiability-1: invariante de status terminal desacoplado do tipo TS ExecucaoStatus |
| Performance | 7.0 | 0 | 0 | 2 | 0 | F-performance-2: novo predicado COALESCE não tem índice de expressão |
| Fault Tolerance | 8.0 | 0 | 0 | 3* | 0 | F-fault-tolerance-2: interação escrita x trigger 0057 sem teste de integração |
| Security | 8.5 | 0 | 0 | 1 | 1 | F-security-1: backfill de encerrado_em é aproximação declarada, drift não quantificado |
| Testability | 7.0 | 0 | 1 | 0 | 0 | F-testability-1: escrita de encerrado_em só testada por regex, nunca contra Postgres real |
| **Overall** | **7.7** | **0** | **1** | **13** | **3** | — |

\* Das 3 findings P2 de Fault Tolerance, F-fault-tolerance-1 foi **resolvida sem mudança de código**
nesta sessão (ver R-10) — mantida na contagem de findings do agente, sem card ativo no KANBAN.

Score interpretation:
- 0–3: estrutural risk — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

Nenhum QA ficou abaixo de 7,0. Delta pequeno (1 migration + 2 repositórios), gates 100% verdes,
24/24 testes de integração SQL reais e 21/21 guardas estáticas — os achados são majoritariamente P2
de dívida defensável, não bloqueios.

## 2. Top 10 risks (cross-QA)

### R-1: Núcleo da correção (transição error → settled) nunca roda contra Postgres real em nenhum teste
- **QA(s) afetados**: Testability, Fault Tolerance
- **Findings de origem**: F-testability-1, F-fault-tolerance-2
- **Evidência sintetizada**: os 5 testes novos em `PermutaExecucaoRepository.test.ts`/`SolicitacaoNumerarioExecucaoRepository.test.ts` só casam regex contra a string do UPDATE mockado; o único teste de integração que valida a regra (`vwMetricasCiclo.integration.test.ts`) insere `encerrado_em` direto via SQL, contornando o repositório. 0 de 2 repositórios têm teste de integração chamando markSettled/markParcial/markError contra Postgres real com o trigger 0057 ativo.
- **Impacto técnico**: um refactor futuro do UPDATE (reordenar SET, trocar query builder) pode inverter silenciosamente a semântica COALESCE/CASE sem nenhum teste acusar.
- **Impacto de negócio**: é exatamente a lógica que corrigiu a distorção de R$ 503.066,69 (2 linhas em 190, medida 18/09) que originou a ADR-0051. Regressão silenciosa aqui reabre o mesmo erro no número publicado à Columbia, sem sinal no CI.
- **Card(s) Kanban relacionados**: `testability-1` (consolida `fault-tolerance-2`)
- **Custo de inação em 6 meses**: premissa — no ritmo observado de mudanças na função de métricas (0058 → 0064 em 14 dias), a chance de um refactor tocar este UPDATE sem o teste real não é trivial; o custo de detectar tarde é o mesmo já pago uma vez (1 ADR + 1 migration + comunicação ao cliente). Custo de prevenir: ≤1 dia, infraestrutura já existe.

### R-2: Regra "quais status são terminais" duplicada 5x em SQL literal, sem fonte única nem barreira de esquema
- **QA(s) afetados**: Integrability, Modifiability, Availability
- **Findings de origem**: F-integrability-1, F-modifiability-1, F-availability-1
- **Evidência sintetizada**: a expressão `CASE WHEN status IN (...) THEN COALESCE(encerrado_em, now()) ELSE now() END` aparece em 5 pontos de 2 arquivos, nenhum derivado do union TS `ExecucaoStatus` já existente, e sem CHECK/TRIGGER de esquema.
- **Impacto técnico**: um novo status terminal esquecido em uma das listas `IN (...)` não quebra typecheck/lint/teste — produz semana subfaturada em silêncio.
- **Impacto de negócio**: reabertura da mesma classe de erro que já custou 1 ADR + 1 migration + comunicação ao cliente; cada integração futura (Conexos fin010, Nexxera) herda o risco.
- **Card(s) Kanban relacionados**: `modifiability-1` (consolida `integrability-1`), `availability-1` (defesa complementar em esquema)
- **Custo de inação em 6 meses**: premissa — o roadmap prevê ≥2 novas integrações de escrita que precisarão da mesma doutrina; sem fonte única, cada uma é chance de repetir o incidente. Custo de prevenir: ≤1 dia por card.

### R-3: Recálculo de número já publicado à Columbia sem verificação automatizada nem confirmação manual pós-deploy
- **QA(s) afetados**: Deployability, Fault Tolerance
- **Findings de origem**: F-deployability-1, F-fault-tolerance-3
- **Evidência sintetizada**: a migration recalcula toda a série de `metricas.metricas_ciclo()`, inclusive a semana 11–18/09 (R$ 0,00 → R$ 150.061,81). A única verificação prevista é uma query manual em `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md`, não executada nesta sessão (leitura de produção negada).
- **Impacto técnico**: se o backfill se comportar diferente em produção do que nos fixtures, ninguém descobre automaticamente.
- **Impacto de negócio**: o dado que vai à Columbia é o mesmo usado para validar o rollout desta ADR; a janela entre deploy e confirmação manual é um intervalo cego.
- **Card(s) Kanban relacionados**: `deployability-1`, `fault-tolerance-3`
- **Custo de inação em 6 meses**: premissa — 3º ajuste de regra na mesma função em pouco tempo (0058→0060→0064); sem automação, cada ajuste repete a janela cega. Custo de prevenir: 1 dia rodar a query pendente + 1 dia automatizar.

### R-4: markError sobrescreve status/encerrado_em sem a guarda de terminal que markSettled/markParcial têm
- **QA(s) afetados**: Security
- **Findings de origem**: F-security-2
- **Evidência sintetizada**: markSettled/markParcial protegem encerrado_em com CASE WHEN status IN (...); markError grava status='error', encerrado_em=now() incondicionalmente.
- **Impacto técnico**: uma corrida entre um retry tardio e resposta de sucesso atrasada do ERP reverteria uma liquidação real para erro na trilha.
- **Impacto de negócio**: uma baixa/SN realmente concluída poderia sumir/mudar de semana no número publicado, exigindo investigação manual. Probabilidade baixa, custo alto se ocorrer.
- **Card(s) Kanban relacionados**: `security-2`
- **Custo de inação em 6 meses**: premissa — probabilidade de corrida real não medida (0 incidentes registrados), mas o padrão de retry já existe nas duas frentes. Custo de prevenir ≤1 dia; custo de um incidente é o mesmo ciclo de investigação já pago pela ADR-0051.

### R-5: "Falha crônica" perde a semana original a cada nova tentativa — intencional, mas sem visibilidade operacional
- **QA(s) afetados**: Availability, Security
- **Findings de origem**: F-availability-2, F-security-2 (mesmo par de métodos)
- **Evidência sintetizada**: markError grava encerrado_em=now() a cada falha, sem teto de idade. **Nota de contexto do orquestrador**: comportamento já avaliado e intencional — documentado no cabeçalho da migration 0064 e na Decisão D1 da ADR-0051 ("um retry preso conta na semana da sua última falha"). Não é defeito a corrigir.
- **Impacto técnico**: a série semanal não distingue problema novo de problema antigo que só falhou de novo.
- **Impacto de negócio**: indicador de % concluídas pode mascarar quanto tempo uma falha está aberta — dado que a decisão já aceita o trade-off, o gap real é de observabilidade, não de correção.
- **Card(s) Kanban relacionados**: `availability-2` (enhancement, não bugfix)
- **Custo de inação em 6 meses**: premissa — sem indicador de idade, um item preso continua indistinguível de problema novo, custando triagem manual a cada ciclo. Custo de prevenir: 2-5 dias.

### R-6: Boot fail-fast agrupa migração de baixo valor com a disponibilidade do sistema de execução financeira; runbook ambíguo para o mesmo padrão
- **QA(s) afetados**: Availability, Deployability
- **Findings de origem**: F-availability-3, F-deployability-2
- **Evidência sintetizada**: a 0064 roda ALTER/UPDATE sobre as mesmas tabelas que Permutas e Recebimentos escrevem em produção; se falhar, o BootMigrator aborta o boot inteiro. A tabela de decisão do runbook de rollback (`docs/runbooks/rollback.md:18-23`) classifica migrações em "aditiva" (segura) ou "destrutiva/backfill que sobrescreve" (não reverta sozinho) — a 0064 é as duas coisas, e o texto não desambigua.
- **Impacto técnico**: acoplamento de risco entre mudança de baixo valor e disponibilidade do sistema inteiro; operador sob pressão pode escalar sem necessidade ou hesitar.
- **Impacto de negócio**: baixa probabilidade (migração testada, transacional, ~190 linhas) mas alto custo se ocorrer — indisponibilidade total do backend financeiro.
- **Card(s) Kanban relacionados**: `availability-3`, `deployability-2`
- **Custo de inação em 6 meses**: premissa — padrão "coluna nova + backfill" já ocorreu 2x (0058/0060, 0064); um 3º caso falhando no boot teria MTTR proporcional à clareza do runbook. Custo de prevenir a ambiguidade: ≤1 dia; a decisão arquitetural de isolamento é maior fôlego (L).

### R-7: Função metricas.metricas_ciclo (144 linhas) é reescrita por inteiro a cada mudança de regra, sem índice para o novo predicado COALESCE
- **QA(s) afetados**: Modifiability, Performance
- **Findings de origem**: F-modifiability-2, F-performance-1, F-performance-2
- **Evidência sintetizada**: apenas ~5 de 144 linhas (~3,5%) mudaram de fato entre 0058 e 0064. Medido nesta sessão via EXPLAIN ANALYZE: 12,8 ms (W=6) → 193,0 ms (W=111) com 5.000 linhas sintéticas — razão 15,1x, confirmando que o O(janelas x linhas) pré-existente não muda com este delta. Nenhum índice cobre encerrado_em nem criado_em.
- **Impacto técnico**: code review precisa comparar 144 linhas para achar as ~5 que mudaram; deslize entre os 2 ramos UNION ALL passa despercebido.
- **Impacto de negócio**: nenhum efeito imediato hoje; custo de mudança futuro permanece alto mesmo após corrigida a regra atual.
- **Card(s) Kanban relacionados**: `modifiability-2`, `performance-1`
- **Custo de inação em 6 meses**: premissa — no ritmo observado, a função pode passar por 4-6 reescrições integrais em 6 meses, cada uma com risco de copy-paste divergente. Custo de prevenir: 2-5 dias, pago uma vez.

### R-8: Contrato de wire (MetricaCiclo) não sinaliza quando uma janela já publicada foi recalculada
- **QA(s) afetados**: Integrability
- **Findings de origem**: F-integrability-2
- **Evidência sintetizada**: por decisão deliberada (ADR-0051 D4), este delta quebra pela primeira vez a suposição implícita "valor de semana fechada não muda" — 2 linhas em 190, R$ 503.066,69. Nada no payload sinaliza essa quebra a um consumidor automatizado.
- **Impacto técnico**: hoje só o kavex-report-ciclo consome a API e não cacheia — mas o roadmap prevê mais integrações.
- **Impacto de negócio**: um futuro consumidor que arquive/cacheie leituras semanais herdaria dados obsoletos sem meio de detectar.
- **Card(s) Kanban relacionados**: `integrability-2`
- **Custo de inação em 6 meses**: premissa — se uma 2ª integração passar a consumir antes deste card, o retrabalho de adicionar o sinal depois é maior do que fazer agora (S, ≤1 dia).

### R-9: Backfill de ~190 linhas é aproximação declarada (atualizado_em como proxy), com viés residual não quantificado
- **QA(s) afetados**: Security, Fault Tolerance
- **Findings de origem**: F-security-1, F-fault-tolerance-3
- **Evidência sintetizada**: para uma linha settled re-clicada depois de liquidar, atualizado_em é o clique, não a liquidação — a mesma aproximação que gerou a medição de 18/09 (ADR-0051 D3). Quanto do backfill ainda carrega esse viés não foi medido (leitura de produção negada).
- **Impacto técnico**: até 190 linhas carregam data de auditoria aproximada em vez de exata.
- **Impacto de negócio**: o campo que hoje é fonte de verdade de "quando o sistema executou" pode deslocar valores em semanas específicas de forma não quantificada.
- **Card(s) Kanban relacionados**: `security-1`, `fault-tolerance-3`
- **Custo de inação em 6 meses**: premissa — sem quantificar, cada pergunta de auditoria sobre uma semana passada custa investigação manual ad-hoc em vez de resposta direta. Custo de prevenir: ≤1 dia (depende só de acesso de leitura a produção).

### R-10: [RESOLVIDO nesta sessão] Retentativa reabre execução com encerrado_em stale durante a janela "em voo"
- **QA(s) afetados**: Fault Tolerance
- **Findings de origem**: F-fault-tolerance-1
- **Evidência sintetizada**: reproduzido em Postgres 17 local nesta revisão — uma linha error reaberta por beginExecution mantém status='reconciling' com encerrado_em não-nulo herdado da falha anterior, até a próxima escrita terminal sobrescrever. **Resolução**: o orquestrador determinou que este é o mesmo comportamento coberto pela Decisão D1 da ADR-0051 e já documentado no cabeçalho da migration 0064 — "um retry preso conta na semana da sua última falha" é intencional. Nenhuma mudança de código foi feita ou é necessária; o card fault-tolerance-1 proposto pelo agente (limpar encerrado_em no reopen) foi descartado por contradizer a decisão já tomada. O orquestrador validou manualmente, contra Postgres 17 local, a sequência markError → markSettled → markSettled (T1 grava o carimbo do erro; markSettled seguinte sobrescreve para T2; segundo markSettled preserva T2) e confirmou que o trigger permuta_execucao_bloqueia_reabertura (0057) recusa markError sobre uma baixa já confirmada.
- **Impacto técnico**: nenhum — comportamento transitório e auto-corretivo, coberto por decisão explícita.
- **Impacto de negócio**: nenhum residual — o item permanece na lista para auditabilidade da decisão de não agir, e porque a mesma verificação manual motiva o card testability-1 (R-1): codificar como teste automatizado o que hoje só foi provado manualmente.
- **Card(s) Kanban relacionados**: nenhum ativo — ver seção "Resolvido nesta revisão" do KANBAN.md
- **Custo de inação em 6 meses**: N/A — não é ação pendente, é decisão já fechada.

## 3. Cross-cutting findings

### CC-1: Regra "quais status são terminais" sem fonte única, replicada em SQL literal
- **Aparece em**: Integrability, Modifiability, Availability
- **Findings**: F-integrability-1, F-modifiability-1, F-availability-1
- **Diagnóstico unificado**: o backend não tem ORM e a regra "1º encerramento terminal é imóvel" é expressa como CASE WHEN status IN (...) THEN COALESCE(...) ELSE now() END em 5 lugares de 2 arquivos, sem amarração ao tipo TS ExecucaoStatus/RecebimentoExecucaoStatus e sem barreira de esquema. Mesma causa-raiz vista por três ângulos: falta de abstração (Integrability), falta de tipo (Modifiability), falta de defesa em profundidade no banco (Availability).
- **Recomendação consolidada**: card único (`modifiability-1` consolidado) para extrair constante tipada por ledger que constrói o IN (...) e é testada por exaustividade — resolve Integrability + Modifiability numa tacada. `availability-1` adiciona a barreira de esquema como segunda linha de defesa.

### CC-2: Núcleo da correção da ADR-0051 sem teste de execução real contra Postgres
- **Aparece em**: Testability, Fault Tolerance
- **Findings**: F-testability-1, F-fault-tolerance-2
- **Diagnóstico unificado**: dois agentes, de ângulos diferentes (cobertura de teste vs. interação com o trigger 0057), chegaram ao mesmo gap: a transição error → settled nunca é exercitada por um teste que realmente execute markSettled/markParcial/markError contra Postgres real. A prova de correção existe só como verificação manual desta sessão, não como regressão automatizada.
- **Recomendação consolidada**: card único (`testability-1` consolidado) adiciona ao vwMetricasCiclo.integration.test.ts (reaproveitando describeComBanco/emTransacao) os 3 casos que codificam o que foi verificado manualmente: (a) markSettled duas vezes preserva o 1º carimbo; (b) error → settled sobrescreve; (c) reabertura de baixa confirmada é recusada pelo trigger 0057.

### CC-3: Correção de número já publicado sem confirmação automatizada nem manual contra produção
- **Aparece em**: Deployability, Fault Tolerance, Security
- **Findings**: F-deployability-1, F-fault-tolerance-3, F-security-1
- **Diagnóstico unificado**: o mesmo fato — leitura de produção negada ao agente nesta sessão — gera três findings complementares: falta de automação da verificação (Deployability), falta de execução pontual da consulta já pronta (Fault Tolerance) e falta de quantificação do viés do backfill (Security). É um único buraco operacional: ninguém rodou a query de validação contra o banco real desde que a 0064 foi escrita.
- **Recomendação consolidada**: rodar a consulta pendente contra produção antes do próximo report do ciclo (`fault-tolerance-3`, resolve também o insumo para `security-1`) e, em paralelo, construir a automação recorrente (`deployability-1`).

### CC-4: markError sem guarda simétrica — risco de corrida (Security) e perda de visibilidade de falha crônica (Availability)
- **Aparece em**: Security, Availability (decisão já fechada em Fault Tolerance)
- **Findings**: F-security-2, F-availability-2, F-fault-tolerance-1 (resolvido, ver R-10)
- **Diagnóstico unificado**: markError grava status='error', encerrado_em=now() sem proteção condicional. Gera dois riscos distintos: (1) corrida rara mas cara, liquidação real revertida para erro (Security); (2) por desenho aceito (ADR-0051 D1), toda falha nova reescreve a data, apagando a idade real de uma falha crônica (Availability) — isso não é bug, é a mesma decisão do R-10, só que aqui falta observabilidade.
- **Recomendação consolidada**: `security-2` (guarda simétrica em markError) resolve o risco de corrida; `availability-2` (coluna primeiro_erro_em + indicador de idade) resolve a lacuna de observabilidade sem contradizer a decisão já tomada.

### CC-5: Função metricas_ciclo monolítica — custo de mudança alto e sem índice para o novo predicado
- **Aparece em**: Modifiability, Performance
- **Findings**: F-modifiability-2, F-performance-1, F-performance-2
- **Diagnóstico unificado**: a mesma função de 144 linhas é ao mesmo tempo um problema de Modifiability (reescrita integral a cada regra, ~96,5% cópia literal entre 0058 e 0064) e de Performance (nenhum índice cobre COALESCE(encerrado_em, criado_em), mantendo o O(janelas x linhas) já registrado em ciclo anterior). Decompor a função resolveria Modifiability e deixaria o predicado isolado, mais fácil de indexar.
- **Recomendação consolidada**: `modifiability-2` (decompor a função) como pré-requisito natural; `performance-1` (registrar a assinatura do índice no follow-up já aberto) como anotação de baixo custo.

### CC-6: Migração de baixo risco compartilha blast radius com o boot fail-fast, runbook de rollback não desambigua o padrão
- **Aparece em**: Availability, Deployability
- **Findings**: F-availability-3, F-deployability-2
- **Diagnóstico unificado**: a arquitetura de deploy atual (Render, BootMigrator fail-fast, sem canary/blue-green) trata toda migração pendente como bloqueante do boot — incluindo migração de puro relatório que toca as mesmas tabelas de ledger de Permutas/Recebimentos. O padrão "coluna nova + backfill" já se repetiu 2x sem que o runbook tenha uma linha clara para ele.
- **Recomendação consolidada**: `deployability-2` (S, corrigir o runbook) reduz o MTTR imediatamente; `availability-3` (L, decisão arquitetural) evita o próximo caso deste acoplamento.

## 4. Quick wins (≤5 dias úteis)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `testability-1` (consolida `fault-tolerance-2`) | Testability + Fault Tolerance | S | P1 | 0 → ≥3 testes de integração (Postgres real) cobrindo error→settled, settled→settled e recusa do trigger 0057 |
| `availability-1` | Availability | S | P2 | 0 → ≥1 barreira de esquema (TRIGGER/CHECK) protegendo encerrado_em |
| `modifiability-1` (consolida `integrability-1`) | Modifiability + Integrability | S | P2 | 5 → 1 fonte única do invariante de status terminal, tipada; ≥1 teste cross-repo |
| `deployability-1` | Deployability | S | P2 | 0 → 1 verificação automatizada por deploy de migração em metricas.* |
| `fault-tolerance-3` | Fault Tolerance | S | P2 | Viés residual do backfill: "não medido" → valor numérico (linhas e R$) |
| `security-1` | Security | S | P2 | 0% → 100% das linhas com proveniência de encerrado_em marcada |
| `integrability-2` | Integrability | S | P2 | Decisão de sinalização de recálculo registrada em inbox/ADR |
| `performance-1` | Performance | S | P2 | Assinatura do índice de expressão registrada no follow-up performance-1 |

Estes 8 cards são a proposta defensável de "primeira sprint pós-aprovação": nenhum exige decisão
arquitetural nova, todos reaproveitam infraestrutura de teste/migração já existente, e cobrem o único
P1 do ciclo mais o núcleo dos P2 de maior leverage.

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `availability-2` | Availability | M | Condition Monitoring | O ledger já tem ~190 execuções e cresce ~1 janela/semana desde o piso fixo (ADR-0048, 2026-08-07); sem indicador de idade de falha, cada item cronicamente preso é retriado sem alarme, e o próprio caso desta ADR (2 linhas / R$ 503.066,69) mostra que o time só descobre esse tipo de distorção por auditoria manual. |
| `modifiability-2` | Modifiability, Performance | M | Refactor / Reduce Size of Module | Medido nesta revisão: ~96,5% (139/144 linhas) da função metricas_ciclo é cópia literal entre 0058 e 0064 — já redefinida por inteiro 1x em 14 dias; decompor reduz o raio de comparação de code review de 144 para ≤20 linhas por frente. |
| `availability-3` | Availability, Deployability | L | Removal from Service | O BootMigrator aborta o boot inteiro (Permutas + SISPAG + Recebimentos) se qualquer migração falhar, incluindo migrações de puro relatório. Com o padrão já repetido 2x, o custo de não decidir isolar migrações de baixo risco cresce a cada migration nova. |

## 6. O que está bem (e por quê)

1. **Timestamp** aplicado corretamente ao domínio: encerrado_em separa "quando nasceu" (criado_em), "quando alguém tocou" (atualizado_em) e "quando terminou de fato" — exatamente o que faltava para atribuir uma retentativa à semana certa. (0064...sql:13-24)
2. **Rollback / Idempotent Replay**: a migration é ADD COLUMN IF NOT EXISTS + backfill só WHERE encerrado_em IS NULL + CREATE OR REPLACE FUNCTION — reaplicar é comprovadamente um no-op (testado), rollback manual documentado no próprio cabeçalho.
3. **Transactions**: cada migration roda em transação própria sob pg_advisory_xact_lock (runMigrations.ts:130-152) — sem estado parcial possível em caso de falha.
4. **Adhere to Standards / Limit Exposure**: a função redefinida preserva exatamente as mesmas 9 colunas + parcial/apurado_ate; nenhum consumidor precisou de alteração.
5. **Limit Access / Change Default Settings / Validate Input**: REVOKE ALL FROM PUBLIC e SET search_path='' reafirmados; 100% do SQL novo parametrizado; 0 segredos hardcoded — medido, não assumido.
6. **Recordable Test Cases (excepcionalmente forte)**: o caso real de produção (id 341: nasceu 10/08, liquidou 14/09, R$ 150.061,81) virou fixture literal do teste, com o mesmo número do incidente documentado no cabeçalho da migration.
7. **Bound Execution Times**: ADD COLUMN sem DEFAULT é metadata-only; o backfill toca ~190 linhas, bem abaixo do limiar de 1.000 que exigiria script de reverse dedicado.
8. **Decisões honestas e documentadas**: a ADR-0051 registra explicitamente os trade-offs aceitos (D1 retry crônico; D3 backfill aproximado; D4 valor retroativo) em vez de escondê-los — é essa transparência que permitiu fechar o item de Fault Tolerance (R-10) como decisão, não como bug.

## 7. Limitações da análise

- **Leitura de produção negada ao agente nesta sessão** (repetido em Deployability, Fault Tolerance, Security, Integrability, Availability): a consulta de validação pronta em `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md` não foi executada contra o banco real. Baseline conhecido de sessão anterior (18/09): 2 linhas em 190, R$ 503.066,69 — não reconfirmado após a 0064.
- **MTTR real de um boot que falha por migração quebrada** — não medível localmente (Availability); requer métrica de produção.
- **Impacto real de lock/contenção do backfill contra tráfego concorrente em produção** — não medível localmente (Availability); requer CloudWatch/logs de produção do momento do deploy.
- **Cobertura percentual exata de teste** — sessões rodaram em modo --quick (sem npm test -- --coverage); usamos ratio de arquivos como proxy (Testability).
- **Viés residual do backfill pós-fix** — não quantificado nesta sessão (Security, Fault Tolerance).
- **Edição de cards para consolidação**: dois pares de cards foram fundidos por serem a mesma causa-raiz com a mesma solução técnica — `modifiability-1` absorveu `integrability-1` (fonte única do invariante de status terminal) e `testability-1` absorveu `fault-tolerance-2` (teste de execução real contra Postgres com o trigger 0057). O card `fault-tolerance-1` foi removido da lista ativa por decisão do orquestrador (ver R-10) — não é dívida, é decisão de arquitetura já fechada e documentada.
- **O que este pipe não cobre**: chaos engineering, threat modeling formal, custo de infraestrutura cloud, UX/acessibilidade da tela de métricas, auditoria de dependências (npm audit não rodou, --quick).
- **Janela temporal**: snapshot do delta datado de 2026-09-28 (ADR-0051, migration 0064). Não é reavaliação do sistema financeiro inteiro — dívida pré-existente fora do delta citada só como contexto.

## 8. Ações recomendadas

1. Codificar os testes de execução real contra Postgres cobrindo markSettled/markParcial/markError + trigger 0057 (`testability-1`, consolidado) — fecha o único P1 do ciclo, protegendo exatamente a lógica que corrigiu os R$ 503 mil, com infraestrutura de teste já pronta.
2. Rodar a consulta de validação do backfill contra produção e anexar o resultado ao próximo report do ciclo (`fault-tolerance-3`), e em paralelo iniciar a automação recorrente da verificação pós-deploy (`deployability-1`).
3. Extrair a doutrina "status terminal" para uma constante tipada única por ledger, amarrada a ExecucaoStatus/RecebimentoExecucaoStatus, com teste de exaustividade e teste cross-repo (`modifiability-1`, consolidado com `integrability-1`).
4. Adicionar a barreira de esquema (TRIGGER/CHECK) sobre encerrado_em como segunda linha de defesa (`availability-1`), e blindar markError com guarda de terminal simétrica (`security-1`, `security-2`).
5. Registrar as anotações de baixo custo pendentes: proveniência do carimbo (`security-1`), sinalização de payload recalculado (`integrability-2`), assinatura do índice de expressão (`performance-1`) e correção do runbook de rollback (`deployability-2`) — nenhuma exige decisão arquitetural nova.

---

**Contagem de P0 neste ciclo: 0.**

Nenhum finding, em nenhuma das 8 dimensões, atingiu severidade P0 (crítico/bloqueante). O delta é
pequeno, aditivo, transacional, idempotente e coberto por 24/24 testes de integração SQL contra
Postgres real + 21/21 guardas estáticas, todos verdes. O único P1 (F-testability-1, ausência de
teste de execução real para o núcleo da correção) é o item de maior prioridade recomendado para os
próximos 30 dias, junto com o fechamento da verificação de produção pendente (R-3/R-9). Segundo o
gate do pipeline (CLAUDE.md — Green criteria #8), este delta pode prosseguir para merge sem
re-loop obrigatório; os P1/P2/P3 seguem como follow-ups em ontology/_inbox/.
