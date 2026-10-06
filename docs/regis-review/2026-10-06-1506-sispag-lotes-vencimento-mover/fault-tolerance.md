---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-06-1506
agent: qa-fault-tolerance
generated_at: 2026-10-06T15:30:00Z
scope: all
score: 7.5
findings_count: 5
cards_count: 3
---

# Fault Tolerance — Regis-Review (delta sispag-lotes-vencimento-mover)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (UI) / cron de formação | Dois cliques concorrentes, falha no meio de "criar lote + incluir títulos", finalização concorrente do lote de origem | `LotePagamentoService.incluirTitulo` (mover), `FormacaoLotesService`, `useCriarLoteManual` | Operação normal, multi-usuário | Mover é tudo-ou-nada; título em lote comprometido nunca é duplicado; falha parcial é visível | 0 títulos em dois lotes ativos; 0 títulos perdidos; falha parcial reportada ao analista |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Atomicidade do mover (remove origem + add destino + descarta alertas + marcarManual + tocarLote + cancelarSeVazio) | 1 transação sob advisory lock por título | 100% | ✅ | LotePagamentoService.ts `incluirTitulo`/`retirarDaOrigem` |
| Guarda condicional na origem (DELETE só se RASCUNHO; 0 linhas aborta) | presente + teste | presente | ✅ | LotePagamentoRepository.removerItemDeRascunho; teste "origem deixou de ser RASCUNHO" |
| Bloqueio de título em FINALIZADO/REMESSA_GERADA | presente + teste | presente | ✅ | `loteComprometidoComTitulo` |
| Audit pareado na mesma transação | 0/1 (audit é `logService.info` pós-commit, best-effort) | 100% | ⚠️ | `audit()` |
| Criação de lote na UI atômica | não (criarLote + N chamadas) | atômica ou compensada | ⚠️ | useCriarLoteManual.ts |
| Efeito em ERP/banco do delta | nenhum (só Postgres) | — | ✅ | diff |
| Stuck-state reaper / reconciliação Conexos | fora do delta | — | N/A | — |

## 3. Tactics

| Tactic | Implementação | Status | Evidência |
|---|---|---|---|
| Rollback (atomic move) | withTransaction; erro em qualquer passo desfaz tudo | ✅ presente | LotePagamentoService.ts |
| Sanity Checking | DELETE condicional ao status + rowCount | ✅ presente | removerItemDeRascunho |
| Optimistic concurrency | `tocarLote` bumpa versão; origem aberta em outra tela recebe conflito | ✅ presente | retirarDaOrigem |
| Idempotent Replay | repetir mover: título já no destino não duplica; sem Idempotency-Key | ⚠️ parcial | routes/sispag.ts |
| Quarantine / Exception path | falhas parciais listadas em toast (3 primeiras) | ⚠️ parcial | useCriarLoteManual.ts |
| Compensating transaction | N/A no backend (tx local); UI não limpa lote vazio | ⚠️ parcial | — |
| Audit trail | log estruturado, fora da tx | ⚠️ parcial | `audit()` |
| Condition monitoring / reconciliação | N/A para o delta (sem escrita externa) | N/A | — |

## 4. Findings

- **F1 (P2)** Audit do mover (`moverTitulo`, com loteOrigem) é `logService.info` após o commit: se o processo morrer entre commit e log, o movimento fica sem trilha. Padrão herdado dos demais audits do serviço; não é regressão, mas as alertas descartadas já guardam o ator.
- **F2 (P2)** TOCTOU estreito: `loteComprometidoComTitulo` e `loteRascunhoComTitulo` rodam sob o lock por título, mas a finalização de lote não toma esse lock. Se o lote X finaliza entre as duas leituras, o título (sem `mover`) pode entrar em Y estando em X FINALIZADO. Com `mover` o DELETE condicional cobre; sem `mover` não.
- **F3 (P2)** Frontend: `criarLote` seguido de N `incluirTitulo` não é atômico. Se todas as inclusões falharem, sobra lote RASCUNHO vazio órfão; falha parcial só aparece em toast (3 primeiras). Sem Idempotency-Key, clique duplo antes de `criando` propagar cria dois lotes. Recuperação é forward (analista) — escolha aceitável, mas não documentada.
- **F4 (P3)** Lock ocupado em `incluirTitulo` cai em `LoteVersaoConflitoError(versaoEsperada: -1)` — mensagem enganosa (pré-existente). Moves cruzados entre lotes podem gerar deadlock de linha em `tocarLote`; o Postgres aborta uma tx inteira (sem estado parcial).
- **F5 (P3)** `fatiar`/agrupamento são puros e determinísticos; o cron segue sob `FORMACAO_LOCK_KEY` e lotes movidos viram manuais, então não são desfeitos pelo cron. Lotes automáticos pré-deploy (por filial) coexistem com os novos até o ciclo seguinte. Sem risco, só registro.

Nenhum P0: sem dual-write com sistema externo, sem catch silencioso, sem consumer SQS no delta.

## 5. Cards Kanban

### [P2] Audit do mover durável na mesma transação
- Origem: F1 · Esforço: S
- Gravar o registro `moverTitulo` (ator, lote origem/destino, título) dentro do `withTransaction`, em vez de só log pós-commit.

### [P2] Finalização tomar o lock por título (ou re-checar comprometido)
- Origem: F2 · Esforço: S
- Fechar a janela entre a checagem de lote comprometido e a inclusão sem `mover`.

### [P2] Criação de lote na UI: limpar lote vazio e mostrar todas as falhas
- Origem: F3 · Esforço: S
- Cancelar o lote criado quando 0 títulos entram; desabilitar o botão durante `criando`; documentar a recuperação forward.

## 6. Cross-QA

- Security: trilha de audit durável (F1).
- Availability/Performance: N chamadas sequenciais por lote criado (latência cresce com o nº de títulos).
- Testability: o delta cobre a corrida "origem deixou de ser RASCUNHO" e o bloqueio de comprometido; falta teste de concorrência real (F2).
