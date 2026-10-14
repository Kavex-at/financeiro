# Regis-Review (reduzido) 2026-10-14-1806 — métricas compartilhadas

> Escopo: **delta da branch `fix/sispag-guarda-codbar-repetido` contra `origin/main` (v0.66.0)**,
> tweak `sispag-guarda-codbar-repetido` (PR 1 de 2: DETECTAR e ABORTAR). Versão **reduzida**: 3 QAs
> escolhidos pelo risco — Fault Tolerance, Security, Testability. Worktree:
> `/home/inteli/Área de trabalho/projects/kavex/financeiro/.claude/worktrees/sispag-guarda-codbar-repetido`
> (use SEMPRE caminhos dentro dele). Delta = `git diff origin/main HEAD` (≈ 13 commits; v0.66.1).

## O que muda

Um mesmo código de barras não pode sair duas vezes na remessa (risco de pagamento em duplicidade:
medido 27 títulos flagados pelo ERP em grupos com mais títulos que boletos, ex. PEDRONI 10 títulos × 2
boletos). Pontos de checagem: (1) em `RemessaService`, **depois do import e antes de `finalizarLote`**,
lendo `itsNumCodbar` do lote (`listarLinhasDigitaveisDoLote`), normalizando 47→44; roda também na
retomada; (2) rede de segurança nos segmentos J do `.REM` em `RemessaCnabValidator`. Hit ⇒
`BoletoCodigoBarrasRepetidoError` (409), ledger `failed`, rascunho preservado, **só o código
mascarado (5+4)** em mensagem/log/ledger. Código presente mas inválido **falha fechado**. BOLETO sem
código legível depois do import = WARN e segue (comportamento de ausência inalterado).
Sem escrita nova no ERP, sem migration, sem UI, sem permissão nova.

## Arquivos de produção do delta

`domain/libs/boleto/AnaliseCodigoBarrasRepetido.ts` (novo, puro), `domain/libs/boleto/CodigoBarrasBoleto.ts`
(`paraBarras` 47/44 com DV), `domain/client/ConexosSispagWriteClient.ts` (`invalidos` com identidade,
nunca o código), `domain/interface/sispag/Fin015Write.ts`, `domain/errors/BoletoCodigoBarrasRepetidoError.ts`,
`domain/service/sispag/RemessaService.ts` (`verificarCodigoBarrasRepetido`),
`domain/libs/cnab/RemessaCnabValidator.ts` (`repetidos`, gate 5.1).

## Baselines medidos

| Métrica | Resultado |
|---|---|
| Backend typecheck / lint | limpo / 0 erros, 92 warnings preexistentes |
| Backend testes | 241 suites / 4388 testes passando (+ ajuste de texto da mensagem: 305 nos suites tocados) |
| `RemessaService.test.ts` | 125 → 138 testes (10 novos do guard, 2 do gate 5.1) |
| `BoletoSemCodigoBarrasError.ts` | sem diff; nenhum teste existente editado |
| Ground truth | `SEM_GROUND_TRUTH` do ERP (o código só existe depois do import); teste canônico por fixture (PEDRONI 10 títulos × 2 códigos sintéticos de DV válido) |

## Fato do ERP (HML, 2026-10-14) que molda o desenho

O ERP **não valida o DV** de um código digitado, **não compara** o código com o título e o `importar`
**descarta** código no payload; o código só chega ao item por `PUT fin015/finItemSispag` depois de
`validacao/codigoBarras` + `confirmaCodigoBarras`. Por isso a checagem é NOSSA, sobre o código de 44
dígitos derivado de `itsNumCodbar`, e a análise é uma função pura reutilizável (o passo 2 da
ADR-0068 a chamará de novo depois da edição do item).

## Fora do escopo (PR 2, feature separada)

Remoção automática do item repetido do rascunho nativo (`DELETE finItemSispag`, medido em HML),
retenção do título retirado, estágio novo de retomada, exceção em lote FINALIZADO. **Nada disso está
neste delta.** Consequência conhecida e aceita: após o aborto, remover o título do lote local não
tira o item do rascunho no Conexos; uma nova tentativa aborta de novo (correto: fail-closed) até o
rascunho ser descartado no Conexos. A mensagem ao analista foi ajustada para dizer isso.
