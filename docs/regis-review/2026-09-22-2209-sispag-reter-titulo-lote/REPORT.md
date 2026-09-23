---

> **Nota de 2026-09-23.** Esta revisão foi feita sobre a versão da feature que retinha o título da
> formação automática. Antes do merge o usuário retirou a retenção (ADR-0050): saíram a migration
> 0062, `RetencaoFormacaoRepository`, a rota `DELETE .../retencao`, o badge e a confirmação da
> lixeira. O que vai para a `main` é um subconjunto do código revisado. Os cards que continuam
> valendo estão em `ontology/_inbox/sispag-reter-titulo-lote-regis-followups.md`.
type: regis-review-report
run_id: 2026-09-22-2209-sispag-reter-titulo-lote
generated_at: 2026-09-23T15:00:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: delta da branch fix/sispag-reter-titulo-lote vs main (ADR-0050 — retirar título do lote com retenção da formação automática, I9), rebase sobre main @3864b76 (v0.40.0)
total_cards: 18
total_p0: 0
total_p1: 2
total_p2: 9
total_p3: 7
overall_score: 8.1
---

# Regis-Review — financeiro — 2026-09-22-2209-sispag-reter-titulo-lote

**Escopo desta revisão:** exclusivamente o delta de `fix/sispag-reter-titulo-lote` (`git diff
main...HEAD`, 25 arquivos, +1929/−48 LOC, 11 commits, ADR-0050) — a feature que introduz a
retenção do título da formação automática (invariante I9), materializada em tabela própria
`titulo_retencao_formacao` (migration 0062), com soft-delete e no máximo uma retenção ativa por
título; duas rotas admin novas (`POST /sispag/titulos/:filCod/:docCod/:titCod/retirar-do-lote` e
`DELETE .../retencao`); nenhuma escrita no ERP e nenhum cálculo monetário. **Não é** uma auditoria
do módulo SISPAG inteiro — código pré-existente só entra como contexto de blast radius quando os
agentes o citam explicitamente. Rebase sobre `main @3864b76` (v0.40.0, ADR-0049 data de débito) já
aplicado; a invariante da retenção foi renumerada de I8 para I9. Gates pós-rebase: 146 suites /
2.196 testes backend verdes, 49 / 417 frontend verdes, typecheck e lint sem erros novos.

**Resultado em uma frase:** nenhum P0 foi encontrado; o núcleo do delta (repositório dedicado,
`removerItemDoLote` privado compartilhado, migration idempotente, transações atômicas com árbitro
via índice único parcial) é bem modelado do ponto de vista de tactics Bass — mas a feature amarra
um refetch de `GET /sispag/painel` (com fan-out Conexos) a toda ação de lote local (P1 Performance)
e adiciona duas rotas de escrita sem o guard de escopo de filial que o `recebimentos.ts` já usa em
8/10 rotas equivalentes (P1 Security).

## 1. Executive scorecard

**Overall score = 8,1/10** (média ponderada dos 8 QAs; pesos calibrados para um SaaS financeiro
multi-tenant que executa escritas que movem dinheiro — Security 1,5, Fault Tolerance 1,3,
Availability 1,2, Modifiability 1,2, Testability 1,0, Performance 1,0, Integrability 0,9,
Deployability 0,9; total de peso = 9,0). Média simples (não ponderada) dos 8 scores: 8,09 — as
duas leituras convergem porque só Performance (6,5) destoa fortemente para baixo, empurrada por 1
achado P1 concreto.

**P0: 0 | P1: 2 | P2: 9 | P3: 7 | Total: 18 cards** (após deduplicação; ver seção 7).

| QA | Score (0–10) | Peso | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|---|
| Availability | 8,3 | 1,2 | 0 | 0 | 2 | 1 | F-availability-2: `montarPainel` faz `Promise.all` de 4 leituras; a nova leitura da retenção derruba o painel inteiro em vez de degradar o badge |
| Deployability | 8,2 | 0,9 | 0 | 0 | 1 | 1 | F-deployability-1: migration 0062 nunca roda contra Postgres real antes do boot de produção |
| Integrability | 8,6 | 0,9 | 0 | 0 | 2 | 0 | F-integrability-1: `SispagPainelService` cresce para 14 colaboradores injetados, 4 clients Conexos diretos |
| Modifiability | 8,4 | 1,2 | 0 | 0 | 2 | 1 | F-modifiability-1: `LotePagamentoRepository.ts` atravessou o teto de 600 LOC (633, 26 métodos) |
| Performance | 6,5 | 1,0 | 0 | **1** | 0 | 2 | F-performance-1: `acaoLote` reintroduz fan-out Conexos (~410 KB, p99 2–10s) no caminho de escrita local do lote |
| Fault Tolerance | 8,6 | 1,3 | 0 | 0 | 1 | 2 | F-fault-tolerance-2: audit trail das transições de lote segue padrão só-stdout do resto do serviço |
| Security | 8,2 | 1,5 | 0 | **1** | 2 | 0 | F-security-1: rotas novas não aplicam `assertUserCanActOnFilial` (0/11 rotas SISPAG têm o guard; `recebimentos.ts` usa em 8/10) |
| Testability | 7,9 | 1,0 | 0 | 0 | 2 | 1 | F-testability-2: `RetencaoFormacaoRepository` e migration 0062 nunca rodam contra Postgres real |
| **Overall** | **8,1** | **9,0** | **0** | **2** | **9** | **7** | — |

