# Regis-Review (reduzido) 2026-10-14-1330 — métricas compartilhadas

> Escopo: **delta da branch `feat/sispag-sugestao-boleto-dda` contra `origin/main` (7c59eaa, v0.65.0)**,
> feature `sispag-sugestao-boleto-dda` (passo 1: sugestão de boleto DDA + confirmação do emissor).
> Versão **reduzida**, pedida pelo usuário: 4 QAs escolhidos pelo risco — Security, Fault Tolerance,
> Testability, Performance. Availability, Deployability, Integrability e Modifiability ficam de fora
> (PatternGuardian, migration aditiva e gate de complexidade do lint cobrem o essencial).
> Worktree: `/home/inteli/Área de trabalho/projects/kavex/financeiro/.claude/worktrees/sispag-sugestao-boleto-dda`
> Use SEMPRE caminhos dentro dele. Delta = `git diff origin/main HEAD` (≈ 20 commits; v0.66.0).

## O que a mudança faz

Mostra, na aba de títulos, uma sugestão de boleto DDA para o título "boleto sem DDA", com evidência
(deltas com sinal, camadas CONHECIDO/FORTE/ATENCAO/VENCIDO_INFORMATIVO, sinais), e deixa o analista
Confirmar/Rejeitar/Copiar a linha digitável/Revogar. Confirmação é **evidência, não autoridade**:
passo 1 **não escreve no Conexos**; a validação ao vivo da remessa (ADR-0040) segue sendo a única
autoridade. ADR-0068; regra I15a–k; migration 0084 (3 tabelas, trigger append-only, índices parciais).

## Arquivos de produção do delta

Backend (`src/backend`): `migrations/0084_sispag_sugestao_boleto.sql` (+rollback),
`domain/libs/boleto/CodigoBarrasBoleto.ts` (chave do emissor 341/237), `domain/service/sispag/`
`RegraSugestaoBoleto.ts`, `MotorSugestaoBoleto.ts`, `BoletoSuggestionService.ts`,
`ConsolidacaoBoletoDda.ts` (regra em camadas, substitui "valor exato ±3 dias"),
`domain/repository/sispag/SugestaoBoletoRepository.ts` (+`TituloAPagarRepository`,
`BoletoDdaRepository`, `LotePagamentoRepository`), `domain/interface/sispag/` (`SugestaoBoleto*`,
`ConfirmacaoEmissorBoleto`), `domain/errors/*` (erros nomeados), `routes/sispag.ts` (6 rotas),
limiter, `jobs/validate-sispag-sugestao-boleto-dda-v1.ts`.
Frontend (`src/frontend/app/sispag/`): `SugestaoBoletoPainel`, `MotivoDecisaoDialog`,
`ConfirmacoesEmissorPainel`, `sugestaoBoleto.ts`, `BoletosDoTituloDialog`, `FormaPagamentoBadge`,
`page.tsx`, `lib/sispag.ts`.

## Baselines medidos (neste worktree, após as correções do PatternGuardian e do DesignSystemReviewer)

| Métrica | Resultado |
|---|---|
| Backend typecheck / lint | limpo / 0 erros, 91 warnings |
| Backend testes | 237 suites / 4284 testes passando |
| Migration 0084 (integração em Postgres real) | 3 suites / 24 testes passando |
| Frontend lint / testes | 0 erros, 20 warnings / 967 testes passando; 2 suítes falham pelo módulo `@radix-ui/react-dropdown-menu` ausente no `node_modules` compartilhado (ambiental, fora do delta) |
| Gate ground-truth (PRD, read-only) | DIVERGE_OUTRO_BOLETO = 0; 98 reproduzem; 44 empates legítimos; 26 "ERP compartilha boleto"; amostra cega 80 títulos / 31 credores: 56 reproduzem, 0 divergem |
| Cobertura descritiva (sem ground truth) | de 953 títulos BOLETO não flagados: FORTE 248, VENCIDO_INFORMATIVO 40, ATENCAO 4 |
| Motor | ~1100 títulos × ~1500 boletos em < 1 s (teste) |

## Decisões do mantenedor que NÃO se reabrem (2026-10-14)

Par + registro por título; confirmar um par nunca alarga os limites globais (R$ 0,05 no mesmo dia, ou
valor igual com boleto 1–5 dias DEPOIS e não antes da data de débito); um analista com
`sispag:executar` confirma/rejeita/revoga; **`sispag:ver` pode copiar a linha digitável e TODA cópia é
auditada (fail-closed)** — alinhado ao ADR-0053 (`GET /sispag/boletos-dda` já é `ver` e devolve a
linha digitável sem auditoria: estado conhecido e aceito); chave genérica (≠ 341/237) nunca é
elegível a automático (passo 3).
