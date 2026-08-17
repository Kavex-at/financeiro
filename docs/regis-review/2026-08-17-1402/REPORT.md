---
type: regis-review-report
run_id: 2026-08-17-1402
generated_at: 2026-08-17
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: DELTA da feature nde-painel-lista (aba NDe do painel de recebimentos) — worktree /tmp/nde-painel-wt · branch fix/nde-painel-lista · base main
total_cards: 27
total_p0: 1
total_p1: 7
total_p2: 13
total_p3: 6
overall_score_pre_remediation: 6.3
overall_score_post_remediation: 7.3
weights: { security: 1.5, fault_tolerance: 1.3, availability: 1.2, modifiability: 1.2, testability: 1.0, performance: 1.0, integrability: 0.9, deployability: 0.9 }
---

# Regis-Review — financeiro — 2026-08-17-1402 (feature `nde-painel-lista`)

> **Nota de numeração (pós-rebase).** As seções cruas dos 8 agentes citam "ADR-0034" e "migration
> 0046". Durante o rebase sobre a `main` descobriu-se que os dois números já estavam ocupados: o ADR
> desta feature virou **0037** e a migration virou **0048**. Onde este relatório diz ADR-0034 nas
> citações herdadas, leia **ADR-0037**.

## 0. O que mudou entre o run dos 8 agentes e este consolidado

Os 8 agentes rodaram sobre o worktree ANTES de uma leva de remediações. Este consolidado reflete o
estado APÓS as remediações. Cards são gerados apenas para o que continua aberto.

**Remediado dentro do ciclo (não vira card):**

| # | Remediação | Findings fechados |
|---|---|---|
| 1 | `LogService` injetado em `RecebimentosPainelService` (era 0/7 deps). Toda falha de hidratação e de reconciliação passa a emitir `logService.warn` com `LOG_TYPE.BUSINESS_WARN`. | F-fault-tolerance-2, F-testability-4, F-availability-4, F-security-5 (parte silenciosa) |
| 2 | Prazo por leitura (`PAINEL_NDE_HIDRATACAO_TIMEOUT_MS=8000`, alinhado ao `ERP_WRITE_TIMEOUT_MS`) via `Promise.race` + orçamento da fase (`PAINEL_NDE_HIDRATACAO_BUDGET_MS=12000`) cortando a fase inteira. Linhas restantes voltam do banco com log. | F-availability-1 (elimina o pior caso de ~8 min); F-performance-1 (mitiga; cauda finita); F-integrability-2 (mitiga; timeout honrado localmente) |
| 3 | Lote 5 → `FANOUT_LIMIT_RECEBIMENTOS` (4), com teste que mede o PICO de concorrência real (não só o cap). A constante local `PAINEL_NDE_HIDRATACAO_LOTE` foi REMOVIDA — o código lê `FANOUT_LIMIT_RECEBIMENTOS` diretamente, unificando o teto num único símbolo do módulo. | F-availability-2, F-performance-3, F-testability-2 |
| 4 | Ordem de escrita invertida: grava `numero_nde` PRIMEIRO e `nde_autorizado` DEPOIS. O flag é o ponto de commit; falha ao gravar o número não deixa mais a linha autorizada-e-sem-número para sempre. Com teste. | F-fault-tolerance-1, F-fault-tolerance-3 (parcial) |
| 5 | Guard do `docEspNumero`: `numeroNdeUtilizavel()` rejeita vazio e `"0"`. O campo não-confirmado-por-HAR não vira número fiscal falso persistido; a autorização é gravada mesmo sem número. Com teste. | F-integrability-1 |
| 6 | Migration **0048** (aditiva, rollback-safe): índice PARCIAL em `solicitacao_numerario_execucao (fil_cod, nd_doc_cod) WHERE dry_run=false AND COALESCE(nde_dispensada,false)=false`. Comando exato: `CREATE INDEX IF NOT EXISTS ... WHERE ...` — **SEM `CONCURRENTLY`**, porque o `BootMigrator` roda em transação antes de aceitar tráfego e `CONCURRENTLY` não funciona dentro de transação. | F-performance-2 |
| 7 | UI: chip do SEFAZ aparece também quando `ndeAutorizado===true` sem NDe local (não nega um fato fiscal); mensagem de erro ganhou ícone (P0 de acessibilidade do DesignSystemReviewer). | achado do DesignSystemReviewer, fora dos 8 QAs |

