---
name: exporPainelAprovacoes
type: action
entity: TituloAprovacao
ontology_version: "0.10"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/aprovacoes/AprovacoesPainelService.ts
  - src/backend/domain/service/aprovacoes/DuracaoCalculator.ts
  - src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts
  - src/backend/domain/repository/aprovacoes/EtapaAprovacaoRepository.ts
  - src/backend/domain/interface/aprovacoes/ports.ts
  - src/backend/routes/aprovacoes.ts
  - src/backend/http/aprovacoesGate.ts
  - src/backend/http/filialAuthz.ts
  - src/frontend/lib/aprovacoes.ts
  - src/frontend/app/aprovacoes/page.tsx
  - src/frontend/app/aprovacoes/components/status-badges.tsx
last_review: 2026-08-19
preconditions:
  - "Requisição autenticada; `aprovacoesEnabled` ligado — o `aprovacoesGate` responde 403 em todo `/aprovacoes/*` quando a frente está desligada."
  - "Escopo de filiais resolvido: allow-list do JWT quando provisionada, senão todas as filiais do ERP (`ConexosCadastroClient.listFiliais`)."
  - "Ingestão já executada ao menos uma vez — o painel lê o snapshot local, nunca o ERP ao vivo."
postconditions:
  - "Devolve uma PÁGINA do grid (`items`, `page`, `pageSize`, `total`) com todos os derivados já calculados no servidor."
  - "Devolve `snapshotEm` = `MAX(observado_em)` da tabela — a idade do dado, obrigatória na tela (I7)."
  - "Nenhuma escrita: nem no ERP, nem no Postgres."
side_effects:
  - "Duas consultas por página: a listagem filtrada/paginada em SQL e UMA consulta em lote para as trilhas de toda a página (`listByTitulos`), mais uma para o `MAX(observado_em)`."
  - "`filCod` explícito fora da allow-list lança `FilialForbiddenError` → HTTP 403."
  - "`pageSize` acima de 100 é recusado no boundary por Zod (400), não capado silenciosamente."
---

# exporPainelAprovacoes — o grid da Frente V

> **Vigência:** 2026-08-19 (ADR-0038, fatia F2). `GET /aprovacoes` devolve uma página do painel de
> trilhas de aprovação. Leitura pura sobre o snapshot local: **nenhuma chamada ao ERP acontece neste
> caminho**. O que o analista vê é o que a última ingestão observou, e a tela é obrigada a dizer
> quando isso foi.

## Superfície

```
GET /aprovacoes
  ?page=1&pageSize=25
  &filCod=2
  &status=AGUARDANDO|APROVADO|REJEITADO|INDETERMINADO|SEM_WORKFLOW
  &fornecedorCod=…&responsavel=…&emissaoDe=…&emissaoAte=…&busca=…
```

Tudo validado por Zod no boundary. `pageSize` tem teto **100** (default 25): sem teto,
`?pageSize=100000` viraria uma varredura da tabela inteira num único request.

Resposta: `{ items: AprovacaoListItem[], page, pageSize, total, snapshotEm }`.

## Paginação e filtro são do SERVIDOR — e isso é decisão de contrato

O `useTabelaFiltro` compartilhado (`app/permutas/components/tabela-filtro.tsx`) recebe a lista inteira
e faz `filter(...)` + `slice(...)` **em memória**. Serve às frentes cujas listas cabem no cliente;
**não serve à Frente V**, que tem 23.632 títulos só na filial 2 em 12 meses.

Aqui, filtro e paginação são resolvidos **em SQL** pelo repository. Filtrar em memória *depois* de
paginar devolveria páginas com buracos — a página 1 traria 25 linhas das quais 6 sobrevivem ao filtro,
e o analista concluiria que existem 6 títulos aguardando quando existem centenas.

O frontend reusa `FiltroBarra` e `Paginacao` como **componentes visuais** alimentados por um objeto
montado a partir da resposta: consistência visual sem herdar a premissa errada.

## Todo derivado nasce no backend

`statusWorkflow`, `etapasAbertas`, `etapaAtual`, `paradaHaSegundos`, `tempoTotalSegundos` e `lacunas`
chegam prontos ao frontend, que **só formata** (`4h 32m` em vez de `16320`).

Não é preferência de estilo. `paradaHaSegundos` e `tempoTotalSegundos` dependem do **instante da
leitura**; calculados no browser, divergiriam do que o servidor afirma, e um painel financeiro
auditável não pode ter duas versões do mesmo número circulando. A UI escolhe **formato**, nunca valor.

Pelo mesmo motivo, `agora` é **parâmetro** de `listar(filtro, agora)` e não um `new Date()` embutido:
sem injetá-lo, "parada há" e "tempo total" não seriam testáveis de forma determinística.