Score interpretation:
- 0–3: risco estrutural — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

Performance (6,5) é o único QA na faixa "dívida defensável" — puxado pelo P1 concreto de
`acaoLote`. Os outros 7 QAs estão na faixa "saudável com oportunidades pontuais", com um piso
mais estreito (7,9–8,6) do que na rodada anterior (`sispag-data-pagamento`, 6,5–8,5) — reflexo do
delta ser 100% interno ao Postgres, sem ampliar a superfície ERP e com um núcleo funcional bem
encapsulado.

## 2. Top 10 risks (cross-QA)

Ranqueados por severidade × leverage × impacto de negócio — não é simplesmente "os 10 piores
findings". Nenhum P0 existe neste delta; a lista mistura os 2 P1 reais com os P2/P3 de maior raio
de blast.

### R-1: `acaoLote` amarrou o fluxo de trabalho mais repetitivo da Frente II ao p99 do Conexos

- **QA(s) afetados**: Performance (origem), Availability (blast radius quando Conexos está lento)
- **Findings de origem**: F-performance-1 (`performance.md §4`)
- **Evidência sintetizada**: `page.tsx:428-432` — `await Promise.all([recarregarLotes(),
  recarregarPainel()])` substituiu `await recarregarLotes()`. `recarregarPainel` chama `GET
  /sispag/painel` → `SispagPainelService.montarPainel`, que faz fan-out `listLotes` no Conexos
  (`CONEXOS_FANOUT_LIMIT=4`) e devolve ~410 KB de carteira. O botão `busy=true` só libera quando o
  MAIOR dos dois fetches resolve.
- **Impacto técnico**: uma ação 100% local (ex.: `atualizarModalidadeItem`) passa a aguardar N
  chamadas ao Conexos. Um lote com 20 itens revisado modalidade a modalidade dispara 20 fan-outs
  completos do painel. Em pico Conexos lento (p99 2–10s), o UI parece travado sem indicação de que
  a causa é uma leitura desnecessária do ERP.
- **Impacto de negócio**: tela de montagem de lote atrasa a janela de corte bancário. A analista
  da Columbia prepara o lote pela manhã e envia antes do fim do dia — Conexos ruim vira UX ruim, e
  ela não sabe pra onde apontar.
- **Card(s) Kanban relacionados**: performance-1
- **Custo de inação em 6 meses**: cada `/feature-tweak` que tocar `page.tsx`/`LoteCard.tsx` herda
  o padrão; conforme a Frente II adicionar retornos Nexxera e DDA, a probabilidade de o painel ser
  o gargalo real por trás de "tela travada" cresce.

### R-2: 0/11 rotas mutantes de SISPAG aplicam `assertUserCanActOnFilial` — a feature adicionou 2 rotas de escrita novas sem fechar o gap

- **QA(s) afetados**: Security (origem), Availability (blast radius de ator agindo em filial alheia)
- **Findings de origem**: F-security-1 (`security.md §4`)
- **Evidência sintetizada**: `grep -c assertUserCanActOnFilial src/backend/routes/sispag.ts` = 0
  (11 rotas mutantes SISPAG, inclusive as 2 novas); `recebimentos.ts` usa em 8/10 rotas
  equivalentes. O comentário de `filialAuthz.ts:19` já pedia paridade com SISPAG ANTES deste delta.
- **Impacto técnico**: um usuário com `role='admin'` provisionado para uma filial pode retirar
  título de lote ou liberar retenção de QUALQUER outra filial só trocando `filCod` na URL. O guard
  `requireRole('admin')` distingue papel, não escopo.
- **Impacto de negócio**: a feature declara "nenhuma escrita no ERP, nenhum cálculo monetário" — o
  ator comprometido não move dinheiro diretamente. Mas pode **atrasar ou bloquear** o pagamento de
  fornecedores de outra filial sem rastro do "por que este título nunca é lotado". Em contexto
  multi-filial (e, no roadmap SaaSo, multi-tenant), quebra de isolamento operacional real.
- **Card(s) Kanban relacionados**: security-1
- **Custo de inação em 6 meses**: com mais filiais/analistas no mesmo tenant, ausência do guard
  vira vetor real de interferência operacional. As 9 rotas mutantes pré-existentes precisarão da
  mesma correção mecânica quando o próximo cliente SaaSo entrar.

