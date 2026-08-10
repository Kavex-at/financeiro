---
name: transferencia-interna-nao-e-recebivel
type: business-rule
entity: TransacaoBancaria
ontology_version: "0.21"
implementation_status: implemented
status: stable
owners: [yuri]
related_files:
  - src/backend/domain/service/recebimentos/normalizarLancamento.ts
  - src/backend/domain/service/recebimentos/IngestaoTransacoesService.ts
  - src/backend/domain/service/recebimentos/RecebimentosPainelService.ts
  - src/backend/domain/repository/recebimentos/TransacaoRepository.ts
  - src/backend/migrations/0045_transacao_bancaria_transferencia_interna.sql
  - src/frontend/app/recebimentos/page.tsx
last_review: 2026-08-10
has_canonical_test: true
---

# Regra: transferencia-interna-nao-e-recebivel

> Um crédito do extrato cujo **remetente é a própria casa** é **transferência entre contas do
> grupo**, não recebimento de cliente. Ele sai da carteira do analista (escondido, nunca apagado),
> pelo mesmo botão que já esconde o ruído de tesouraria.

## Origem

Report do analista (2026-08-10), duas queixas que pareciam distintas e tinham a mesma raiz:

1. *"uma transação que eu paguei está vindo como recebida"*;
2. *"esses valores não estão no extrato"*.

Sondagem read-only no `fin095` de produção (contas 212 e 213, janela 05–09/08/2026) mostrou que
**nenhuma das duas era bug de sinal**. As três linhas reportadas:

| Valor | Data | Conta | `exiVldTipo` | Categoria | Histórico | `exiEspNrdocto` |
|---|---|---|---|---|---|---|
| 830.000,00 | 07/08 | 212 (BB ag 1913) | 2 = crédito | 209 | `TED-CRED CONTA` | `000000100463942` |
| 368.000,00 | 07/08 | 213 (Bradesco ag 2372) | 2 = crédito | 209 | `PIX RECEBIDO` | `1224537REM: COLUMBIA TRADING S/A  07/0` |
| 240.000,00 | 06/08 | 212 (BB ag 1913) | 2 = crédito | 209 | `TED-CRED CONTA` | `000000100460627` |

A semântica `exiVldTipo` 1 = débito / 2 = crédito foi **reconfirmada** na mesma amostra (débitos:
AFRMM, TARIFA, CÂMBIO; créditos: TED/PIX recebido, resgate de aplicação). O mapeamento do código
estava correto. O que existia era outra coisa:

- o `REM:` do `exiEspNrdocto` denunciava **COLUMBIA TRADING S/A** como remetente — a perna de
  crédito de uma transferência entre contas da casa. A ingestão só puxa `exiVldTipo = 2`, então a
  perna de débito nunca entra para fechar o par, e o analista lê "recebi" o que ele pagou;
- as linhas eram de **contas diferentes** daquela cujo extrato o analista conferia, e a tabela
  não tinha coluna de conta (desde o ADR-0032 a transação é corporativa e o painel funde ~20 contas).

## Enunciado

```
categoria == '209' ∧ remetente(nrdocto) ∈ titularesInternos  ⇒  transferenciaInterna = TRUE
                                                                (fora da carteira por default)

categoria == '209' ∧ remetente identificado ∉ titularesInternos  ⇒  FALSE   # PIX/TED de cliente
categoria == '209' ∧ remetente NÃO identificável                 ⇒  FALSE   # fail-open deliberado
categoria != '209'                                                ⇒  FALSE
titularesInternos vazio                                           ⇒  FALSE  # detecção desligada
```

`titularesInternos` vem de `RECEBIMENTO_TITULARES_INTERNOS` (CSV; default `COLUMBIA TRADING`).
Comparação é *case/acento-insensitive*, por `includes` — `REM: COLUMBIA TRADING S/A` casa com
`COLUMBIA TRADING`.

## Por que uma coluna, e não uma entrada em `CATEGORIAS_TESOURARIA`

**A categoria 209 não é ruído por si só.** Recebimento de cliente por PIX/TED cai exatamente nela —
medidos na conta 212 na mesma semana: PIX de R$ 20.000 / 50.000 / 30.000. Excluir a categoria inteira
esconderia recebível de verdade. O discriminador é o **remetente**, que é por-linha; daí a coluna
`transacao_bancaria.transferencia_interna` em vez de uma constante de categoria.

## Por que `FALSE` quando o remetente é desconhecido

`TED-CRED CONTA` não diz quem enviou. Esconder às cegas todo crédito 209 sem remetente esconderia
recebíveis. **O custo de errar para o lado de ocultar é maior que o de deixar ruído na fila** — o
analista consegue ignorar uma linha a mais, mas não consegue conciliar uma linha que ele não vê.
Consequência aceita: as duas linhas `TED-CRED CONTA` do report continuam na carteira até o banco
informar remetente (ou até uma regra futura casar as duas pernas do movimento).

## Efeitos colaterais corrigidos junto

- **Contraparte deixou de ser lixo.** `extrairContraparte` cortava o prefixo de canal e devolvia o
  resto: `"PIX RECEBIDO"` virava a contraparte **"RECEBIDO"** e `"TED-CRED CONTA"` virava `"—"`.
  Agora o remetente do `nrdocto` tem precedência sobre o histórico, e resíduos de status
  (`RECEBIDO`, `ENVIADA`, `CONTA`, …) devolvem `undefined` em vez de virarem nome de pagador.
- **Coluna "Conta" na tabela**, com o `gerDes` do `fin133`, no lugar da coluna "Tipo" — que era
  constante (`CREDITO` em toda linha, porque `RecebimentosPainelService` filtra `tipos: [CREDITO]`)
  e portanto nunca informou nada.

## Teste canônico

`src/backend/domain/service/recebimentos/normalizarLancamento.test.ts` —
`describe('normalizarLancamento — transferência entre contas da casa')`, construído sobre a linha
real de R$ 368.000,00 da conta 213.

## Backfill

A migration `0045` reclassifica as linhas já ingeridas a partir do `raw_payload` persistido
(`exiEspNrdocto ~* 'REM\s*:.*COLUMBIA\s+TRADING'`) — sem isso a carteira atual continuaria mostrando
as transferências internas até que cada linha fosse reingerida.