**Nota de precisão sobre Deployability:** a afirmação original do agente ("delta é migration-free")
não é mais literal após a remediação 6. Correção: **o delta continua rollback-safe** — a migration é
aditiva, sem migração de dados, sem down-script, zero-impacto no código antigo. "Revert = git revert
+ push" continua verdadeiro.

**Continuam abertos:** 27 cards (1 P0, 7 P1, 13 P2, 6 P3). Ver §2, §4, §5 e o `KANBAN.md`.

**Dívida pré-existente que o delta apenas AMPLIFICOU (não introduziu):**

- **F-security-1** (`filiaisPermitidas` fail-open) — vale para toda a carteira; o delta só expande a
  superfície de leitura. **Prioridade sistêmica P0.**
- **F-security-3** (`erroMensagem` cru na tela) — já existe precedente no `BorderosPanel` de permutas.
- **F-security-4 / F-availability-5** (`heavyRouteLimiter` ausente no `/painel`) — a rota só virou
  "heavy" agora; o mecanismo de proteção já existia e nunca foi aplicado a ela.
- **F-deployability-3, F-deployability-4** (deploy não-atômico FE/BE, sem `/deployinfo`).
- **F-integrability-4, F-integrability-5** (`ExternalCallOptions.timeoutMs` não propagado; GAP do
  grid `com297`) — o delta amplifica a consequência, não introduz o gap.

## 1. Executive scorecard

Pesos (SaaSo financeiro que move dinheiro): Security 1.5, Fault Tolerance 1.3, Availability 1.2,
Modifiability 1.2, Testability 1.0, Performance 1.0, Integrability 0.9, Deployability 0.9.

| QA | Pré | Pós-remediação | P0 | P1 | P2 | P3 | Top finding aberto |
|---|---|---|---|---|---|---|---|
| Security | 6 | 6 | 1 | 2 | 1 | 0 | fail-open de authz por filial (100% dos tokens hoje viram "todas as filiais") |
| Fault Tolerance | 6 | 8 | 0 | 1 | 1 | 0 | sem reaper — divergência SEFAZ×local depende de painel humano |
| Availability | 6 | 8 | 0 | 0 | 2 | 0 | sem cache/breaker cross-request — F5 amplifica ERP degradado |
| Modifiability | 7 | 7 | 0 | 2 | 2 | 1 | ISP violado (9 arquivos de teste tocados só para stubs) |
| Testability | 7 | 8 | 0 | 1 | 2 | 1 | aba NDe sem cobertura e2e — 9 fakes devolvem `[]` |
| Performance | 5 | 7 | 0 | 1 | 2 | 0 | hidratação segue no path de leitura; mover para job |
| Integrability | 6 | 7 | 0 | 0 | 2 | 1 | 3 rotas Conexos sem observability por dependência |
| Deployability | 8 | 8 | 0 | 0 | 2 | 2 | deploy FE+BE não-atômico sem orquestração no CI |
| **Overall** | **6.3** | **7.3** | **1** | **7** | **13** | **6** | — |

Escala: 0–3 risco estrutural · 4–6 dívida defensável · 7–8 saudável com oportunidades pontuais ·
9–10 estado-da-arte para o estágio.

A feature entrega **7.3 ponderado**. O único P0 restante é dívida pré-existente sistêmica; fechado
ele, o score passa de 8.0.

