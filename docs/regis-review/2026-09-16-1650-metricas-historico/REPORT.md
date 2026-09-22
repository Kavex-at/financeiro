---
type: regis-review-report
run_id: 2026-09-16-1650-metricas-historico
generated_at: 2026-09-18T16:30:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
total_cards: 20
total_p0: 0
total_p1: 3
total_p2: 11
total_p3: 6
overall_score: 7.3
---

# Regis-Review — financeiro — 2026-09-16-1650-metricas-historico

**Gate: PASSA.** 0 findings P0 nas 8 seções. O PR não está bloqueado — todos os P1/P2/P3 abaixo viram
follow-ups de inbox (`ontology/_inbox/metricas-historico-6-semanas-regis-followups.md`), não requisito
para merge. Esta run auditou um delta pequeno e bem contido: ~60 linhas de produção / ~350 de teste,
7 arquivos, que corrige a tela `/metricas` abrindo vazia em produção (ADR-0048, emenda a ADR-0045 D4).
A decisão de produto: a tela recua para `2026-08-07 18:00` (piso fixo); o report semanal
(`kavex-report-ciclo`) permanece ancorado no ciclo 6, via `?historico=true` opt-in.

## 1. Executive scorecard

Pesos aplicados ao `overall_score` (financeiro é SaaS multi-tenant de automação que executa escritas
que movem dinheiro — permuta/baixa no Conexos, remessa SISPAG via Nexxera, upload no GED — por isso
Security e Fault Tolerance pesam mais que Integrability/Deployability):

| QA | Peso |
|---|---|
| Security | 1.5 |
| Fault Tolerance | 1.3 |
| Availability | 1.2 |
| Modifiability | 1.2 |
| Testability | 1.0 |
| Performance | 1.0 |
| Integrability | 0.9 |
| Deployability | 0.9 |

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 7.0 | 0 | 0 | 2 | 1 | F-availability-1: sem `statement_timeout` na leitura ampliada — risco de esgotar o pool de 5 conexões |
| Deployability | 8.0 | 0 | 0 | 1 | 1 | F-deployability-1: ordem de deploy FE/BE depende de Zod sem `.strict()`, não travada por teste |
| Integrability | 7.0 | 0 | 1 | 2 | 0 | F-integrability-1: contrato cross-repo com `kavex-report-ciclo` sem teste consumidor-driven |
| Modifiability | 7.0 | 0 | 0 | 2 | 1 | F-modifiability-2: piso `2026-08-07` hardcoded em SQL, envelhece sem alarme (~18 semanas em dezembro) |
| Performance | 6.0 | 0 | 1 | 1 | 0 | F-performance-1: `metricas_ciclo()` custa O(janelas×linhas), medido 17× mais lento (19,6ms → 333,9ms) |
| Fault Tolerance | 7.0 | 0 | 0 | 2 | 1 | F-fault-tolerance-1: ADR-0048 amplia 5x a exposição a subnotificação de Permutas, sem detecção |
| Security | 8.0 | 0 | 0 | 1 | 1 | F-security-1: `/metricas/ciclo` sem `requireRole`, exposição de dado 6x maior sob o mesmo controle |
| Testability | 8.0 | 0 | 1 | 0 | 1 | F-testability-1: branch protection ausente — CI verde não bloqueia merge |
| **Overall** | **7.3** | **0** | **3** | **11** | **6** | — |

Score interpretation:
- 0–3: estrutural risco — bloqueia escalonamento
- 4–6: dívida defensável — endereçar nesta janela de planejamento
- 7–8: saudável com oportunidades pontuais
- 9–10: estado-da-arte para o estágio atual

