---
name: situacao-pagamento-titulo
type: business-rule
entity: TituloAPagar
invariant: I19
ontology_version: "0.46.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/interface/sispag/SituacaoPagamento.ts
  - src/backend/domain/service/sispag/SituacaoPagamentoResolver.ts
  - src/backend/domain/service/sispag/SituacaoPagamentoService.ts
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/service/sispag/FormacaoLotesService.ts
  - src/backend/domain/service/sispag/IngestaoPagamentosService.ts
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/domain/errors/TituloNaoElegivelError.ts
  - src/backend/migrations/0089_titulo_tipo_documento.sql
  - src/backend/routes/sispag.ts
  - src/frontend/lib/sispag.ts
  - src/frontend/app/sispag/page.tsx
last_review: 2026-10-20
has_canonical_test: false
open-gap:
  - "tipos de adiantamento (tpdCod 99/141/18 na carteira de 2026-10-13) NÃO bloqueiam nesta fatia: um adiantamento a fornecedor é pagamento. Confirmar com a analista se algum deles deve entrar em TIPO_PERMUTA."
  - "o que '(PERMUTA)' significa em cada título (já quitado por permuta, parcialmente permutado ou aguardando) não é decidível pelo tipo: o saldo permutado só existe no detalhe `com298/{docCod}` (`mnyTitPermuta`). A linha avisa; a analista confere em Permutas."
  - "pagamento parcial real com `vldPago = 0` (baixa bancária sem `vldPago`) aparece com a face cheia: risco de pagar em dobro, fora desta fatia. O resolver deve ter lugar para um motivo futuro."
  - "TED/PIX sem conta/chave no cadastro e favorecido não autorizado só se conhecem dentro do lote (I13/I14): PRONTO até existir verificação no carregamento da carteira (D10)."
  - "código de TED em `titVldPagopor` não confirmado; `FORMA_NAO_SISPAG` parte da lista {1, 4, 5, 7} e não deduz o resto."
universality_evidence:
  - "ADR-0075 + ontology/_inbox/sispag-situacao-pagamento-plan.md — decisões D1–D17 do maintainer (2026-10-20)"
  - "1 cliente apenas (Columbia): a estrutura (um valor derivado por título, com motivo, dono e ação, aplicado na tela e na inclusão) é do domínio; a lista de motivos e os códigos de forma que bloqueiam são config/decisão do tenant"
---

# Regra: situacao-pagamento-titulo (um título a pagar é PRONTO ou BLOQUEADO, e o bloqueio diz quem resolve)

> **Invariante I19 — Situação de pagamento.** Todo `TituloAPagar` da carteira tem uma
> **situação de pagamento** calculada **no backend**, por uma função única, a partir do que a plataforma
> já sabe dele: `PRONTO` (pode entrar em lote) ou `BLOQUEADO` (não pode), com **todos os motivos** que se
> aplicam, o **principal** (o mais urgente), **quem resolve** e **o próximo passo**. A tela só desenha; a
> inclusão em lote e a formação automática usam a **mesma** função. Valor **derivado**, nunca persistido.

## Por que existe

Até aqui a analista descobria que um título não podia ser pago **tarde**: o bloqueado entrava na
seleção e falhava depois de o lote nascer; permuta aparecia como título comum; boleto sem DDA só travava
na remessa; favorecido não autorizado só aparecia dentro do lote. O selo "falta cadastro?" da tela
(`prontoParaRemessa`) nunca disparou em produção. Bloquear não basta: cada bloqueio precisa dizer
**o que é, quem resolve e qual o próximo passo**. Ver ADR-0075.

## Invariantes

Estado, motivos e prioridade (I19a–b):

| # | Invariante |
|---|------------|
| **I19a** | **Dois estados.** `estado ∈ {PRONTO, BLOQUEADO}` (`ESTADO_PAGAMENTO`). Não existe estado "pronto, confira" nesta fatia: os casos que o código tem hoje (confirmação a revisar, ajuste de centavos pendente, boleto sem DDA) são bloqueios resolvidos por uma ação simples. Reabrir quando aparecer um título **pronto** que ainda peça conferência. `PRONTO ⇔ motivos = []`. |
| **I19b** | **Motivos, prioridade e `principal`.** `motivos` lista **todos** os que se aplicam, na ordem fixa `ALCADA, TIPO_PERMUTA, VENCIDO, FORMA_NAO_SISPAG, DUPLICIDADE, RETIDO_CODBAR, AJUSTE_CENTAVOS_PENDENTE, CONFIRMACAO_A_REVISAR, BOLETO_SEM_DDA` (`MOTIVO_PAGAMENTO`). `principal = motivos[0]` (ausente em `PRONTO`) e é o que a linha mostra; `dono`, `acao`, `rotulo` e `detalhe` são os do principal. `ResumoSituacao.porMotivo` conta pelo **principal**, então a soma dos motivos é igual a `porEstado.BLOQUEADO`. |

