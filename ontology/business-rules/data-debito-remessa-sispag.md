---
name: data-debito-remessa-sispag
type: business-rule
entity: LotePagamento
invariant: I8
ontology_version: "0.27.0"
implementation_status: planned
status: active
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/RemessaService.ts
  - src/backend/domain/client/ConexosSispagWriteClient.ts
  - src/backend/domain/repository/sispag/LotePagamentoRepository.ts
  - src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts
  - src/frontend/app/sispag/components/LoteCard.tsx
last_review: 2026-09-22
has_canonical_test: false
---

# Business Rule — data de débito da remessa SISPAG (I8)

> **Origem:** pedido da Flavia (financeiro da Columbia), 2026-09-22 — *"a data de pagamento é sempre
> hoje; para testes e para muitos casos reais preciso escolher amanhã ou outra data"*. **Reverte a
> resposta A5** (`_inbox/sispag-fin015-exploration.md:227`, "data de débito = HOJE, SEMPRE, sem
> agendamento"). Hoje continua sendo o **default**; o que deixa de existir é o "sempre". ADR-0049.

## A regra

```
janela(lote) = [ hoje_BRT , min(itsDtaPgto dos itens) ]  ∩  diasUteisBancarios

I8a   dataDebito ∈ janela(lote)                     — senão: bloqueia, antes de qualquer escrita
I8b   existe lote nativo fin015 criado com dataDebito  ⇒  dataDebito é imutável
```

- **`hoje_BRT`** — a data civil em `America/Sao_Paulo`. **Nunca** meia-noite UTC: com UTC, das 21h às
  24h de Brasília "hoje" já é amanhã, e a data enviada ao `fin015` salta um dia (bug do `hojeUtc()`
  corrigido por esta regra). O fuso é do **domínio**, não do tenant: o sistema de pagamentos brasileiro
  (SPB, compensação, janelas de TED/boleto) opera no horário de Brasília, então nenhum cliente
  brasileiro teria outro valor aqui.
- **Limite inferior = R1 do ERP** ("A DATA DE DÉBITO NÃO PODE SER MENOR QUE A DATA DE HOJE").
- **Limite superior = R2 do ERP** ("EXISTEM TÍTULOS QUE IRÃO VENCER ANTES DA DATA DE PAGAMENTO DESTE
  LOTE"), que compara com o **`itsDtaPgto` do item** — snapshot de `titDtaVencimento` gravado no import
  (`_inbox/sispag-fin015-ida-provada-hml.md:77`), não o vencimento vivo do título nem o
  `ItemLote.vencimento` local. Antes do import o `itsDtaPgto` ainda não existe, e a janela
  mostrada à analista usa o vencimento conhecido naquele momento (snapshot do `ItemLote` ou leitura ao
  vivo — escolha de implementação, fica com o TaskScoper). Se o vencimento mudou no ERP depois da
  inclusão, quem decide é o `finalizarLote`.
- **Dias úteis bancários** — regra **nossa**, não do ERP (o `fin015` aceita sábado). Ver o calendário
  abaixo.

## Por que bloquear, e não corrigir

Uma data depois do menor vencimento **não** tira títulos do lote automaticamente. Remover um título
em silêncio é decidir, pela analista, que aquele fornecedor não será pago naquele lote — e ele
simplesmente sumiria da remessa. A tela mostra a janela e **nomeia o título que define o limite**; para
usar uma data posterior, a analista reabre o lote (L4) e retira esse título. Decisão da analista, com
rastro (`removerTitulo`).

**Janela vazia** — menor vencimento antes de hoje, ou nenhum dia útil entre hoje e ele (ex.: título
vence no sábado e hoje é sábado) — torna a remessa **impossível** até o lote ser editado. É o mesmo
catch-22 que o ERP já impõe (título vencido não finaliza), só que avisado antes de escrever.

## Por que congelar (I8b)

A data vai no `criarLote` (`flpDtaCredito`) e fica no lote nativo. As escritas do `fin015` não são
idempotentes, e a retomada (ADR-0039) **reaproveita** o lote nativo que já existe — ela não cria outro.
Logo, depois do `criarLote`, mudar a data local não mudaria nada no ERP: só criaria um lote local
dizendo uma coisa e o nativo outra. Além disso a `dataDebito` compõe a **assinatura da marca d'água**
que reconhece um lote órfão (`retomada-remessa-sispag.md`); se mudasse entre tentativas, o órfão ficaria
irreconhecível.

Ordem obrigatória (estende o write-ahead da retomada):

1. Validar `dataDebito` contra I8a — **antes** de qualquer escrita. Falha = erro de negócio (4xx),
   ledger intocado.
2. Persistir `LotePagamento.dataDebito` junto da marca d'água, **antes** do `criarLote`.
3. Retry/retomada com lote nativo existente: usa a data persistida; um valor diferente vindo da tela é
   **recusado** (não ignorado em silêncio).

**Quando a data volta a ser escolhível:** só se aquele lote nativo deixar de existir — cancelado no
`fin015` e confirmado pela analista no fluxo do `LoteAnteriorCanceladoError`. A tentativa seguinte cria
um lote nativo novo, e com ele uma nova escolha.

**Caso que a regra não resolve sozinha — data congelada que o tempo ultrapassou.** Lote nativo criado
para hoje, queda antes do `finalizarLote`, retomada amanhã: a data congelada agora é passado e o ERP
recusa (R1). A retomada **não** reescreve a data do lote nativo (seria uma escrita nova no ERP fora
deste escopo); o erro do `finalizarLote` chega à analista, que cancela o lote nativo no `fin015` e segue
pelo caminho acima. Fail-closed, com saída conhecida.

## Calendário de dias úteis bancários

**Dia útil bancário** = não é sábado nem domingo **e** não é feriado bancário nacional. Calculado em
código, sem tabela e sem serviço externo:

| Tipo | Datas |
|---|---|
| Fixos nacionais | 01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, **20/11 (desde 2024, Lei 14.759/2023)**, 25/12 |
| Móveis (derivados da Páscoa) | Carnaval segunda e terça (Páscoa −48 / −47), Sexta-feira Santa (Páscoa −2), Corpus Christi (Páscoa +60) |

Carnaval e Corpus Christi não são feriados nacionais em lei, mas **não há expediente bancário** — é o
calendário que importa para débito. A Quarta-feira de Cinzas é dia útil (expediente a partir do
meio-dia).

**O backend é a fonte única.** Ele calcula e expõe à tela a janela já recortada (dias permitidos /
não úteis). O frontend não reimplementa o calendário — duas implementações de Páscoa divergem no
primeiro ano em que alguém erra uma.

"Amanhã" na tela = **próximo dia útil** depois de hoje. Se hoje não é dia útil (sábado), o default é o
primeiro dia útil da janela.

### Onde o calendário mora: ontologia × configuração

- **Ontologia (esta regra):** o **conceito** de dia útil bancário e o conjunto **nacional** — é
  regulatório, igual para toda trading brasileira, estável por anos (A1/A2/A3 = sim; Filtro C = sim).
  Não é entidade: não tem identidade nem ciclo de vida, é uma função sobre datas (propriedade antes de
  entidade, entidade existente antes de nova).
- **Configuração (fora desta entrega):** feriados **municipais/estaduais** e dias sem expediente
  específicos de praça. Esses dependem da cidade da filial ou da agência, então são **valor de cliente**
  — se entrarem, entram como configuração por tenant/filial, não aqui. Hoje: **fora de escopo**
  (REJECT-PREMATURE, `_inbox/_watchlist.md`), pergunta aberta em `_inbox/sispag-data-pagamento-gap.md`.

## O que esta regra NÃO é

- **Não é agendamento de envio.** A data é a do débito dentro do lote; o arquivo continua gerado quando
  a analista pede, e o transporte ao banco continua externo e manual (`REMESSA_GERADA ≠ ENVIADO`). Se
  uma data futura exige mandar o arquivo no dia do débito, é pergunta aberta (gap), não regra.
- **Não é estado.** Um lote com débito futuro não é `AGENDADO`: é `REMESSA_GERADA` com uma
  `dataDebito` posterior a hoje. A data é propriedade do lote (Filtro E).
- **Não muda a formação automática.** `formarLotesAutomaticos` continua agrupando por filial e
  a-vencer ≤7d; a data só é escolhida no pedido de remessa.

## Verificação (a implementar)

- Unitário: calendário (fixos, 20/11 antes/depois de 2024, Páscoa de anos conhecidos), janela
  (vazia, limite num sábado, hoje não útil), fuso (23h de Brasília = mesmo dia), I8b (retry com data
  diferente recusado; retry usa a persistida).
- Ao vivo em HML: remessa com débito em D+1 útil finaliza no `fin015`; data > menor vencimento é
  recusada **por nós**, antes do ERP.
