---
type: regis-review-report
run_id: 2026-08-19-1603
generated_at: 2026-08-19T17:00:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice
delta: feat/frente-v-aprovacoes (73 arquivos, +15.482 linhas)
total_cards: 55
total_p0: 3
total_p1: 19
total_p2: 28
total_p3: 5
overall_score: 6.6
---

# Regis-Review — financeiro — 2026-08-19-1603

> Escopo: delta da **Frente V — Workflow de Aprovação** (`feat/frente-v-aprovacoes`).
> Read-only no ERP por decisão arquitetural (ADR-0038 D2 — o port de leitura não declara escrita).
> Rodada `--quick`: coverage, `next build`, `npm audit` profundo e `terraform plan` **não executados** (§7).

> ## ⚠ 7 cards já foram fechados na remediação pós-review
>
> Esta revisão fotografou o commit `603a3ed`. O commit `dea5ce7` remediou parte dela **antes** deste
> relatório ser lido. Ver §9 para a lista e para o que a remediação mudou nos números.

## 1. Executive scorecard

**Pesos** (SaaSo financeiro multi-tenant; a Frente V é read-only mas alimenta decisão auditável):
Security 1.5 · Fault Tolerance 1.3 · Availability 1.2 · Modifiability 1.2 · Testability 1.0 ·
Performance 1.0 · Integrability 0.9 · Deployability 0.9. Soma = 9.0.

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---:|---:|---:|---:|---:|---|
| Availability | 6.0 | 0 | 4 | 3 | 0 | 1 título "poison" aborta backfill de 23.632 |
| Deployability | 6.0 | 0 | 3 | 3 | 0 | job sem workflow (único das 4 frentes) |
| Integrability | 7.5 | 0 | 2 | 3 | 1 | Zod ausente (único entre 9 clients Conexos) |
| Modifiability | 7.0 | 0 | 3 | 3 | 2 | `executar` cognitive 33 (>2× teto Biome) |
| Performance | 5.0 | 1 | 2 | 4 | 1 | 23.680 chamadas/varredura enquanto PV-07 aberta |
| Fault Tolerance | 7.5 | 0 | 2 | 4 | 0 | sem cron + `status='error'` sem consumidor |
| Security | 7.5 | 0 | 1 | 5 | 0 | fail-open: JWT sem `filiais` vê todas |
| Testability | 6.0 | 2 | 2 | 3 | 1 | SQL nunca tocou Postgres real |
| **Overall** | **6.6** | **3** | **19** | **28** | **5** | — |

Interpretação: 0–3 risco estrutural · 4–6 dívida defensável · 7–8 saudável · 9–10 estado-da-arte.

**Leitura do 6.6**: dívida defensável. Performance (5.0) está presa a pendência externa (PV-07);
Testability e Deployability (6.0) travam na mesma raiz (Postgres nunca aplicado, workflow nunca
criado). Fault Tolerance e Security em 7.5 mostram que as decisões estruturais — read-only por tipo,
fail-safe em `INDETERMINADO`, advisory lock, UPSERT idempotente — foram acertadas. **O problema não
é desenho, é fechamento.**

### Três baldes de esforço

**Balde A — código nosso (43 cards).** Zod no client, backoff, poison-title, split de `page.tsx` e
`TrilhaDrawer`, índices trigram, cursor por página, ClockProvider, contract tests, redator de PII,
endurecimento das sondas, workflow YAML, alerta em `status='error'`.

**Balde B — depende de terceiro (4 cards).** É *dívida esperando*, não desleixo:
- `performance-1` (P0) — **PV-07**, acesso à tela `fin103`. Enquanto aberta, cada varredura custa
  23.680 chamadas em vez de ~48. O código já troca o binding em 1 linha.
- `security-1` (P1) e `modifiability-7` (P3) — **PV-09**, claim `filiais` no JWT do Supabase.
- `availability-2` (P1) — cron exige a Fase 1 do runbook executada antes.

**Balde C — infraestrutura ausente (5 cards).** `testability-1` (P0) e `deployability-6` — Postgres
real em CI. `availability-4` — smoke contra homologação. `deployability-5` — token da API Render.
`testability-8` — depende dos dois primeiros.

**Consequência para a defesa em reunião:** dos 3 P0, dois estão no Balde C e um no Balde B.
**Nenhum P0 é código a escrever no worktree.** É evidência de que a arquitetura do delta está
sólida — o que trava está fora do teclado.

