# invoice-pago-detalhe — follow-ups do Regis-Review

**Run:** `2026-08-28-1608-invoice-pago-detalhe`
**Relatório:** `docs/regis-review/2026-08-28-1608-invoice-pago-detalhe/REPORT.md`
**Kanban:** `docs/regis-review/2026-08-28-1608-invoice-pago-detalhe/KANBAN.md`
**Branch:** `fix/invoice-pago-detalhe` · commits `48abd7b` (fix) + `15a1351` (remediação P0)

Score consolidado **6.2**. 33 cards: P0=3 · P1=9 · P2=14 · P3=7.
Por Inviolable Rule #11, **só P0 re-entrou no loop deste PR**. O resto está aqui.

## P0 — status

| Card | Status | Onde |
|---|---|---|
| `permuta-persistence-1` | ✅ FEITO | `15a1351` — mapa `pagoConfiavel` em `toInvoiceRows` + 2 testes (o 1º provado falhando sem o fix) |
| `deployability-1` | ✅ FEITO | `15a1351` — `render.yaml` revertido; byte-idêntico a `origin/main` |
| `testability-1` | ⏳ **ABERTO** | fixtures reais do wire de Permutas + `contrato.test.ts` — **não entrou neste PR** |

> **`testability-1` é P0 e ficou de fora.** É esforço M (portar `capture-fixtures-sispag.ts` para
> Permutas + criar `__fixtures__/` + `contrato.test.ts`), fora do escopo de um tweak de bug, e não
> bloqueia a correção funcionar. Mas é o card que impede a **4ª reincidência** desta classe de
> defeito. Decisão do Yuri: entra como card próprio no quadro ou vira `/feature-new` dedicado.

## P1 (9) — não implementados

| Card | QA | Esforço | Uma linha |
|---|---|---|---|
| `integrability-1` | Integrability + Security | S | `com308RowSchema` é decorativo (0 usos); aplicar `safeParse` no mapper. **Dedupe de F-integrability-1 + F-security-5** |
| `integrability-2` | Integrability + FT | M | `fieldList` explícito com 7 campos: quebra no com308 derruba 4 features; fallback ao detalhe |
| `fault-tolerance-1` | FT + Avail + Integr | M | ✅ PARCIAL em `15a1351` (os 2 ramos do `hidratarInvoiceNegociada`). Faltam: catches de `EleicaoPermutasService.ts:563,858` e `AlocacaoPermutasService.ts:149`, contador `fallbackCount`, coluna `pago_source` |
| `fault-tolerance-2` | FT + Availability | S | `IngestLockBusyError` → `exit 1` no job. **PRÉ-EXISTENTE**, não regressão deste delta; padrão correto em `reaper-sispag-reconciling.ts:27` |
| `modifiability-1` | Modif + Integr + FT | M | `invoicePagoResolver` único — sela a raiz da reincidência-por-classe |
| `modifiability-2` | Modifiability | S | Neutralizar `ConexosBaseClient.isPago()` (armadilha viva em `ConexosFinanceiroClient.ts:441,582`) |
| `availability-1` | Availability | S | Health check de frescor + badge na UI (`findLatestIngestFinishedAt` já existe) |
| `performance-1` | Performance | S | Instrumentar requests/duração do cron (~3.438 chamadas, 11–13 min estimados) |
| `testability-3` | Testability + Integr | M | Promover os 8 `validate-*.ts` a `.integration.test.ts` opt-in |

## P2 (14) e P3 (7)

Lista completa com Problema / Melhoria / Resultado no `KANBAN.md`. Resumo dos temas:

- **P2:** `fault-tolerance-3` (status `partial`), `fault-tolerance-4` (validator semanal), `integrability-4` (documentar assimetria dos 3 call-sites), `performance-2` (fail-loud no `capHit`), `performance-4` (calibrar concorrência ao pool real de ~3 sessões), `deployability-4` (kill-switch runtime), `security-3` (sondas fora do `dist/`), `security-4` (sondas gravam rows crus em `/tmp`), `modifiability-3` (extrair função pura), `modifiability-4` (externalizar tolerância), `testability-2` (unit tests diretos), `testability-4` (lint do `render.yaml` no CI), `testability-5` (quebrar o service de 950 LOC), `testability-6` (fechar o loop probe→capture→contract).
- **P3:** `availability-4` (Self-Test), `performance-3` (medir o ganho de payload), `integrability-6` (constante do `titVldStatus`), `integrability-7` (decodificar o enum `pago` do com308), `modifiability-5` (business-rule na ontologia), `deployability-7` (pinar `nodeVersion`), `security-5` (runbook de rotação).

## Correções de premissa aplicadas na consolidação

Registradas porque as seções individuais dos agents ainda contêm as versões erradas:

1. **C1** — o cron do Render era duplicata do `.github/workflows/ingest-permutas.yml` (em `origin/main`, 3×/dia, `success` diário verificado via `gh run list`). 6 findings de deployability/security/availability existiam só por causa dele e sumiram com a reversão. `F-testability-4` teve a premissa falsa removida ("se o cron não subir, o `pago` para de ser recalculado" — o recálculo é do cron do GitHub).
2. **C2** — `F-fault-tolerance-2` é pré-existente, não regressão deste delta.
3. **C3** — o P0 `permuta-persistence-1` não foi achado por nenhum agent isolado; emergiu na consolidação e foi confirmado por leitura direta.
4. **C4** — `F-integrability-3` atribuía a execução do validador ao vivo ao Yuri; foi executado pelo assistente durante a sessão do `/feature-tweak`.

## Estágio de aprendizado (pipe v2) — regra proposta para o CLAUDE.md core

> **Evidência de wire medida num tipo de documento não vale para outro.**
>
> O gap `gate-3-pago-via-detail` foi medido em 2026-06-18 sobre **411 PROFORMAs** e escrito na
> ontologia como fato geral ("o list não traz saldo"). A ingestão do universo de INVOICEs
> (ADR-0014, 2026-06-24) herdou a generalização sem re-medir, e o `pago` ficou errado por 62 dias.
>
> **Regra:** toda nota de ontologia que cite uma sonda deve nomear o **tipo de documento** e o
> **tamanho da amostra**; um novo consumidor daquele campo re-mede antes de confiar.
> Corolário verificado neste ciclo: quando a sonda re-mediu, além de confirmar o problema no lado
> INVOICE ela encontrou um caminho **melhor** (o `titMnyTotPago` do com308, custo zero) que a
> generalização herdada escondia.