### `tempoTotalSegundos` é recalculado, não reaproveitado

O valor persistido em `aprovacao_titulo.tempo_total_segundos` congelou no instante da ingestão. Para
um título ainda `AGUARDANDO`, o relógio **não parou** — exibir o número gravado faria o painel
envelhecer em silêncio, mostrando "parado há 3h" numa segunda-feira sobre um dado de sexta.

## `etapaAtual` é determinística — e o desempate não é detalhe

`etapaAtual` = a etapa `PENDENTE` com `recebidoEm` mais antigo; empate resolvido pelo **menor
`fblCod`** e, ainda empatado, pelo **menor `ftbCod`**. Etapa sem `recebidoEm` vai para o fim — não dá
para afirmar que espera há mais tempo que uma datada.

Sem critério **total**, duas execuções da mesma consulta poderiam devolver aprovadores diferentes para
o mesmo título. A fila "mudaria sozinha" aos olhos do analista, e um painel cuja resposta oscila sem
que nada tenha acontecido perde a confiança de quem o usa — que é o único ativo que ele tem.

`etapasAbertas` acompanha o campo para a UI poder dizer **`CONTROLLER +2`** em vez de fingir que só
existe uma etapa pendente. Se a simultaneidade de etapas for confirmada em produção, migrar para uma
lista de etapas atuais vira **adição**, não correção
(ver `_inbox/frente-v-contrato-reconciliacao.md` §1.1).

## Uma consulta para as trilhas da página inteira

`listByTitulos` traz as trilhas de todas as linhas da página numa única consulta, agrupadas por
`filCod:docCod:titCod`.

A forma óbvia — um `listByTitulo` por linha dentro de um `Promise.all` — dispararia até `pageSize`
consultas concorrentes a cada carregamento e, com poucos analistas simultâneos, esgotaria o pool de
conexões do Postgres. **O custo de uma página não deve crescer com o número de linhas dela.**

## Escopo de filial

- Allow-list do JWT quando provisionada (`filiaisPermitidas`).
- **Fallback:** todas as filiais do ERP. Existe porque o JWT de hoje ainda não carrega a claim
  `filiais`; sem o fallback, **todo** usuário veria um painel vazio. Quando a claim for provisionada,
  ela passa a mandar sem edição de rota. Premissa registrada em **PV-09**.
- `filCod` explícito **fora** da allow-list é **403**, não lista vazia: negar em silêncio faria o
  analista concluir que a filial não tem títulos.

## O que o painel deliberadamente NÃO faz

| Não faz | Por quê |
|---------|---------|
| Aprovar, liberar ou reprovar título | ADR-0038 D2: read-only absoluto. Nenhum caminho desta ação toca o ERP |
| Preencher `dataFinalizacao` com `dataEmissao` | O cliente ancorou o aceite em *"o documento foi finalizado às 10:00"*. Substituir esse marco produziria um número que **parece** o combinado sem ser. O campo fica ausente, a lacuna `SEM_DATA_FINALIZACAO` explica, e a coluna da tela é rotulada **"Emissão"** — outro dado, honestamente nomeado (**PV-04**) |
| Estimar duração de etapa pendente | Invariante I3. "Parada há X" é campo distinto e não entra em média alguma |
| Esconder `INDETERMINADO` | É estado de primeira classe, com a lacuna visível ao lado. Hoje são 13 etapas reais (**PV-01**) |
| Buscar no ERP ao vivo | Uma chamada por título tornaria o painel inutilizável — segundos por linha — e é justamente o que a persistência existe para evitar |

## Segurança / consistência

- `aprovacoesGate` responde **403** em todo `/aprovacoes/*` quando a frente está desligada — o
  backend nega a API direta, não só a navegação.
- Zod em toda a query; `status` é validado contra as constantes de `STATUS_WORKFLOW`, não contra
  string livre.
- Leitura pura: nenhuma escrita, em lugar nenhum.
- `snapshotEm` é **obrigatório na tela** (invariante I7). Um painel de snapshot sem idade visível é um
  painel que mente por omissão sempre que a ingestão atrasa.

## Por que está na ontologia (universalidade)

Universal: expor a fila de aprovação com **quem está segurando** e **há quanto tempo** é o produto da
frente — o gargalo declarado pelo cliente é falta de visibilidade agregada. A estrutura (projeção
paginada no servidor, derivados calculados num único lugar, escolha determinística da etapa corrente,
idade do snapshot obrigatória, lacunas explícitas) é do domínio. Configuração do tenant: colunas
exibidas, tamanho de página, filtros oferecidos.
