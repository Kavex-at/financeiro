---
name: nde-dispensada-conta-e-ordem
type: business-rule
entity: NotaDebitoEletronica
ontology_version: "0.16"
implementation_status: implemented
status: stable
owners: [yuri]
invariant: I-Receb-4
related_files:
  - src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts
  - src/backend/domain/interface/recebimentos/constants.ts
  - src/backend/domain/interface/recebimentos/ports.ts
  - src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts
  - src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx
last_review: 2026-08-07
has_canonical_test: true
---

# Regra: nde-dispensada-conta-e-ordem (a NDe não é devida em conta e ordem) — I-Receb-4

> **Invariante I-Receb-4 — NDe só quando devida.** Uma alocação de recebimento **NÃO** emite Nota de
> Débito Eletrônica quando o processo de importação é **POR CONTA E ORDEM DE TERCEIROS**
> (`imp021.priVldTipo = 2`): a documentação fiscal do repasse sai em nome do terceiro, não da
> Columbia. A alocação quita com **SN (com299) + baixa (fin014)** e termina em `quitado-sem-nde`.
> A modalidade é lida **do `imp021`, no servidor**; se não for determinável, a alocação é
> **BLOQUEADA** (fail-closed) em vez de adivinhada. Introduzido pela ADR-0031.

## Enunciado

```
priVldTipo == 2  ⇒  SN + fin014, e PARA          # sem com297 / com300 / com131 / poll SEFAZ
                    etapa terminal = 'quitado-sem-nde'
                    nd_doc_cod = NULL             # não é lacuna: não era devida

priVldTipo ∈ {1, 3}  ⇒  trilha completa, com NDe homologada

priVldTipo indeterminável  ⇒  blocked            # nada escrito; nem o write-ahead abre
  (processo ausente no imp021 | campo nulo | read falhou)
```

## Por que fail-closed, e não um default

Os dois erros possíveis não custam a mesma coisa:

| Chute | Consequência |
|-------|--------------|
| Assumir "não é conta e ordem" e emitir | **NDe homologada indevida** — fato fiscal **irreversível**, sem teardown no com297 |
| Assumir "é conta e ordem" e não emitir | Deixa de emitir nota legítima, **em silêncio** — descoberto tarde, na conciliação |
| Bloquear | Um analista preenche o campo "Tipo" no Conexos e reprocessa |

Só o terceiro é recuperável, então é o escolhido. O `motivo` nomeia o campo (`priVldTipo`) e o
`priCod` justamente para que a correção não precise de investigação.

## Ponto de enforcement

**Gate 0.5 do pré-flight** (`classificarAlocacao`), antes do gate 1 de cadastro e antes de qualquer
escrita. A decisão viaja no `PreflightResult` (`priVldTipo`, `ndeDispensada`) até o `EscritaCtx`, e
`rodarEtapas` desvia para `quitarSemNde` logo após `fin014-done`.

Rodar no pré-flight (e não só na execução) faz o **dry-run** herdar a regra de graça: o preview já
avisa que a nota não sairá, antes de o analista disparar a execução real.

## O que NÃO é o gatilho

A **variante da config de SN** (`"SOLICITAÇÃO DE NUMERÁRIO - TERCEIROS"`, gcd 151), derivada por
`extrairVarianteSn` para escolher a conta de rateio, **não** decide esta regra (ADR-0031 D3). São
eixos independentes:

| Eixo | O que descreve | Onde é usado |
|------|----------------|--------------|
| `imp021.priVldTipo` | modalidade do PROCESSO | esta regra (emite NDe ou não) |
| `gcdDesNome` da config | qual config de SN o processo aceita no com299 | conta de rateio da linha de item |

Um processo pode ter `priVldTipo = 2` e ainda assim oferecer só a config `- ENCOMENDA`. Os dois
aparecem como notas independentes no `motivo` do pré-flight READY.

## Distinção — I-Receb-4 × I-Receb-3 × I-Receb-1

| Invariante | Pergunta que responde |
|------------|-----------------------|
| **I-Receb-1** (`invariante-rateio`) | quanto posso distribuir deste pagamento? |
| **I-Receb-3** (`alocacao-sn-existente`) | quanto posso baixar contra ESTA SN existente? |
| **I-Receb-4** (esta) | esta alocação deve gerar nota de débito? |

Ortogonais: uma alocação conta e ordem contra SN existente obedece às três.

## Trilha de auditoria

`etapa = 'quitado-sem-nde'` com `status = 'settled'` e `nd_doc_cod IS NULL` significa **"não era
devida"**. É o par que distingue esse desfecho de uma execução que parou antes de emitir (`status =
'error'`, com a etapa da falha). Consultável por `GET /recebimentos/execucoes?txnId=...`.

## Testes canônicos

- `RecebimentoNumerarioService.test.ts` → describe `NDe dispensada (ADR-0031)`: trilha curta, ledger,
  regressão de `priVldTipo` 1/3, os três caminhos de bloqueio, filial do processo, dry-run e re-POST.
- `recebimentos.e2e.falhas.test.ts` → `Cenário 5`: prova por HTTP, contra o ERP fake, que **nenhuma**
  operação de documento chega ao com297/com300/com131.
- `SolicitacaoNumerarioExecucaoRepository.test.ts` → override de `etapa` no `markSettled`.
- `AlocarProcessosDialog.test.tsx` → badge "Sem nota de débito", ausência da linha "Nota de débito",
  e `blocked` que não vira "Quitado".