## 2. Top 10 riscos (cross-QA)

**R-1 · Migration 0049 estreia em produção sem nunca ter tocado um Postgres.**
143 LOC (2 tabelas, 3 CHECK, 8 índices). `AprovacoesSql.test.ts` valida nomes de parâmetro, não
executa. Qualquer discrepância de tipo ou CHECK mal escrito quebra o `preDeployCommand` do Render e
trava deploys concorrentes. → `testability-1`, `deployability-6`, `availability-4`.

**R-2 · Painel apresenta dado errado como certo.** Parse silencioso + contrato duplicado.
`INDETERMINADO` legítimo e `INDETERMINADO` "falhou o parse" ficam indistinguíveis. **É o risco
dominante deste delta**: a frente é read-only por construção, então o único jeito de fazer estrago é
mostrar número errado num painel auditável. → `integrability-1` ✅, `integrability-2`, `integrability-3`.

**R-3 · Sem cron e sem alerta em `status='error'` — mesmo buraco em 3 QAs.**
`.github/workflows/` tem 4 arquivos; `ingest-aprovacoes.yml` não existe. `finalizar(id,'error',msg)`
grava e ninguém lê. Runs zumbi ficam abandonadas. → `deployability-2`, `fault-tolerance-2`, `fault-tolerance-5`.

**R-4 · Fail-open no JWT.** `filialAuthz.ts:16-19` libera todas as filiais quando falta a claim; 0%
dos tokens a carregam. Analista de escopo único baixa a carteira inteira. LGPD art. 6. → `security-1`.

**R-5 · PV-07 externo.** 23.632 chamadas medidas na filial 2; wall-clock ~3,3h. Retry sem backoff
exponencial. → `performance-1` (bloqueado), `performance-2` ✅, `availability-3`.

**R-6 · Título "poison" derruba a varredura.** 1 título ruim = todos os posteriores ausentes do
snapshot, indistinguíveis de `SEM_WORKFLOW` legítimo. → `availability-1` ✅.

**R-7 · Nada nunca rodou contra dependência real.** O harness `buildErp()` da Frente IV existia e não
foi reaproveitado. → `testability-2` ✅, `testability-1`, `availability-4`.

**R-8 · Auditoria e redação de log ausentes.** `redactBody` cobre só chaves de credencial; ignora
`responsavelNome`, `fornecedorNome`, `valor`, `cnpj`. Sem log de consumo do painel. → `security-3`,
`security-4`, `security-5`.

**R-9 · `page.tsx` (632 LOC) e `TrilhaDrawer.tsx` (540 LOC) são hotspots.** Cada uma das 10 PVs que
fechar reabre esses arquivos. → `modifiability-1`, `modifiability-2`, `modifiability-3`.

**R-10 · Sondas de PRD vazam PII em `/tmp`.** 879 LOC de sonda contra 106 do job real, sem expurgo
nem ACL. → `security-2`, `modifiability-8`.

## 3. Cross-cutting

| # | Tema | QAs | Consolidação |
|---|---|---|---|
| CC-1 | Cron + observabilidade do erro do job | Avail, Deploy, FT | 2 cards resolvem 3 QAs |
| CC-2 | Contrato duplicado backend↔frontend | Integr, Modif | 1 card resolve os dois |
| CC-3 | Nenhuma execução real | Test, Deploy, Avail | 2 cards resolvem 3 QAs |
| CC-4 | Timeout + AbortController + breaker | Perf, Avail, FT | `performance-8` engloba |
| CC-5 | PV-09 (claim `filiais`) | Sec, Modif | `security-1` inverte o default |
| CC-6 | Observabilidade externa + audit trail | Avail, Sec, FT | `security-4` + `fault-tolerance-2` |

## 4. Quick wins (≤5 dias)

27 cards de esforço **S**. Sprint 1 recomendada: os 13 P1 mais 4 P2 de maior alavancagem
(`security-3`, `security-2`, `fault-tolerance-3` ✅, `integrability-4`).

## 5. Movimentos estratégicos (M/L/XL)

