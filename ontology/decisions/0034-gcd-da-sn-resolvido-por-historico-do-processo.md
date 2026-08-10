---
id: 0034
title: O gcd da SN é resolvido pelo HISTÓRICO do processo, não pelo nome da configuração
status: accepted
date: 2026-08-10
deciders: [yuri]
supersedes: []
amends: [0027]
related_files:
  - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  - src/backend/domain/client/ConexosGerDocProcessoClient.ts
  - src/backend/domain/interface/recebimentos/SolicitacaoNumerarioListItem.ts
  - src/backend/domain/libs/environment/EnvironmentProvider.ts
  - src/backend/domain/libs/environment/model/EnvironmentVars.ts
---

# ADR-0034 — O `gcd` da SN é resolvido pelo HISTÓRICO do processo, não pelo nome da configuração

## Contexto

O gate 3 do pré-flight de `gerarSolicitacaoNumerario` decide (a) se o processo aceita uma Solicitação
de Numerário e (b) com qual **Configuração de Documento** (`gcdCod`) ela seria gerada. Até aqui ele
fazia as duas coisas por **casamento de NOME** contra a lista `lov/ConfigDocProcesso`, com o regex
`/SOLICITA[ÇC][ÃA]O\s+DE\s+NUMER[ÁA]RIO/i`.

Em produção (2026-08-10), a analista selecionou a **SN existente 4285** do **processo 699, filial 4**
(cliente ELEVAGE, `pesCod` 5407, R$ 65.618,78) e o Processar foi bloqueado:

```
BLOCKED_ELEGIBILIDADE — Processo 699 NÃO aceita nenhuma "Solicitação de Numerário"
(0 de 29 configurações válidas do processo no Conexos)
```

Sondagem read-only do ERP (mesmas chamadas que a requisição já fazia) mostrou que o veredito era falso:

- Das **29** configs que o processo aceita, **nenhuma** se chama "Solicitação de Numerário". A SN
  daquela filial é a **`gcd 185 "ADIANTAMENTO DE CLIENTES"`**.
- As **7 SNs já existentes** do processo 699 foram **todas** geradas com a `gcd 185`.
- O `gcd 150` (valor do `SN_GCD_COD` global, correto na filial 1) **existe** na lista da filial 4 com
  outro significado: `"IMPLANTAÇÃO DE SALDO FINANCEIRO - CLIENTES NACIONAIS ENCOMENDA"`.

Ou seja: o nome da configuração **não é uniforme entre filiais**, e o `gcd` global é filial-1-cêntrico
por construção. Um segundo defeito, independente, agravava o caso: o gate 3 responde "com qual config a
SN seria **CRIADA**", mas rodava **também** no ramo "SN existente" (ADR-0027), onde nenhuma SN é criada
e o `gcd` resolvido nunca é lido — um veredito irrelevante bloqueava a operação inteira.

## Decisão

**D1 — A 1ª rota de resolução do `gcd` é o HISTÓRICO do próprio processo.** O `gcdCod` da SN mais
recente do processo (`com299/list`, já ordenado por `docCod desc`) é a evidência mais forte disponível:
aquele `gcd` **já gerou SN aceita naquele processo/filial**. O `com299/list` passa a projetar `gcdCod`.

**D2 — Cadeia de fallback explícita, nesta ordem:**

| # | Rota | Fonte | Quando |
|---|------|-------|--------|
| 1 | Histórico | `com299/list` do processo | sempre que o processo já teve SN |
| 2 | Mapa filial → gcd | `SN_GCD_COD_BY_FIL` (`"1:150,4:185"`) | processo sem histórico, filial conhecida |
| 3 | Nome | `SN_CONFIG_NOME_RE` + desempate `SN_GCD_COD` → ENCOMENDA → 1ª | comportamento histórico, preservado |

**D3 — Toda rota é validada contra o `lov/ConfigDocProcesso` antes de virar decisão.** O
`ConfigDocProcesso` continua sendo a autoridade sobre o que o processo aceita; as rotas 1–3 apenas
**escolhem dentro** dela. Um `gcd` que não esteja lá falharia a geração com `gcdDesNomeProc NOT_VALID`,
então é descartado e a resolução cai para a rota seguinte.

