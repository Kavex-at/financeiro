# O "gap dos títulos" resolvido: o PUT da condição de pagamento é que destrói o título

> Fecha o achado nº 4 de `HANDOFF-proxima-sessao.md` e corrige o diagnóstico de
> `fase-b-rodada2-e-gap-titulos.md`. Medições reais no Conexos HML em 2026-08-03
> (SKYJACK, pri 186, filial 2, R$ 123,45). Testes: `recebimentos.e2e.hmlTitulos*`.

## O diagnóstico anterior estava errado

`fase-b-rodada2-e-gap-titulos.md` concluiu que "a automação nunca gera os títulos" e que faltava
implementar a tela **com032** ("Financeiro"). **Não falta.** O ERP gera o título sozinho na geração
do documento; o que existia era um passo nosso que o **destruía**.

## As medições

Sonda read-only sobre os resíduos da Fase B — o primeiro sinal:

| doc | condição | itens | `mnyTitValor` |
|---|---|---|---|
| 732 (parou antes do item) | `1 A VISTA` (default) | 0 | **123,45** |
| 731 (PUT da condição + item) | `103 BONDUELLE` | 1 | 0 |
| 733 (PUT da condição + item) | `101 SKYJACK - DUPLICATA` | 1 | 0 |

Documento novo, medido passo a passo na ordem ATUAL do produto (`hmlTituloZero`, doc **734**):

| passo | `docMnyValor` | `mnyBruto` | `mnyTitValor` |
|---|---|---|---|
| 0. geração | 123,45 | 0 | **123,45** |
| 1. PUT da condição (1 → 101) | **0** | 0 | **0** |
| 2. linha de item | 0 | 123,45 | 0 |
| 3. reaplicar a condição (101 → 101) | 123,45 | 123,45 | 0 |

Documento novo com a ordem invertida (`hmlTituloOrdem`, doc **735**):

| passo | `docMnyValor` | `mnyTitValor` |
|---|---|---|
| 0. geração | 123,45 | 123,45 |
| 1. linha de item | 123,45 | **123,45** (o item PRESERVA) |
| 2. PUT da condição (1 → 101) | 123,45 | **0** (o PUT DESTRÓI) |

E o fluxo sem o PUT (`hmlTituloCondicao`, docs **736** e **737**):

| variante | após finalizar | com194 | `lov/TituloBorderoReceber` |
|---|---|---|---|
| A — condição no header da geração | `docVldFinalizado: 1` | `count: 0` | `titCod 1 · "030820261" · 123,45` |
| B — sem tocar na condição | `docVldFinalizado: 1` | `count: 0` | `titCod 1 · "030820261" · 123,45` |

## O que ficou provado

1. **O título nasce na geração** do com299, com o valor do header. Nenhuma tela extra é necessária.
2. **O PUT do com299 que troca o `pgtCod` destrói as parcelas e não as regenera.** Reaplicar a mesma
   condição também não regenera (a condição não MUDA, então não há o que reescrever).
3. **O PUT recalcula `docMnyValor` a partir das linhas de item.** Por isso, aplicado antes do item
   (ordem atual), ele zera também o valor do documento — o título ia junto.
4. **`vldRwCondpgt` não é o gatilho de regeneração** que o código assumia: já vem `1` no GET do
   documento, ao lado de `vldRwPlanfin: 1` e `right: "RW"`. É flag de permissão, não comando.
5. **Sem o PUT, a cadeia fecha**: geração → item → finalização (`docVldFinalizado: 1`) → título
   visível no LOV que a `etapaFin014` consulta. O ERP **ignora** `pgtCod` no header da geração.
6. **A condição "sugestiva" do cadastro é exigência POR-PESSOA, não universal.** O SKYJACK (232) no
   HML não tem uma, e a com194 devolveu `count: 0` — nem aviso. A exigência que motivou o passo veio
   da pessoa 194 (L-FOUNDERS) em produção, cujo cadastro sugere "L-FOUNDERS - DUPLICATA".

## Por que produção parecia funcionar

O log do colega (`ontology/_inbox/com299-sn-generation-har.md`, milestone 2026-08-03) registra a SN
**18345** em produção com título materializado (`titCod 4`) usando a ordem atual. Ou seja: em
produção o PUT não destruiu as parcelas, no HML destrói. A diferença mais provável está na condição
de pagamento envolvida (a de produção tem regra de parcelamento; a `101` do HML, aparentemente não).
**Consequência de projeto:** a correção não pode assumir nenhum dos dois comportamentos — tem que
verificar o resultado e falhar fechado quando o título não bater com o documento.

## Decisão (Yuri, 2026-08-03): condicional + fail-closed

- A linha de item vem **antes** da condição de pagamento.
- A condição só é aplicada **se a com194 acusar validação bloqueante de condição de pagamento**.
- Se for aplicada, o resultado é **verificado**: `mnyTitValor === docMnyValor` ou a etapa falha com
  mensagem explícita — nunca finalizar um documento cujas parcelas foram destruídas.

Descartadas: remover o passo de vez (quebraria clientes cujo cadastro exige a condição sugerida) e
manter o PUT capturando o HAR do com032 (caminho mais longo, e só necessário se algum cliente real
cair no caso bloqueante).

## Resíduos no HML após esta investigação

- **734** — ordem atual: item e valor, sem título (não finalizado).
- **735** — ordem invertida: título destruído pelo PUT (não finalizado).
- **736**, **737** — **FINALIZADOS, com título aberto de R$ 123,45** (`titCod 1`). São os primeiros
  documentos do HML em que a leg `fin014` pode ser exercitada de verdade.

Nota lateral: o `docEspNumero` sai como a DATA (`"03082026"`) e o título herda `"030820261"`. As SNs
de produção usam o nº do PROCESSO — follow-up já anotado no HAR do colega, não tocado aqui.