Dono, ação e rótulo por motivo (`DONO_PAGAMENTO`, `ACAO_PAGAMENTO`; os rótulos de ação são os da tela):

| Motivo | Rótulo | Dono | Ação (`codigo` → botão) |
|--------|--------|------|-------------------------|
| `ALCADA` | Aguardando aprovação | `APROVADOR` | `ABRIR_NO_CONEXOS` → "Abrir no Conexos" |
| `TIPO_PERMUTA` | Possível permuta | `PERMUTAS` | `ABRIR_EM_PERMUTAS` → "Abrir em Permutas" |
| `VENCIDO` | Vencido | `CONTAS_A_PAGAR` | `RENEGOCIAR_NO_CONEXOS` → "Renegociar no Conexos" |
| `FORMA_NAO_SISPAG` | Forma de pagamento fora do SISPAG | `VOCE` | `CORRIGIR_FORMA_NO_CONEXOS` → "Corrigir a forma no Conexos" |
| `DUPLICIDADE` | Possível duplicidade | `VOCE` | `TRATAR_DUPLICIDADE` → "Tratar alerta" |
| `RETIDO_CODBAR` | Retido por código de barras | `VOCE` | `DESFAZER_RETENCAO` → "Desfazer retenção" |
| `AJUSTE_CENTAVOS_PENDENTE` | Ajuste de centavos pendente | `VOCE` | `TENTAR_AJUSTE` → "Tentar de novo o ajuste" |
| `CONFIRMACAO_A_REVISAR` | Confirmação a revisar | `VOCE` | `VER_BOLETO` → "Ver boleto" |
| `BOLETO_SEM_DDA` | Boleto sem DDA | `VOCE` | `VER_BOLETO` → "Ver boleto sugerido" |

Regra de cada motivo (I19c–j):

| # | Invariante |
|---|------------|
| **I19c** | **`ALCADA`:** `liberado = false` (AND de `titVld1/2/3libera`, I2 de `elegibilidade-titulo-lote`). `pago` **não** é motivo: o pago não entra na carteira (a ingestão filtra `vldPago = 0`) e a inclusão mantém a checagem **ao vivo** no `fin064` (`ja-pago`, `nao-liberado`), que é a autoridade. |
| **I19d** | **`TIPO_PERMUTA` (indicação, não prova).** O nome do tipo do documento (`tpdDesNome`, vindo do `com298/list`, **persistido pela ingestão**, migration 0089) contém `PERMUTA`, sem distinguir acento nem caixa. Bloqueia **mesmo que o título já tenha sido permutado em parte**; `detalhe` = "pode já ter permuta parcial: confira o saldo em Permutas". Tipo **desconhecido** (título que o `com298` não devolve) **nunca** bloqueia. Tipos de **adiantamento** não bloqueiam nesta fatia (open-gap). Medido em PRD (leitura somente leitura, 2026-10-20): `tpd_cod` nulo em **100%** dos **1.277** títulos ativos e não pagos — o `fin064` não devolve o tipo; por isso a ingestão passa a ler o tipo no `com298/list` e gravá-lo (`tpd_cod`, `tpd_des_nome`; UPSERT preserva o último valor quando a rodada não o traz). |
| **I19e** | **`VENCIDO`:** vencimento anterior ao **dia civil de hoje em Brasília** (ADR-0070): **vence hoje não é vencido**. Mesmo cálculo de `diasAteVencimento < 0` do painel. |
| **I19f** | **`FORMA_NAO_SISPAG`:** `formaPagamentoConexos ∈ {1 cheque, 4 extra-caixa, 5 cartão de crédito, 7 caixa}` (`titVldPagopor`, `FORMA_CONEXOS_ROTULO`). **Não** bloqueiam: 2 TEF, 3 carteira, 6 boleto, 8 transação, 9 documento, 10 transação automática, nem forma **ausente** (título fora do grid de pendentes). O código de TED não está confirmado: **não se deduz**. A lista é config do tenant e revisável. |
| **I19g** | **`DUPLICIDADE` e `RETIDO_CODBAR`:** existe `BloqueioDuplicidade` **ATIVO** (ADR-0063 I13g; ADR-0069 emenda 1 I16g) para o título. `DUPLICIDADE` = origem `DUPLICIDADE_TITULO`; `RETIDO_CODBAR` = uma das origens de retenção (`ORIGENS_RETENCAO_CODIGO_BARRAS`: `CODIGO_BARRAS_REPETIDO`, `CODIGO_BARRAS_ILEGIVEL`, `VINCULO_CODIGO_BARRAS_FALHOU`). `detalhe` pode citar o documento da contraparte. |
| **I19h** | **`AJUSTE_CENTAVOS_PENDENTE`:** o **último** ledger de ajuste do título (`sispag_ajuste_centavos_execucao`, ADR-0074 I18h) está em etapa **não terminal** ou em `indeterminado` / `aguardando_aprovacao_manual`. Etapas `concluido`, `concluido_sem_decisao`, `cancelado`, `recusado` e `simulado` não bloqueiam. |
| **I19i** | **`CONFIRMACAO_A_REVISAR`:** o desfecho do título no `BoletoSuggestionService` é `ORFA` (I15l: o ERP sinalizou o título depois da confirmação). `detalhe` = `motivoOrfa`. |
| **I19j** | **`BOLETO_SEM_DDA`:** `formaPagamentoConexos = 6` (BOLETO) e `temBoleto ≠ true`, **exceto** se há decisão `CONFIRMADA` para o título **e** o modo do vínculo do código de barras da filial é `on` (`ModoVinculoCodigoBarras.resolverModo`): então o código é vinculado no `.REM` (ADR-0071, I17) e o título é `PRONTO`. Confirmado com o modo `off`/`shadow` continua `BOLETO_SEM_DDA` com `detalhe` = "confirmado, aguardando vínculo no Conexos". **Dono sempre `VOCE`**, com ou sem candidato: a analista verifica (não existe dono "aguardar DDA"). Forma diferente de BOLETO não depende de DDA. |

