# Shared metrics — `sispag-reter-titulo-lote` (delta vs `origin/main`)

- **Worktree:** `/home/inteli/Área de trabalho/projects/kavex/financeiro/.claude/worktrees/agent-a914f4c15f12e54b0`
  (leia os arquivos DAQUI; o checkout principal está em outra branch e não tem estes arquivos)
- **Branch:** `fix/sispag-reter-titulo-lote`
- **Feature:** ADR-0050 — retirar um título do lote pela aba de títulos e retê-lo da formação
  automática (invariante I8). Tabela própria `titulo_retencao_formacao` (migration 0062), soft-delete,
  no máximo uma retenção ativa por título. Nenhuma escrita no ERP, nenhum cálculo monetário.
- **Layout:** `src/backend/` e `src/frontend/` (não `backend/src/`). **Não existe `infra/`** —
  métricas de Terraform/tenant são **não medíveis** neste repo (deploy via Render hook).

## Escopo do delta (`git diff --stat origin/main...HEAD -- src`)

```
 src/backend/domain/errors/RetencaoInexistenteError.ts          |  21 ++ (novo)
 src/backend/domain/errors/TituloForaDeLoteError.ts             |  22 ++ (novo)
 src/backend/domain/interface/sispag/SispagInterface.ts         |  36 ++
 src/backend/domain/repository/sispag/LotePagamentoRepository.ts|  54 +-
 src/backend/domain/repository/sispag/RetencaoFormacaoRepository.ts | 105 (novo)
 src/backend/domain/repository/sispag/TituloAPagarRepository.ts |   8 +
 src/backend/domain/service/sispag/LotePagamentoService.ts      | 151 +-
 src/backend/domain/service/sispag/SispagPainelService.ts       |  23 +-
 src/backend/migrations/0062_titulo_retencao_formacao.sql       |  70 (novo)
 src/backend/routes/sispag.ts                                   | 109 +-
 src/frontend/app/sispag/components/LoteCard.tsx                |  86 +-
 src/frontend/app/sispag/components/RetencaoBadge.tsx           |  39 (novo)
 src/frontend/app/sispag/components/RetirarDoLoteDialog.tsx     | 133 (novo)
 src/frontend/app/sispag/components/retencao.ts                 |  46 (novo)
 src/frontend/app/sispag/page.tsx                               | 154 +-
 src/frontend/lib/sispag.ts                                     |  56 +
 + testes: RetencaoFormacaoRepository.test (138), LotePagamentoService.test (+214),
   routes/sispag.test (+188), SispagPainelService.test (+66), LotePagamentoRepository.test (+31),
   TituloAPagarRepository.test (+24), migrations/retencaoFormacao.test (58),
   frontend lib/sispag.test (+70), app/sispag/components/retencao.test (75)
 25 files changed, 1929 insertions(+), 48 deletions(-)
```

## Gates medidos nesta branch (2026-09-22)

| Gate | Resultado |
|------|-----------|
| backend `npm run typecheck` | OK (0 erros) |
| backend `npm run lint` (Biome) | 0 erros, 73 warnings (pré-existentes; nenhum nos arquivos do delta) |
| backend `npm test` | 143 suites verdes |
| frontend `npm run typecheck` | OK |
| frontend `npm run lint` (ESLint) | 0 erros, 20 warnings (pré-existentes) |
| frontend `npm test` | 48 suites verdes |
| PatternGuardian | APPROVED |
| SpecVerifier (cego) | APROVADO 71/71 criteria |
| DesignSystemReviewer | aprovado exceto 1 item: `DateFormatter` de `@/shared/lib/datetime` exigido pelo doc não existe no repo (drift do template) |
| `npm audit` | não medido nesta rodada (sem dependência nova no delta) |
| Cobertura (%) | não medida nesta rodada |

## Instrução para os agentes

Avalie o **delta** desta feature (e o impacto dele nos arquivos tocados). Finding em código fora do
delta deve ser rotulado "pré-existente, fora do delta" — ele pode virar card, mas nunca P0 desta feature.

## Atualização pós-rebase (2026-09-23)

- Branch rebaseada sobre `main` @ `3864b76` (v0.40.0, data de débito ADR-0049). Conflitos resolvidos em
  `ontology/*` (JSON e changelog), `src/frontend/lib/sispag.test.ts` e `LoteCard.tsx` (o `GerarRemessaDialog`
  da `main` convive com a confirmação de remoção desta feature).
- A invariante da retenção foi **renumerada de I8 para I9** (a `main` já usa I8 para a data de débito).
- Gates depois do rebase: backend typecheck OK · lint 0 erros · **146 suites / 2196 testes verdes**;
  frontend typecheck OK · lint 0 erros · **49 suites / 417 testes verdes**.
- Seções já escritas nesta rodada (deployability, fault-tolerance, integrability, performance, security):
  **0 P0**. Faltam availability, modifiability, testability.
- Compare o delta com `main` (`git diff main...HEAD`), não com `origin/main`.
