---
adr_number: 0025
title: O título a receber da SN nasce na geração do com299; a condição de pagamento passa a ser CONDICIONAL (só sob validação bloqueante da com194), aplicada DEPOIS da linha de item e sempre VERIFICADA (mnyTitValor === docMnyValor) — fail-closed
date: 2026-08-03
status: accepted
type: correction
related_entities: [SolicitacaoNumerario, Recebimento]
related_actions: [gerarSolicitacaoNumerario]
related_integrations: [conexos-com299-gerdoc]
supersedes_decisions: []
amends_decisions: [0022, 0024]
---

# ADR 0025: o passo da condição de pagamento da SN é condicional e verificado (fail-closed)

**Cliente:** Columbia Trading · **Entrega:** Kavex (created by Clonex) · **Branch:**
`fix/sn-titulo-condicao-fail-closed` (worktree). **Fonte:** medições reais no Conexos de **homologação**
em 2026-08-03 (SKYJACK, `pesCod` 232, `priCod` 186, filial 2, R$ 123,45; documentos 732–737), registradas
em `docs/e2e/gap-titulos-diagnostico.md` e exercitadas por `recebimentos.e2e.hmlTitulo*`.
**`entity_changed = true`** — a **sequência** documentada da SN muda e uma afirmação de contrato é
**invalidada**. Nenhuma entidade, ação, regra de negócio ou state-machine nova.

## Contexto

A trilha de recebimentos completa a SN (`com299`) antes de finalizá-la. Até aqui a ordem era: **(1)** PUT
da condição de pagamento do cadastro da pessoa (`lov/CondPgtoPessoa` → `PUT com299` com `vldRwCondpgt: 1`)
e **(2)** linha de item (`comDocProdutos`). O diagnóstico anterior
(`docs/e2e/fase-b-rodada2-e-gap-titulos.md`) concluiu que "a automação nunca gera os títulos" e que faltava
implementar a tela **com032** ("Financeiro") para criar as parcelas.

Medindo documento a documento no HML, o quadro é outro:

| Evento | Efeito no `mnyTitValor` |
|---|---|
| `gerDocProcesso` (geração) | **nasce** o título, com o valor do header (doc 732: 123,45 sem nenhum item) |
| `comDocProdutos` (linha de item) | **preserva** (doc 735: continua 123,45) |
| `PUT com299` trocando `pgtCod` | **destrói** (→ 0) e **não regenera** — nem reaplicando a MESMA condição (docs 734/735) |
| finalizar **sem** o PUT | fecha: `docVldFinalizado: 1` + título em `lov/TituloBorderoReceber` (docs 736/737) |

Três fatos derivados:

1. **Não falta tela nenhuma.** O ERP materializa o título sozinho; o que existia era um passo **nosso** que
   o destruía. Como o PUT também recalcula `docMnyValor` a partir das linhas, aplicado **antes** do item
   ele zerava o valor do documento junto.