`testability-1` (L) · `testability-2` (M) ✅ · `performance-1` (L, bloqueado) · `performance-2` (M) ✅ ·
`security-1` (M) · `availability-2` (M) · `availability-4` (M) · `integrability-2`/`modifiability-5` (M) ·
`modifiability-2` (M) · `deployability-5` (M) · `deployability-6` (M) · `security-4` (M) ·
`performance-8` (M) · `fault-tolerance-4` (M) · `fault-tolerance-6` (M).

## 6. O que está bem, e por quê

1. **Port read-only inexpressível por tipo** — ADR-0038 D2 enforçado pelo compilador, com teste que
   valida por reflexão. **Padrão-referência** para os outros clients Conexos.
2. **Fail-safe em `EtapaStatusResolver`** — status desconhecido vira `INDETERMINADO` sem `throw`.
3. **Cursor + UPSERT idempotente + advisory lock** — retomada não duplica linha.
4. **Gate `APROVACOES_ENABLED` fail-safe em produção** — estreia é decisão explícita.
5. **Zod nas fronteiras HTTP das rotas** — o gap estava no client, não na rota.
6. **Kill-switch por dashboard, sem redeploy.**
7. **1372 testes backend / 203 frontend**; cognitive < 15 em 100% dos services exceto dois pontos.
8. **DI e `EnvironmentProvider` respeitados** — 0 imports cross-layer novos, 0 `process.env` em services.

## 7. Limitações desta análise

**Não medível**: coverage por diretório, `next build`, `npm audit` profundo, `EXPLAIN ANALYZE` em base
cheia, MTTR/MTTD reais, CloudWatch/drain do Render.

**Fora do escopo do pipe**: chaos engineering, threat modeling formal, custo cloud, UX/acessibilidade,
Terraform (não existe `infra/` — CLAUDE.md §Estado Atual vs. Alvo).

**Ruído corrigido**: `fast-check` foi mencionado como dependência existente, mas **não está
instalado** — o card `testability-6` inclui a instalação.

**Janela**: snapshot de 2026-08-19 contra `e7637b8..603a3ed`. Refazer a cada fechamento de PV
significativa — PV-07 e PV-09 moveriam bastante o scorecard.

## 8. Ações recomendadas

1. **Semana 1** — risco de estreia: `deployability-1` ✅, `deployability-2`, `deployability-3`,
   `availability-1` ✅, `availability-3`, `integrability-1` ✅.
2. **Semana 2** — fechar CC-3: `testability-1` (L), `testability-2` ✅, `availability-4`.
3. **Semana 3** — fechar CC-2 e quebrar hotspots: `integrability-2`, `integrability-3`,
   `modifiability-1`, `modifiability-2`, `modifiability-3`.
4. **Semana 4** — segurança: `security-1`, `security-3`, `security-4`, `security-2`.
5. **Contínuo** — desbloqueio externo: PV-07 destrava `performance-1`; PV-09 destrava `security-1`.

## 9. Remediação já aplicada (commit `dea5ce7`)

Sete cards foram fechados **depois** do snapshot desta revisão e **antes** de o relatório ser lido.
Não os retrabalhe.

| Card | O que foi feito |
|---|---|
| `availability-1` (P1) | `try/catch` por título com contagem de falhas; falha sistêmica continua abortando |
| `performance-2` (P1) | `BoundedConcurrency` limite 4 na varredura |
| `performance-3` (P2) | Cursor por página — 23.632 UPDATEs → 48 por filial |
| `integrability-1` (P1) | Zod no boundary do client, tolerante (`passthrough` + `catch` por campo) |
| `deployability-1` (P1) | `APROVACOES_ENABLED` em `render.yaml` (`sync: false`) e `DEPLOY.md` |
| `fault-tolerance-3` (P2) | `ultimoSnapshot` escopado por filial — não mente mais em multi-filial |
| `testability-2` (P0) | `jobs/ingest-aprovacoes.e2e.test.ts` — ERP fake HTTP, client e serviço reais |

**Efeito no scorecard**: o P0 de `testability-2` cai (restam 2 P0, ambos fora do teclado);
Availability, Integrability e Deployability sobem. O relatório **não foi reescrito** — os números do
§1 são o retrato do `603a3ed`, e esta seção é o delta honesto sobre ele.

**Ainda aberto e conhecido**: `availability-3` (backoff exponencial), `modifiability-1` (complexidade
do `executar` — parcialmente reduzida pelo split em `processarFilial`/`processarPagina`), e todo o
Balde B/C.
