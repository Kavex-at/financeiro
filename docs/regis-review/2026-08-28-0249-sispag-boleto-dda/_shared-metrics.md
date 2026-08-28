# Shared metrics — Regis-Review run 2026-08-28-0249 (delta sispag-boleto-dda)

> Coletado pelo orquestrador do `/regis-review`. **Leia isto antes de coletar métrica própria.**
> Escopo desta run: **delta da branch `feat/sispag-boleto-dda`** (commit `5978ac5`), modo `--quick`.

## ⚠️ Layout do repositório (armadilha conhecida)

Este repo usa `src/backend/` e `src/frontend/` — **não** `backend/src/` nem `frontend/src/`.
Comandos herdados do template (`find backend/src …`) retornam vazio. Reescreva os caminhos.
**Não existe `infra/`** — deploy é via Render deploy-hook no GitHub Actions. Toda métrica de
Terraform/tenant é **não medível** neste repo (não é finding: é o estado documentado no CLAUDE.md).

## Escopo do delta (o que revisar)

```
5978ac5 feat(sispag): boleto sai na remessa com código de barras — via associação DDA do ERP
 ontology/_coverage.json                            |  24 +-
 ontology/_inbox/sispag-boleto-dda-sondagem.md      | 152 ++++++++++++
 ontology/_inbox/sispag-boleto-dda-tasks.md         | 130 +++++++++++
 ontology/_index.json                               |  22 +-
 .../boleto-exige-codigo-de-barras.md               |  67 ++++++
 ...0-boleto-sispag-vem-da-associacao-dda-do-erp.md | 109 +++++++++
 ontology/entities/titulo-a-pagar.md                |  23 +-
 ontology/integrations/conexos.md                   |  30 +++
 src/backend/domain/client/ConexosSispagClient.ts   |  15 +-
 .../domain/client/ConexosSispagWriteClient.test.ts | 190 +++++++++++++++
 .../domain/client/ConexosSispagWriteClient.ts      | 132 +++++++++--
 .../domain/errors/BoletoSemCodigoBarrasError.ts    |  33 +++
 src/backend/domain/interface/sispag/Fin015Write.ts |  28 ++-
 .../sispag/IngestaoPagamentosService.test.ts       |  72 +++++-
 .../service/sispag/IngestaoPagamentosService.ts    |  50 +++-
 .../domain/service/sispag/RemessaService.test.ts   | 102 +++++++-
 .../domain/service/sispag/RemessaService.ts        | 120 +++++++---
 .../service/sispag/SispagPainelService.test.ts     |  75 +++++-
 .../domain/service/sispag/SispagPainelService.ts   |  38 ++-
 src/backend/jobs/probe-boleto-fonte.ts             | 152 ++++++++++++
 src/backend/jobs/probe-com308-codbar.ts            |  95 ++++++++
 src/backend/jobs/probe-dda-answer-shape-hml.ts     | 149 ++++++++++++
 src/backend/jobs/probe-dda-assoc-write-hml.ts      | 205 ++++++++++++++++
 src/backend/jobs/probe-dda-associado-hml.ts        | 105 +++++++++
 src/backend/jobs/probe-fin015-boleto-vinculo.ts    | 183 +++++++++++++++
 src/backend/jobs/probe-fin124-dda.ts               | 259 +++++++++++++++++++++
 src/frontend/app/sispag/components/LoteCard.tsx    |   6 +-
 src/frontend/app/sispag/page.tsx                   |  24 ++
 src/frontend/lib/sispag.ts                         |   7 +
 29 files changed, 2513 insertions(+), 84 deletions(-)
```

## Baseline do repositório

| Métrica | Valor | Fonte |
|---|---|---|
| LOC `domain/service` | 14.622 em 50 arquivos | `find src/backend/domain/service -name '*.ts' ! -name '*.test.ts' \| xargs wc -l` |
| LOC `domain/repository` | 5.355 em 21 arquivos | idem |
| LOC `domain/client` | 7.041 em 20 arquivos | idem |
| LOC `domain/errors` | 954 em 26 arquivos | idem |
| LOC `domain/libs` | 1.284 em 13 arquivos | idem |
| LOC `routes` (Express) | 2.595 em 7 arquivos | idem |
| LOC `http` | 721 em 14 arquivos | idem |
| LOC `jobs` (sondas + crons) | 9.027 em 51 arquivos | idem |
| LOC frontend | 17.777 | `find src/frontend … \| xargs wc -l` |
| Arquivos de teste backend | 123 | `find src/backend -name '*.test.ts'` |
| Arquivos de teste frontend | 25 | `find src/frontend -name '*.test.ts(x)'` |
| Módulos Terraform | ⚠️ **não medível** — `infra/` não existe | `ls infra` |
| Tenants provisionados | ⚠️ **não medível** — idem | idem |