## 2. Top 10 riscos (cross-QA)

### R-1 · Fail-open de autorização por filial no `/painel` — **P0**
`filialAuthz.ts:45-50` faz `if (permitidas === undefined) return true;`, e `auth.ts:24-27` documenta
que os tokens Supabase de hoje **não** carregam o claim `filiais`. `resolverFilCods` então cai em
`base.getFiliais()` — TODAS as filiais do ERP. Qualquer analista autenticado lê `numeroNde`,
`ndDocCod`, `valor` e `erroMensagem` de todas as filiais. Quebra do isolamento multi-filial, que é a
promessa central do produto para cliente multi-filial. Card: `security-1`. **Pré-existente.**

### R-2 · `GET /painel` executa reconciliação sem barreira arquitetural — P2 (decisão consciente)
`hidratarUma` dispara `setNdeAutorizado` + `updateNumeroNde` dentro de um GET. Mitigado por
timeout+budget (rem. 2) e pela ordem de escrita (rem. 4), mas a arquitetura continua acoplando
leitura ao ERP. ADR-0037 aceita o trade-off para esta entrega. Cards: `security-2`, `performance-1`,
`fault-tolerance-3` — **uma só unidade de trabalho** (extrair `NdeReconcilerJob`).

### R-3 · `erroMensagem` cru do Conexos exposto no browser — P1
`NdeRepository.ts` → `NdeTable.tsx`. Revela superfície interna do ERP (`RECORDNOTFOUND`, nomes de env).
Combinado com R-1, o analista lê os erros de todas as filiais. Precedente no `BorderosPanel`.
Card: `security-3`.

### R-4 · `heavyRouteLimiter` ausente no `/painel` — P1
`http/rateLimit.ts:5-7` define o limiter exatamente para "rotas cujo fan-out ao Conexos pode esgotar
o pool de sessão" — e o `/painel` acabou de virar esse perfil. No teto atual (100 req/min por IP) o
pior caso é 100 × 20 = 2000 GETs/min ao Conexos. Cards: `security-4` = `availability-5`.

### R-5 · Regra "NDe pendente" duplicada em 3 stacks — P1
SQL do `contarPendentes` + `computeKpis` do FE + composição visual da tabela. "Card diz 3, tabela
mostra 4" é o jeito mais eficiente de matar a confiança do analista. Cards: `modifiability-2`,
`deployability-3`.

### R-6 · `NdeRepositoryInterface` viola ISP — P1
Estender a porta forçou 9 arquivos e2e a redigitar stubs. Os consumidores reais são disjuntos (um só
escreve, outro só lê). Cards: `modifiability-1`, `modifiability-3`, `modifiability-5`.

### R-7 · Aba NDe sem cobertura e2e — P1
Os 9 fakes devolvem `[]`; nenhum caso prova que a rota serializa `painel.ndes`. Card: `testability-1`.

### R-8 · Reaper de divergência SEFAZ×local ausente — P1
Linhas fora da janela do painel podem ficar `nde_autorizado=false` por dias mesmo com o SEFAZ tendo
autorizado. Card: `fault-tolerance-3`.

### R-9 · Sem cache/breaker cross-request na hidratação — P2
`ProcessoProviderConexos` já cacheia `imp021` por essa razão; a hidratação NDe não segue a doutrina.
N analistas × 20 GETs. Cards: `availability-3`, `integrability-3`.

### R-10 · `RecebimentosPainelService` a caminho de "god service" — P2
7 deps (era 5); `hidratarNdes`/`hidratarUma` misturam leitura ERP + derivação + write-back em duas
tabelas. Card: `modifiability-3` (= `testability-5`).

## 3. Cross-cutting findings

- **CC-1 — Reconciliação distribuída sem coordenador dedicado** (Security, Performance, Fault
  Tolerance, Availability). O `GET /painel` foi promovido a coordenador porque não havia scheduler.
  Fechar `security-2` + `performance-1` + `fault-tolerance-3` como UMA unidade devolve o `/painel`
  a 100% read-only.
