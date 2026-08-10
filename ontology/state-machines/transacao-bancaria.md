---
name: transacao-bancaria
type: state-machine
entity: TransacaoBancaria
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-07-24
states: [importada, conciliada, parcial, manual, erro, processada]
out_of_scope_states: []
---

# Ciclo de vida — `TransacaoBancaria` (movimento bancário — Frente IV) — SKELETON

> **SKELETON (Fase 0).** Modela o estado da conciliação de um movimento bancário importado do
> Nexxera. É estado **local/persistido** (`transacao_bancaria.status`), não do banco/Nexxera. A
> semântica de transição profunda (regras de matching, parcialidade) é modelada nas ações
> (`atribuirBaixa`, Fase 2) — aqui só a **forma** dos estados. Ver `entities/transacao-bancaria.md`.

## Estados (constantes tipadas)

| Constante | Valor | Significado |
|-----------|-------|-------------|
| `importada` | `importada` | Movimento importado e normalizado (estado inicial). Ainda não conciliado. |
| `conciliada` | `conciliada` | Crédito atribuído a recebível(is) com confiança e executado/pronto (match `unica`/`multiplas` resolvido). |
| `parcial` | `parcial` | Parte do valor casada; resta saldo (diferença registrada / possível `CreditoCliente`). |
| `manual` | `manual` | Match incerto/nenhum → **fila de análise manual** (invariante "sem baixa incorreta"). |
| `erro` | `erro` | Falha no processamento (importação/normalização/execução) — reprocessável. |
| `processada` | `processada` | **TERMINAL operacional** (ADR-0033). A alocação foi executada até o fim — SN + baixa `fin014`, com NDe (`concluido`) ou sem ela (`quitado-sem-nde`). As duas contam: a diferença entre elas é FISCAL, não operacional, e quem a carrega é a modalidade. Nada mais a fazer. |

Tipo: `TransacaoBancariaStatus = 'importada' | 'conciliada' | 'parcial' | 'manual' | 'erro' | 'processada'`
(constantes tipadas — nunca strings cruas; princípio P3 da ontologia).

> ⚠️ **Até a ADR-0033 esta máquina nunca rodou.** Não havia caminho de escrita de status: o
> repositório não tinha update e nenhuma linha saía de `importada`, mesmo com alocações executadas —
> era por isso que o painel mostrava centenas de `importada` e zero conciliações. `TB6` é a primeira
> transição realmente implementada depois de `TB1`.

## Transições (SKELETON — regras detalhadas na Fase 2)

Cada transição é uma **ação nomeada** com registro de vigência (auditoria). Grava ator/gatilho + timestamp.

| # | De → Para | Ação (gatilho) | Regra (SKELETON) | Vigência |
|---|-----------|----------------|------------------|----------|
| TB1 | `(novo) → importada` | `importarTransacoesExtrato` | **Implementada** (ADR-0023/0028). Lançamento do `fin095` importado, normalizado, deduplicado por `natural_key`, com correlation id determinístico. Nasce **sempre** `importada` — o `vldConciliado` do ERP não é a nossa conciliação. | 2026-08-04 |
| TB2 | `importada → conciliada` | `atribuirBaixa` (match confiável) | Crédito casa com recebível(is) e é resolvido — Módulo 2. | 2026-07-24 |
| TB3 | `importada → parcial` | `atribuirBaixa` (match parcial) | Parte do valor casa; saldo/diferença registrado. | 2026-07-24 |
| TB4 | `importada → manual` | `atribuirBaixa` (incerto/nenhum) | Match incerto/nenhuma → fila manual (nunca auto-baixa). | 2026-07-24 |
| TB5 | `{importada,parcial,manual} → erro` | (falha de processamento) | Falha reprocessável — sinal explícito para revisão. | 2026-07-24 |
| TB6 | `{importada,conciliada,parcial,manual,erro} → processada` | settle do ledger da alocação (`gerarSolicitacaoNumerario`) | **Implementada** (ADR-0033). Escrita quando a execução settla, nos dois ramos (`concluido` e `quitado-sem-nde`). Parte de `erro` também: a re-execução que dá certo leva ao terminal. NÃO propaga falha — quando roda, o dinheiro já se moveu no ERP; divergência vira `BUSINESS_WARN`. | 2026-08-10 |

`processada` é terminal de verdade: não sai dele.

## Arquivamento (ortogonal ao status)

`arquivada_em`/`arquivada_por` (ADR-0033) **não** são estados: um crédito arquivado preserva o status
que tinha. Arquivar é um gesto de organização da carteira — tira o crédito da listagem **e dos
KPIs** —, pensado para o ruído de tesouraria (resgate de aplicação, transferência entre contas) que
nunca será conciliado contra processo. Reversível.

> **SKELETON — o conjunto e a granularidade das transições podem mudar na Fase 2**, quando o motor de
> matching (`atribuirBaixa`) for modelado a fundo. Aqui registram-se os estados universais e o esqueleto
> das transições; a spec precisa é fatia própria.

## Relação com o `Recebimento`

A conciliação em si é o agregado `Recebimento` (`state-machines/recebimento.md`, ciclo
`rascunho → aprovado → executado → estornado`). Esta máquina é o **estado do movimento** (o insumo);
a do `Recebimento` é o **estado da conciliação** (o processo). Um crédito `conciliada`/`parcial`
tipicamente tem um `Recebimento` associado.