2. **`vldRwCondpgt` não é gatilho de regeneração** — a premissa que sustentava o passo. O campo **já vem
   `1` no GET** do documento, ao lado de `vldRwPlanfin: 1` e `right: "RW"`: é **flag de permissão**, não
   comando. (Afirmação errada registrada em `_inbox/com299-sn-generation-har.md`, seção "IMPLEMENTADO
   2026-08-02".)
3. **A exigência da condição "sugestiva" é POR-PESSOA.** A pessoa 194 em produção exige
   ("L-FOUNDERS - DUPLICATA"); o SKYJACK no HML **não tem nenhuma** e a `com194` devolve `count: 0` — nem
   aviso. O passo não é universal: é uma exigência do **cadastro do cliente**.

E há uma divergência que impede assumir qualquer comportamento: em **produção** (SN 18345, ordem antiga) o
PUT **não** destruiu as parcelas; no **HML**, destrói. A hipótese mais provável é a própria condição de
pagamento envolvida (a de produção tem regra de parcelamento; a `101` do HML, aparentemente não) — **não
confirmado**.

## Decisão

1. **A linha de item vem PRIMEIRO.** `comDocProdutos` antes de qualquer ajuste de condição de pagamento —
   ela preserva o título e materializa o `mnyBruto`.

2. **O ajuste da condição é CONDICIONAL.** Só é aplicado quando a `com194`
   (`documento/list`, `fdvVldTperr: 1`) devolve uma validação **bloqueante** (`fdvVldErr === 2`) cujo texto
   menciona condição de pagamento. **Quem decide é o ERP**, não uma premissa nossa. Leitura
   **best-effort**: `com194` indisponível ⇒ segue **sem** o PUT (hipótese conservadora — não mexer no que
   está íntegro; a finalização continua sendo o discriminador seguinte).

3. **Se aplicado, o efeito é VERIFICADO (fail-closed).** Releitura do documento exigindo
   `mnyTitValor === docMnyValor` e `> 0`. Divergência ⇒ a **etapa falha**, com a causa nomeada e a
   instrução operacional (gerar as parcelas na `com032` e reprocessar) — nunca se manda finalizar um
   documento cujas parcelas foram destruídas, porque a finalização seria recusada ("O TOTAL DOS TÍTULOS …
   NÃO CONFERE") e o `fin014` não acharia o que baixar. Mesma doutrina de **discriminador próprio por
   etapa** da leg fiscal (`integrations/conexos-nde-fiscal.md`): HTTP 200 nunca é sucesso.

4. **Escolha da condição permanece fail-closed** (inalterada, ADR anterior/banner 2026-08-03): só a
   condição do **próprio** cliente (`pgtDesNome` casada contra o `dpeNomPessoa` do documento, LOV paginado
   pelo `count` do envelope). Sem condição do cliente ⇒ erro, nunca a de terceiro.

## Alternativas consideradas

- **Remover o passo da condição de vez** (o HML prova que sem ele a cadeia fecha): **rejeitado** —
  quebraria clientes cujo cadastro exige a condição sugerida (pessoa 194 em produção). A exigência é
  por-pessoa; suprimir o passo trocaria um bug conhecido por outro, silencioso.
- **Manter o PUT incondicional e implementar a regeneração das parcelas via tela `com032`**:
  **rejeitado** — caminho mais longo (exige capturar o HAR da com032), e só necessário se um cliente real
  cair no caso bloqueante **com** PUT destrutivo. Fica como gap registrado
  (`regeneracao-parcelas-com032`, P2), não como dívida em aberto no fluxo.
- **Assumir o comportamento de produção** (PUT não destrói) e seguir sem verificação: **rejeitado** — o
  HML mostra o comportamento oposto com HTTP 200; sem discriminador o erro só apareceria uma etapa depois,
  apontando para o lugar errado (foi exatamente o que aconteceu na Fase B).

## Consequências

- **Positivas:** o "gap dos títulos" fecha sem nenhuma superfície nova de escrita; o caminho feliz passa a
  ter **um PUT a menos** (menos escrita irreversível num documento financeiro real); a falha, quando
  ocorre, é nomeada na etapa que a causou; docs 736/737 no HML ficam disponíveis como os primeiros
  documentos em que a leg `fin014` pode ser exercitada de verdade.
- **Custos / dívidas:** a divergência HML × produção continua **não explicada** (P2 no
  `open-gap` da integração); o caso bloqueante **com** PUT destrutivo termina em falha operacional que
  exige ação manual do analista na `com032` (deliberado); a receita registrada no inbox
  (`com299-sn-generation-har.md`) fica parcialmente superada — marcada no próprio arquivo.

## Fora deste ADR

- **`docEspNumero` = data (`"03082026"`) em vez do nº do PROCESSO** (o título herda `"030820261"`):
  observado na mesma investigação, **não** tratado aqui — follow-up já anotado no inbox do HAR.
- **Percentuais da encomenda** e **fonte dos códigos de rateio por-processo**: gaps anteriores,
  inalterados.