- **CC-2 — `.catch(() => undefined)` sistêmico** (5 QAs convergiram). A remediação 1 (`LogService`)
  fechou o pior; falta métrica estruturada por endpoint → `integrability-3`.
- **CC-3 — Duplicação de contrato BE↔FE** (Modifiability, Deployability). Intencional para tolerar
  skew de deploy, mas cria pista de divergência silenciosa → `modifiability-2` + `deployability-3`.
- **CC-4 — Serviço do painel cresce** (Modifiability, Testability, Fault Tolerance) → extrair
  `NdePainelHidratadorService` (`modifiability-3` = `testability-5`).
- **CC-5 — `heavyRouteLimiter` + `requestTimeout`** (Security, Availability): duas seções chegaram ao
  mesmo card por caminhos diferentes → `security-4` = `availability-5`.

## 4. Quick wins (esforço S, severidade ≥ P2)

| Card | QA | Resultado esperado |
|---|---|---|
| `security-3` | Security | `erroMensagem` sanitizada; browser lê código estável |
| `security-4` = `availability-5` | Security + Availability | `/painel` de 100 → 10 req/min + `requestTimeout=30000` |
| `modifiability-2` | Modifiability | regra "NDe fechada" em 2 lugares em vez de 3 |
| `testability-1` | Testability | ≥ 1 caso e2e cobrindo `GET /recebimentos → body.ndes` |
| `modifiability-1` | Modifiability | próxima extensão da projeção toca 2 arquivos, não 9 |
| `modifiability-3` = `testability-5` | Modif. + Test. | `NdePainelHidratadorService`; painel volta a 5 deps |
| `deployability-2` | Deployability | `/deployinfo` + meta build-sha; MTTR de skew 5 min → 30 s |
| `fault-tolerance-4` | Fault Tolerance | `source`/`ator` na reconciliação — audit trail completa |
| `performance-4` | Performance | hidratação overlappada com `enriquecerComModalidade` |
| `performance-5` | Performance | `contarPendentes` colapsado no mesmo scan (window function) |
| `integrability-3` | Integrability | 3 contadores de falha por endpoint no `montarPainel` |

**Em bloco: ~10 dias úteis fecham 11 cards e movem a nota de 7.3 para ~8.0.**

## 5. Strategic moves (M/L)

| Card | QA(s) | Tactic | Por que vale |
|---|---|---|---|
| `security-1` | Security | Authorize Actors + Limit Access | cobertura de authz por-filial em produção hoje = 0%; alvo 100%. Único P0. |
| `security-2` + `performance-1` + `fault-tolerance-3` | Sec+Perf+FT | Audit Trail + Schedule Resources + Self-Test | cauda do painel ≤ 12 s → ≤ 400 ms; latência de reconciliação indefinida → ≤ 24 h |
| `availability-3` | Availability | Removal from Service + Predictive Model | ERP saudável: N×20 GETs → ~20. ERP degradado: → ≤ 5 (breaker) |
| `deployability-1` | Deployability | Scale Rollouts | ordem de deploy determinística 0% → 100% |
| `integrability-2` | Integrability | Tailor Interface + Configure Behavior | `ExternalCallOptions.timeoutMs` é contrato escrito e não implementado |
| `testability-4` | Testability | Sandbox | 16 asserções de string viram teste de comportamento contra Postgres real |
| `integrability-4` | Integrability | Restrict Communication Paths | HTTPs por abertura de painel 20 → 1 (batch); fecha o GAP do grid com297 |

## 6. O que está bem (âncora de credibilidade)

1. **Contrato aditivo BE↔FE** — todos os campos novos de `NdePainelRow` são opcionais; o skew do
   deploy não-atômico é seguro nas duas ordens.