Escopo, falha e aplicação (I19k–p):

| # | Invariante |
|---|------------|
| **I19k** | **Fora desta fatia (D10).** TED/PIX sem conta/chave no cadastro (`SEM_DESTINO`) e favorecido não autorizado (`FAVORECIDO_NAO_AUTORIZADO`, I13/I14) só se conhecem dentro do lote, por leitura ao vivo do `cmn025`. O título TED/PIX conta como `PRONTO` até existir essa verificação no carregamento da carteira; a verificação do lote (I13/I14) continua valendo e retira o item ao finalizar. |
| **I19l** | **Falha de fonte nunca é silêncio.** O cálculo consulta fontes de contexto (`DUPLICIDADE`, `AJUSTE_CENTAVOS`, `BOLETO`; `FONTE_SITUACAO`). Se uma falha, **os motivos dessa fonte não se aplicam**, a fonte entra em `ResumoSituacao.fontesIndisponiveis`, a tela avisa "situação incompleta" e as guardas existentes na inclusão (ex.: `DuplicateHoldError`) e na remessa continuam barrando. Um erro de leitura não derruba o painel. |
| **I19m** | **A mesma função na tela, na inclusão e no cron.** (1) `SispagPainelService.montarPainel` preenche `situacaoPagamento` em cada título e `resumoSituacao`. (2) `incluirTitulo` (L2) recusa título `BLOQUEADO` com `TituloNaoElegivelError` (HTTP 422) carregando o `motivo` principal e a mensagem do rótulo; `ALCADA`/`ja-pago` mantêm a checagem **ao vivo** do `fin064` (a persistida pode estar velha). (3) A formação automática (`formarLotesAutomaticos`, L1) só inclui títulos `PRONTO`; o desfazer-vencidos (L6) continua valendo. |
| **I19n** | **Valor derivado, nunca persistido.** `situacaoPagamento` e `resumoSituacao` são calculados a cada painel; só o **nome do tipo** (`tpd_des_nome`) é gravado. Nenhuma coluna guarda "estado". |
| **I19o** | **Resumo sobre a carteira inteira.** `ResumoSituacao` (`porEstado`, `porMotivo`, `porDono`: `{qtd, valor}`) é calculado sobre **todos** os títulos ativos, não sobre o corte `TITULOS_CAP`. Alimenta os cards, o filtro `Todos \| Prontos \| Bloqueados` e os chips de motivo. |
| **I19p** | **Um lote por filial (`POST /sispag/lotes/por-filial`).** Recebe chaves de títulos, agrupa por `filCod`, cria **um lote por filial** (L1) incluindo cada título pela mesma regra de L2 (I19m), e devolve **um resultado por lote** (`CRIADO`, `PARCIAL` ou `RECUSADO`, com `incluidos` e `recusados` por título, cada recusa com `codigo`, `motivo` e `mensagem`). **Um lote que falha não desfaz os outros.** Lote sem nenhum título incluído não é deixado vazio (descartado, como em `useCriarLoteManual`). |

