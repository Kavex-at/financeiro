---
type: regis-review-report
run_id: 2026-08-24-1830-sispag-remessa-retorno
generated_at: 2026-08-24T18:55:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements — Software Architecture in Practice
total_cards: 59
total_p0: 11
total_p1: 25
total_p2: 21
total_p3: 2
overall_score: 5.5
---

# Regis-Review — SISPAG (Remessa `.REM` + Conciliação `.RET`) — 2026-08-24-1830

Escopo: branch `fix/sispag-fin015-import-shape` (PR #60, v0.27.0), frente SISPAG Fatia 3.
Ambiente: `CONEXOS_WRITE_ENABLED=true`, `CONEXOS_DRY_RUN=false` — a flag é GLOBAL e não pode ser desligada só para SISPAG (Permutas e Recebimentos já rodam ao vivo).
Transporte do `.REM` ao banco: **MANUAL** — o Conexos não transmite.

## 1. Scorecard

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 6.0 | 2 | 3 | 3 | 0 | Conciliação sem ledger — `processar` duplica baixas no fin010 |
| Deployability | 4.0 | 1 | 3 | 2 | 0 | `tsx watch` local aplica migrations na Supabase de PRD (incidente ocorrido com `0049`) |
| Integrability | 5.5 | 0 | 4 | 3 | 1 | 0 fixtures reais; contrato de escrita fin015/fin052 mora em JSDoc |
| Modifiability | 6.0 | 0 | 2 | 5 | 1 | `FEBRABAN_POR_BNCCOD` duplicado em 3 arquivos + tabela análoga no FE |
| Performance | 5.0 | 2 | 2 | 2 | 0 | `listarTitulosPendentes` sem paginar — 75% dos títulos da filial 2 invisíveis |
| Fault Tolerance | 6.0 | 2 | 5 | 2 | 0 | `processarArquivoRetorno` sem ledger (escrita não-idempotente) |
| Security | 5.0 | 2 | 3 | 1 | 0 | `.env` local aponta para Conexos + Supabase + JWT signing de PRD |
| Testability | 6.0 | 2 | 3 | 3 | 0 | 0/18 handlers de `routes/sispag.ts` testados |
| **Geral** | **5.5** | **11** | **25** | **21** | **2** | — |

Leitura: 5.5 é dívida defensável. Nenhum QA abaixo de 4, nenhum acima de 6. O agregado esconde
polarização: a perna de REMESSA tem base sólida (ledger `remessa_execucao`, fail-closed, RBAC
server-side) contaminada por lacunas cirúrgicas na perna de RETORNO. Nada é reescrita.

## 2. A decisão da reunião

O owner já decidiu conscientemente subir com escrita ligada, porque o dry-run é uma flag GLOBAL
que desligaria também Permutas e Recebimentos, que estão em produção estável. Este relatório
NÃO recontesta a decisão. Ele responde: **o que entra antes do merge, e o que entra antes de
alguém apertar o botão para valer.**

### 2.1 O argumento do owner — onde SE SUSTENTA

> "O transporte ao banco é MANUAL — o Conexos não transmite — então um `.REM` errado parado no
> ERP não move dinheiro sozinho."

Válido para: a geração do `.REM` (o operador vê o arquivo antes de enviar); o lote nativo órfão
no fin015 (resíduo operacional, não vira pagamento); duplicação de `flpCod` por retry (fantasma
enquanto ninguém finalizar+transmitir). O ledger `remessa_execucao` cobre exatamente isso, e
está bem feito.

### 2.2 Onde NÃO SE SUSTENTA

**A conciliação do retorno não é coberta por esse raciocínio.**

`POST /sispag/retornos/conciliar` com `processar=true` chama `PUT arquivosRetorno/processar`,
que **grava as baixas diretamente no fin010**. Não passa por banco nenhum. Dois cliques
(double-click, retry após 504, aba recarregada) = **duas baixas** sobre o mesmo `.RET`.
Divergência contábil imediata contra o extrato bancário.

**Convergência independente**: Availability e Fault Tolerance chegaram ao MESMO P0 sem
consultar um ao outro. Duas lentes ortogonais no mesmo ponto — o achado é sólido.

Também fora do guarda-chuva do transporte manual:
- `catch {}` cego em `ConciliacaoRetornoService.ts:119` engole timeout/5xx do `listDetalhe`.
  Um pico do Conexos vira "conciliei tudo" com rejeições faltando.
- `GET /sispag/contas-pagadoras` e `GET /sispag/lotes/:id/remessa/arquivo` sem `requireRole`.
  Qualquer autenticado baixa o CNAB 240 com CNPJ, banco, agência e conta de cada fornecedor.
- `.env` de dev com credencial de PRD (JWT signing, admin, Supabase, Conexos).
- `tsx watch` com esse `.env` já aplicou a migration `0049` em produção antes do merge.

### 2.3 Duas listas de P0

**Lista A — bloqueia o MERGE**

| Card | QA | Esforço | Por quê |
|---|---|---|---|
| security-1 | Security | S | GETs sem role vazam CNAB de fornecedor + contas da filial |
| deployability-1 | Deployability | S | Guard-rail contra `tsx watch` + `.env` PRD aplicar DDL. O incidente `0049` já provou o risco |
| security-2 (rotação) | Security | M | Rotacionar `AUTH_JWT_SECRET`, `CONEXOS_PASSWORD`, `ADMIN_PASSWORD`, `databaseConnectionString` |

**Lista B — bloqueia a PRIMEIRA REMESSA REAL**

| Card | QA | Esforço | Por quê |
|---|---|---|---|
| availability-1 + fault-tolerance-1 | Avail + FT | M | Ledger + Idempotency-Key na conciliação. Sem banco no meio |
| availability-2 | Availability | S | Trocar o `catch {}` cego — rejeições bancárias somem do painel |
| fault-tolerance-2 | FT | S | Contexto no `RemessaEmDuvidaError` — hoje o órfão fica sem trilha |
| performance-3 | Performance | M | Paginar pendentes: 75% dos títulos da filial 2 invisíveis |
| performance-1 | Performance | S | Paralelizar a varredura: Bradesco ~92s serial > timeout do proxy |
| fault-tolerance-7 | FT | S | `SISPAG_LIVE_WRITE_ENABLED` — blast radius 3 frentes → 1 |

Relacionados, não bloqueantes: testability-1, testability-2, fault-tolerance-4, fault-tolerance-5.

## 3. Top riscos (cross-QA)

**R-1 — Conciliação duplica baixas no fin010.** Convergência independente entre 2 agentes.
Cards: availability-1, fault-tolerance-1, fault-tolerance-9, testability-2. Custo de inação
estimado: ~5 incidentes/semestre × ~2h de reconciliação + risco contábil não detectado.

**R-2 — `.env` de dev = credencial de prod.** Superfície = nº de laptops × worktrees.
Cards: security-2, deployability-1.

**R-3 — GET SISPAG sem role.** Vaza CNAB de fornecedores e carteira de contas. LGPD Art. 6º +
LC 105. Card: security-1.

**R-4 — Kill-switches globais.** Bug no SISPAG obriga parar 3 frentes.
Cards: availability-7, deployability-3, deployability-4, integrability-7, fault-tolerance-7.

**R-5 — Órfãos no fin015 sem trilha**, atribuídos a pessoa real (`MPS_FRANCINEI`).
Cards: fault-tolerance-2, availability-3, fault-tolerance-5, fault-tolerance-8, availability-6.

**R-6 — Silent-catch mascara falha do ERP.** Card: availability-2.

**R-7 — Paginação inexistente recusa lotes válidos e cria órfãos.** Card: performance-3.

**R-8 — Contratos do ERP moram em prosa; 0 fixtures.**
Cards: integrability-1, integrability-3, integrability-5, testability-2, modifiability-4.

**R-9 — FEBRABAN hardcoded + fallback silencioso `?? 341`.** Já custou um `.REM` de conta
Banestes emitido como Itaú. Cards: modifiability-1, integrability-4.

**R-10 — RBAC vazio**: `role DEFAULT 'admin'`. Cards: security-5, security-4, security-6.

## 4. Cross-cutting

- **CC-1** Escrita não-idempotente sem ledger na perna de RETORNO → tratar como um delta único
  (availability-1 + fault-tolerance-1 + fault-tolerance-9 + testability-2).
- **CC-2** Kill-switches globais → 1 card unificado (`*_LIVE_WRITE_ENABLED` por frente + `sync:false`
  no `render.yaml`). Fecha 5 findings.
- **CC-3** 0 fixtures reais; contratos em prosa → integrability-1 + integrability-5 + modifiability-4.
- **CC-4** Órfãos sem observabilidade → fault-tolerance-2 + availability-3 + fault-tolerance-5 + deployability-5.
- **CC-5** Tabelas de tradução hardcoded → modifiability-1 OU integrability-4.
- **CC-6** Convenções humanas em vez de type/test guards → integrability-6 + modifiability-2 + modifiability-4.

## 5. O que está bem

1. **Ledger write-ahead da remessa** — State Resynchronization + Idempotent Replay bem feitos.
   É o padrão que a perna de RETORNO precisa copiar.
2. **`postGenericOnce`/`putGenericOnce` nas escritas** — sem retry silencioso em 401. 5/5 escritas.
3. **`RetryExecutor` em leituras** — 32 ocorrências nos 3 clients.
4. **Encapsulate no client** — 0 axios fora do client; 0 vazamento de `postGeneric` para services.
5. **Zod no boundary** do `criarLote` + sanity checks pré-POST (filial, FEBRABAN, arquivo por NOME).
6. **Wrapper único no frontend** — 0 `fetch`/`axios` soltos em `sispag/**`.
7. **Guardas anti-produção nos 14 jobs** — Executable Assertions reais.
8. **Fail-closed em `reconciling` órfão** — nunca cria segundo lote.

## 6. Limitações

Não medível localmente (declarado pelos agentes): MTTR real de órfãos e taxa de conclusão da
remessa (exige Supabase PRD); lead time e deploy success rate (dashboard Render); latência real
do ERP (sem APM); taxa de flake no CI. Não coberto: chaos engineering, STRIDE formal, custo
cloud, acessibilidade, compliance SOX/Bacen.

Discrepância registrada: testability declarou `cards_count: 7` no frontmatter mas entregou 8 cards.
Adotado o valor real (8).

## 7. Ações — próximos 30 dias

1. **Antes do merge**: Lista A (§2.3).
2. **Antes da primeira remessa/conciliação real**: Lista B (§2.3). ~1 sprint, 2 devs × 1 semana.
3. **Sprint 1 pós-go-live**: quick wins restantes (todos os P1 de esforço S).
4. **Sprint 2–4**: CC-2 (kill-switches por frente) + CC-5 (FEBRABAN) + security-3 + security-5.
5. **Trimestre seguinte**: CC-3 (fixtures) + strategic moves. Refazer Regis-Review ao final.
