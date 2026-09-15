---
adr_number: 0047
title: "Exceção manual \"permutado fora do painel\": o analista corrige a classificação de um adto que o ERP não marcou como permutado"
date: 2026-09-15
status: accepted
type: addition
related_entities: [ExcecaoPermuta, PermutaCandidata, Adiantamento]
related_actions: [elegerAdiantamentos, avaliarElegibilidade, exporNoPainel]
related_business_rules: [elegibilidade-permuta]
related_state_machines: [elegibilidade-permuta-candidata]
evidence:
  - ontology/_inbox/permutas-excecao-manual-interview.md
supersedes_decisions: []
amends_decisions: [0043, 0046]
---

# ADR 0047: exceção manual "permutado fora do painel"

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Frente:** I — Permutas
**Branch:** `fix/permutas-excecao-manual` · **Feature:** `/feature-tweak` `permutas-excecao-manual`
**Decisões de negócio:** tech@kavex.at, 2026-09-15 (abordagem = exceção manual no painel; exibição =
"Já permutado" + tag de exceção).
**Relacionado:** ADR-0006 (identidade do JWT na auditoria), ADR-0007 (`ClienteFiltro`, config do
analista que muda o roteamento), ADR-0043 (`JA_PERMUTADO`), ADR-0046 (tolerância e prioridade dos
motivos). A ADR-0045 está reservada pela branch `feat/metricas-ciclo`.

## Contexto

Adiantamento **8721** (proforma, filial 2, processo 124, COPPER / CODELCO, ref. `0013COO/25`,
USD 3.787.086,38 × 5,3796 = R$ 20.373.009,89). Depois da ingestão de 2026-09-15 11:24 (v0.36.5, já com
a ADR-0046) ficou `BLOQUEADA / sem-saldo-permutar`.

Conexos ao vivo (read-only, 2026-09-15):

- Detalhe `com298`: `mnyTitPermutar = 0`, `mnyTitPermuta` (Valor permutado) **= 0**, `mnyTitAberto = 0,02`.
- Baixas do título 1 da proforma: 15/01 R$ 17.000.000,00 (`gerNum` 38), 16/01 R$ 3.373.009,87 (38) e
  **30/04 R$ 20.373.009,87 (`gerNum` 21, Fornecedores exterior por encomenda)**.
- Invoice **7329** (mesmo processo, USD 3.787.086,38): única baixa **30/04 R$ 20.373.009,87**, principal
  R$ 20.025.734,07, **`gerNum` 198 (Adto fornecedor internacionais)**.

A permuta **aconteceu**: baixas cruzadas manuais 21 ↔ 198 em 30/04, antes de o painel existir. Foi
feita fora do fluxo de permuta do Conexos, que por isso não preencheu "Valor permutado". Pela regra
(ADR-0043/0046), sem `valorPermutado > 0` o motivo é `sem-saldo-permutar` ("nunca teve saldo"). Para
esse documento o motivo é falso e deixa R$ 20 mi na fila de bloqueadas.

É **1 documento**. Os outros 188 adtos pagos e sem saldo são `ja-permutado` marcados pelo próprio
Conexos. Nenhum dado lido distingue, com segurança, "permutado por fora" de "nunca teve saldo".

## Decisão

### D1. Nova entidade de configuração `ExcecaoPermuta`

Mantida pelo analista (admin), no mesmo padrão do `ClienteFiltro` (ADR-0007): a estrutura está na
ontologia e as instâncias são configuração do cliente. Chave natural `adiantamentoDocCod`; no máximo
**uma ativa** por adto; `justificativa` obrigatória (10 a 500 caracteres); `criadoPor`/`criadoEm` e
`removidoPor`/`removidoEm` (soft-delete), com identidade do **JWT verificado**, nunca de input do
cliente (ADR-0006). Ver `entities/excecao-permuta.md`.

### D2. Guarda estreita: só `BLOQUEADA / sem-saldo-permutar`

Marcar só é aceito quando o estado calculado do adto é `BLOQUEADA` com motivo `sem-saldo-permutar`
(pago dentro da tolerância, `valorPermutar ≤ R$1,00`, `valorPermutado` 0/ausente). Qualquer outro
estado ou motivo → recusa (422). A exceção não pode esconder falta de pagamento, saldo real, falta de
D.I ou de invoice.

### D3. Nova transição T7 e novo motivo informativo

```
T7: BLOQUEADA(sem-saldo-permutar) → JA_PERMUTADO
    somente se ExcecaoPermuta ativa(docCod) ∧ guarda(D2) sobre o resultado da avaliação
    motivo = 'permutado-fora-do-painel'
reverso: desfazer (soft-delete) → volta ao estado calculado (BLOQUEADA / sem-saldo-permutar)
```