## Evidência

- Medição PRD, somente leitura, 2026-10-20: 1.277 títulos ativos e não pagos, 0 com `tpd_cod` (1.262 aprovados, todos sem tipo).
- Medição PRD de 2026-10-13 (registrada na memória do projeto `sispag-carteira-traz-tipos-permuta-e-adiantamento`, sem arquivo no repositório): 218 títulos `tpdCod 157` "RECIBO/BOLETO/FATURA - (PERMUTA)" e 1 `156` "NOTA FISCAL (PERMUTA)" liberados na carteira; o `fin064` não devolve `tpdCod`, `tpdDesNome` nem `docVldTipoAdto`; o nome vem do `com298/list` por `filCod+docCod`.
- `ConexosSispagClient.ts` (comentários de `numOpt` e do `prontoParaRemessa` tri-estado): o selo "falta cadastro?" nunca chegou a aparecer em produção (o diagnóstico que o comentário cita, `sispag-remessa-ground-truth-followups.md`, não está neste repositório).
- Códigos de `titVldPagopor`: `src/frontend/lib/sispag.ts` (`FORMA_CONEXOS_ROTULO`), com paridade testada contra o backend.

## Teste canônico (a escrever no TDD)

`has_canonical_test: false`. Casos de tabela, um por invariante:

1. Título liberado, não vencido, boleto com DDA, sem bloqueios → `PRONTO`, `motivos = []`.
2. `liberado = false` → `BLOQUEADO`, principal `ALCADA`, dono `APROVADOR`.
3. `tpdDesNome = 'RECIBO/BOLETO/FATURA - (PERMUTA)'` → `TIPO_PERMUTA`; `'recibo ... (permuta)'` e sem acento igual; sem tipo → não bloqueia.
4. Vence hoje → não vencido; vence ontem → `VENCIDO`.
5. `formaPagamentoConexos` 1, 4, 5, 7 → `FORMA_NAO_SISPAG`; 2, 3, 6, 8, 9, 10 e ausente → não bloqueia.
6. Vários motivos (alçada + vencido + sem DDA) → `motivos` na ordem de I19b, `principal = ALCADA`.
7. Boleto sem DDA + `CONFIRMADA` + modo `on` → `PRONTO`; com modo `off` → `BOLETO_SEM_DDA` "aguardando vínculo".
8. Ajuste em `indeterminado` → `AJUSTE_CENTAVOS_PENDENTE`; em `concluido` → não bloqueia.
9. Fonte de duplicidade falha → título sai sem `DUPLICIDADE`, `fontesIndisponiveis = ['DUPLICIDADE']`.
10. `incluirTitulo` com título `BLOQUEADO` → 422 com o motivo; `formarLotesAutomaticos` não inclui `BLOQUEADO`.
11. `por-filial` com 3 filiais, uma recusada → 2 `CRIADO` + 1 `RECUSADO`, os dois lotes existem.
12. `resumoSituacao`: soma de `porMotivo` = `porEstado.BLOQUEADO`, sobre a carteira inteira mesmo com `truncado`.

## Universalidade

Universal: o contas-a-pagar não deve oferecer ao pagamento o que não pode ser pago, e deve dizer **por
quê e a quem recorrer**. A estrutura (valor derivado único, aplicado na tela e na porta do lote) é do
domínio; a **lista de motivos**, os **códigos de forma** que bloqueiam e o **marcador de permuta no nome
do tipo** são específicos da Columbia/Conexos e revisáveis.

## Ver também

- [`elegibilidade-titulo-lote`](elegibilidade-titulo-lote.md) — I2, ampliada pela ADR-0075.
- [`sugestao-boleto-dda-sispag`](sugestao-boleto-dda-sispag.md) — desfecho do título (I15m), `ORFA` (I15l).
- [`vinculo-codbar-item-sispag`](vinculo-codbar-item-sispag.md) — modo do vínculo (I17) e a guarda do `.REM`.
- [`ajuste-centavos-titulo-sispag`](ajuste-centavos-titulo-sispag.md) — ledger do ajuste (I18).
- [`nao-duplicacao-titulo-lote`](nao-duplicacao-titulo-lote.md) e [`lote-uma-filial`](lote-uma-filial.md) — I3 e I4, que a criação por filial respeita.
- [ADR-0075](../decisions/0075-sispag-situacao-de-pagamento-do-titulo.md) e [ADR-0070](../decisions/0070-sispag-vencido-por-dia-civil.md).
