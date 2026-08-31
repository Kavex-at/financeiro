# Regis-Review follow-ups — sispag-boleto-dda

> Gate do `/feature-tweak`: **PASSOU** (0 P0). Nada re-entrou no loop.
> Run: `docs/regis-review/2026-08-28-0249-sispag-boleto-dda/`
> (`REPORT.md` = narrativa · `KANBAN.md` = cards completos com métricas)
> Score geral **7,2/10** · 40 findings · 37 cards → **31 após dedupe** → **29 abertos**.

## Resolvidos ainda nesta branch (commit `5558cf8`)

| Card | Por que foi feito agora e não virou follow-up |
|---|---|
| `security-1` (P1) — audit trail da auto-resposta | Era **acceptance criterion do T1** do `tasks.md`, marcado como feito sem implementar. Corrigir o próprio descumprimento não é agir sobre finding de review. |
| `security-2` (P2) — redigir barcode real | Dado individual de fornecedor da Columbia commitado por mim. Custo ~zero, valor de privacidade real. |

## P1 — TODOS IMPLEMENTADOS na mesma branch (commit `d?`)

O Yuri optou por fazer os quatro em vez de deixá-los como follow-up. Ver ADR-0040 §Emenda.

| Card | O que mudou |
|---|---|
| `deployability-1` ✅ | `SISPAG_DDA_ASSOC_ENABLED` (default true) — freio do caminho DDA sem derrubar PIX/TED |
| `integrability-2` ✅ | `PENDENTE_DDA_SCHEMA` (Zod `{0,1}`) + erro explícito se o grid inteiro vier ilegível + taxa por filial logada a cada rodada |
| `sispag-question-wire-contract` ✅ | fixture do envelope real + `contrato.test.ts` + `id` obrigatório no `QUESTION_SCHEMA` |
| `performance-1` ✅ | painel lê `tem_boleto` do banco (0 req Conexos); envio segue ao vivo. `SispagPainelService` deixou de depender do write client |

### Registro do que eram (P1 — resolvidos)

| Card | QA | Esforço | Uma linha |
|---|---|---|---|
| `deployability-1` | Deployability | S | Toggle `SISPAG_DDA_ASSOC_ENABLED` — hoje o rollback do DDA derruba 100% do SISPAG (vs. ~35% dos itens afetados) |
| `integrability-2` | Integrability | S | Zod estrito em `titVldReflexoDdaAssoc` — a coerção `?? 0` repete a causa raiz do bug do `titEspCodbar` (agora fail-closed, não fail-open) |
| `sispag-question-wire-contract` | Integrability + Testability | S | Fixture cru do envelope `QUESTION` + `id` obrigatório no schema — hoje um rename no Conexos mantém o CI verde |
| `performance-1` | Performance | S | Reusar `tem_boleto` no painel: +7 a +10 requisições Conexos por abertura de lote para recalcular o que a ingestão já persistiu |

> ⚠️ **`performance-1` é decisão de negócio, não defeito.** A leitura ao vivo no lote foi
> escolha explícita do Yuri ("nos dois lugares"), coerente com a doutrina anti-drift. O
> card é o contra-argumento numérico; quem decide é quem tem o contexto de operação.

## Também implementado depois da review

| Card | O que mudou |
|---|---|
| `fault-tolerance-4` ✅ (era P2) | `RemessaCnabValidator` + `RemessaCorrompidaError`: o `.REM` é verificado antes de virar entregável. Validado contra 6 remessas reais de produção (0 falso-positivo) e contra o `.REM` do e2e em HML; barra `PG121101.REM`, que tem um DV inválido real. Fecha a pendência de go-live da ADR-0040. |

## P2 — abertos (17)

`testability-1` (asserção negativa do payload boleto) · `testability-2` (re-POST com erro
não-QUESTION) · `fault-tolerance-1` (canário runtime antes do re-POST) · `deployability-2`
(CHANGELOG + step pós-deploy do `tem_boleto`) · `deployability-3` (runbook de cutover) ·
`availability-3` (métrica de degradação DDA) · `integrability-4` (contexto do grid vs.
reciclagem de `flpCod`) · `performance-2` (`FANOUT_LIMIT` 4→3 ou instrumentar o pool) ·
`modifiability-3` (`MODALIDADE_NATIVA.BOLETO=7` como barreira de tipo) · `availability-2`
(deadline agregado no painel) · `fault-tolerance-4` (parse do segmento J no `.REM`) ·
`integrability-3` [HERDADA] (separar read/write do `fin015`) · `modifiability-2`
(consolidar a regra em um módulo) · `modifiability-1` (extrair
`SispagRemessaPayloadBuilder`) · `integrability-6` [HERDADA] (observabilidade de
breaking-change) · `performance-4` [HERDADA] (`duration_ms` por chamada Conexos) ·
`sispag-dda-status-visivel` (indisponível ≠ sem DDA) · `sispag-probes-consolidation`
[MIXED] (sondas HML: build, guard, política, teste)

## P3 — abertos (7)

`fault-tolerance-5` (teste do particionamento com falha entre grupos) · `fault-tolerance-3`
[HERDADA] (lote vazio órfão em `status='error'`) · `modifiability-5` (decompor o builder) ·
`integrability-5` (política de sondas + `fin124` como diagnóstico) · `deployability-5`
(limpar `flp 24` em HML, cleanup em `finally`) · `testability-5` [HERDADA] (primeiros
testes de UI em `app/sispag/`) · `sispag-truncamento-observavel` [HERDADA] (WARN
estruturado + teste de propagação)

## Ordem sugerida (do REPORT §8)

1. **Dias 1–3** — `sispag-question-wire-contract`, `testability-1`, `testability-2`
2. **Dias 4–10** — `deployability-1`, `-2`, `-3`, `integrability-2` → prepara o go-live
3. **Dias 11–20** — decisão sobre `performance-1`, `sispag-dda-status-visivel`,
   `fault-tolerance-1`, `fault-tolerance-4`
4. **Dias 21–30** — `sispag-probes-consolidation`, `deployability-5`, `modifiability-3`
5. **Backlog trimestral** — `modifiability-1`, `-2`, `-5`

## Pendências de negócio (fora da review)

- **P1 para a Flávia** — o caminho DDA cobre 100% dos boletos, ou sobra resíduo digitado
  à mão? Em PRD, 73% dos itens boleto reais têm barras **sem** `vldVinculoDda`. Se houver
  resíduo, esses títulos vão bater no `BoletoSemCodigoBarrasError` e precisam do arquivo
  DDA importado no `fin124` antes. Ver `sispag-boleto-dda-sondagem.md` §6.
- **Go-live** — acompanhar a primeira remessa real com boleto: o `.REM` precisa mostrar
  segmento J com barras, e o `itsVldModalidade` do item deve bater com o banco emissor
  do barcode (341 → 6, outro → 7). Card `fault-tolerance-4` automatiza essa verificação.