## Gates do delta (executados nesta run, 2026-08-27)

| Gate | Resultado | Comando |
|---|---|---|
| Backend typecheck | ✅ limpo | `cd src/backend && npm run typecheck` |
| Backend lint (Biome) | ✅ **0 erros**, 63 warnings | `cd src/backend && npm run lint` |
| Backend testes | ✅ **1500 passed**, 109 suites (+24 vs base) | `cd src/backend && npx jest` |
| Frontend typecheck | ✅ limpo | `cd src/frontend && npm run typecheck` |
| Frontend lint | ✅ 0 erros, 16 warnings (pré-existentes) | `cd src/frontend && npm run lint` |
| Frontend testes | ✅ **189 passed**, 25 suites | `cd src/frontend && npx jest` |

**Warnings de lint: idênticos à base.** O conjunto de ARQUIVOS com warning em `origin/main` e no
delta é o mesmo (13 arquivos, todos `noExcessiveCognitiveComplexity` pré-existentes). Nenhum
arquivo novo/alterado desta branch aparece na lista. Verificado por `comm -13` das duas listas.
**Não abra finding de lint contra este delta** sem antes reproduzir o diff contra `origin/main`.

## Dependências

| Pacote | dependencies | devDependencies |
|---|---|---|
| backend | 16 | 14 |
| frontend | 23 | 17 |

> `--quick`: **não** rodar `npm audit` profundo, coverage completo nem build. O último `npm audit`
> foi endereçado no commit `617ca3b` (axios 1.16.1 → 1.19.0) para destravar o CI.

## Contexto de domínio obrigatório (leia antes de opinar)

Esta feature mexe no caminho de **dinheiro saindo da empresa** (remessa SISPAG). Antes de abrir
finding, leia:

- `ontology/decisions/0040-boleto-sispag-vem-da-associacao-dda-do-erp.md` — a decisão e o porquê
- `ontology/_inbox/sispag-boleto-dda-sondagem.md` — as MEDIÇÕES (4 sondas read-only em PRD + 2
  testes de escrita em HML). Todo número citado no ADR sai daqui.
- `ontology/business-rules/boleto-exige-codigo-de-barras.md` — o fail-closed novo
- `ontology/business-rules/retomada-remessa-sispag.md` — a máquina de retomada já existente
- `ontology/decisions/0013-*` e `0039-*` — doutrina de escrita não-idempotente e retomada

### Fatos medidos que mudam a análise

1. `titEspCodbar` é **null em 100%** dos títulos (0/2000 fin064, 0/2173 grid de pendentes, 0/50
   com308, em PRD). A auto-detecção de boleto anterior **nunca disparava**.
2. O código de barras só existe em `FinItemSispag.itsNumCodbar`, **depois** do import.
3. O vínculo pagamento↔boleto é o flag `titVldReflexoDdaAssoc` do grid de pendentes.
4. O POST que devolve `type: QUESTION` **não escreve nada** (medido: contagem de itens do lote
   inalterada antes da resposta). O re-POST com `answers` **não é retry cego** — não fere ADR-0013.
5. `answers` é `Map<String,String>` chaveado pelo **id** da pergunta (não pelo `key`, não array).

### Pontos que MERECEM escrutínio (não são pré-aprovados)

- **Auto-resposta a uma pergunta do ERP** (`ConexosSispagWriteClient`): a doutrina do repo
  (`ErpPerguntaError`) é NÃO auto-responder. Aqui há allowlist de 1 chave exata. Avaliar se o
  guard é suficientemente estreito e se o re-POST é seguro sob falha parcial.
- **Lote nativo usado como CONTEXTO de leitura** do grid de pendentes (ingestão e painel):
  `listarTitulosComBoletoDda` pega o maior `flpCod` da conta. Avaliar acoplamento e o que
  acontece se esse lote for cancelado/reciclado (o ERP RECICLA flpCod — ver migration 0049).
- **Custo de leitura**: a ingestão passou a fazer +1 leitura paginada por filial por rodada
  (fil 2 tem ~2195 pendentes = ~5 páginas de 500). Avaliar impacto em performance/rate-limit.
- **Sondas em `jobs/`**: 7 arquivos novos, 3 deles ESCREVEM em HML. Avaliar se o guard
  (`recusa base != -hml`) é suficiente e se isso pertence ao repo versionado.
- **Fail-closed no envio** e não no rascunho: avaliar o trade-off de descobrir tarde.

