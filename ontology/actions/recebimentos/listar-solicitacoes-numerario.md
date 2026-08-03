---
name: listarSolicitacoesNumerario
type: action
entity: SolicitacaoNumerario
ontology_version: "0.13"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/routes/recebimentos.ts
  - src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx
last_review: 2026-08-03
preconditions:
  - "Processo (priCod) selecionado na alocação de um pagamento; filial autorizada (assertUserCanActOnFilial, filial do processo)."
  - "READ-only: nenhuma escrita; NÃO gated por CONEXOS_WRITE_ENABLED (é leitura, não escrita)."
postconditions:
  - "Retorna 0..N SNs do processo, cada uma projetada em { docCod, numero, data, descricao, status, solicitado }, mais o valor do documento."
  - "A UI oferece as SNs listadas + a opção 'Criar novo SN'; 'Processar' fica gated na seleção (feeds o ramo 'SN existente' de gerarSolicitacaoNumerario)."
side_effects:
  - "Nenhum — leitura pura no Conexos (POST /api/com299/list; sem POST de escrita, sem trilha write-ahead)."
---

# listarSolicitacoesNumerario — listar as SNs existentes de um processo (READ)

> **Vigência:** v0.13 (2026-08-03, ADR-0027). Antes de "Processar" uma alocação, a analista pode
> **reutilizar** uma Solicitação de Numerário **já existente** do processo em vez de sempre mintar uma
> nova. Esta ação é a **leitura** que popula essa escolha. Alimenta o ramo "SN existente" de
> `gerarSolicitacaoNumerario` (`actions/recebimentos/gerar-solicitacao-numerario.md`). READ-only —
> nenhuma escrita no ERP.

## Contrato de leitura (HAR-confirmado 2026-08-03)

`POST /api/com299/list` (mesma família/host do com299 de escrita), corpo:

```
filterList = {
  "priCod#EQ": <priCod>,
  "docVldTipo#EQ": 9,
  "docVldTipoAdto#EQ": 1,
  "vldStatus#IN": ["1", "3"]
}
```

ordenado por `docCod` **desc**, **paginado**. Envelope de resposta: `{ count, pageNumber, rows: [...] }`.

- **Discriminador SN:** `docVldTipo=9` **E** `docVldTipoAdto=1`. Uma NC/ND no **mesmo** processo é
  `docVldTipoAdto=0` — por isso **excluída** da lista (senão a analista poderia baixar contra uma nota,
  não contra uma SN).
- **Campos por linha (`rows[]`) usados na projeção:** `docCod` (handle da seleção), `docEspNumero`
  (`numero` de exibição, ex.: "26.0141"), `docDtaEmissao` (`data`, epoch ms), `tpdDesNome`/`gcdDesNome`
  (`descricao`, ex.: "Frete internacional"), `vldStatus` (1/3 → rótulo de status), `mnyBruto`
  (`solicitado`), `docMnyValor` (valor do documento).

## ⚠️ Saldo NÃO vem desta leitura

`com299/list` é **document-level**. O **saldo remanescente por-título** — o "Saldo" do mockup e o
**teto do I-Receb-3** — **não** está nesta resposta. Ele vem da leitura do título
(`lov/TituloBorderoReceber`) que a **baixa `fin014` já executa**. A lista exibe o **valor do documento**
(`mnyBruto`/`docMnyValor`); o **enforcement** do teto ≤ saldo é a baixa/título, não o valor da lista.
Ver `business-rules/alocacao-sn-existente.md` e `integrations/conexos-com299-gerdoc.md`.

## Por que está na ontologia (universalidade)

Universal: em qualquer contas-a-receber de comex com encomenda, uma requisição de numerário (SN) de um
processo pode já existir — **listar e reutilizar** o documento existente antes de mintar um novo é a
alternativa recorrente à criação sempre-nova. A **estrutura** (listar as SNs de um processo, discriminar
SN de NC/ND, oferecer "existente × nova", deixar o humano confirmar) é do domínio; o **endpoint/filtros
concretos** (`com299/list`, `docVldTipo=9`, `docVldTipoAdto=1`) e os **códigos** (`gcdCod`) são
instância/config do tenant. Ver ADR-0027.