2. **SQL 100% parametrizado nas 2 queries novas** — inclusive `ANY($filCods)` como array pg. Regra
   Inviolável #5 satisfeita.
3. **Idempotência de replay entre `etapaPoll` e painel** — ambos escrevem o mesmo `true` sob a mesma
   condição; last-write-wins seguro.
4. **Teto de blast-radius unificado** — `PAINEL_NDE_HIDRATACAO_CAP=20` e concorrência amarrada ao
   `FANOUT_LIMIT_RECEBIMENTOS=4`, o símbolo canônico do módulo (a constante local foi eliminada).
5. **`PAINEL_NDE_HIDRATACAO_TIMEOUT_MS=8000`** — alinhado ao `ERP_WRITE_TIMEOUT_MS`; antes o
   `lerDocParaPolling` herdava só o axios `timeout: 40000` POR TENTATIVA.
6. **`PAINEL_NDE_HIDRATACAO_BUDGET_MS=12000`** — orçamento da fase; é o mecanismo que ELIMINA o pior
   caso de ~8 min e limita a cauda do painel independentemente do estado do ERP.
7. **Migration aditiva e rollback-safe** — índice PARCIAL no mesmo recorte da aba. `CONCURRENTLY`
   intencionalmente ausente (BootMigrator roda em transação antes de aceitar tráfego).
8. **Zod nos boundaries** — `DOC_STATUS_SCHEMA` na resposta do com297; `painelQuerySchema` no input.
9. **`LogService` com `LOG_TYPE.BUSINESS_WARN`** — fecha 4 findings de agentes diferentes num movimento.
10. **`numeroNdeUtilizavel()`** — sem HAR confirmatório, o campo não vira número fiscal falso persistido.

## 7. Limitações da análise

**Não medível localmente** (declarado pelos agentes): p50/p95 real do `GET com297` em produção; MTTR
analista-visível sob ERP pendurado; coverage line/branch (`--quick` bloqueia); distribuição real de
tokens com claim `filiais`; bundle FE em KB gzip; `npm audit` profundo; taxa real de divergência
SEFAZ×local em produção.

**Fora do pipe:** chaos engineering, threat modeling formal, custo cloud, UX qualitativa, WCAG completo.

**Escopo:** DELTA (`fix/nde-painel-lista` vs `main`), não repo-wide — dívida pré-existente fora do
delta não entrou.

**Ajustes editoriais vs. seções cruas:** `security-4`/`availability-5` e `modifiability-3`/
`testability-5` são pares de ID distinto para a MESMA unidade de trabalho; `security-2` rebaixado de
P0 para P2 (o trade-off é decisão de ADR, não bug); `performance-1` reframed para "mover para job";
`fault-tolerance-1` (remediado) excluído do Kanban.

**Janela temporal:** snapshot de 2026-08-17. Refazer trimestralmente.

## 8. Ações recomendadas (30 dias)

1. **Sprint 1 — quick wins de segurança/observabilidade (~5 dias):** `security-3`,
   `security-4`/`availability-5`, `integrability-3`, `deployability-2`, `fault-tolerance-4`.
2. **Sprint 1 em paralelo — modifiability/testability (~3-5 dias):** `modifiability-1`,
   `modifiability-2`, `modifiability-3`/`testability-5`, `testability-1`, `performance-4`,
   `performance-5`, `deployability-3`, `deployability-4`.
3. **Sprint 2 — o único P0:** `security-1`. Exige alinhamento com o time de auth Supabase (hook de
   JWT) e OntologyCurator (entidade `UsuarioFilial`).
4. **Sprint 2-3 — CC-1:** extrair `NdeReconcilerJob` — três findings fecham juntos e o `/painel`
   volta a ser read-only.
5. **Sprint 3-4:** `availability-3` (cache + breaker) e `integrability-2` (Tailor Interface).
   `integrability-4` (HAR do grid com297) fica no backlog do próximo caso de uso fiscal.