### R-3: Migration 0062 com DDL não-trivial (índice único parcial + 3 CHECKs) nunca roda contra Postgres real antes do boot de produção

- **QA(s) afetados**: Deployability (origem), Availability, Testability (mesma causa raiz; CC-1)
- **Findings de origem**: F-deployability-1, F-availability-1, F-testability-2
- **Evidência sintetizada**: `retencaoFormacao.test.ts` valida por regex sobre o texto SQL;
  `RetencaoFormacaoRepository.test.ts` mocka o driver `pg`; 0 arquivos `*.integration.test.ts`
  tocam `titulo_retencao_formacao`. O único integration em migrations é
  `vwMetricasCiclo.integration.test.ts` — a trilha `test:sql` existe no `package.json` e usa
  `postgres:17-alpine`, pronta para reuso.
- **Impacto técnico**: 3 cenários silenciosos só apareceriam em produção: (a) `WHERE` no target do
  `ON CONFLICT ... DO NOTHING` só é aceito a partir do PG 15; se o driver `pg` divergir, o INSERT
  falha em runtime, não no boot; (b) `char_length(motivo) <= 500` opera sobre code points, não
  bytes — 500 emojis (2.000 bytes UTF-8) devem passar; (c) pareamento dos 3 campos de soft-delete
  só é reforçado pelo Postgres real.
- **Impacto de negócio**: no cenário (a), a analista clica "Retirar do lote", recebe 500, e o
  título fica sem retenção — na próxima rodada do cron da formação automática ele volta ao lote
  automático silenciosamente, exatamente o que a feature existe para impedir. `BootMigrator` não
  pega porque a migration em si passa.
- **Card(s) Kanban relacionados**: migration-0062-integration (deduplicado — antes 3 cards
  paralelos)
- **Custo de inação em 6 meses**: cada nova migration SISPAG com DDL não-trivial reintroduz a
  mesma janela cega. Ao ritmo observado (0062 é a 62ª do repo, ~1 por sprint), a probabilidade
  cumulativa de boot cair em produção por sintaxe/semântica DDL cresce a cada ciclo.

### R-4: `LotePagamentoService.audit()` (e 22 outros serviços) gravam auditoria só em stdout — o delta introduz o primeiro caso persistido em tabela e não generaliza

- **QA(s) afetados**: Fault Tolerance, Security (mesma causa raiz; CC-2)
- **Findings de origem**: F-fault-tolerance-2, F-security-2
- **Evidência sintetizada**: `LogService.writeLog` = `process.stdout.write(...)`; `grep -rl` = 22
  arquivos de serviço no mesmo padrão. Nenhuma tabela `audit_log` no repo. O delta cria o primeiro
  caso persistido em tabela (`titulo_retencao_formacao` + `marcado_por/removido_por` + timestamps)
  — mas as outras 5 transições do MESMO agregado (`criarLote`, `finalizarLote`, `cancelarLote`,
  `atualizarContaPagadora`, `atualizarModalidadeItem`) continuam só em stdout.
- **Impacto técnico**: reconstruir "quem fez o quê num lote" depende da retenção de log do Render
  (sem índice por ator/lote/ação), não de consulta SQL. Se o Render rotacionar antes da auditoria
  pedir, o rastro sumiu.
- **Impacto de negócio**: em auditoria de compliance financeiro (ex.: lote cancelado
  indevidamente), a única ação com trilha em tabela é a retenção — as demais transições dependem
  de janela de retenção do provedor. Antes do delta era 100% do agregado sem trilha; depois é 5/6.
  Melhoria parcial.
- **Card(s) Kanban relacionados**: audit-trail-lote (deduplicado)
- **Custo de inação em 6 meses**: cada disputa/incidente sobre "quem cancelou aquele lote" que a
  janela de log já não cobre é custo de suporte + risco reputacional. `RecebimentoNumerarioService`
  (2415 LOC) tem o mesmo problema em maior escala.

### R-5: `LotePagamentoRepository.ts` atravessou o teto de 600 LOC (633, +44 LOC) — a primeira feature a fazê-lo, e há 3 fatias SISPAG na fila que também vão tocar o arquivo

- **QA(s) afetados**: Modifiability (origem), Testability (blast radius em testes)
- **Findings de origem**: F-modifiability-1 (`modifiability.md §4`)
- **Evidência sintetizada**: `main`: 589 LOC · 25 métodos; `HEAD`: 633 LOC · 26 métodos (+44, +1
  método `lerEstadoParaEdicao`). Mistura 4 razões de mudança (CRUD do lote raiz, CRUD dos itens,
  leitura para o painel, metadados da remessa nativa); o delta acrescentou uma 5ª ("estado para
  edição sob lock"). Fan-in = 4 (`LotePagamentoService`, `SispagPainelService`,
  `FormacaoLotesService`, `RemessaService`).
