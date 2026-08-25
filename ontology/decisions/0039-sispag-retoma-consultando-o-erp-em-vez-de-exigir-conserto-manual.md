---
adr_number: 0039
title: O SISPAG retoma uma execução órfã consultando o estado no ERP, em vez de exigir conserto manual no fin015 — e o critério é "o ERP expõe estado verificável daquela escrita?"
date: 2026-08-25
status: accepted
type: change
related_entities: [LotePagamento]
related_actions: [gerar-remessa, conciliar-retorno]
related_integrations: [conexos-fin015, conexos-fin052]
supersedes_decisions: []
amends_decisions: [0013]
---

# ADR 0039: retomar consultando o ERP, em vez de mandar a pessoa no fin015

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:**
`fix/sispag-fin015-import-shape`. **Fonte:** `/feature-tweak` com o Yuri (2026-08-25) — *"user
should be able to retry the sispag workflow and continue from where the flow stopped, and not
need manual fixes in Conexos to do so"*. **`entity_changed = true`** — a doutrina de recuperação
muda, e com ela o contrato de erro das rotas de remessa e conciliação.

## Contexto

O ledger write-ahead (ADR-0013, `idempotencia-reconciliacao.md`) resolveu o problema certo: as
escritas do Conexos não são idempotentes, e um retry cego significa pagar duas vezes. A doutrina
escrita lá é explícita:

> *"Se o processo morre entre o POST e o `markSettled`, a linha fica em `reconciling` — sinal
> explícito de 'verificar no ERP se a baixa entrou' (reconciliação manual), em vez de um silêncio
> que pareceria 'não executado'."*

Isso está certo quanto a **não repetir**. O que ficou faltando é que "reconciliação manual" é o
fim da linha para o operador: um 409, uma ida ao fin015, um lote a cancelar na mão. E o motivo do
409 é sempre o mesmo — **nós** não sabemos se a escrita valeu.

Mas o ERP sabe. Para o `fin015` e o `fin052`, o estado é consultável:

- `flpVldStatus` + `titulosCount` dizem exatamente onde a sequência parou;
- `finItemSispag/list` diz **quais** títulos entraram;
- `processadoEm` no `fin052` responde "o processar já rodou?" sem heurística.

## Decisão

**Onde o ERP expõe estado verificável daquela escrita, a retomada consulta em vez de supor. Onde
não expõe, a doutrina do ADR-0013 continua valendo.**

Este é o critério, e ele é deliberadamente estreito. Não estamos dizendo "retry é seguro agora";
estamos dizendo que *perguntar* é diferente de *supor*. Um retry assume que a escrita não valeu;
a retomada observa o que aconteceu e pula apenas o que já está lá.

Três consequências que valem registrar:

1. **A ordem do write-ahead vira parte da regra, não detalhe de implementação.** A marca d'água
   antes do `criarLote` e o nome do arquivo antes do `gerarRemessa` existem porque sem eles dois
   estados ficam indistinguíveis depois de uma queda. Ver `retomada-remessa-sispag.md`.
2. **Falha de leitura nunca é tratada como ausência.** Um `Set` vazio significaria "nada foi
   importado" e mandaria reimportar tudo; `undefined` significa "não sei" e trava.
3. **Ambiguidade não é resolvida pelo sistema.** Dois lotes com a mesma assinatura, ou um título
   que não é nosso dentro do lote nativo, param. A regra do *exatamente um* é a salvaguarda.

## O caso que a decisão NÃO resolve, e por quê

Lote cancelado por uma pessoa. Cancelar o órfão é literalmente a limpeza que a nossa própria
mensagem de erro prescreve, então o retry seguinte deveria funcionar. Mas o cancelamento também
pode ter sido a decisão de **abortar o pagamento** — e o ERP deixa `flpVldStatus = 2` nos dois
casos. Nenhuma consulta separa as intenções.

Decisão do Yuri: **a tela pergunta.** `LoteAnteriorCanceladoError` (409, `code` próprio) e um
segundo clique explícito. Custa uma interação; a alternativa custava uma ida ao ERP, e a
alternativa oposta — assumir "limpeza" — desfaria uma decisão humana sobre dinheiro.

## Por que a permuta (fin010) não muda junto

Não foi avaliado neste tweak, e mudar por simetria seria exatamente o erro que este ADR evita.
O critério é por-escrita, não por-módulo: a pergunta a fazer é *"o ERP expõe estado verificável
da baixa do fin010?"*. Enquanto ninguém medir isso, o ADR-0013 continua valendo lá integralmente.

## Consequências

**Boas.** Uma queda no meio da remessa deixa de virar chamado. Cinco dos oito desfechos já se
resolviam sozinhos desde o `da2714e`; com este tweak, sete — e o oitavo pergunta em vez de travar.

**Custo.** Uma chamada de leitura a mais no caminho normal (a marca d'água) e duas a três na
retomada. Barato perto de um lote de pagamento duplicado.

**Risco.** A adoção por marca d'água é a única parte com julgamento: a impressão digital é tripla
(flpCod acima da marca + conta + data de débito + lote vazio), mas não é uma chave. A regra do
*exatamente um* transforma o risco de "adotar o lote errado" em "não adotar nenhum" — que é o
lado certo para errar.

**Dívida aberta.** Toda a mecânica é testada contra mock. O gate real é
`jobs/validate-retomada-remessa-v1.ts`, que interrompe a sequência em HML e afirma que a filial
termina com exatamente os lotes esperados. Enquanto ele não rodar, esta decisão está fundamentada
em leitura de estado observado, não em recuperação observada.
