---
type: regis-review-kanban
run_id: 2026-08-24-1830-sispag-remessa-retorno
total: 59
counts: { p0: 11, p1: 25, p2: 21, p3: 2 }
---

# Kanban — SISPAG (Remessa + Retorno) — 2026-08-24-1830

> Ordem: P0 (S → M), P1 (S → M), P2 (S → M), P3.
> Detalhamento completo de cada card (Problema / Melhoria Proposta / Resultado Esperado,
> métricas e riscos) está na seção correspondente de cada `{qa-slug}.md` deste mesmo diretório.

---

## P0 — Crítico (11)

### Bloqueiam o MERGE

| # | Card | QA | Esforço | Problema em uma linha |
|---|---|---|---|---|
| 1 | `security-1` | Security | S | `GET /contas-pagadoras` e `GET /lotes/:id/remessa/arquivo` sem `requireRole('admin')` — qualquer autenticado baixa CNAB com conta bancária de fornecedor |
| 2 | `deployability-1` | Deployability | S | `tsx watch` + `.env` de PRD + `BootMigrator` no boot aplica DDL em produção a cada save (incidente `0049` já ocorreu) |
| 3 | `security-2` | Security | M | `.env` de dev tem `AUTH_JWT_SECRET`, `ADMIN_PASSWORD`, `CONEXOS_PASSWORD`, `databaseConnectionString` de PRD — rotação urgente + separação por ambiente |

### Bloqueiam a PRIMEIRA REMESSA REAL

| # | Card | QA | Esforço | Problema em uma linha |
|---|---|---|---|---|
| 4 | `availability-1` | Availability | M | Conciliação chama `processar` (grava baixas no fin010) sem ledger write-ahead |
| 5 | `fault-tolerance-1` | Fault Tolerance | M | Mesmo P0, por outra lente: `processarArquivoRetorno` sem ledger nem `Idempotency-Key` |
| 6 | `availability-2` | Availability | S | `catch {}` cego no `listDetalhe` engole timeout/5xx — conciliação parcial reporta sucesso |
| 7 | `fault-tolerance-2` | Fault Tolerance | S | Janela entre `criarLote` e `setNativeFlpCod`: fail-closed protege, mas o erro não traz pista do órfão |
| 8 | `performance-3` | Performance | M | `listarTitulosPendentes` lê só a página 1 (500 de ~2020) — falso "não elegível" com lote já criado |
| 9 | `performance-1` | Performance | S | Varredura de eventos em série: Bradesco ~92s p50, acima do timeout do proxy |
| 10 | `fault-tolerance-7` | Fault Tolerance | S | Sem kill-switch por frente — conter SISPAG obriga parar Permutas e Recebimentos |

### Defesa de regressão (P0 por cobertura, não por dano imediato)

| # | Card | QA | Esforço | Problema em uma linha |
|---|---|---|---|---|
| 11 | `testability-2` | Testability | S | `RemessaExecucaoRepository` (o ledger anti-duplicação) sem teste — a invariante "settled não regride" está no vácuo |
| 12 | `testability-1` | Testability | M | 0/18 handlers de `routes/sispag.ts` testados |

---

## P1 — Alto (25)

### Esforço S

| Card | QA | Problema em uma linha |
|---|---|---|
| `availability-3` | Availability | `listByStatus` existe mas nenhuma rota expõe — órfãos invisíveis sem SQL direto |
| `availability-4` | Availability | `/health` não probe Conexos nem Postgres, mas é o `healthCheckPath` do Render |
| `deployability-3` | Deployability | `SISPAG_ENABLED` hardcoded no `render.yaml` — kill-switch some no próximo deploy |
| `integrability-3` | Integrability | Protocolo `QUESTION` do ERP tratado em 1 de 6 escritas |
| `integrability-5` | Integrability | Endpoints fora do OpenAPI sem doc datada (`arquivosRetorno/processar`) |
| `performance-2` | Performance | N+1 de contas do favorecido — regressão do que o commit `7be243f` já corrigiu no painel |
| `performance-4` | Performance | `fetchContasPagadoras` por card: 8 requests idênticos por render da aba |
| `fault-tolerance-3` | Fault Tolerance | Reaproveitar `flpCod` assume que `reconciling` sempre bloqueia — flip manual quebra |
| `fault-tolerance-4` | Fault Tolerance | Conciliação sem `withTransaction` — morte no meio deixa estado parcial |
| `fault-tolerance-5` | Fault Tolerance | Sem reaper de `reconciling` órfão |
| `security-4` | Security | `filialAuthz` não aplicado nas 4 rotas de escrita (a docstring dele pede paridade) |
| `testability-3` | Testability | Suíte não hermética: `dotenv` re-hidrata `CONEXOS_DRY_RUN` depois que o teste apaga |
| `testability-4` | Testability | `sispagGate` sem teste nos dois ramos |