**D4 — O `SN_GCD_COD` global NUNCA decide sozinho.** Ele só desempata **dentro da rota 3**, isto é,
entre configs cujo nome já é de SN. Aceitá-lo só por estar presente no `ConfigDocProcesso` geraria, na
filial 4, um "IMPLANTAÇÃO DE SALDO FINANCEIRO" no lugar de uma SN — escrita **irreversível**. Pelo mesmo
motivo o fallback `/ENCOMENDA/i` continua restrito às configs já filtradas por nome de SN.

**D5 — O gate 3 NÃO roda quando a analista selecionou uma SN existente.** Nesse ramo `etapaSn` pula
geração/completação/finalização e o fluxo só roda baixa `fin014` + NDe `com297` contra o `docCod`
escolhido; `preflight.gcdCod`/`gcdDesNome` não são lidos. Os gates **0.5 (modalidade)** e **1
(cadastro)** continuam valendo — eles decidem a baixa e a NDe, que ainda vão acontecer.

**D6 — A variante da config exige o separador `" - "`.** `extrairVarianteSn` só trata o último segmento
como variante quando há `" - "` no nome; sem separador, a variante é `ENCOMENDA`. Sem isso,
`"ADIANTAMENTO DE CLIENTES"` virava a "variante" `ADIANTAMENTO DE CLIENTES` e a conta-alvo do rateio
ficava `"ADIANTAMENTO DE CLIENTE ADIANTAMENTO DE CLIENTES"` — inexistente, com `addLineItem` falhando
**depois** de a SN shell já existir no ERP (documento órfão). Com o fallback, a conta-alvo é
`"ADIANTAMENTO DE CLIENTE ENCOMENDA"`, que a filial 4 tem (`ctpCod` 690, medido 2026-08-10).

**D7 — A origem do `gcd` é auditável.** Quando a decisão não veio do nome, o `motivo` do `READY` diz de
qual rota veio ("histórico de SNs do processo" / "mapa `SN_GCD_COD_BY_FIL` da filial"). Documento
financeiro real gerado: a auditoria precisa saber **por que** aquele `gcd`, não só qual.

## Consequências

**Positivas**

- O gate deixa de depender de uma convenção de nomenclatura que o tenant não garante; passa a
  auto-calibrar por filial/processo sem intervenção.
- O processo 699 (e qualquer outro com histórico de SN) volta a ser processável.
- O ramo "SN existente" deixa de ser refém de um gate que não se aplica a ele.
- O risco de gerar o documento **errado** por causa de um `gcd` global fica explicitamente fechado (D3+D4),
  com teste dedicado.

**Negativas / custos**

- **Um read a mais por Processar** no ramo "criar novo SN" (`com299/list`). Mesma doutrina já aceita para
  a modalidade no gate 0.5 (ADR-0031): leitura barata, idempotente, que decide escrita irreversível.
- Um processo **sem histórico** numa filial **sem mapa** e **sem config com nome de SN** continua
  bloqueado — por decisão (fail-closed). O desbloqueio é cadastrar `SN_GCD_COD_BY_FIL`, não afrouxar o gate.
- A leitura do histórico é **best-effort**: falha do ERP cai para as rotas seguintes (é evidência, não
  autoridade — quem decide elegibilidade continua sendo o `ConfigDocProcesso`).

## Alternativas descartadas

- **Alargar o regex de nome** (aceitar "ADIANTAMENTO DE CLIENTES"): frágil e perigoso. O nome varia por
  tenant/filial sem contrato, e alargar aproximaria o match de configs homônimas de outra família — foi
  exatamente assim que a `150`/"IMPLANTAÇÃO DE SALDO FINANCEIRO - ... ENCOMENDA" entrou no raio do
  fallback `/ENCOMENDA/i`.
- **Só o mapa filial → gcd**, sem histórico: exige descobrir e manter o `gcd` de cada filial à mão, e
  erra em silêncio quando um processo da filial usa outra config. Fica como fallback (rota 2).
- **Confiar no `validaConfigDocPessoa` (gate 2)**: já se sabe que devolve `null` para todo processo,
  inclusive geráveis — por isso ele é NOTA, não decisor.