Todos os 8 QAs caem em "saudável com oportunidades pontuais" (Performance na fronteira com "dívida
defensável", pelo único P1 medido com número real). Nenhum QA está em risco estrutural.

## 2. Top 10 risks (cross-QA)

Ranqueados por severidade × alcance de negócio × leverage — não é simplesmente "os 10 piores findings".

### R-1: Degradação quase-quadrática de latência em `/metricas`, causada pelo piso fixo sem teto
- **QA(s) afetados**: Performance, Modifiability
- **Findings de origem**: F-performance-1 (performance.md §4), F-modifiability-2 (modifiability.md §4)
- **Evidência sintetizada**: medido em Postgres 17 real — 6 janelas: 19,6 ms; 111 janelas: 333,9 ms
  (17× para 18,5× mais janelas). O plano confirma re-varredura do ledger inteiro por janela
  (`Rows Removed by Join Filter = linhas × janelas`). O piso que causa esse crescimento é o mesmo que
  a própria migration 0060 admite "envelhecer" (~18 semanas em dezembro/2026) — tactics Increase
  Resource Efficiency e Defer Binding violadas pela mesma causa raiz.
- **Impacto técnico**: sem correção, o escopo da query dobra a cada ~1 ano; linhas de ledger e nº de
  janelas crescem simultaneamente, custo aproximadamente quadrático no tempo decorrido desde o piso.
- **Impacto de negócio**: hoje invisível (5,5 ms na escala real, ~200 linhas) — por isso passou
  despercebido. Em ~1-2 anos a tela síncrona (sem loading incremental) fica perceptivelmente lenta sem
  nenhum código novo ter sido escrito, virando correção de última hora sob pressão em vez de migration
  planejada.
- **Card(s) Kanban relacionados**: performance-1, modifiability-2
- **Custo de inação em 6 meses**: baixo especificamente em 6 meses (a janela ainda cresce pouco), mas a
  trajetória medida garante que o custo vira visível dentro de 12-24 meses — premissa: nenhuma migration
  toca o piso ou a query nesse intervalo.

### R-2: Guardrail do invariante central da ADR-0048 não é obrigatório para merge
- **QA(s) afetados**: Testability, Deployability
- **Findings de origem**: F-testability-1 (testability.md §4)
- **Evidência sintetizada**: `gh api .../branches/main/protection` → `404 Branch not protected`. O job
  `backend-sql` roda os 5 testes de integração novos que provam "recuar o piso não move uma vírgula das
  janelas que já existiam" — mas um reviewer pode mergear com esse check vermelho.
- **Impacto técnico**: a suíte que garante o invariante central da mudança existe e roda, mas não é
  enforced.
- **Impacto de negócio**: o número publicado semanalmente pelo `kavex-report-ciclo` (consumido pelo
  Diretor de TI/Presidente da Columbia) depende desse invariante; sem enforcement, a proteção é só
  disciplina humana de quem revisa o PR.
- **Card(s) Kanban relacionados**: testability-1
- **Custo de inação em 6 meses**: um PR futuro sob pressão de prazo pode mergear com `test:sql`
  vermelho — premissa: cadência atual de ~1 feature/semana no domínio financeiro, risco cumulativo por
  PR, não restrito a esta feature.

### R-3: Contrato cross-repo com `kavex-report-ciclo` sem verificação automática
- **QA(s) afetados**: Integrability, Fault Tolerance
- **Findings de origem**: F-integrability-1 (integrability.md §4)
- **Evidência sintetizada**: 0 workflows referenciam `metrics.py`/`kavex-report-ciclo`. A garantia da
  ADR-0048 D3 depende de uma propriedade do script externo (sempre exigir `--inicio`/`--fim`, nunca
  enviar `historico`) verificada só por leitura manual nesta review.
- **Impacto técnico**: uma mudança futura no script (ex.: tornar `--inicio` opcional) quebra a suposição
  sem nenhum sinal em CI.
- **Impacto de negócio**: o report que vai para o Diretor de TI/Presidente só revelaria o problema
  quando o número já estivesse errado, não em CI.
- **Card(s) Kanban relacionados**: integrability-1
- **Custo de inação em 6 meses**: baixo (script estável hoje), mas cresce a cada mudança na skill —
  premissa: a skill evolui fora do controle de versão deste repositório.

### R-4: Exposição a subnotificação de Permutas amplia 5x sem instrumentação de detecção
- **QA(s) afetados**: Fault Tolerance, Integrability
- **Findings de origem**: F-fault-tolerance-1 (fault-tolerance.md §4), F-integrability-3 (integrability.md §4)
- **Evidência sintetizada**: 190 linhas elegíveis a `DELETE` (medição 2026-09-14); exposição temporal de
  semanas fechadas visíveis: 0 → 5, idade máxima 0 → ~42 dias. O card equivalente do run anterior
  (2026-09-14) que mitigaria isso não foi implementado.
- **Impacto técnico**: cada semana fechada agora exibida é consulta live, não snapshot; um `DELETE` de
  borderô associado faz a tentativa sumir do numerador/denominador silenciosamente.
- **Impacto de negócio**: o cliente (Columbia) pode comparar visualmente a tela com um report já
  recebido para a mesma janela; a divergência aparece como bug de produto, não como o efeito colateral
  conhecido de uma exclusão de borderô.
- **Card(s) Kanban relacionados**: fault-tolerance-1, fault-tolerance-2
- **Custo de inação em 6 meses**: janela de exposição já em ~42 dias e crescendo +1 semana/semana,
  proporcional ao piso fixo — premissa: a taxa de exclusão de borderô permanece como hoje.

### R-5: Garantia de compatibilidade de deploy FE/BE depende de comportamento do Zod não travado por teste
- **QA(s) afetados**: Deployability, Modifiability
- **Findings de origem**: F-deployability-1 (deployability.md §4)
- **Evidência sintetizada**: `z.object({inicio,fim}).safeParse({historico:'true'})` →
  `{success:true, data:{}}`, verificado manualmente nesta review. 0 testes/comentário travando essa
  propriedade como contrato deliberado.
- **Impacto técnico**: um PR futuro de "padronização" de schemas com `.strict()` quebra a garantia sem
  saber que ela sustenta a ordem de deploy Vercel/Render.
- **Impacto de negócio**: `/metricas` quebra com 400 em toda janela em que Vercel estiver à frente do
  Render, após qualquer deploy futuro que toque este padrão — sem causa óbvia, difícil de diagnosticar
  porque o "erro" não está no código novo.
- **Card(s) Kanban relacionados**: deployability-1, deployability-2
- **Custo de inação em 6 meses**: depende de uma mudança de schema não relacionada tocar rotas
  compartilhadas — premissa: a cadência observada de features tocando `routes/` torna isso plausível
  dentro do período.

### R-6: `/metricas/ciclo` sem controle de papel, exposição de dado de negócio ampliada 6x
- **QA(s) afetados**: Security
- **Findings de origem**: F-security-1 (security.md §4)
- **Evidência sintetizada**: 0/1 rotas de `/metricas` com `requireRole`, contra 30+ ocorrências em
  outras rotas de negócio (`permutas`, `sispag`, `recebimentos`, `usuarios`). A janela de dado exposto
  sob esse mesmo controle cresce de 1 para 6 semanas.
- **Impacto técnico**: qualquer conta autenticada, independente de papel, lê agregados semanais de
  negócio (valor baixado em permutas, taxas de conclusão).
- **Impacto de negócio**: baixo isoladamente (sem CNPJ/valor por documento), mas achado pré-existente
  cuja superfície cresce a cada extensão da tela — o próximo `/feature-tweak` que adicionar dimensão
  sensível herda o mesmo controle fraco sem novo checkpoint de decisão.
- **Card(s) Kanban relacionados**: security-1
- **Custo de inação em 6 meses**: baixo isoladamente, mas cresce proporcionalmente a cada nova frente
  exposta pela tela — premissa: a tela Métricas segue recebendo mais frentes conforme o roadmap
  (Nexxera/GED, citados em integrability.md).

### R-7: Pool de conexões sem teto de tempo de execução de query
- **QA(s) afetados**: Availability
- **Findings de origem**: F-availability-1 (availability.md §4)
- **Evidência sintetizada**: `Pool({...})` sem `statement_timeout`; o único timeout do repositório é o
  de migrations (10 min), que não cobre queries de aplicação; pool compartilhado `max=5` para toda a API.
- **Impacto técnico**: uma query presa (lock, plano ruim, crescimento do ledger) não tem teto — pode
  esgotar as 5 conexões e degradar rotas não relacionadas a `/metricas`.
- **Impacto de negócio**: hoje risco baixo (~177 linhas no ledger), estrutural — vale corrigir antes do
  volume crescer, para não descobrir o limite em produção durante um fechamento semanal.
- **Card(s) Kanban relacionados**: availability-1
- **Custo de inação em 6 meses**: baixo dado o volume atual, mas cresce junto com R-1 (crescimento do
  ledger) — premissa: nenhuma query lenta adicional é introduzida por outra feature no período.

### R-8: Sem kill-switch operacional para a leitura ampliada de `/metricas`
- **QA(s) afetados**: Availability
- **Findings de origem**: F-availability-2 (availability.md §4)
- **Evidência sintetizada**: 3 kill-switches existentes para SISPAG/Recebimentos/Conexos (`sync:false`
  no Render), 0 equivalente para `historico`.
- **Impacto técnico**: a única mitigação de um incidente restrito a esta tela é reverter e reimplantar
  o frontend.
- **Impacto de negócio**: MTTR de um incidente isolado sobe de "tempo de trocar uma env var" para
  "tempo de um deploy completo" — inconsistente com o padrão já adotado para outras integrações
  sensíveis.
- **Card(s) Kanban relacionados**: availability-2
- **Custo de inação em 6 meses**: baixo em probabilidade, alto em MTTR se ocorrer — premissa: nenhum
  incidente restrito à tela ocorre no período, mas o custo condicional permanece.

### R-9: Sem observabilidade por consumidor no endpoint que alimenta o report executivo
- **QA(s) afetados**: Integrability, Fault Tolerance
- **Findings de origem**: F-integrability-3 (integrability.md §4)
- **Evidência sintetizada**: `routes/metricas.ts` não loga `historico`/origem/resultado; 0 sinal
  distinguindo a chamada da tela da chamada da skill.
- **Impacto técnico**: falha do lado do consumidor (skill) não gera nenhum sinal no financeiro.
- **Impacto de negócio**: falha do report semanal só é percebida quando o Diretor de TI notar a
  ausência/erro do relatório, não por alerta proativo do lado provedor.
- **Card(s) Kanban relacionados**: integrability-3
- **Custo de inação em 6 meses**: depende de uma falha específica do lado da skill — premissa: nenhuma
  mudança na skill nesse período, mas o gap de detecção permanece latente e cumulativo.

### R-10: Falha isolada no piso histórico derruba a tela inteira sem degradar
- **QA(s) afetados**: Availability
- **Findings de origem**: F-availability-3 (availability.md §4)
- **Evidência sintetizada**: `Promise.all` usa o mesmo piso nas duas leituras, por desenho correto — mas
  sem fallback; uma falha isolada em `historico_inicio()` com `serie_inicio()` saudável derruba a tela
  inteira.
- **Impacto técnico**: o usuário perde a tela inteira em vez de ver a semana vigente (comportamento
  equivalente ao de antes da ADR-0048).
- **Impacto de negócio**: baixo — o cenário exige uma falha parcial de schema que o `BootMigrator` já
  torna improvável.
- **Card(s) Kanban relacionados**: availability-3
- **Custo de inação em 6 meses**: muito baixo, mas não-zero — premissa: nenhum downgrade manual de
  schema fora do `BootMigrator` ocorre.

## 3. Cross-cutting findings

### CC-1: Piso fixo que envelhece (rótulo + custo)
- **Aparece em**: Modifiability, Performance
- **Findings**: F-modifiability-2 (Modifiability), F-performance-1 (Performance)
- **Diagnóstico unificado**: `metricas.historico_inicio()` retorna uma constante SQL fixa
  (`2026-08-07 18:00`), decisão deliberada do Yuri (ADR-0048 D2) para resolver o problema imediato
  (tela vazia). A mesma causa raiz — um piso que não avança — gera duas consequências arquiteturais
  distintas e independentes: (a) **correção de rótulo** — a tela seguirá anunciando "últimas 6 semanas"
  quando na prática já mostrará ~18 em dezembro/2026, um drift semântico silencioso; (b) **custo de
  execução** — a query re-varre o ledger inteiro por janela (sem índice funcional em `criado_em`), e
  cada semana adicional multiplica o custo medido (17× ao passar de 6 para 111 janelas, Postgres 17
  real). As duas consequências crescem juntas e sem teto a partir do mesmo piso fixo — não são bugs
  isolados, é o mesmo vetor de dívida se manifestando em dois QAs.
- **Recomendação consolidada**: tratar como um único item de planejamento, não dois cards desconectados.
  (1) Reescrever `metricas_ciclo()` para custo O(linhas) via bucketing/índice de expressão
  (card **performance-1**, resolve o custo). (2) Registrar lembrete datado (`ontology/_inbox/`) + teste
  de idade da janela que alerta quando `NOW() - historico_inicio() > 10 semanas` (card
  **modifiability-2**, resolve o rótulo). Nenhuma das duas ações reabre a decisão de negócio da
  ADR-0048 — ambas mitigam tecnicamente a consequência que a própria ADR já admite.

### CC-2: Zod sem `.strict()` como garantia não documentada
- **Aparece em**: Deployability, Modifiability
- **Findings**: F-deployability-1 (Deployability), nota cruzada registrada em `modifiability.md` §6
- **Diagnóstico unificado**: a segurança da ordem de deploy independente Vercel/Render (janela de
  inconsistência = 0s) depende inteiramente de uma propriedade implícita do Zod —
  `z.object({...})` sem `.strict()` descarta chaves desconhecidas em vez de rejeitá-las. A mesma
  propriedade é o que torna o padrão do delta elegante do ponto de vista de Modifiability (nenhuma
  camada abaixo da rota precisa saber da versão do consumidor). O risco: ninguém documentou essa
  dependência — um desenvolvedor "padronizando" schemas de rota com `.strict()` por higiene de
  tipagem, um refactor plausível e bem-intencionado do ponto de vista de Modifiability, quebraria
  silenciosamente a garantia de Deployability, sem nenhum teste ou comentário para detê-lo.
- **Recomendação consolidada**: um único card cobre os dois QAs — adicionar teste de contrato explícito
  ("chave de query desconhecida retorna 200, nunca 400/500") e comentário no schema ligando a decisão à
  ordem de deploy (card **deployability-1**). Não é necessário card duplicado em Modifiability: o teste
  de contrato É a proteção contra o refactor perigoso que Modifiability sinaliza como risco.

### CC-3: Ausência de sinal cross-repo e cross-ledger
- **Aparece em**: Integrability, Fault Tolerance, Availability
- **Findings**: F-integrability-1, F-integrability-3 (Integrability), F-fault-tolerance-1
  (Fault Tolerance)
- **Diagnóstico unificado**: o financeiro não tem nenhum mecanismo automatizado que confirme, depois do
  deploy, que os dois lados de uma integração continuam de acordo — nem o lado externo (o script
  `metrics.py` da skill `kavex-report-ciclo`, sem teste cross-repo nem observabilidade por consumidor
  no endpoint) nem o lado interno (o ledger de origem, `permuta_alocacao_execucao`, que pode ser mutado
  por `DELETE` depois de uma semana já ter sido "fechada" e reportada, sem nenhuma tabela append-only ou
  monitor de drift). É a mesma lacuna estrutural — falta de observabilidade de integração — aparecendo
  em duas superfícies diferentes: uma aponta para fora do repositório (skill), a outra para dentro
  (ledger mutável).
- **Recomendação consolidada**: dois cards resolvem as duas superfícies sem se substituir. (1)
  Instrumentar `/metricas/ciclo` com log de origem/resultado por chamada (card **integrability-3**,
  cobre a superfície externa/skill). (2) Implementar a tabela append-only `metricas_ciclo_leituras`
  que registra o snapshot de cada leitura de semana fechada, permitindo detectar divergência
  retroativa por diff (card **fault-tolerance-1**, cobre a superfície interna/ledger). O smoke test
  cross-repo (card **integrability-1**) é um terceiro pilar complementar, não redundante: garante que
  o CONSUMIDOR externo não mudou de comportamento, enquanto os dois cards acima garantem que o
  PROVEDOR sinaliza quando algo diverge.

## 4. Quick wins (≤5 dias úteis)

Cards de esforço S, severidade ≥ P2 — defensáveis como "primeira sprint pós-aprovação". (Excluído
deliberadamente: `modifiability-1`, que também é S/P2 mas é um card de "esperar o gatilho" — o próprio
finding recomenda YAGNI até um 3º piso ser pedido; incluí-lo aqui distorceria a lista.)

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| testability-1 | Testability | S | P1 | Required status checks em `main`: 0 → 3; PR com `test:sql` vermelho deixa de ser mergeável |
| availability-1 | Availability | S | P2 | `statement_timeout` configurado no client de app: 0 → 1 |
| availability-2 | Availability | S | P2 | Kill-switch operacional para `?historico=true`: 0 → 1, igualando padrão de SISPAG/Recebimentos/Conexos |
| deployability-1 | Deployability | S | P2 | Teste de contrato de compatibilidade de schema de query: 0 → ≥1 |
| integrability-2 | Integrability | S | P2 | Convenção de versionamento de contrato documentada: ausente → presente |
| integrability-3 | Integrability | S | P2 | Chamadas a `/metricas/ciclo` logadas por origem: 0% → 100% |
| modifiability-2 | Modifiability | S | P2 | Alerta/lembrete de revisão do piso fixo: 0 → 1 mecanismo (ontologia ou teste agendado) |
| performance-2 | Performance | S–M | P2 | Cache hit ratio de leituras: 0% → ≥80%; janelas por resposta: ilimitado → tetado (ex. 26) |
| fault-tolerance-2 | Fault Tolerance | S | P2 | Estados de semana com aviso de instabilidade na UI: 1/2 → 2/2 |
| security-1 | Security | S | P2 | Rotas de `/metricas` com `requireRole` OU decisão documentada: 0/1 → 1/1 |

## 5. Strategic moves (M / L / XL)

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| performance-1 | Performance | M | Increase Resource Efficiency | Medido 19,6 ms → 333,9 ms (17×) ao passar de 6 para 111 janelas com ledger fixo em 5.000 linhas; o piso fixo já cresce +1 janela/semana para sempre — sem correção, a projeção aponta centenas de ms em ~1 ano e pode ultrapassar 1s em ~2 anos |
| integrability-1 | Integrability | M | Contract testing | 0 testes cross-repo hoje contra `metrics.py`, que alimenta o report consumido pelo Diretor de TI/Presidente da Columbia — a garantia da ADR-0048 D3 depende de uma propriedade hoje não verificável automaticamente |
| fault-tolerance-1 | Fault Tolerance | M | Rollback + Reconcile | Exposição de semanas fechadas sujeitas a `DELETE` cresceu de 0 para ~42 dias (5 semanas), sobre 190 linhas elegíveis a exclusão medidas em 2026-09-14, sem nenhuma instrumentação de detecção de divergência |
| security-2 | Security | M | Validate Input | Hoje 0 sítios de interpolação SQL insegura, mas isso é garantido só por auditoria manual a cada review; formalizar como gate do `PatternGuardian` remove a dependência de disciplina manual no único vetor de SQL injection do domínio |
| availability-3 | Availability | M | Degradation | Hoje 0% de cobertura de fallback quando o piso histórico falha isoladamente — cenário raro mas real dado que 2 pisos agora coexistem; a falha derruba a tela inteira em vez de degradar para a janela vigente que funcionava antes da ADR-0048 |

## 6. O que está bem (e por quê)

1. **Ordem de deploy FE/BE segura por construção, não por sorte de timing** — `BootMigrator` bloqueia
   `/health` até a migration completar ou o processo morrer, e o schema de query não usa `.strict()`,
   então parâmetro novo do frontend contra backend antigo degrada sem erro. Janela de inconsistência
   medida = 0s. Tactic: Script Deployment Commands / Backward-compatibility shim.
   (`deployability.md` §2)
2. **Contrato do report preservado byte a byte** — 9/9 campos + `parcial`/`apurado_ate`, mesma ordem,
   mesmo piso, comprovado por guarda estática e teste de rota. `kavex-report-ciclo` não precisa de
   nenhuma mudança. Tactic: Adhere to Standards. (`integrability.md` §2)
3. **Migrations idempotentes e aditivas** — `CREATE OR REPLACE FUNCTION` + `REVOKE ALL FROM PUBLIC`,
   ambas re-executáveis sem efeito colateral; reaplicar o mesmo deploy não duplica efeito. Tactic:
   Idempotent deploys / Software Upgrade. (`deployability.md` §2, `availability.md` §3)
4. **SQL injection investigado e refutado ponta a ponta** — o booleano validado nunca vira string
   livre; `piso()` mapeia para 1 de 2 literais fixos de módulo, nunca deriváveis da requisição; os
   únicos valores do cliente que chegam à query (`inicio`/`fim`) vão via bind parameter. Tactic: Verify
   Message Integrity. (`security.md` §4)
5. **Erro nunca mascarado como número zerado** — falha de leitura propaga como exceção visível, testada
   explicitamente nos dois lados (backend `errorMiddleware`, frontend `EmptyState` + "Tentar de novo").
   Tactic: Exception Detection. (`availability.md` §2)
6. **Não-determinismo controlado nos testes** — `metricas.metricas_ciclo(p_serie_inicio, p_agora)`
   recebe o "agora" como parâmetro, não lê `now()` internamente; os testes fixam a data e não dependem
   do relógio da máquina de CI. Tactic: Limit Non-Determinism (também facilita Modifiability — trocar a
   régua de "agora" sem tocar a função). (`testability.md` §3)
7. **Proporção teste:produção de ~1:6, com testes reais contra Postgres 17** — 26 testes novos para
   ~60 linhas de produção, incluindo 5 de integração rodando contra um Postgres efêmero real (não
   mocks), 19/19 verdes. Tactic: Sandbox + Executable Assertions. (`testability.md` §1-2)
8. **Hardening de privilégio SQL consistente entre migrations** — `REVOKE ALL ... FROM PUBLIC` e
   `SET search_path = ''` replicados da migration 0058 para a 0060, com guarda estática própria
   travando a repetição do padrão. Tactic: Change Default Settings. (`security.md` §2-3)

## 7. Limitações da análise

**Métricas declaradas "não medíveis localmente" pelos agents:**
- Contagem de linhas reais do ledger de Permutas em produção hoje (18/09) — requer consulta ao Postgres
  de produção (`availability.md`).
- Observabilidade por consumidor em produção (log estruturado por chamada) — requer
  CloudWatch-equivalente (`integrability.md`).
- Quantas linhas das 5 semanas de agosto já foram de fato apagadas por exclusão de borderô desde que
  nasceram — requer produção (`fault-tolerance.md`).
- Cobertura de testes (`--coverage`) e `npm audit` profundo — fora do escopo `--quick` (`security.md`,
  `testability.md`, `_shared-metrics.md`).
- `statement_timeout`/timeout de execução de query no client de app — código pré-existente fora dos 7
  arquivos do delta, citado como contexto, não medido como parte deste PR (`performance.md`,
  `fault-tolerance.md`).

**O que o pipe não cobre:**
- Chaos engineering (nenhuma injeção de falha real em produção/staging).
- Threat modeling formal (STRIDE ou equivalente) — a análise de segurança é code review dirigido, não
  modelagem de ameaça sistemática.
- Custo de infraestrutura/cloud (não aplicável hoje — sem `infra/`/Terraform neste repositório).
- UX e acessibilidade formal da tela `/metricas`.

**Escopo restrito ao delta (`--quick`):** vários achados citados nesta run são **pré-existentes**, não
regressões introduzidas por este PR — sinalizados explicitamente pelos agentes e preservados aqui:
`requireRole` ausente em `/metricas` (Security), branch protection ausente em `main` (Testability),
ausência de `statement_timeout` no client de app (Availability/Performance), `autoDeploy` sem canário
(Deployability). Todos citados como contexto do artefato atravessado pelo delta, nunca como regressão
deste PR especificamente.

**Nenhuma edição de conteúdo** foi feita nos cards copiados para o `KANBAN.md` — apenas a numeração de
seção/prioridade é deste consolidado; o texto de Problema/Melhoria Proposta/Resultado Esperado é
verbatim das 8 seções.

**Janela temporal:** este é um snapshot do dia 2026-09-18 (run `2026-09-16-1650-metricas-historico`);
código é vivo — refazer trimestralmente, ou antes se a janela do piso fixo se aproximar do gatilho de
revisão sinalizado em CC-1/R-1 (~10 semanas de idade).

## 8. Ações recomendadas

1. Fechar os 3 P1 antes de qualquer novo `/feature-new`/`/feature-tweak` que toque `/metricas`:
   branch protection obrigatória em `main` (card `testability-1`), smoke test cross-repo do
   `metrics.py` (card `integrability-1`), reescrita de `metricas_ciclo()` para custo O(linhas)
   (card `performance-1`).
2. Na mesma sprint, fechar os quick wins de disponibilidade/segurança operacional: decisão de
   `requireRole` em `/metricas` (card `security-1`), `statement_timeout` no client de Postgres
   (card `availability-1`), kill-switch para `?historico=true` (card `availability-2`).
3. Resolver o par cross-cutting do piso fixo (CC-1) e da garantia Zod (CC-2) juntos: teste de contrato
   travando o comportamento não-`.strict()` (card `deployability-1`) e lembrete datado + teste de idade
   da janela do piso fixo (card `modifiability-2`) — ambos amarrados ao mesmo card `performance-1`.
4. Instrumentar observabilidade cross-consumer (CC-3) antes que a janela de agosto (~42 dias e
   crescendo) envelheça mais: log por origem em `/metricas/ciclo` (card `integrability-3`) e tabela
   append-only `metricas_ciclo_leituras` (card `fault-tolerance-1`).
5. Planejar — não implementar ainda — os moves estratégicos restantes para a próxima janela de
   planejamento: fallback do piso histórico (card `availability-3`) e regra `PatternGuardian` para
   interpolação SQL (card `security-2`).
