---
type: regis-review-report
run_id: 2026-08-25-1742-sispag-retomada
generated_at: 2026-08-25T18:00:00-03:00
audience: technical (architects + senior devs + tech lead)
basis: Bass & Clements 8 QAs + Design System (lens custom)
total_cards: 52
total_p0: 6
total_p1: 21
total_p2: 21
total_p3: 4
overall_score: 6.3
---

# Regis-Review — SISPAG retomada — 2026-08-25-1742

Escopo: delta do `/feature-tweak sispag "retomar de onde parou sem correção manual no Conexos"`,
branch `fix/sispag-fin015-import-shape`, diff `da2714e..HEAD`.

## 1. Scorecard

Pesos (SaaSo fiscal, com dinheiro saindo pelo caminho da feature): Security 1.5, Fault Tolerance 1.3,
Availability 1.2, Modifiability 1.2, Testability 1.0, Performance 1.0, Integrability 0.9,
Deployability 0.9, Design System 0.5.

| QA | Score | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Security | 8 | 0 | 0 | 2 | 2 | `POST /remessa` devolve o CNAB no JSON, duplicando a superfície do GET dedicado |
| Availability | 7 | 1 | 2 | 3 | 0 | Reaper de execuções presas não agendado em PRD |
| Deployability | 7 | 0 | 2 | 1 | 2 | `SISPAG_LIVE_WRITE_ENABLED=false` por default e invisível — só se descobre clicando |
| Fault Tolerance | 7 | 2 | 3 | 2 | 0 | `gerarRemessa` sem advisory lock — duplo clique cria 2 lotes → pagamento duplicado |
| Design System | 6 | 0 | 2 | 2 | 0 | Decisão financeira atrás de um toast de 60s |
| Testability | 6 | 2 | 3 | 2 | 0 | Perna de VOLTA: 0 execuções ao vivo, 3 shapes sem contrato |
| Integrability | 5 | 1 | 2 | 4 | 0 | Protocolo `QUESTION` do ERP tratado em 1 de 5 escritas |
| Performance | 5 | 0 | 3 | 3 | 0 | `importarTitulos` serial: lote de 25 ≈ 25s só nessa etapa |
| Modifiability | 4.5 | 0 | 4 | 2 | 0 | `gerarRemessa` com complexidade cognitiva 70 (teto Biome = 15) |
| **Geral** | **6.3** | **6** | **21** | **21** | **4** | — |

Leitura: 0–3 risco estrutural · 4–6 dívida defensável · 7–8 saudável · 9–10 estado-da-arte.

A feature entrega retomada **provada ao vivo na perna de IDA** (3/3 cenários verdes em HML, mais o
caminho normal com lote de 2 títulos gerando `.REM` com fidelidade de bytes) e o gate ao vivo achou
**6 defeitos de produção** que teste mockado não pegava. O que puxa a nota: Modifiability (o service
concentrou a máquina de retomada inline), Performance (padrões vizinhos não reaplicados no caminho
quente) e Integrability (o `QUESTION` do ERP é engolido em 4 de 5 escritas).

## 2. Verificação do orquestrador — o que NÃO sobreviveu

Antes dos riscos, o que a conferência derrubou. Isto é insumo de reunião: **4 dos 9 agentes
afirmaram coisas que não se sustentaram**, e um deles cometeu exatamente o erro de generalização que
esta feature existiu para corrigir.

| Item | Agente | Veredito (medido) | Ação |
|---|---|---|---|
| `fin005/list` vazaria contas de outra filial (**P0**) | integrability | **REFUTADO.** Medido ao vivo em HML: 17 linhas, todas da filial 2. | Finding e card removidos |
| 10 endpoints sem `filCod#EQ` vazariam por analogia (**P1**) | integrability | **REBAIXADO para P2.** Medição de 5 endpoints: `fin015` vaza (4 filiais); `fin005` e `fin064` escopam pelo contexto; `fin050` e `ger015` não têm `filCod`. **O `fin015` é a exceção, não a regra.** | Card reescrito como "medir os endpoints restantes", não "adicionar filtro em 10 lugares" |
| `notify()` / `NotificationCenter` / "Patterns §21" (2 findings) | design-system | **REFUTADOS.** API inexistente neste repositório. Regra importada de outro projeto. | Findings removidos; preocupação legítima ("ação financeira em toast efêmero") mantida sem a prescrição |
| CNAB indo para o log da aplicação | security | **PARCIALMENTE REFUTADO.** Corpo de resposta só é logado em status ≥ 400 (`index.ts:63`). O `.REM` de um sucesso não é logado. | Card mantido em P2, escopo restrito à duplicação de superfície |

**Confirmados por verificação direta** — peso máximo em reunião:

