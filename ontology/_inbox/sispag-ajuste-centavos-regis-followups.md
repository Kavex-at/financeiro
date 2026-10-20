# Follow-ups do Regis-Review — `sispag-ajuste-centavos` (ADR-0073), 2026-10-19

Revisão reduzida (Fault Tolerance, Integrability, Security, Testability). Relatório:
`docs/regis-review/2026-10-19-sispag-ajuste-centavos/REPORT.md`. **Não implementados**, salvo onde dito.

## Portão de merge (P0)

- **[P0] fault-tolerance-1 — medir antes do merge.** I17m (`MODO_GUARDA_VALOR_J = BLOQUEIA`) e I17n mudam
  toda remessa mesmo com o ajuste em `off`. Rodar a Task 13 (GT3: J com barra > 0 × pagamento nos `.REM` de
  PRD dos últimos 30 dias; GT4: pendentes com `titMnyLiquido ≠ titMnyValor`). Caso legítimo ⇒ `AVISA` antes
  do merge + ADR curta. Também medir (GT1) se o `fin064` traz `titMnyJuros`/`titMnyDesconto` nulos em título
  comum — a régua trata nulo como 0 só quando a chave existe; chave ausente falha fechado.

## P1

- **integrability-1** — `emItemSispag` (sinal `its*` de título em lote nativo) falha ABERTO se o `fin064`
  não trouxer as chaves. Provar o sinal em PRD/HML e exigir as chaves presentes antes de `shadow`.
- **fault-tolerance-2** — ledger `cancelado`/`recusado` não reabre (chave de idempotência por decisão).
  *Parcial:* "tentar de novo" agora recusa (`AJUSTE_ENCERRADO_*`) e a tela não oferece o botão. Falta ação
  humana auditada de reabertura.
- **fault-tolerance-3** — `indeterminado` sem fila durável. *Parcial:* agora segura o `finalizarLote`.
- ~~**fault-tolerance-4** — alerta de ledger parado.~~ **Fechado em 2026-10-20** (decisão do mantenedor):
  `indeterminado` e `aguardando_aprovacao_manual` emitem `Alerta` `sispag-ajuste-centavos-parado` no Painel
  de Operação (dedup por título e dia civil BRT), além do log. Fora do escopo fechado, sem item aberto: a
  retomada continua só ao abrir a tela/após confirmar (não há varredura por idade do ledger não terminal).

## P2

- **integrability-2/3** — provar em HML (Task 15) o cancelamento do `fin070` e as codificações
  `fbaVldStatus` (ativo) e `ftbVldStatus` (2 = liberado); unificar os dois schemas do `fin064` e gravar
  fixtures de contrato (testability-2).
- **integrability-4** — logar linha descartada por `safeParse`. *Parcial:* a soma de `mnyValorTotal` não é
  mais parcial.
- **fault-tolerance-5** — advisory lock de sessão segura conexão do pool durante o fluxo inteiro.
- **fault-tolerance-6** / PatternGuardian — corrida entre a guarda do `finalizarLote` e o início do ajuste.
- **security-1** — scrub de mensagens remove só 20+ dígitos contíguos; código formatado passaria.
- **security-2** — `/ajustes-centavos/retomar` sem guarda de concorrência e com `filCod` opcional.
- **testability-1** — teste de contrato entre o ledger fake e o repositório real.
- PatternGuardian — `emItemSispag`/`ehDeterministica` são regra no client (mover para `libs`); funções de
  módulo `centavos`/`chaveDeLock`; casts `as T`; `passo` muta `exec`.
- ObservabilityAdvisor — `type` uniforme nos logs de erro, `acaoHumana` em `data`, duração por etapa,
  contadores por filial; correlação (`execucaoId`) nos logs de `ler`.
- DesignSystemReviewer — selo `em_curso` não se atualiza sozinho (sem polling); linhas > 100 col no frontend.

## P3

- **security-3** — escopo por filial nas rotas de ajuste.
- **security-4 / fault-tolerance-7** — runbook de kill-switch e de recuperação para a frente.
- **testability-3/4** — seam de id no repositório; dividir o service (≈1200 LOC) por etapa.