### Esforço M

| Card | QA | Problema em uma linha |
|---|---|---|
| `availability-5` | Availability | Sem circuit breaker — pico do ERP amplifica saturação nas 3 frentes |
| `deployability-2` | Deployability | Migration `0049` sem par `down`; rollback = PITR que derruba 4 frentes |
| `deployability-4` | Deployability | Flags de escrita globais — escopar por frente com fallback |
| `integrability-1` | Integrability | 0 fixtures reais do ERP; 1088 LOC de teste 100% hand-mocked |
| `integrability-4` | Integrability | FEBRABAN e `grbCodSeq` hardcoded — descobrir via `cmn025`/`ger015` |
| `modifiability-1` | Modifiability | `FEBRABAN_POR_BNCCOD` em 4 lugares + fallback silencioso `?? 341` |
| `modifiability-2` | Modifiability | Máquina de estados do lote decidida em 3 serviços |
| `fault-tolerance-6` | Fault Tolerance | Sem cron de descoberta de `.RET` não conciliado |
| `security-3` | Security | 4 high no backend (axios), 7 no frontend; 52 alertas no Dependabot da main |
| `security-5` | Security | `role DEFAULT 'admin'` — todo usuário nasce admin |
| `testability-5` | Testability | 2854 LOC de frontend novo sem teste; `dryRun` da UI é o último seam |

---

## P2 — Médio (21)

| Card | QA | Esforço | Problema em uma linha |
|---|---|---|---|
| `availability-7` | Availability | S | `SISPAG_DRY_RUN` independente do global |
| `availability-8` | Availability | S | `.REM` não persistido local — re-download depende do ERP estar de pé |
| `deployability-5` | Deployability | S | Zero runbook para 4 modos de falha nomeados |
| `integrability-2` | Integrability | S | ~70 LOC de parse de erro duplicadas entre dois clients |
| `integrability-7` | Integrability | S | `CONEXOS_DRY_RUN` isolável por frente |
| `modifiability-3` | Modifiability | S | Status como string crua em 4 lugares no frontend |
| `modifiability-7` | Modifiability | S | Ontology desatualizada: diz que `BAIXADO` é out-of-scope, código já implementa |
| `performance-6` | Performance | S | Sem cache nas leituras estáticas do ERP |
| `fault-tolerance-9` | Fault Tolerance | S | Rota de conciliação não lê `Idempotency-Key` |
| `security-6` | Security | S | `ator()` com fallback `'unknown'`; rota de remessa sem Zod no body |
| `testability-6` | Testability | S | 3 critérios distintos de guarda anti-produção nos 14 jobs |
| `testability-8` | Testability | S | `waitFor` sem timeout explícito — flake sob paralelismo |
| `availability-6` | Availability | M | Sem rollback automático do lote nativo órfão |
| `deployability-6` | Deployability | M | Sem smoke test pós-deploy do `gerarRemessa` em dry-run |
| `integrability-6` | Integrability | M | Chave nativa composta é convenção humana, não tipo |
| `modifiability-4` | Modifiability | M | Invariantes críticas em comentário, sem teste correspondente |
| `modifiability-5` | Modifiability | M | 3 funções acima do teto de complexidade cognitiva do Biome |
| `modifiability-6` | Modifiability | M | 32 jobs exploratórios misturados com operacionais; 13 erros de lint |
| `performance-5` | Performance | M | `listAtivos` sem `LIMIT` — 1511 linhas para servir 400 |
| `fault-tolerance-8` | Fault Tolerance | M | Sem relatório de rascunhos órfãos (forward-recovery não institucionalizada) |
| `testability-7` | Testability | M | `Date`/`randomUUID` não injetáveis — bloqueia teste de conteúdo do CNAB |

---

## P3 — Baixo (2)

| Card | QA | Esforço | Problema em uma linha |
|---|---|---|---|
| `integrability-8` | Integrability | S | `endpoint` no payload do log em vez de tag — métrica por integração exige grep |
| `modifiability-8` | Modifiability | L | Sem intermediário `ContratoFin015` — trocar destino de escrita exige reescrever o serviço |

---

## Agrupamentos recomendados

Fechar em um delta único, porque compartilham desenho:

- **Ledger da conciliação**: `availability-1` + `fault-tolerance-1` + `fault-tolerance-9` + `testability-2`
- **Kill-switch por frente**: `fault-tolerance-7` (líder) + `availability-7` + `deployability-3` + `deployability-4` + `integrability-7`
- **Contratos do ERP**: `integrability-1` + `integrability-5` + `modifiability-4`
- **Observabilidade de órfãos**: `fault-tolerance-2` + `availability-3` + `fault-tolerance-5` + `deployability-5`
- **Tabela de bancos**: `modifiability-1` OU `integrability-4` (escolher M vs L conforme apetite)