- **Impacto técnico**: cada nova regra sobre o lote empurra +40 a +100 LOC nesse arquivo. Fan-in
  4 é a variável que mais correlaciona com bugs de merge e revisão superficial.
- **Impacto de negócio**: baixo hoje; médio em 6 meses porque Fatias 3–4 vão acrescentar rotinas
  de escrita. Mesmo mecanismo que fez `RecebimentoNumerarioService.ts` chegar a 2415 LOC.
- **Card(s) Kanban relacionados**: modifiability-1
- **Custo de inação em 6 meses**: no ritmo médio observado (+50 LOC/feature nas 3 últimas features
  SISPAG que tocaram o arquivo), o repositório passa de 800 LOC e vira o próximo
  `RecebimentoNumerarioService`.

### R-6: `src/frontend/app/sispag/page.tsx` é kitchen-sink em 1229 LOC (+150 no delta), e cada feature futura vai adicionar mais 100+ LOC nele

- **QA(s) afetados**: Modifiability (origem), Testability (intratável por unit test)
- **Findings de origem**: F-modifiability-4; overlap com F-testability-3
- **Evidência sintetizada**: `main`: 1079 LOC · 2 componentes top-level; `HEAD`: 1229 LOC · idem,
  agora com 3 fluxos novos. É o 3º maior arquivo do repo depois do delta, atrás só de
  `RecebimentoNumerarioService.ts` (2415) e `ConexosGerDocProcessoClient.ts` (1291). `SispagPanel`
  concentra estado da carteira, seleção múltipla, lotes candidatos, finalizados, ingestão,
  formação automática, retornos e agora retenção.
- **Impacto técnico**: cada nova coluna/tab entra como `React.useState` no mesmo componente.
  Testes de UI dependem de acionar dezenas de estados juntos; ninguém escreve teste desta página.
- **Impacto de negócio**: baixo hoje; alto em 6 meses porque cada Fatia futura da Frente II é
  obrigada a mexer neste arquivo — o custo médio de uma PR do painel só cresce.
- **Card(s) Kanban relacionados**: modifiability-3
- **Custo de inação em 6 meses**: em 6 meses, com as 3 fatias planejadas, o arquivo passa de 1500
  LOC. `recebimentos/page.tsx` (727 LOC, testável) já provou que a alternativa funciona.

### R-7: `montarPainel` faz `Promise.all` de 4 leituras; a leitura ornamental da retenção derruba o painel inteiro em vez de degradar o badge

- **QA(s) afetados**: Availability (origem), Fault Tolerance
- **Findings de origem**: F-availability-2 (`availability.md §4`)
- **Evidência sintetizada**: `SispagPainelService.montarPainel:91-97` — `Promise.all([...
  retencaoRepo.listAtivas()])`. O padrão certo já existe na MESMA classe
  (`linhasDigitaveisDoLote:267-280`, `contarExecucoesParadas:388-412`) — falha em leitura
  secundária vira `BUSINESS_WARN` + resposta parcial. A retenção alimenta apenas o `RetencaoBadge`
  (ornamento).
- **Impacto técnico**: se o Postgres estiver saturado e a query da retenção der `ETIMEDOUT`, o
  painel inteiro devolve 500 — perdendo também as 3 leituras críticas que já resolveram.
- **Impacto de negócio**: em janela transitória do Supabase, a analista perde a tela em que decide
  TODOS os pagamentos do dia — não só a coluna que sinaliza "não lotar automaticamente".
- **Card(s) Kanban relacionados**: availability-1
- **Custo de inação em 6 meses**: cada nova leitura ornamental que o painel ganhar entra no mesmo
  `Promise.all`, e a janela de "1 falha = painel inteiro cai" só cresce.

### R-8: `SispagPainelService` cresce para 14 colaboradores injetados, 4 clients Conexos diretos — hotspot pré-existente amplificado pelo delta

- **QA(s) afetados**: Integrability (origem), Modifiability (mesmo arquivo, ângulo de complexidade)
- **Findings de origem**: F-integrability-1 (`integrability.md §4`)
- **Evidência sintetizada**: `grep -c "@inject" SispagPainelService.ts` = 14 (13 antes do delta),
  sendo 4 Clients Conexos diretos — acima do limite heurístico de 3.
- **Impacto técnico**: cada feature nova da Frente II entra aqui por inércia; o serviço é o ponto
  de maior raio de blast numa troca de gateway bancário (Nexxera) ou upgrade de versão do Conexos.
- **Impacto de negócio**: nenhum imediato (é leitura, não escrita); médio em 6 meses porque a
  próxima integração de retornos Nexxera provavelmente adiciona mais 2–3 colaboradores.
- **Card(s) Kanban relacionados**: integrability-1
- **Custo de inação em 6 meses**: mesma dinâmica de R-5 — custo de refactor cresce com cada
  colaborador não isolado.