| Achado | Verificação |
|---|---|
| Reaper não agendado | `grep cron render.yaml` vazio |
| `RemessaService` sem advisory lock | `withAdvisoryLock` existe e é usado por `IngestaoPagamentosService`; ausente no `RemessaService` |
| `listarLotesNativos` lê só a 1ª página | `pageNumber: 1, pageSize: 500`, sem loop nem aviso |
| `ConciliacaoEmDuvidaError` sem UX no FE | 0 ocorrências em `src/frontend` |
| Copy cita `CONEXOS_DRY_RUN`, causa é `SISPAG_LIVE_WRITE_ENABLED` | `LoteCard.tsx:228` |
| Timeout 40s + sem keep-alive | `services/conexos.ts:121`; nenhum `httpAgent` nos clients |
| `heavyRouteLimiter` em 4 de 18 rotas | contagem direta |
| Zero testes na UI do SISPAG | os 3 `.test.ts` de `lib/` são de outras áreas |
| LOC 870 / 455 / 1026 | `wc -l` |

## 3. O que bloqueia o quê

### Bloqueia o MERGE

**Nada.** O PR é internamente coerente e os 6 defeitos que o gate ao vivo achou já estão corrigidos.
Os P0 abaixo são todos S ou M e cabem numa sprint pós-merge — **desde que o merge não venha
acompanhado da primeira remessa real no mesmo dia.**

### Bloqueia a PRIMEIRA REMESSA REAL

1. **`fault-tolerance-1` (P0, S)** — advisory lock em `gerarRemessa`. Sem ele, dois cliques ou dois
   operadores produzem dois lotes nativos → pagamento em duplicidade. O `heavyRouteLimiter` é
   por-IP e não protege operadores em máquinas distintas.
2. **`availability-1` (P0, S)** — agendar o reaper. Sem cron, o único canal ativo de detecção de
   órfãos é alguém abrir o painel.
3. **`integrability-1` (P0, M)** — tratar `QUESTION` nas 5 escritas. A docstring do próprio
   `importarTitulos` prevê o cenário FIN_041 (favorecido sem conta ativa) e o catch engole em erro
   genérico. Primeiro credor novo transforma a retomada em "o sistema não funciona".
4. **`deployability-1` + `-2` (P1, S+S)** — `/health` expor as flags e a copy citar a variável certa.
5. **`availability-3` (P1, S)** — UX própria para `ConciliacaoEmDuvidaError`.

### Bloqueia a PRIMEIRA CONCILIAÇÃO REAL

6. **`fault-tolerance-2` = `testability-2` = `availability-2` (P0, M)** — exercitar a perna de VOLTA
   ao vivo. A IDA passou pelo mesmo gate e revelou 6 defeitos. O `processar` do fin052 é
   **irreversível**. É o maior risco composto do relatório.

Todo o resto é dívida — legítima, mas dívida.

## 4. Top 5 riscos (cross-QA)

**R-1 · Duplicidade de lote por concorrência.** `gerarRemessa` não serializa por `loteId`. O ledger
write-ahead protege contra INTERRUPÇÃO, não contra CONCORRÊNCIA. Dois cliques = dois lotes nativos =
pagamento em dobro para todos os fornecedores do lote. Fix: 1 card S. *(FT)*

**R-2 · Perna de VOLTA só em mock.** 26 testes mockados, 0 fixtures das 3 shapes centrais, 0
execuções ao vivo — contra um `processar` irreversível no fin010. O histórico da IDA (6 defeitos em
~3 rodadas) sugere 3–6 defeitos análogos escondidos. Fix: 2 cards M. *(FT + Testability +
Availability + Integrability)*

**R-3 · Reaper não agendado.** MTTR de órfão degrada de "≤15 min" para "próxima interação humana" —
que num feriado emendado são dias. Fix: 1 card S. *(Availability + FT + Deployability)*

**R-4 · `QUESTION` engolido em 4 de 5 escritas.** O ERP responde com pergunta interativa em cenários
previsíveis; nós devolvemos erro genérico, o ledger vai para `error` e a retomada refaz o mesmo
caminho. Loop até intervenção humana. Fix: 2 cards (S + M). *(Integrability + FT)*

**R-5 · Kill-switch invisível + copy apontando a variável errada.** `SISPAG_LIVE_WRITE_ENABLED` fica
`false` até alguém setar no dashboard, `/health` não expõe, e a tela manda olhar `CONEXOS_DRY_RUN`
— que é global e afeta Permutas e Recebimentos. Fix: 2 cards S. *(Deployability + Design System)*

## 5. Cross-cutting

