# Regis-Review (reduzido) 2026-10-14-2230 — métricas compartilhadas

> Escopo: delta da branch `feat/sispag-passo2-vinculo-codbar` contra `origin/main` (v0.67.0), tweak
> `sispag-passo2-vinculo-codbar` (ADR-0071, I17a–l: vincular o código de barras ao item do SISPAG, só
> valor igual). Worktree:
> `/home/inteli/Área de trabalho/projects/kavex/financeiro/.claude/worktrees/sispag-passo2-vinculo-codbar`
> (use SEMPRE caminhos dentro dele). Delta = `git diff origin/main HEAD` (18 commits).

## O que muda
Para título BOLETO sem associação DDA do ERP com decisão humana `CONFIRMADA` e boleto de valor igual em
centavos ao `fin064.totalAberto` ao vivo (Δdias 0..5, não órfã, tier CONHECIDO/FORTE), o código de barras
é vinculado ao item no rascunho nativo: lista ao vivo → `validacao/codigoBarras` → `confirmaCodigoBarras`
→ `PUT fin015/finItemSispag` (tentativa única; 5 campos, 6º `itsVldModalidade=7` se banco do código ≠ banco
do lote) → releitura decide. Etapa `vincular_codbar` só em memória, entre `importar` e a guarda I16.
Falha determinística → retirada pela máquina I16d (`VINCULO_CODIGO_BARRAS_FALHOU`); transitória/ambígua →
aborta e retoma; edição de terceiro nunca é sobrescrita (`indeterminado`); nunca em lote nativo
FINALIZADO. Flag por filial `SISPAG_BIND_CODBAR_FILIAIS` (off/shadow/on, fail-closed off) + kill-switch.
Migration 0086 (5 colunas + trilha). Rota `GET /sispag/lotes/:id/vinculos-previstos`. Selo no LoteCard.
Sonda PRD read-only (não executada). **Escreve no ERP quando `on`** (hoje default off).

## Baselines (relatados pelo AutoLoopRunner)
typecheck OK; lint 0 erros; backend jest 254 suites / 4678 testes; `test:sql` 20 suites / 163 testes
(docker postgres); frontend jest 1008 testes; PatternGuardian PASS; DesignSystemReviewer PASS;
SpecVerifier aprovado. HML V1–V9 em `ontology/_inbox/sispag-passo2-vinculo-codbar-hml-achados.md`
(V6 e V-PRD1/V-PRD2 abertos). V3: ERP sem lock otimista. V4: banco do código ≠ banco do lote exige
modalidade 7 (validação, confirma e item).

## Fora do escopo
Boleto acima/abaixo do título; ATENCAO; `on` em PRD (gated em V-PRD1/V-PRD2); guarda entre lotes.