### R-9: Frontend consome `loteRascunho`/`retencaoFormacao` sem validação Zod — herda débito pré-existente em `lib/sispag.ts`

- **QA(s) afetados**: Integrability
- **Findings de origem**: F-integrability-2 (`integrability.md §4`)
- **Evidência sintetizada**: 0 ocorrências de `z\.` em `src/frontend/lib/sispag.ts` (antes e
  depois do delta); o delta adiciona 2 campos novos à superfície não validada. Interfaces TS
  espelham manualmente as do backend (F-modifiability-2).
- **Impacto técnico**: drift de contrato (renomear `marcadoPor` → `retidoPor`) só quebra em
  runtime na tela (undefined silencioso), não no build — `RetencaoBadge.tsx` renderiza `undefined`
  sem erro.
- **Impacto de negócio**: baixo hoje (badge informativo, não decisão financeira). A próxima
  integração da Frente II (retorno Nexxera, DDA) herda o mesmo vácuo num payload que já move
  dinheiro.
- **Card(s) Kanban relacionados**: integrability-2
- **Custo de inação em 6 meses**: cada campo novo em `/sispag/painel` é oportunidade de drift
  silencioso; custo cresce com a superfície da API.

### R-10: Sem alarme agregado para 401/403 — nem nas rotas novas, nem no resto do repo

- **QA(s) afetados**: Security
- **Findings de origem**: F-security-3 (`security.md §4`)
- **Evidência sintetizada**: `console.warn` em `auth.ts:187` (403), `:221-224` (401); `grep -rn
  "alarm\|threshold" src/backend/http` = 0 hits. Pré-existente; as 2 rotas novas herdam o padrão.
- **Impacto técnico**: força bruta em `filCod`/`docCod`/`titCod` ou credencial `admin` vazada só
  aparece em auditoria manual retroativa — sem MTTD útil.
- **Impacto de negócio**: baixo isoladamente (mitigado se `security-1` for corrigido); alto
  cumulativamente conforme o número de contas admin crescer com a expansão SaaSo.
- **Card(s) Kanban relacionados**: security-3
- **Custo de inação em 6 meses**: sem contador/alarme, cada tentativa passa despercebida até
  auditoria manual — custo mensurado em tempo de investigação, não em incidente evitável.

## 3. Cross-cutting findings

### CC-1: Migration 0062 sem integration test contra Postgres real (mesmo card em 3 QAs)

- **Aparece em**: Availability, Deployability, Testability
- **Findings**: F-availability-1, F-deployability-1, F-testability-2
- **Diagnóstico unificado**: três QAs, independentemente, identificaram que a migration
  `0062_titulo_retencao_formacao.sql` — DDL não-trivial (índice único parcial + 3 CHECKs) — só é
  testada por regex sobre o texto SQL. O padrão de integration test contra Postgres real já existe
  no repo (`vwMetricasCiclo.integration.test.ts` + `npm run test:sql` + `postgres:17-alpine` no
  CI), mas não foi estendido à 0062. Os 3 agentes recomendaram explicitamente a mescla.
- **Recomendação consolidada**: um único card `[migration-0062-integration]` (esforço S) cria
  `tituloRetencaoFormacao.integration.test.ts` cobrindo: (i) migration aplica limpo; (ii)
  idempotente na 2ª execução; (iii) índice parcial rejeita segunda retenção ativa e permite reter
  depois de `removido_em IS NOT NULL`; (iv) `ON CONFLICT ... WHERE removido_em IS NULL DO NOTHING`
  funciona; (v) `char_length` em code points (500 emojis passa; 501 falha); (vi) pareamento CHECK
  rejeita estado parcial. Resolve F-availability-1, F-deployability-1 e F-testability-2
  simultaneamente.

### CC-2: Audit trail persistido em tabela — feature abre o precedente e não generaliza