- Aplicada na **eleição** (cron e botão), depois dos gates e do roteamento de cliente-filtro. É
  mutuamente exclusiva com T4 (T4 exige saldo > R$1,00, T7 exige sem saldo).
- **Reusa o estado `JA_PERMUTADO`**, que é terminal. O motivo novo é informativo, como `ja-permutado`,
  `cliente-filtro` e `composto-nm`.
- **I3 e T1–T6 não mudam.** O fluxo automático segue igual. T7 é o único caminho para
  `permutado-fora-do-painel`.

### D4. O ERP vence

A cada eleição a guarda é reavaliada sobre o dado relido:

- `valorPermutado > 0` → `JA_PERMUTADO / ja-permutado`. O motivo do ERP tem precedência sobre o da
  exceção.
- Saldo reaparece, título reaberto ou qualquer outro resultado → vale o estado calculado. A exceção
  fica registrada, ativa e **não aplicada** (sinalizada como inativa no painel) e a eleição emite
  `BUSINESS_WARN`.

### D5. Exposição

Card e filtro "Já permutado"; badge "Já permutado" + tag **"Exceção manual"**; detalhe com
justificativa, autor, data e ação **"Desfazer exceção"**. Fora da aba Histórico (não há borderô do
painel). Na exportação Excel dos adiantamentos, a coluna `Motivo bloqueio` mantém o código cru
(`permutado-fora-do-painel`), como os demais motivos, e quatro colunas trazem a exceção: `Exceção
manual` (**"Permutado fora do painel (exceção manual)"** quando aplicada, **"Registrada, não
aplicada"** quando o cálculo venceu, vazia sem exceção ativa), `Justificativa exceção`, `Autor exceção`
e `Data exceção`. O snapshot da eleição grava o estado inteiro (ADR-0043): `ja-permutado` com o motivo
novo.

### D6. Sem escrita no ERP

Marcar e desfazer escrevem só no nosso banco. I4 intocado.

## Consequências

- O 8721 sai de "Bloqueadas" e entra em "Já permutado" com trilha auditável de quem marcou, quando e
  por quê. `total_ja_permutado` do header passa a incluir as exceções aplicadas.
- A ingestão (3×/dia + botão) respeita a exceção, e o cálculo continua sendo a fonte da classificação:
  a exceção só troca **um** resultado específico.
- Se o dado do ERP mudar, a exceção não mascara a mudança (D4).
- **Custo aceito:** a classificação desse adto depende de julgamento humano e não de dado do ERP. A
  guarda estreita (D2), a justificativa obrigatória e a trilha limitam o raio.
- **Universalidade.** A forma do conceito (override auditado, restrito a um estado) é de domínio:
  qualquer trading com histórico anterior à ferramenta tem permutas por lançamento manual. A evidência
  hoje é **um cliente e um documento**. Se o uso crescer além de casos isolados, reabrir a alternativa (a)
  com dados.
- Implementada na mesma branch (ontologia v0.26.1): migration 0059, que também estende a guarda de estado colapsado da 0055 ao motivo novo; rotas admin; payload `excecaoManual`; UI.

## Alternativas rejeitadas

- **(a) Regra automática "baixa em conta 21 ⇒ permutado".** A conta da baixa não é marcador confiável.
  O 8721 tem baixa em 21 e o ERP diz permutado = 0. Permutas oficiais também usam a conta 18
  (ADR-0073 do `fechamento-processos`), então a conta sozinha não separa os casos. A calibração contra os
  188 `ja-permutado` ficou bloqueada: o Conexos passou a negar `PSQ_018` ao usuário CLONEX em
  2026-09-15. Sem calibração, a regra seria chute aplicado a todo o backlog.
- **(b) Estornar e refazer a permuta no Conexos.** Resolveria na fonte, mas é uma mudança contábil de
  R$ 20 mi para corrigir um problema de exibição. Rejeitada pelo usuário.
- **(c) `UPDATE` manual no banco.** A ingestão recalcula todos os adtos 3×/dia e no botão, e
  sobrescreveria a correção. Também não deixa trilha de autor e justificativa.
- **(d) Novo estado `EXCECAO`.** Distinguiria o caso na máquina, mas acrescenta um estado ao snapshot,
  ao header, aos CHECKs e aos relatórios para um conceito que, em domínio, **é** "já permutado". O
  usuário escolheu `JA_PERMUTADO` + tag; a distinção fica no motivo.