- **CC-1 · O ciclo de detecção de órfãos não fecha.** Reaper + painel existem e são bem projetados,
  mas o reaper não roda sozinho. `availability-1` = `fault-tolerance-7` = `deployability-3` — **um
  card, três nomes.**
- **CC-2 · A VOLTA é o gêmeo mal-cuidado da IDA.** Mesma doutrina, mesma irreversibilidade, metade da
  defesa. 2 cards M fecham.
- **CC-3 · `QUESTION` ignorado.** `ErpResponseReader` já existe no repo e ninguém importa;
  `describeConexosValidation` está duplicado 100% entre dois clients.
- **CC-4 · Kill-switch invisível.** Mesmo padrão que a ADR-0058 acabou de resolver noutra frente:
  dizer QUAL parâmetro quebrou.
- **CC-5 · Padrões vizinhos não reaplicados.** `BoundedConcurrency`, `withTransaction`, verificação
  de rows afetadas, `withAdvisoryLock` — **todos já existem no repositório** e não foram usados no
  `RemessaService`. Não é falta de biblioteca, é falta de reuso. Uma sprint de "aplicar o padrão do
  vizinho" fecha 6 findings.
- **CC-6 · O gate ao vivo diverge do service.** `validate-retomada-remessa-v1.ts` reimplementa a
  sequência com tabela FEBRABAN própria (a 5ª cópia do repo, adicionada por esta feature). Gate verde
  não garante código verde.
- **CC-7 · Frontend SISPAG com 0 testes e 2.439 LOC.** Terceira revisão consecutiva apontando.

## 6. O que está bem

1. **Retomada da IDA provada ao vivo** — 3/3 cenários, e o gate achou 6 defeitos de produção.
2. **Kill-switch por frente** (`SISPAG_LIVE_WRITE_ENABLED`) isola blast radius sem levar Permutas e
   Recebimentos junto.
3. **Ledger write-ahead** com `ON CONFLICT` preservando `settled` e `postGenericOnce` nas escritas
   não-idempotentes.
4. **14/14 rotas de mutação com `requireRole('admin')`**, com teste dedicado no download do `.REM`.
5. **"Falha de leitura ≠ ausência"** — `listarChavesDoLote` e `getArquivoRetorno` devolvem
   `undefined`, não vazio. É a distinção que impede reimportar tudo ou reprocessar.
6. **Fixtures do ERP redigidas por tipo**, com teste guardando a redação.
7. **Guard-rails `BootMigrator` e `EnvironmentProvider`** (local → PRD) testados, com escapatórias
   documentadas no runbook.

## 7. Limitações desta análise

- Métricas de PRD não medíveis daqui: MTTR real, p95 do POST com lote de 25 (o gate rodou com 2),
  taxa real de `QUESTION`, drift HML vs PRD.
- **Perna de VOLTA não exercitada ao vivo nesta bateria** — endereçado por CC-2.
- Contract test valida presença de chave, não tipo nem nulidade.
- Sem mutation testing: "os testes existem, mas *asserem* o suficiente?" fica em aberto.
- Design System com peso 0.5 — é lente custom, não Bass canônico.
- Snapshot de 2026-08-25. Refazer a cada release ou após incidente.
- **1 finding removido, 1 rebaixado, 2 descartados na verificação** (§2).

## 8. Próximos 30 dias

1. **Semana 1 — bloqueadores da primeira remessa:** `fault-tolerance-1` (lock) + `availability-1`
   (cron do reaper) + `deployability-1` (`/health`) + `deployability-2` (copy) + `availability-3`
   (UX do erro). Todos S. ~3–4 dias de dev. Depois disso, merge e primeira remessa ficam defensáveis.
2. **Semana 2 — bloqueadores da primeira conciliação:** `integrability-6` (S) → `integrability-1` (M)
   → `testability-1` (M) → `fault-tolerance-2` (M). Fecha CC-2 e CC-3.
3. **Semanas 3–4 — aplicar o padrão do vizinho:** `performance-1/2/3` + `fault-tolerance-3/4/5` +
   `modifiability-2`. Fecha CC-5.
4. **Backlog trimestral:** `modifiability-1` (quebrar `gerarRemessa`), `modifiability-5` (extrair
   `SispagPanel`), `testability-3` (gate repetível).
5. **Higiene:** a próxima feature que tocar `RemessaService` faz `modifiability-3` (FEBRABAN
   centralizado) como pré-requisito — para não haver a 6ª cópia.

> **Para a reunião:** a retomada da IDA está provada ao vivo; a VOLTA está provada só em mock — e é
> ela que grava baixa irreversível no `fin010`. O bloco de 30 dias é: cron do reaper, advisory lock,
> protocolo `QUESTION` e o gate ao vivo da conciliação. Tudo o mais é dívida.