- **Aparece em**: Fault Tolerance, Security
- **Findings**: F-fault-tolerance-2, F-security-2
- **Diagnóstico unificado**: dois QAs de ângulos diferentes (Fault Tolerance como "trilha para
  reconciliação pós-incidente"; Security como "trilha para auditoria de compliance") identificam a
  mesma causa: 22 serviços do backend gravam auditoria só via `LogService` → `stdout`. O delta
  cria a primeira exceção (retenção fica registrada em `titulo_retencao_formacao`), mas não
  estende para as outras 5 transições do MESMO agregado (`criarLote`, `finalizarLote`,
  `cancelarLote`, `atualizarContaPagadora`, `atualizarModalidadeItem`).
- **Recomendação consolidada**: um único card `[audit-trail-lote]` (esforço M) cria uma tabela
  `sispag_lote_evento` com `lote_id`, `acao`, `ator`, `criado_em`, `dados` (jsonb), gravada dentro
  da MESMA transação de cada `withTransaction`. Estende o padrão que o delta introduziu para a
  retenção às 5 transições restantes. Próximo `/feature-new sispag-audit-trail`, não escopo desta
  feature.

### CC-3: MTTR real de rollback nunca foi medido — meta ≤5min segue aspiracional

- **Aparece em**: Availability, Deployability
- **Findings**: F-availability-5, F-deployability-3
- **Diagnóstico unificado**: `docs/runbooks/rollback.md:5` define "reverter em ≤5min sem consultar
  ninguém"; 0 rollbacks reais foram cronometrados. Sem baseline, a meta é aspiração, não fato.
- **Recomendação consolidada**: um único card `[mttr-rollback-history]` (esforço S; disciplina de
  preenchimento) adiciona ao runbook uma seção "Histórico" com 1 linha por rollback real (data,
  hora do deploy quebrado, hora da confirmação via `/health`, cumpriu ≤5min?). Após 3 rollbacks, a
  meta vira métrica observada.

### CC-4: `SispagPainelService` como god-object da Frente II (hotspot pré-existente amplificado)

- **Aparece em**: Integrability, Modifiability
- **Findings**: F-integrability-1; overlap com F-modifiability-1 (`LotePagamentoRepository` cresce
  pelo mesmo motivo)
- **Diagnóstico unificado**: `SispagPainelService` foi de 13 para 14 colaboradores injetados (4
  clients Conexos diretos); `LotePagamentoRepository` foi de 25 para 26 métodos e atravessou o
  teto de 600 LOC. Cada feature nova da Frente II cai por inércia num dos dois pontos — nenhum
  encolhe. Mesmo mecanismo que fez `RemessaService.ts` chegar a 1111 LOC / complexidade cognitiva
  91 (rodada anterior).
- **Recomendação consolidada**: dois cards que não se fundem — `[integrability-1]` extrai uma
  fachada `SispagLeituraConexosFacade` (4 Clients diretos → 1); `[modifiability-1]` faz Split de
  `LotePagamentoRepository` em `LoteRepository` + `ItemLoteRepository`. Sequenciar antes da
  próxima Fatia SISPAG (Nexxera/DDA), não em paralelo, para não competir por QA manual.

### CC-5: `page.tsx` como kitchen-sink amplificado pelo delta

- **Aparece em**: Modifiability, Testability
- **Findings**: F-modifiability-4, F-testability-3
- **Diagnóstico unificado**: Modifiability como "1229 LOC / 2× o teto"; Testability como "0 casos
  de teste de componente para os +150 LOC novos". `SispagPanel` acumulou 8+ responsabilidades no
  mesmo componente ao longo das últimas fatias.
- **Recomendação consolidada**: card `[modifiability-3]` (esforço L) extrai `TitulosTab`,
  `LotesCandidatosTab`, `LotesFinalizadosTab`, `RetornosTab`, `IngestaoBloco`. Resolve os dois
  ângulos por construção — subcomponentes menores viabilizam testes de componente focados. Deve
  ser feito antes da Fatia 4, seguindo o precedente que `recebimentos/page.tsx` (727 LOC) já
  provou funcionar.

## 4. Quick wins (≤5 dias úteis)

Esforço S, severidade ≥ P2 — candidatos para a primeira sprint pós-aprovação.

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| performance-1 | Performance | S (alternativa 1) | P1 | Fetches Conexos por ação de lote local: 1 → 0 (refetch de painel não-bloqueante); P95 de `atualizarModalidadeItem` volta para < 300ms independente de Conexos |
| security-1 | Security | S (para as 2 rotas do delta) | P1 | `assertUserCanActOnFilial` presente em ≥2 rotas mutantes SISPAG (0/11 → 2/11); teste automatizado cobre 403 cross-filial |
| availability-1 | Availability | S | P2 | `Promise.allSettled` no `montarPainel` — falha em `retencaoRepo.listAtivas()` degrada o badge, não derruba o painel |
| migration-0062-integration | Availability + Deployability + Testability | S | P2 | 6 casos de integration test contra Postgres real para 0062 (índice parcial, ON CONFLICT, CHECKs, code points); resolve 3 findings de 3 QAs simultaneamente |
| integrability-2 | Integrability | S | P2 | Zod validando os 2 campos novos (`loteRascunho`, `retencaoFormacao`) em `GET /sispag/painel` — drift de contrato vira erro explícito no fetch |
| testability-1 | Testability | S | P2 | `RetirarDoLoteDialog.test.tsx` cobrindo reset por chave, limite 500, trim antes de `onConfirmar`, aria-live do contador; `RetencaoBadge` opcional |

Esses 6 cards fecham os 2 P1 e 4 dos 9 P2 em uma sprint, sem competir com trabalho de feature nova.
Argumento defensável: os 2 P1 são de baixo custo (mudanças localizadas, sem novo padrão
arquitetural), então "fechamos os P1 na 1ª sprint pós-aprovação" é promessa entregável.

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| modifiability-1 | Modifiability | M | Split Module / Increase Semantic Coherence | `LotePagamentoRepository` atravessou o teto de 600 LOC (633, 26 métodos) na primeira feature a fazê-lo; 3 fatias SISPAG na fila (Nexxera/DDA/retornos) vão continuar tocando o arquivo; sem intervenção, replica o padrão que fez `RecebimentoNumerarioService` chegar a 2415 LOC |
| modifiability-3 | Modifiability, Testability | L | Split Module + Increase Semantic Coherence | `page.tsx` em 1229 LOC (3º maior arquivo do repo), +150 no delta, 0 testes de componente; `recebimentos/page.tsx` (727 LOC) já provou que a alternativa funciona; a Fatia 4 vai adicionar +100–150 LOC no mesmo arquivo se nada for feito |
| audit-trail-lote | Fault Tolerance + Security | M | Audit Trail / Repair State | 5/6 transições de `LotePagamentoService` só têm rastro em `stdout` (retenção do provedor Render, sem índice); o delta abriu o precedente correto para 1/6 e não generalizou; requisito de compliance financeiro cross-cutting da proposta |
| integrability-1 | Integrability, Modifiability | M | Use an Intermediary | `SispagPainelService` cresceu para 14 colaboradores injetados / 4 Clients Conexos diretos (acima do limite heurístico de 3); é o ponto de maior raio de blast numa troca de gateway bancário (Nexxera) — feito ANTES do próximo `/feature-new` de Nexxera para não pagar o custo de refatorar sob feature-lock |
| security-3 | Security | M | Detect Intrusion | 0 alarmes agregados para 401/403 em todo o repo; MTTD de credencial comprometida hoje = "descoberto em auditoria manual"; se `security-1` for aceito, o alarme também cobre `FILIAL_NAO_AUTORIZADA`, dobrando o retorno |

## 6. O que está bem (e por quê)

1. **Split Module explícito ao nascer** (tactic Split Module). `RetencaoFormacaoRepository` (105
   LOC, 3 métodos) nasceu separado em vez de crescer `TituloAPagarRepository` ou
   `LotePagamentoRepository` — o dev nomeou a razão no header do arquivo (linhas 25–33). Serve de
   exemplo positivo para as próximas migrations. Confirmado por Modifiability, Integrability e
   Testability.
2. **Encapsulate correto no boundary do agregado** (tactic Encapsulate). Nem o SQL da retenção,
   nem a decisão de reter/não-reter vazam da camada de serviço. A tabela `titulo_retencao_formacao`
   **não tem FK** para `titulo_a_pagar` de propósito (documentado na migration): a decisão da
   analista sobrevive a um rebuild da carteira.
3. **Transações atômicas com árbitro no banco** (tactic Transactions + Exception Prevention). 4/4
   caminhos de escrita do delta rodam dentro de `withTransaction`; `SELECT ... FOR UPDATE` em
   `lerEstadoParaEdicao` fecha a janela TOCTOU. Duplo-clique é neutralizado no servidor por índice
   único parcial + `ON CONFLICT DO NOTHING` — 7 testes de corrida em
   `LotePagamentoService.test.ts:592-746`.
4. **Increase Semantic Coherence via método privado compartilhado** (tactic Refactor + Increase
   Semantic Coherence). `removerItemDoLote` privado serve às duas entradas (lixeira e "Retirar do
   lote"), parametrizado por `retencao: 'sempre' | 'se-automatico'`. Uma implementação, duas
   entradas — DRY sem abstração prematura.
5. **Migration idempotente end-to-end** (tactic Idempotent Deploys). `CREATE TABLE IF NOT EXISTS`,
   `CREATE UNIQUE INDEX IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` antes de cada `ADD CONSTRAINT`;
   confirmada por teste dedicado. Cai na linha "aditiva = seguro reverter só o código" da matriz
   de `rollback.md`.
6. **Defesa em profundidade real na validação de input** (tactic Sanity Checking). O limite de 500
   caracteres do motivo é reforçado em 3 camadas: Zod nos boundaries HTTP (`.max(500)`), constante
   no frontend (`MOTIVO_RETENCAO_MAX = 500`), CHECK do Postgres (`char_length(motivo) <= 500`).
7. **Autor de escrita mais estrito que o padrão legado**. `autorDoToken` recusa autor
   `unknown`/ausente com 401 explícito — melhora sobre o `ator()` legado do resto do arquivo. Nada
   é escrito sem identidade rastreável (`marcado_por`/`removido_por` são NOT NULL).
8. **~3.193 linhas de teste sobre ~4.770 LOC de fonte novo (razão 0,67)**, com constructor
   injection em 100% dos testes de serviço/rota, 9/9 transições da máquina de retenção com teste,
   `mock.invocationCallOrder` travando a ordem `automatico` antes de `marcarManual` — o ponto
   sensível de P1-1 da ADR-0050.

## 7. Limitações da análise

**Métricas declaradas "não medíveis localmente" pelos agentes:**
- MTTR real de rollback observado nesta feature (meta ≤5min do runbook nunca cronometrada) —
  Availability, Deployability.
- Taxa real de indisponibilidade transitória do Postgres Supabase — Availability, Fault Tolerance.
- Percentual de deploys em que `healthCheck` do Render falha e a instância anterior segue no ar —
  Deployability.
- Comportamento sob falha real de rede intermitente do Postgres (fault injection durante
  `withTransaction`) — Fault Tolerance.
- Latência real p95/p99 do Conexos em produção; profiling ao vivo — Performance (todas as métricas
  de latência foram derivadas de constantes/comentários no código, não de medição).
- `npm audit` — não medido nesta rodada (sem dependência nova no delta).
- Percentual de cobertura de linhas/branches medida por diretório do delta — o CI mede via
  `--coverage`, mas o número não foi anexado a `_shared-metrics.md` (F-testability-4).

**O que este pipe não cobre:** chaos engineering / fault injection real, threat modeling formal,
custo de infraestrutura cloud, UX e acessibilidade além de aria-label/tabIndex nos componentes
novos, penetration testing, carga real em produção.

**Cards mesclados no KANBAN.md (deduplicação explícita):**
- `[migration-0062-integration]` absorve `availability-2` (`F-availability-1`), `deployability-1`
  (`F-deployability-1`) e `testability-2` (`F-testability-2`) — os 3 agentes recomendaram
  explicitamente a mescla.
- `[audit-trail-lote]` absorve `fault-tolerance-1` (`F-fault-tolerance-2`) e `security-2`
  (`F-security-2`) — mesma causa raiz (auditoria só em stdout).
- `[mttr-rollback-history]` absorve `availability-3` (`F-availability-5`) e `deployability-2`
  (`F-deployability-3`) — mesma métrica de instrumentação de runbook.

Nenhum outro card teve conteúdo alterado. A contagem de findings por QA na tabela §1 reflete os
arquivos de origem; a contagem de **cards** no KANBAN.md já está deduplicada (18, não 22 raw).

**Divergência de julgamento entre agentes (transparência de método):** Fault Tolerance classifica
o audit trail só-stdout como P2 explicitamente rebaixado de P1 por instrução do run (baseline
numérico exigido para P0/P1); Security classifica o mesmo achado como P2 "pré-existente, fora do
delta". As duas leituras convergem em severidade — mantido P2 e mesclado em `[audit-trail-lote]`.

**Janela temporal:** snapshot do delta em 2026-09-22, escopado à branch
`fix/sispag-reter-titulo-lote` (ADR-0050), rebaseada sobre `main @3864b76` (v0.40.0, ADR-0049).
Código pré-existente do módulo SISPAG (`RemessaService.ts` com complexidade 91 já revisado em
`2026-09-22-2020-sispag-data-pagamento/`) não foi reavaliado aqui exceto quando diretamente tocado
ou amplificado pelo delta.

## 8. Ações recomendadas

1. **Fechar os 2 P1 na primeira sprint pós-aprovação** — `performance-1` (alternativa 1: `Promise`
   não-bloqueante no `acaoLote`) e `security-1` (aplicar `assertUserCanActOnFilial` nas 2 rotas do
   delta). Os dois são S em esforço e cortam os riscos R-1 e R-2 sem depender de refactor
   estrutural.
2. **Adicionar `migration-0062-integration` (esforço S) antes do próximo /feature-tweak que tocar
   `titulo_retencao_formacao` ou o SQL da formação automática** — reusa a infra `test:sql` que já
   existe, fecha 3 findings (Availability + Deployability + Testability) num único PR, é rede de
   segurança contra a exata classe de bug que o `BootMigrator` não pega em tempo.
3. **Sequenciar `modifiability-1` (Split de `LotePagamentoRepository`) antes da Fatia 3 SISPAG** —
   é o card de maior alavanca no delta e o único que amadurece logo (a próxima feature que tocar o
   arquivo já paga o custo do adiamento). Usa a suíte já verde como rede de segurança.
4. **Extrair as abas de `page.tsx` (`modifiability-3`) antes da Fatia 4** — esforço L, mas
   `recebimentos/page.tsx` já provou o padrão; sem isso, cada feature futura da Frente II paga o
   custo de mexer num arquivo de 1229+ LOC.
5. **Provisionar a tabela de audit trail (`audit-trail-lote`) e o alarme de 401/403 (`security-3`)
   em paralelo, fora da janela desta feature** — reduzem blast radius de compliance/investigação
   sem dependência entre si; o primeiro reusa o padrão que o delta abriu para retenção, o segundo
   dobra de valor quando combinado com `security-1`.
