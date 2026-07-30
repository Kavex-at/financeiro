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
states: [importada, conciliada, parcial, manual, erro]
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

Tipo: `TransacaoBancariaStatus = 'importada' | 'conciliada' | 'parcial' | 'manual' | 'erro'`
(constantes tipadas — nunca strings cruas; princípio P3 da ontologia).

## Transições (SKELETON — regras detalhadas na Fase 2)

Cada transição é uma **ação nomeada** com registro de vigência (auditoria). Grava ator/gatilho + timestamp.

| # | De → Para | Ação (gatilho) | Regra (SKELETON) | Vigência |
|---|-----------|----------------|------------------|----------|
| TB1 | `(novo) → importada` | `importarTransacoesNexxera` | Movimento importado, normalizado, deduplicado, com correlation id. | 2026-07-24 |
| TB2 | `importada → conciliada` | `atribuirBaixa` (match confiável) | Crédito casa com recebível(is) e é resolvido — Módulo 2. | 2026-07-24 |
| TB3 | `importada → parcial` | `atribuirBaixa` (match parcial) | Parte do valor casa; saldo/diferença registrado. | 2026-07-24 |
| TB4 | `importada → manual` | `atribuirBaixa` (incerto/nenhum) | Match incerto/nenhuma → fila manual (nunca auto-baixa). | 2026-07-24 |
| TB5 | `{importada,parcial,manual} → erro` | (falha de processamento) | Falha reprocessável — sinal explícito para revisão. | 2026-07-24 |

> **SKELETON — o conjunto e a granularidade das transições podem mudar na Fase 2**, quando o motor de
> matching (`atribuirBaixa`) for modelado a fundo. Aqui registram-se os estados universais e o esqueleto
> das transições; a spec precisa é fatia própria.

## Relação com o `Recebimento`

A conciliação em si é o agregado `Recebimento` (`state-machines/recebimento.md`, ciclo
`rascunho → aprovado → executado → estornado`). Esta máquina é o **estado do movimento** (o insumo);
a do `Recebimento` é o **estado da conciliação** (o processo). Um crédito `conciliada`/`parcial`
tipicamente tem um `Recebimento` associado.
