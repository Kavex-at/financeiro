---
id: "0023"
title: Extrato bancário vem do Conexos (fin133 → fin095), não da Nexxera direto; supersede a D4 do ADR-0022 e ENCERRA o spike O7
status: accepted
date: 2026-07-30
type: change
supersedes_decisions: []
amends_decisions: ["0022"]
owners: [yuri]
---

## Contexto

O ADR-0022 (D4) decidiu que o extrato bancário da Frente IV viria da **Nexxera
direto**, com um `NexxeraClient` novo, e abriu o spike **O7** porque o canal era
desconhecido (API JSON? SFTP + CNAB240? OFX?). O O7 passou a ser o bloqueador da
Fase 1 inteira — sem ele, o Módulo 1 não sabia nem de onde ler.

O cliente corrigiu a premissa: *"fin134 para os extratos e imp021 para listar os
processos"*. Sondas READ-ONLY contra a produção (`jobs/probe-fin134.ts`,
`probe-extratos-fase2.ts`, `probe-extratos-fase3.ts`) confirmaram e refinaram.

Isso é coerente com o que o repositório já havia descoberto no SISPAG
(`ontology/_inbox/sispag-native-vs-nexxera.md`): a `fin143` "Importação Nexxera" é
um robô que traz **extratos** para conciliação e alimenta o pipeline do `fin134`.
A Nexxera **já entra pelo ERP** — nós é que planejávamos entrar por fora.

## Decisão

### D1 — A fonte do extrato é o Conexos, não a Nexxera

```
fin133/list  {}                                          → contas financeiras (gerNum + gerDes)
fin095/list  { gerNum, exiVldTipo:2, exiDtaLcto#GE/#LE }  → LANÇAMENTOS (os créditos)
```

Nenhum `NexxeraClient`, nenhuma credencial de VAN, nenhum contrato de fornecedor a
negociar. Reusa o `ConexosBaseClient` que já está em produção.

**O `fin134` não é a fonte dos lançamentos** — ele lista os ARQUIVOS `.RET`
importados (`EXT_341_0641_55795_30072600.RET`), com as colunas `feaCod`,
`feaEspFilename`, `vldStatus`, `vldSit`. O detalhe do lote traz um resumo de
lançamentos, mas quem devolve a linha a linha filtrável é o `fin095`.

**Alternativa rejeitada:** ler pelo detalhe do lote do `fin134`. Amarraria a
ingestão à granularidade de arquivo e exigiria descobrir endpoints de detalhe que
não respondem no padrão `/list`. O `fin095` filtra por conta, tipo e data — que é
exatamente o recorte que o painel precisa.

### D2 — O spike O7 está ENCERRADO

Não há canal a descobrir. O port `NexxeraGatewayInterface` permanece no código
para uma eventual ingestão por arquivo CNAB, mas **não está no caminho da Fase 1**:
o `IngestaoTransacoesService` injeta o `ConexosExtratoClient` diretamente, como o
`IngestaoPagamentosService` faz com o `ConexosSispagClient`.

**Dívida registrada (P2):** o nome do port ficou desalinhado com a realidade —
`NEXXERA_GATEWAY_TOKEN` não é usado pela ingestão real. Renomear quando houver a
segunda fonte.

### D3 — `gerNum` é coluna, não JSONB

A conta financeira (`gerNum` do `fin133`) é a **"Conta Financeira de Baixa"** que o
`fin014` exige ao registrar a quitação na Fase 5 — confirmado no runbook manual do
cliente (print do `fin014` com `Conta Financeira de Baixa = 38`, a mesma
`gerNum 38 = BANCO ITAÚ - AG. 0641 CONTA 55.795-4` do `fin133`). Enterrá-la num
`normalized->>'gerNum'` significaria um cast num caminho que move dinheiro.

### D4 — A contraparte do extrato é DICA, nunca chave

O `exiEspHistorico` é o único sinal de pagador, e o banco o **trunca em ~24
caracteres**: `"TED 745.0001.BROWN-FORMA"` para BROWN-FORMAN,
`"SISPAG  BELLIZ INDUSTRIA"` para BELLIZ INDUSTRIA, COMERCIO, IMPORTA. Não há CNPJ,
não há `pesCod`, e o ERP classifica boa parte como `"CRÉDITO DESCONHECIDO"`.

Consequência de desenho: **o analista escolhe o cliente**. O sistema pré-seleciona
por casamento de prefixo (visível e trocável) e lista os processos daquele cliente
via `imp021` filtrado por `pesCod`. Isso preserva o invariante do ADR-0022 —
*match incerto nunca auto-baixa*.

### D5 — Ruído de tesouraria é escondido na exibição, nunca descartado na ingestão

Medição em produção (filial 1, 90 dias, 1.759 créditos):

| Categoria | Qtd |
|---|---|
| 209 TRANSFERÊNCIA INTERBANCÁRIA (DOC, TED) | 915 |
| 205 LANÇAMENTO AVISADO | 498 |
| **206 RESGATE DE APLICAÇÃO** | 239 |
| 299 CRÉDITO DESCONHECIDO | 34 |
| 202 LÍQUIDO DE COBRANÇA | 19 |
| **210 AÇÕES** | 18 |
| **213 TRANSFERÊNCIA ENTRE CONTAS** | 14 |

As categorias em negrito são movimento da própria Columbia, não recebimento de
cliente. O painel as esconde por default (`CATEGORIAS_TESOURARIA`), mas a ingestão
**persiste tudo**: o extrato é fonte da verdade e um descarte gravado no banco não
teria volta. O filtro é de apresentação e reversível por query.

### D6 — A conciliação do ERP NÃO é a nossa

O `fin095` traz `vldConciliado`/`vldStatusConciliacao`. Isso é conciliação
**banco × extrato-de-sistema** do próprio ERP. A nossa é **crédito × processo do
cliente**. Mapear uma na outra faria o painel declarar resolvido o que ninguém
alocou. O sinal do ERP vai para `normalized.conciliadoNoErp` como informação;
`status` nasce sempre `importada`.

## Consequências

- **A Fase 1 (Módulo 1) está desbloqueada e implementada.** `job:ingest-extratos`
  roda contra produção: 1.759 créditos na filial 1 em 90 dias, reingestão
  deduplica 100%, e transação já trabalhada pelo analista sobrevive ao reimport.
- `ontology/actions/recebimentos/importar-transacoes-nexxera.md` fica com o nome
  errado — a fonte não é Nexxera. Renomeado para `importar-transacoes-extrato.md`.
- Nova integração documentada: `integrations/conexos-fin095-extrato.md`.
- A `naturalKey` sai de "fórmula exata na Fase 1" para
  `fin095:{filCod}:{gerNum}:{extCod}:{exiCodSeq}`.
- **Nova constatação operacional:** o Conexos limita sessões simultâneas por
  usuário (`LOGIN_ERROR_MAX_SESSIONS`). O cron da ingestão vai competir por sessão
  com o app rodando — vale um usuário de robô separado antes de agendar.
